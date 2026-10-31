import { BellRing, ChevronLeft, ChevronRight, Pencil, Plus, StickyNote, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getLang, num } from "../../domain/locale";
import { textProblem } from "../../domain/text";
import { dateTimeKey, formatClock, formatShortDate, parseDateTimeKey } from "../../domain/time";
import type { Note, NoteUrgency } from "../../domain/types";
import { t } from "../../i18n";
import { newId, nowIso } from "../../persistence/repository";
import { deleteNote, dismissReminder, saveNote, useApp } from "../../state/store";
import { DateInput, TextArea, TextInput, TimeInput } from "../../ui/fields";
import { Button, Dialog, Field, IconButton, Switch } from "../../ui/primitives";
import { Wizard, WizardDone, WizardError, WizardQuestion } from "../../ui/Wizard";
import { textErrorMessage } from "../planner/PlanWizard";

const VISIBLE = 4;
const SHUFFLE_MS = 520;

const reminderLabel = (remindAt: string) => {
  const { date, min } = parseDateTimeKey(remindAt);
  return `${formatShortDate(date)} · ${formatClock(min)}`;
};

/** Cards stacked like a deck. Moving on sends the top card round to the back, like shuffling. */
function useDeck(count: number) {
  const [index, setIndex] = useState(0);
  const [flying, setFlying] = useState<{ index: number; dir: 1 | -1 } | null>(null);
  useEffect(() => {
    if (count && index >= count) setIndex(0);
  }, [count, index]);
  const shuffle = useCallback(
    (dir: 1 | -1) => {
      if (count < 2) return;
      setIndex((i) => {
        // Going forward, the old top card flies out. Going back, the new top card flies in.
        setFlying({ index: dir === 1 ? i : (i - 1 + count) % count, dir });
        return (i + dir + count) % count;
      });
    },
    [count],
  );
  useEffect(() => {
    if (!flying) return;
    const id = setTimeout(() => setFlying(null), SHUFFLE_MS);
    return () => clearTimeout(id);
  }, [flying]);
  return { index: count ? Math.min(index, count - 1) : 0, setIndex, flying, shuffle };
}

function NoteFace({ note, full }: { note: Note; full?: boolean }) {
  return (
    <>
      <span className="note-card__level">
        <i />
        {t.urgency[note.urgency]}
      </span>
      <strong className="note-card__title">{note.title}</strong>
      {note.description && <p className={`note-card__desc ${full ? "note-card__desc--full" : ""}`}>{note.description}</p>}
      {note.remindAt && (
        <span className="note-card__remind tabular">
          <BellRing size={12} />
          {reminderLabel(note.remindAt)}
        </span>
      )}
    </>
  );
}

function Deck({ notes, index, flying, full, onTop }: { notes: Note[]; index: number; flying: { index: number; dir: 1 | -1 } | null; full?: boolean; onTop?: () => void }) {
  const count = notes.length;
  return (
    <div className={`deck ${full ? "deck--full" : ""}`}>
      {notes.map((note, i) => {
        const offset = (i - index + count) % count;
        const fly = flying?.index === i;
        if (offset >= VISIBLE && !fly) return null;
        const side = offset % 2 === 0 ? 1 : -1;
        return (
          <button
            key={note.id}
            type="button"
            tabIndex={offset === 0 && onTop ? 0 : -1}
            aria-hidden={offset !== 0}
            className={`note-card note-card--u${note.urgency} ${fly ? `note-card--fly-${flying!.dir === 1 ? "out" : "in"}` : ""}`}
            style={{
              zIndex: VISIBLE + 2 - offset,
              ["--off" as string]: offset,
              ["--tilt" as string]: `${offset === 0 ? 0 : side * (1 + offset * 0.9)}deg`,
            }}
            onClick={offset === 0 ? onTop : undefined}
          >
            <NoteFace note={note} full={full} />
          </button>
        );
      })}
    </div>
  );
}

