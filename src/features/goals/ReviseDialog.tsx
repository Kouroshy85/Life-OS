import { ArrowLeft, RefreshCcw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { aiConfigured } from "../../ai/planProvider";
import { validateGoalText } from "../../domain/goalCompiler";
import type { Goal } from "../../domain/types";
import { applyRevision, previewRevision, useApp, type RevisionPreview } from "../../state/store";
import { DateInput, NumberInput, TextArea, TextInput } from "../../ui/fields";
import { Button, Dialog, Field, Switch } from "../../ui/primitives";
import { PlanPreview } from "./GoalComposer";

export function ReviseDialog({ goal, open, onClose }: { goal: Goal; open: boolean; onClose: () => void }) {
  const ai = useApp((s) => s.ai);
  const canUseAi = aiConfigured(ai);
  const [text, setText] = useState(goal.title);
  const [context, setContext] = useState(goal.description);
  const [targetDate, setTargetDate] = useState<string | null>(goal.targetDate);
  const [hours, setHours] = useState(5);
  const [useAi, setUseAi] = useState(canUseAi);
  const [preview, setPreview] = useState<RevisionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setText(goal.title);
    setContext(goal.description);
    setTargetDate(goal.targetDate);
    setPreview(null);
    setError(null);
    setUseAi(canUseAi);
  }, [open, goal, canUseAi]);

  const run = async () => {
    const problem = validateGoalText(text);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      setPreview(await previewRevision(goal.id, text, { targetDate, hoursPerWeek: hours, useAi: useAi && canUseAi, description: context }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const s = preview?.revision.summary;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={preview ? "Review the revised plan" : "Revise plan"}
      subtitle={
        preview
          ? "Nothing you have worked on is removed."
          : "Recompile the plan with new wording, timing or pace. Completed, in-progress, edited, manual and planned tasks are always kept."
      }
      footer={
        preview ? (
          <>
            <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => setPreview(null)}>
              Back
            </Button>
            <span className="spacer" />
            <Button
              variant="primary"
              icon={<RefreshCcw size={15} />}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await applyRevision(goal.id, preview, text !== goal.title ? text : "");
                setBusy(false);
                onClose();
              }}
            >
              Apply revision
            </Button>
          </>
        ) : (
          <>
            <span className="spacer" />
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={run} disabled={busy}>
              {busy ? "Compiling…" : "Preview changes"}
            </Button>
          </>
        )
      }
    >
      {preview && s ? (
        <>
          <div className="revision-summary">
            <div>
              <ShieldCheck size={16} color="var(--success)" />
              <span>
                <strong>{s.kept}</strong> kept {s.completedKept > 0 && <span className="faint">({s.completedKept} completed)</span>}
              </span>
            </div>
            <div>
              <span>
                <strong>{s.replaced}</strong> untouched generated task{s.replaced === 1 ? "" : "s"} replaced
              </span>
            </div>
            <div>
              <span>
                <strong>{s.added}</strong> new task{s.added === 1 ? "" : "s"} added
              </span>
            </div>
            {s.skippedDuplicates > 0 && (
              <div className="faint">
                {s.skippedDuplicates} already covered by tasks you kept
              </div>
            )}
          </div>
          <PlanPreview outcome={preview.outcome} />
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          <Field label="Goal" error={error}>
            <TextInput value={text} maxLength={240} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Field label="Context">
            <TextArea rows={2} value={context} maxLength={600} onChange={(e) => setContext(e.target.value)} />
          </Field>
          <div className="field-row">
            <Field label="Target date">
              <DateInput value={targetDate} onChange={setTargetDate} />
            </Field>
            <Field label="Time per week">
              <NumberInput value={hours} min={1} max={80} suffix="hours" onChange={setHours} />
            </Field>
          </div>
          <div className="ai-row">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 560 }}>Use Claude</div>
              <div className="faint" style={{ fontSize: 12.5 }}>
                {canUseAi ? `Uses ${ai.model} with your key.` : "Not configured — the built-in planner will be used."}
              </div>
            </div>
            <Switch checked={useAi && canUseAi} disabled={!canUseAi} onChange={setUseAi} label="Use Claude" />
          </div>
          <button type="submit" hidden />
        </form>
      )}
    </Dialog>
  );
}
