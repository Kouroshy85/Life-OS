import { Moon, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { textProblem } from "../../domain/text";
import { formatFullDate, toDateKey } from "../../domain/time";
import type { Dream } from "../../domain/types";
import { t } from "../../i18n";
import { newId, nowIso } from "../../persistence/repository";
import { deleteDream, saveDream, useApp } from "../../state/store";
import { TextArea, TextInput } from "../../ui/fields";
import { Button, Confirm, Dialog, Empty, Field, IconButton } from "../../ui/primitives";
import { Wizard, WizardDone, WizardError, WizardQuestion } from "../../ui/Wizard";
import { textErrorMessage } from "../planner/PlanWizard";

const dreamDate = (d: Dream) => formatFullDate(toDateKey(new Date(d.createdAt)));

export function DreamsView() {
  const dreams = useApp((s) => s.dreams);
  const [writing, setWriting] = useState<{ dream: Dream | null } | null>(null);
  const [reading, setReading] = useState<Dream | null>(null);
  const [removing, setRemoving] = useState<Dream | null>(null);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{t.dreamsEyebrow}</div>
          <h1 className="page-title" tabIndex={-1} data-page-heading>
            {t.navDreams}
          </h1>
          <p className="page-sub">{t.dreamsSub}</p>
        </div>
        <Button variant="primary" size="lg" icon={<Plus size={17} />} onClick={() => setWriting({ dream: null })}>
          {t.writeDream}
        </Button>
      </div>

      {dreams.length === 0 ? (
        <div className="card rise">
          <Empty
            icon={<Moon size={22} />}
            title={t.dreamsEmpty}
            text={t.dreamsEmptyText}
            action={
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => setWriting({ dream: null })}>
                {t.writeDream}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="dream-grid">
          {dreams.map((d, i) => (
            <article key={d.id} className="dream-card" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
              <button type="button" className="dream-card__open" onClick={() => setReading(d)}>
                <strong className="dream-card__title">{d.title}</strong>
                {d.body && <p className="dream-card__body">{d.body}</p>}
                <span className="dream-card__date tabular">{dreamDate(d)}</span>
              </button>
              <div className="dream-card__actions">
                <IconButton label={t.editDreamOf(d.title)} onClick={() => setWriting({ dream: d })}>
                  <Pencil size={15} />
                </IconButton>
                <IconButton label={t.deleteDreamOf(d.title)} onClick={() => setRemoving(d)}>
                  <Trash2 size={15} />
                </IconButton>
              </div>
            </article>
          ))}
        </div>
      )}

      <DreamWizard open={!!writing} dream={writing?.dream ?? null} onClose={() => setWriting(null)} />

      {reading && (
        <Dialog
          open
          wide
          onClose={() => setReading(null)}
          title={reading.title}
          subtitle={dreamDate(reading)}
          footer={
            <Button
              variant="glass"
              icon={<Pencil size={14} />}
              onClick={() => {
                setWriting({ dream: reading });
                setReading(null);
              }}
            >
              {t.edit}
            </Button>
          }
        >
          <p className="dream-read">{reading.body || t.dreamNoStory}</p>
        </Dialog>
      )}

      <Confirm
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={t.deleteDreamQ}
        message={removing ? t.deleteDreamMsg(removing.title) : ""}
        onConfirm={() => removing && deleteDream(removing.id)}
      />
    </div>
  );
}

const STEP_TITLE = 0;
const STEP_BODY = 1;
const STEP_DONE = 2;

function DreamWizard({ open, dream, onClose }: { open: boolean; dream: Dream | null; onClose: () => void }) {
  const [step, setStep] = useState(STEP_TITLE);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(STEP_TITLE);
    setDirection(1);
    setTitle(dream?.title ?? "");
    setBody(dream?.body ?? "");
    setError(null);
  }, [open, dream]);

  const go = (next: number) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
    setError(null);
  };

  const next = async () => {
    if (step === STEP_TITLE) {
      const problem = textErrorMessage(textProblem(title));
      if (problem) return setError(problem);
      return go(STEP_BODY);
    }
    const problem = textErrorMessage(textProblem(body));
    if (problem) return setError(problem);
    const saved = await saveDream({ id: dream?.id ?? newId(), title: title.trim(), body: body.trim(), createdAt: dream?.createdAt ?? nowIso() });
    if (saved) go(STEP_DONE);
  };

  return (
    <Wizard
      open={open}
      onClose={onClose}
      title={dream ? t.editDream : t.writeDream}
      step={step}
      total={STEP_DONE + 1}
      direction={direction}
      onBack={step === STEP_BODY ? () => go(STEP_TITLE) : undefined}
      onNext={next}
      nextLabel={step === STEP_BODY ? t.saveDream : t.continue}
      hideFooter={step === STEP_DONE}
    >
      {step === STEP_TITLE && (
        <>
          <WizardQuestion title={t.qDreamTitle} />
          <Field label={t.taskTitle}>
            <TextInput className="wiz-input" value={title} maxLength={100} placeholder={t.dreamTitlePh} onChange={(e) => { setTitle(e.target.value); setError(null); }} />
          </Field>
        </>
      )}
      {step === STEP_BODY && (
        <>
          <WizardQuestion title={t.qDreamBody} hint={t.hintDreamBody} />
          <Field label={t.dreamBodyLabel}>
            <TextArea rows={6} value={body} maxLength={4000} onChange={(e) => { setBody(e.target.value); setError(null); }} />
          </Field>
        </>
      )}
      {step === STEP_DONE && (
        <WizardDone
          title={dream ? t.dreamUpdated : t.dreamSaved}
          action={
            <Button variant="primary" onClick={onClose} data-step-focus>
              {t.doneThanks}
            </Button>
          }
        >
          <p className="muted">{t.dreamSavedText}</p>
        </WizardDone>
      )}
      {error && <WizardError>{error}</WizardError>}
    </Wizard>
  );
}