export function NotesSection() {
  const stored = useApp((s) => s.notes);
  const notes = stored;
  const [viewing, setViewing] = useState(false);
  const [editing, setEditing] = useState<{ note: Note | null } | null>(null);
  const deck = useDeck(notes.length);
  const top = notes[deck.index];

  useEffect(() => {
    if (!viewing) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector(".wiz-step")) return;
      const forward = getLang() === "fa" ? "ArrowLeft" : "ArrowRight";
      const backward = getLang() === "fa" ? "ArrowRight" : "ArrowLeft";
      if (e.key === forward) deck.shuffle(1);
      else if (e.key === backward) deck.shuffle(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing, deck.shuffle]);

  useEffect(() => {
    if (viewing && notes.length === 0) setViewing(false);
  }, [viewing, notes.length]);

  return (
    <section className="card rise rise-2 today-priorities notes-section" aria-labelledby="notes-title">
      <div className="card__title">
        <span id="notes-title">
          {t.notesTitle} {notes.length > 0 && <span className="faint tabular">{num(notes.length)}</span>}
        </span>
        <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setEditing({ note: null })}>
          {t.addNote}
        </Button>
      </div>
      {notes.length === 0 ? (
        <div className="notes-empty">
          <span className="empty__icon"><StickyNote size={20} /></span>
          <p className="faint">{t.notesEmpty}</p>
        </div>
      ) : (
        <>
          <Deck notes={notes} index={deck.index} flying={deck.flying} onTop={() => setViewing(true)} />
          {notes.length > 1 && (
            <div className="deck-nav">
              <IconButton label={t.prevNote} onClick={() => deck.shuffle(-1)}>
                <ChevronLeft size={16} className="flip-rtl" />
              </IconButton>
              <span className="faint tabular">{t.noteOf(num(deck.index + 1), num(notes.length))}</span>
              <IconButton label={t.nextNote} onClick={() => deck.shuffle(1)}>
                <ChevronRight size={16} className="flip-rtl" />
              </IconButton>
            </div>
          )}
        </>
      )}

      <Dialog
        open={viewing && !!top}
        onClose={() => setViewing(false)}
        title={t.notesTitle}
        subtitle={notes.length > 1 ? t.notesShuffleHint : undefined}
        footer={
          top && (
            <>
              <Button
                variant="danger-ghost"
                icon={<Trash2 size={15} />}
                onClick={() => deleteNote(top.id)}
              >
                {t.delete}
              </Button>
              <span className="spacer" />
              <Button
                variant="glass"
                icon={<Pencil size={14} />}
                onClick={() => {
                  setViewing(false);
                  setEditing({ note: top });
                }}
              >
                {t.edit}
              </Button>
            </>
          )
        }
      >
        <Deck notes={notes} index={deck.index} flying={deck.flying} full />
        {notes.length > 1 && (
          <div className="deck-nav">
            <Button variant="glass" size="sm" icon={<ChevronLeft size={15} className="flip-rtl" />} onClick={() => deck.shuffle(-1)}>
              {t.prevNoteShort}
            </Button>
            <span className="faint tabular">{t.noteOf(num(deck.index + 1), num(notes.length))}</span>
            <Button variant="glass" size="sm" icon={<ChevronRight size={15} className="flip-rtl" />} onClick={() => deck.shuffle(1)}>
              {t.nextNoteShort}
            </Button>
          </div>
        )}
      </Dialog>

      <NoteWizard open={!!editing} note={editing?.note ?? null} onClose={() => setEditing(null)} />
    </section>
  );
}

const STEP_TITLE = 0;
const STEP_DESC = 1;
const STEP_LEVEL = 2;
const STEP_REMIND = 3;
const STEP_DONE = 4;

