import { ArrowLeft, RefreshCcw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { aiConfigured } from "../../ai/planProvider";
import { validateGoalText } from "../../domain/goalCompiler";
import { num } from "../../domain/locale";
import type { Goal } from "../../domain/types";
import { t } from "../../i18n";
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
      title={preview ? t.reviseReviewTitle : t.reviseTitle}
      subtitle={
        preview
          ? t.reviseReviewSub
          : t.reviseSub
      }
      footer={
        preview ? (
          <>
            <Button variant="ghost" icon={<ArrowLeft size={15} className="flip-rtl" />} onClick={() => setPreview(null)}>
              {t.back}
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
              {t.applyRevision}
            </Button>
          </>
        ) : (
          <>
            <span className="spacer" />
            <Button variant="ghost" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button variant="primary" onClick={run} disabled={busy}>
              {busy ? t.compiling : t.previewChanges}
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
                <strong>{num(s.kept)}</strong> {t.revKept} {s.completedKept > 0 && <span className="faint">{t.revCompleted(s.completedKept)}</span>}
              </span>
            </div>
            <div>
              <span>
                <strong>{num(s.replaced)}</strong> {t.revReplaced(s.replaced)}
              </span>
            </div>
            <div>
              <span>
                <strong>{num(s.added)}</strong> {t.revAdded(s.added)}
              </span>
            </div>
            {s.skippedDuplicates > 0 && (
              <div className="faint">
                {t.revDuplicates(s.skippedDuplicates)}
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
          <Field label={t.goalField} error={error}>
            <TextInput value={text} maxLength={240} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Field label={t.contextField}>
            <TextArea rows={2} value={context} maxLength={600} onChange={(e) => setContext(e.target.value)} />
          </Field>
          <div className="field-row">
            <Field label={t.targetDate}>
              <DateInput value={targetDate} onChange={setTargetDate} />
            </Field>
            <Field label={t.timePerWeek}>
              <NumberInput value={hours} min={1} max={80} suffix={t.hours} onChange={setHours} />
            </Field>
          </div>
          <div className="ai-row">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 560 }}>{t.useClaudeShort}</div>
              <div className="faint" style={{ fontSize: 12.5 }}>
                {canUseAi ? t.claudeUses(ai.model) : t.claudeOff}
              </div>
            </div>
            <Switch checked={useAi && canUseAi} disabled={!canUseAi} onChange={setUseAi} label={t.useClaudeShort} />
          </div>
          <button type="submit" hidden />
        </form>
      )}
    </Dialog>
  );
}
