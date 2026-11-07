import { ArrowRight, Check, CircleAlert, Pencil, X } from "lucide-react";
import { useState } from "react";
import type { ResolvedOperation, Rejection } from "../../ai/assistant/parse";
import { changeCounts, type ChangeItem, type ChangeSet } from "../../ai/assistant/proposals";
import { num } from "../../domain/locale";
import { formatClock, formatDuration, formatShortDate } from "../../domain/time";
import { t } from "../../i18n";
import type { ChatMessage } from "../../persistence/repository";
import { applyProposal, cancelProposal, editProposal } from "../../state/assistant";
import { useApp } from "../../state/store";
import { NumberInput, TextInput } from "../../ui/fields";
import { Button, Field } from "../../ui/primitives";

const WEEKDAY_SHORT = () => t.weekdays;

export function rejectionText(r: Rejection): string {
  switch (r.code) {
    case "unknown_ref":
      return t.aiRejUnknownRef;
    case "bad_date":
      return t.aiRejBadDate(r.detail);
    case "past_date":
      return t.aiRejPastDate(r.detail);
    case "wrong_intent":
      return t.aiRejWrongIntent;
    case "protected_task":
      return t.aiRejProtected(r.detail);
    case "pinned_block":
      return t.aiRejPinned(r.detail);
    case "started_block":
      return t.aiRejStarted(r.detail);
    case "no_slot":
      return t.aiRejNoSlot(r.detail);
    case "after_target":
      return t.aiRejAfterTarget(r.detail);
    case "nothing_to_plan":
      return t.aiRejNothing;
    case "no_milestone":
      return t.aiRejNoMilestone;
    case "duplicate":
      return t.aiRejDuplicate(r.detail);
    default:
      return t.aiRejInvalid;
  }
}

const slot = (date: string, start: number, end: number) => `${formatShortDate(date)} · ${formatClock(start)}–${formatClock(end)}`;

function TaskLine({ title, minutes, deadline }: { title: string; minutes?: number; deadline?: string | null }) {
  return (
    <li className="proposal__task">
      <span>{title}</span>
      <span className="faint tabular">
        {minutes != null && formatDuration(minutes)}
        {deadline && ` · ${formatShortDate(deadline)}`}
      </span>
    </li>
  );
}

