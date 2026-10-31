import { HeartCrack, TrendingDown } from "lucide-react";
import { useEffect, useState } from "react";
import { num } from "../../domain/locale";
import { formatClock, formatDuration } from "../../domain/time";
import type { Goal } from "../../domain/types";
import { t } from "../../i18n";
import { decreaseGoalHours, deleteGoal, useApp } from "../../state/store";
import { NumberInput } from "../../ui/fields";
import { Button, Dialog, Field } from "../../ui/primitives";
import { WizardDone, WizardError } from "../../ui/Wizard";

const PRESETS = [3, 5, 7, 9, 12];

/** Before a goal is abandoned: are you sure, or would fewer hours do? */
export function AbandonGoalDialog({ goal, open, onClose }: { goal: Goal; open: boolean; onClose: () => void }) {
  const plans = useApp((s) => s.plans);
  const sessions = plans.filter((p) => p.goalId === goal.id);
  const currentMin = sessions.reduce((sum, p) => sum + (p.end - p.start) * countDays(p.weekdays), 0);
  const currentHours = currentMin / 60;
  const canDecrease = currentHours > 1;

  const [mode, setMode] = useState<"ask" | "hours" | "done">("ask");
  const [hours, setHours] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode("ask");
    setError(null);
    setHours(Math.max(1, Math.ceil(currentHours / 2)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const presets = PRESETS.filter((h) => h < currentHours);
  const maxHours = Math.max(1, Math.ceil(currentHours) - 1);

  const decrease = async () => {
    if (hours >= currentHours) return setError(t.errLowerHours(formatDuration(currentMin)));
    setBusy(true);
    const problem = await decreaseGoalHours(goal, hours);
    setBusy(false);
    if (problem) return setError(problem);
    setError(null);
    setMode("done");
  };

  if (mode === "done") {
    return (
      <Dialog open={open} onClose={onClose} wide title={t.decreaseDoneTitle}>
        <WizardDone
          title={t.decreaseDoneLead(formatDuration(hours * 60))}
          action={
            <Button variant="primary" onClick={onClose} data-step-focus>
              {t.doneThanks}
            </Button>
          }
        >
          <div className="session-cards session-cards--center">
            {sessions.map((s, i) => (
              <div key={s.id} className="session-card" style={{ animationDelay: `${i * 60}ms` }}>
                <strong>{t.weekdays[Math.log2(s.weekdays)] ?? ""}</strong>
                <span className="tabular">
                  {formatClock(s.start)} – {formatClock(s.end)}
                </span>
              </div>
            ))}
          </div>
        </WizardDone>
      </Dialog>
    );
  }

  if (mode === "hours") {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        wide
        title={t.decreaseTitle}
        subtitle={t.decreaseSub(formatDuration(currentMin))}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMode("ask")}>
              {t.back}
            </Button>
            <span className="spacer" />
            <Button variant="primary" disabled={busy} onClick={decrease}>
              {busy ? t.replanning : t.replanGoal}
            </Button>
          </>
        }
      >
        {presets.length > 0 && (
          <div className="wiz-chips">
            {presets.map((h) => (
              <Button key={h} size="sm" variant={hours === h ? "primary" : "glass"} onClick={() => { setHours(h); setError(null); }}>
                {t.hoursCount(num(h))}
              </Button>
            ))}
          </div>
        )}
        <Field label={t.newHoursPerWeek}>
          <NumberInput value={hours} min={1} max={maxHours} suffix={t.hours} onChange={(v) => { setHours(v); setError(null); }} />
        </Field>
        {error && <WizardError>{error}</WizardError>}
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.abandonTitle}
      subtitle={goal.title}
      initialFocus="[data-keep]"
      footer={
        <>
          <Button
            variant="danger"
            icon={<HeartCrack size={15} />}
            onClick={() => {
              onClose();
              void deleteGoal(goal.id);
            }}
          >
            {t.abandonYes}
          </Button>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose} data-keep>
            {t.abandonNo}
          </Button>
          <Button variant="primary" icon={<TrendingDown size={15} />} disabled={!canDecrease} title={canDecrease ? undefined : t.decreaseUnavailable} onClick={() => setMode("hours")}>
            {t.abandonDecrease}
          </Button>
        </>
      }
    >
      <p className="muted">{t.abandonMsg(sessions.length)}</p>
      {!canDecrease && <p className="faint" style={{ fontSize: 13 }}>{t.decreaseUnavailable}</p>}
    </Dialog>
  );
}

function countDays(mask: number) {
  let n = 0;
  for (let w = 0; w < 7; w++) if (mask & (1 << w)) n++;
  return n;
}
