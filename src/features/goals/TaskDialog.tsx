import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { formatDuration } from "../../domain/time";
import type { Energy, Priority, Task } from "../../domain/types";
import { t } from "../../i18n";
import { addTask, deleteTask, updateTask, useApp, validateTaskPatch } from "../../state/store";
import { DateInput, NumberInput, TextArea, TextInput, TimeInput } from "../../ui/fields";
import { Button, Dialog, Field, Segmented, Switch } from "../../ui/primitives";

export interface TaskDraft {
  goalId?: string | null;
  milestoneId?: string | null;
  projectId?: string | null;
  inPlanner?: boolean;
}

interface Form {
  title: string;
  notes: string;
  priority: Priority;
  estimateMin: number;
  energy: Energy | "none";
  deadline: string | null;
  deadlineTime: number | null;
  inPlanner: boolean;
}

const QUICK = [15, 30, 45, 60, 90, 120];

export function TaskDialog({ open, onClose, task, draft }: { open: boolean; onClose: () => void; task?: Task | null; draft?: TaskDraft }) {
  const defaultEstimate = useApp((s) => s.prefs.defaultEstimateMin);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      task
        ? {
            title: task.title,
            notes: task.notes,
            priority: task.priority,
            estimateMin: task.estimateMin,
            energy: task.energy ?? "none",
            deadline: task.deadline,
            deadlineTime: task.deadlineTime,
            inPlanner: task.inPlanner,
          }
        : {
            title: "",
            notes: "",
            priority: 2,
            estimateMin: defaultEstimate,
            energy: "none",
            deadline: null,
            deadlineTime: null,
            inPlanner: draft?.inPlanner ?? !draft?.goalId,
          },
    );
  }, [open, task, draft, defaultEstimate]);

  if (!form) return null;
  const patch = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));

  const save = async () => {
    const values: Partial<Task> = {
      title: form.title,
      notes: form.notes,
      priority: form.priority,
      estimateMin: form.estimateMin,
      energy: form.energy === "none" ? null : form.energy,
      deadline: form.deadline,
      deadlineTime: form.deadline ? form.deadlineTime : null,
      inPlanner: form.inPlanner,
    };
    const problem = validateTaskPatch(values);
    if (problem) {
      setError(problem);
      return;
    }
    if (task) await updateTask(task.id, values);
    else await addTask({ ...values, title: form.title, goalId: draft?.goalId ?? null, milestoneId: draft?.milestoneId ?? null, projectId: draft?.projectId ?? null });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={task ? t.taskEdit : t.taskNew}
      subtitle={task?.origin === "generated" && !task.edited ? t.taskGeneratedSub : undefined}
      footer={
        <>
          {task && (
            <Button
              variant="danger-ghost"
              icon={<Trash2 size={15} />}
              onClick={async () => {
                await deleteTask(task.id);
                onClose();
              }}
            >
              {t.delete}
            </Button>
          )}
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button variant="primary" onClick={save} disabled={!form.title.trim()}>
            {task ? t.save : t.taskAdd}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        <Field label={t.taskTitle} error={error}>
          <TextInput value={form.title} onChange={(e) => patch({ title: e.target.value })} placeholder={t.taskTitlePh} maxLength={160} autoFocus />
        </Field>
        <Field label={t.taskNotes}>
          <TextArea rows={2} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} placeholder={t.taskNotesPh} maxLength={1000} />
        </Field>
        <div className="field">
          <span className="field__label">{t.taskPriority}</span>
          <Segmented
            label={t.taskPriority}
            value={form.priority}
            onChange={(v) => patch({ priority: v })}
            options={[
              { value: 1, label: t.priority[1] },
              { value: 2, label: t.priority[2] },
              { value: 3, label: t.priority[3] },
              { value: 4, label: t.priority[4] },
            ]}
          />
        </div>
        <div className="field-row" style={{ gridTemplateColumns: "160px 1fr" }}>
          <Field label={t.taskDuration}>
            <NumberInput value={form.estimateMin} min={5} max={960} suffix={t.min} onChange={(v) => patch({ estimateMin: v })} />
          </Field>
          <div className="field">
            <span className="field__label">&nbsp;</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", minHeight: 40 }}>
              {QUICK.map((m) => (
                <Button key={m} size="sm" variant={form.estimateMin === m ? "primary" : "ghost"} onClick={() => patch({ estimateMin: m })}>
                  {formatDuration(m)}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <div className="field">
          <span className="field__label">{t.taskEnergy}</span>
          <Segmented
            label={t.taskEnergy}
            value={form.energy}
            onChange={(v) => patch({ energy: v })}
            options={[
              { value: "none", label: t.energyAny },
              { value: "low", label: t.energyLow },
              { value: "medium", label: t.energyMedium },
              { value: "high", label: t.energyHigh },
            ]}
          />
        </div>
        <div className="field-row">
          <Field label={t.taskDeadline} hint={t.optional}>
            <DateInput value={form.deadline} onChange={(v) => patch({ deadline: v })} />
          </Field>
          <Field label={t.taskDueBy} hint={form.deadline ? t.taskDueByHint : t.taskDueByNoDate}>
            <TimeInput value={form.deadlineTime} allowEmpty onChange={(v) => patch({ deadlineTime: v })} disabled={!form.deadline} />
          </Field>
        </div>
        <label className="check" style={{ justifyContent: "space-between" }}>
          <span>
            <span style={{ color: "var(--text)", fontWeight: 560 }}>{t.taskInPlanner}</span>
            <br />
            <span className="faint" style={{ fontSize: 12 }}>
              {t.taskInPlannerHint}
            </span>
          </span>
          <Switch checked={form.inPlanner} onChange={(v) => patch({ inPlanner: v })} label={t.taskInPlanner} />
        </label>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