function ItemView({ item }: { item: ChangeItem }) {
  const tasks = useApp((s) => s.tasks);
  const titleOf = (id: string | null) => tasks.find((x) => x.id === id)?.title ?? "";
  switch (item.kind) {
    case "goal":
      return (
        <div className="proposal__item">
          <strong>{item.plan.title}</strong>
          {item.plan.targetDate && <span className="chip tabular">{formatShortDate(item.plan.targetDate)}</span>}
          {item.plan.milestones.map((m, i) => {
            const tasks = m.projects.flatMap((p) => p.tasks);
            return (
              <details key={i} className="proposal__milestone" open={item.plan.milestones.length === 1}>
                <summary>
                  <span>{m.title}</span>
                  <span className="faint tabular">{t.aiTasksSummary(tasks.length, formatDuration(tasks.reduce((s, x) => s + x.estimateMin, 0)))}</span>
                </summary>
                <ul>
                  {tasks.map((x, j) => (
                    <TaskLine key={j} title={x.title} minutes={x.estimateMin} deadline={x.deadline} />
                  ))}
                </ul>
              </details>
            );
          })}
          <p className="proposal__sessions muted">
            {item.sessions.length
              ? t.aiGoalSessions(formatDuration(item.placedMin), item.sessions.map((s) => `${WEEKDAY_SHORT()[s.weekday]} ${formatClock(s.start)}–${formatClock(s.end)}`).join(t.listJoin))
              : t.aiNoSessions}
          </p>
          {item.plan.notes.map((n, i) => (
            <p key={i} className="faint proposal__note">
              {n}
            </p>
          ))}
        </div>
      );
    case "milestone":
      return (
        <div className="proposal__item">
          <strong>{item.title}</strong> <span className="faint">{t.aiMilestoneIn(item.goalTitle)}</span>
          <ul>
            {item.tasks.map((x, j) => (
              <TaskLine key={j} title={x.title} minutes={x.estimateMin} deadline={x.deadline ?? item.deadline} />
            ))}
          </ul>
        </div>
      );
    case "task":
      return (
        <div className="proposal__item">
          <ul>
            <TaskLine title={item.task.title} minutes={item.task.estimateMin} deadline={item.task.deadline} />
          </ul>
          <span className="faint">{item.parentTitle ? t.aiTaskIn(item.parentTitle) : t.aiStandaloneTask}</span>
        </div>
      );
    case "task_update":
      return (
        <div className="proposal__item">
          <strong>{item.title}</strong>
          <ul>
            {Object.keys(item.after).map((key) => {
              const k = key as keyof typeof item.after;
              const show = (v: unknown) => (k === "estimateMin" ? formatDuration(Number(v)) : k === "deadline" && v ? formatShortDate(String(v)) : v == null || v === "" ? "—" : String(v));
              return (
                <li key={key} className="proposal__change">
                  <span className="faint">{show(item.before[k])}</span>
                  <ArrowRight size={13} className="flip-rtl" />
                  <span>{show(item.after[k])}</span>
                </li>
              );
            })}
          </ul>
        </div>
      );
    case "week":
      return (
        <div className="proposal__item">
          {item.days.map((d) => (
            <div key={d.date} className="proposal__day">
              <span className="muted tabular">{formatShortDate(d.date)}</span>
              <ul>
                {d.blocks
                  .filter((b) => b.kind === "task")
                  .map((b) => (
                    <TaskLine key={b.id} title={`${formatClock(b.start)}–${formatClock(b.end)} ${titleOf(b.taskId)}`} />
                  ))}
              </ul>
            </div>
          ))}
          {item.unscheduled.length > 0 && (
            <div className="proposal__day">
              <span className="muted">{t.aiUnscheduledTitle}</span>
              <ul>
                {item.unscheduled.map((u) => (
                  <li key={u.taskId} className="proposal__task">
                    <span>{u.title}</span>
                    <span className="faint">{u.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    case "reschedule":
      return (
        <div className="proposal__item">
          <strong>{item.title}</strong>
          <ul>
            {(item.from.length ? item.from : [null]).map((f, i) => (
              <li key={i} className="proposal__change tabular">
                <span className="faint">{f ? slot(f.date, f.start, f.end) : t.aiNotScheduled}</span>
                <ArrowRight size={13} className="flip-rtl" />
                <span>{item.to.filter((b) => b.kind === "task").map((b) => slot(b.date, b.start, b.end)).join(t.listJoin)}</span>
              </li>
            ))}
          </ul>
        </div>
      );
  }
}

const isNew = (i: ChangeItem) => i.kind === "goal" || i.kind === "milestone" || i.kind === "task" || i.kind === "week";

/** Inline editing for the fields a person would most likely tweak. Schedules are changed by asking in the chat. */
function EditForm({ cs, onDone }: { cs: ChangeSet; onDone: (ops: ResolvedOperation[] | null) => void }) {
  const [ops, setOps] = useState<ResolvedOperation[]>(() => structuredClone(cs.operations));
  const patch = (i: number, next: ResolvedOperation) => setOps(ops.map((o, j) => (j === i ? next : o)));
  return (
    <div className="proposal__edit">
      {ops.map((op, i) => {
        switch (op.type) {
          case "create_goal":
            return (
              <div key={i} className="proposal__edit-row">
                <Field label={t.aiFieldTitle}>
                  <TextInput value={op.title} maxLength={160} onChange={(e) => patch(i, { ...op, title: e.target.value })} />
                </Field>
                <Field label={t.aiFieldHours}>
                  <NumberInput value={op.hoursPerWeek} min={1} max={40} onChange={(v) => patch(i, { ...op, hoursPerWeek: v })} />
                </Field>
              </div>
            );
          case "create_milestone":
            return (
              <div key={i} className="proposal__edit-row">
                <Field label={t.aiFieldTitle}>
                  <TextInput value={op.title} maxLength={160} onChange={(e) => patch(i, { ...op, title: e.target.value })} />
                </Field>
              </div>
            );
          case "create_task":
            return (
              <div key={i} className="proposal__edit-row">
                <Field label={t.aiFieldTitle}>
                  <TextInput value={op.task.title} maxLength={160} onChange={(e) => patch(i, { ...op, task: { ...op.task, title: e.target.value } })} />
                </Field>
                <Field label={t.aiFieldMinutes}>
                  <NumberInput value={op.task.estimateMin} min={5} max={480} onChange={(v) => patch(i, { ...op, task: { ...op.task, estimateMin: v } })} />
                </Field>
              </div>
            );
          case "update_task":
            return (
              <div key={i} className="proposal__edit-row">
                {op.changes.title !== undefined && (
                  <Field label={t.aiFieldTitle}>
                    <TextInput value={op.changes.title} maxLength={160} onChange={(e) => patch(i, { ...op, changes: { ...op.changes, title: e.target.value } })} />
                  </Field>
                )}
                {op.changes.estimateMin !== undefined && (
                  <Field label={t.aiFieldMinutes}>
                    <NumberInput value={op.changes.estimateMin} min={5} max={480} onChange={(v) => patch(i, { ...op, changes: { ...op.changes, estimateMin: v } })} />
                  </Field>
                )}
              </div>
            );
          default:
            return (
              <p key={i} className="faint proposal__note">
                {t.aiEditScheduleHint}
              </p>
            );
        }
      })}
      <div className="proposal__actions">
        <Button variant="ghost" size="sm" onClick={() => onDone(null)}>
          {t.cancel}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={ops.some((o) => (o.type === "create_goal" || o.type === "create_milestone" ? !o.title.trim() : o.type === "create_task" ? !o.task.title.trim() : false))}
          onClick={() => onDone(ops)}
        >
          {t.aiSaveEdit}
        </Button>
      </div>
    </div>
  );
}

/**
 * A proposal as a small approval card: what it is, one line on what changes, and Yes / No.
 * The full preview folds away under Details. "Yes" saves straight away; there is no second
 * confirmation, and the card says when existing plans are affected.
 */
export function ProposalCard({ msg }: { msg: ChatMessage }) {
  const cs = msg.proposal as ChangeSet;
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState(false);
  const pending = msg.proposalStatus === "pending";
  const fresh = cs.items.filter(isNew);
  const changed = cs.items.filter((i) => !isNew(i));
  const c = changeCounts(cs);

  const apply = async () => {
    setWorking(true);
    await applyProposal(msg.id);
    setWorking(false);
  };

  const statusLabel: Record<string, string> = { applied: t.aiApplied, cancelled: t.aiCancelled, failed: t.aiNotSaved, stale: t.aiStale, interrupted: t.aiInterrupted };

  return (
    <div className={`proposal ${pending ? "" : "proposal--done"}`}>
      <div className="proposal__head">
        <strong dir="auto">{cs.summary || t.aiProposalTitle}</strong>
        {msg.proposalStatus && !pending && <span className={`chip proposal__status proposal__status--${msg.proposalStatus}`}>{statusLabel[msg.proposalStatus]}</span>}
      </div>
      {cs.items.length > 0 && <p className="muted proposal__summary tabular">{t.aiPreview(c.goals, c.milestones, c.tasks, c.updated, c.sessions, c.rescheduled)}</p>}
      {pending && cs.touchesExisting && (
        <p className="proposal__touches">
          <CircleAlert size={14} /> {t.aiTouchesTitle}
        </p>
      )}
      {cs.warnings.length > 0 && (
        <ul className="proposal__warnings">
          {cs.warnings.map((w, i) => (
            <li key={i}>
              <CircleAlert size={14} /> {w}
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <EditForm
          cs={cs}
          onDone={async (ops) => {
            setEditing(false);
            if (ops) await editProposal(msg.id, ops);
          }}
        />
      ) : (
        <>
          {(cs.items.length > 0 || cs.rejected.length > 0) && (
            <details className="proposal__details" open={cs.items.length === 0}>
              <summary>{t.aiDetails}</summary>
              {fresh.length > 0 && (
                <section className="proposal__section">
                  <h4>{t.aiNew}</h4>
                  {fresh.map((item, i) => (
                    <ItemView key={i} item={item} />
                  ))}
                </section>
              )}
              {changed.length > 0 && (
                <section className="proposal__section proposal__section--existing">
                  <h4>{cs.items.some((i) => i.kind === "reschedule") ? t.aiMoved : t.aiChanged}</h4>
                  {changed.map((item, i) => (
                    <ItemView key={i} item={item} />
                  ))}
                </section>
              )}
              {cs.rejected.length > 0 && (
                <div className="proposal__rejected">
                  <span className="faint">{t.aiRejectedTitle(num(cs.rejected.length))}</span>
                  <ul>
                    {cs.rejected.map((r, i) => (
                      <li key={i} className="faint">
                        {rejectionText(r)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </details>
          )}
          {pending && cs.items.length > 0 && (
            <div className="proposal__actions">
              <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => cancelProposal(msg.id)} disabled={working}>
                {t.aiNo}
              </Button>
              <Button variant="glass" size="sm" icon={<Pencil size={14} />} onClick={() => setEditing(true)} disabled={working}>
                {t.edit}
              </Button>
              <Button variant="primary" size="sm" icon={<Check size={14} />} disabled={working} onClick={() => void apply()}>
                {t.aiYesApply}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