function NoteWizard({ open, note, onClose }: { open: boolean; note: Note | null; onClose: () => void }) {
  const clock = useApp((s) => s.clock);
  const [step, setStep] = useState(STEP_TITLE);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState<NoteUrgency>(1);
  const [remind, setRemind] = useState(false);
  const [date, setDate] = useState<string | null>(clock.today);
  const [time, setTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(STEP_TITLE);
    setDirection(1);
    setTitle(note?.title ?? "");
    setDescription(note?.description ?? "");
    setUrgency(note?.urgency ?? 1);
    const at = note?.remindAt ? parseDateTimeKey(note.remindAt) : null;
    setRemind(!!at);
    setDate(at?.date ?? clock.today);
    setTime(at?.min ?? Math.min(1435, Math.ceil((clock.nowMin + 30) / 15) * 15));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, note]);

  const go = (next: number) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
    setError(null);
  };

  const next = async () => {
    if (step === STEP_TITLE) {
      const problem = textErrorMessage(textProblem(title));
      if (problem) return setError(problem);
      return go(STEP_DESC);
    }
    if (step === STEP_DESC) {
      const problem = textErrorMessage(textProblem(description, { required: false }));
      if (problem) return setError(problem);
      return go(STEP_LEVEL);
    }
    if (step === STEP_LEVEL) return go(STEP_REMIND);
    if (step === STEP_REMIND) {
      let remindAt: string | null = null;
      if (remind) {
        if (!date || time == null) return setError(t.errRemindMissing);
        remindAt = dateTimeKey(date, time);
        if (remindAt <= dateTimeKey(clock.today, clock.nowMin)) return setError(t.errRemindPast);
      }
      const saved = await saveNote({
        id: note?.id ?? newId(),
        title: title.trim(),
        description: description.trim(),
        urgency,
        remindAt,
        reminded: note?.remindAt === remindAt ? (note?.reminded ?? false) : false,
        createdAt: note?.createdAt ?? nowIso(),
      });
      if (saved) go(STEP_DONE);
    }
  };

  return (
    <Wizard
      open={open}
      onClose={onClose}
      title={note ? t.editNote : t.addNote}
      step={step}
      total={STEP_DONE + 1}
      direction={direction}
      onBack={step > STEP_TITLE ? () => go(step - 1) : undefined}
      onNext={next}
      nextLabel={step === STEP_REMIND ? t.saveNote : t.continue}
      hideFooter={step === STEP_DONE}
    >
      {step === STEP_TITLE && (
        <>
          <WizardQuestion title={t.qNoteTitle} />
          <Field label={t.taskTitle}>
            <TextInput className="wiz-input" value={title} maxLength={80} placeholder={t.noteTitlePh} onChange={(e) => { setTitle(e.target.value); setError(null); }} />
          </Field>
        </>
      )}
      {step === STEP_DESC && (
        <>
          <WizardQuestion title={t.qNoteDesc} hint={t.optional} />
          <Field label={t.descriptionLabel}>
            <TextArea rows={4} value={description} maxLength={600} onChange={(e) => { setDescription(e.target.value); setError(null); }} />
          </Field>
        </>
      )}
      {step === STEP_LEVEL && (
        <>
          <WizardQuestion title={t.qNoteLevel} />
          <div className="urgency-grid" role="radiogroup" aria-label={t.qNoteLevel}>
            {([1, 2, 3] as NoteUrgency[]).map((u) => (
              <button key={u} type="button" role="radio" aria-checked={urgency === u} className={`urgency urgency--u${u} ${urgency === u ? "urgency--on" : ""}`} onClick={() => setUrgency(u)}>
                <strong className="tabular">{num(u)}</strong>
                <span>{t.urgency[u]}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {step === STEP_REMIND && (
        <>
          <WizardQuestion title={t.qNoteRemind} hint={t.hintNoteRemind} />
          <label className="check wiz-switch">
            <span>{t.remindMe}</span>
            <Switch checked={remind} onChange={(v) => { setRemind(v); setError(null); }} label={t.remindMe} />
          </label>
          {remind && (
            <div className="wiz-times">
              <Field label={t.commitDate}>
                <DateInput required value={date} onChange={(v) => { setDate(v); setError(null); }} />
              </Field>
              <Field label={t.remindTime}>
                <TimeInput value={time} allowEmpty onChange={(v) => { setTime(v); setError(null); }} />
              </Field>
            </div>
          )}
        </>
      )}
      {step === STEP_DONE && (
        <WizardDone
          title={note ? t.noteUpdated : t.noteSaved}
          action={
            <Button variant="primary" onClick={onClose} data-step-focus>
              {t.doneThanks}
            </Button>
          }
        />
      )}
      {error && <WizardError>{error}</WizardError>}
    </Wizard>
  );
}

export function ReminderDialog() {
  const note = useApp((s) => s.reminderNote);
  if (!note) return null;
  return (
    <Dialog
      open
      onClose={dismissReminder}
      title={t.reminderTitle}
      footer={
        <Button variant="primary" onClick={dismissReminder}>
          {t.gotIt}
        </Button>
      }
    >
      <div className={`note-card note-card--solo note-card--u${note.urgency}`}>
        <NoteFace note={note} full />
      </div>
    </Dialog>
  );
}

export function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <time className="live-clock tabular" dateTime={now.toISOString()}>
      {formatClock(now.getHours() * 60 + now.getMinutes())}
      <small>{num(String(now.getSeconds()).padStart(2, "0"))}</small>
    </time>
  );
}
