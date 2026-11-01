import { CalendarHeart, ChevronLeft, ChevronRight, Repeat, Target } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { blockedOnCalendarDay } from "../../domain/availability";
import { overlaps } from "../../domain/intervals";
import { getLang, weekStartDay } from "../../domain/locale";
import { ALL_DAYS, classifyConflicts, colorUsage, dayBit, planColor, planTimeProblem, suggestColor, weekDates, type PlanConflict } from "../../domain/plans";
import { textProblem } from "../../domain/text";
import { addDays, formatClock, formatDuration, formatMonthYear, formatShortDate, parseDateKey, weekdayOf } from "../../domain/time";
import type { DateKey, Minutes, Plan, PlanColor, PlanType } from "../../domain/types";
import { t } from "../../i18n";
import { makePlan } from "../../persistence/repository";
import { savePlan, updateGoal, useApp } from "../../state/store";
import { TextArea, TextInput, TimeInput } from "../../ui/fields";
import { Button, Field, IconButton } from "../../ui/primitives";
import { Wizard, WizardDone, WizardError, WizardQuestion } from "../../ui/Wizard";
import { ColorOptions } from "./ColorPicker";

export const PLAN_ICON = { default: Repeat, goal: Target, event: CalendarHeart };

const planTitle = (type: PlanType) => ({ default: t.addDefault, goal: t.addManualGoal, event: t.addEvent })[type];

/** "Sun, Tue" or "Every day" or specific dates. */
export function planDaysLabel(plan: Pick<Plan, "weekdays" | "dates">): string {
  if (plan.dates) return plan.dates.map(formatShortDate).join(t.listJoin);
  if (plan.weekdays === ALL_DAYS) return t.everyDay;
  const first = weekStartDay();
  return Array.from({ length: 7 }, (_, i) => (first + i) % 7)
    .filter((w) => plan.weekdays & dayBit(w))
    .map((w) => t.weekdays[w])
    .join(t.listJoin);
}

const conflictDay = (c: PlanConflict) => (c.date ? formatShortDate(c.date) : t.weekdays[c.weekday]);

export function textErrorMessage(problem: ReturnType<typeof textProblem>): string | null {
  if (problem === "empty") return t.textEmpty;
  if (problem === "short") return t.textShort;
  return problem === "noLetters" ? t.textNoLetters : null;
}

const STEP_TITLE = 0;
const STEP_DESC = 1;
const STEP_COLOR = 2;
const STEP_DAYS = 3;
const STEP_TIME = 4;
const STEP_DONE = 5;

/** Add or edit a plan, one question at a time. */
export function PlanWizard({ open, onClose, type, plan, date }: { open: boolean; onClose: () => void; type: PlanType; plan?: Plan | null; date?: DateKey }) {
  const plans = useApp((s) => s.plans);
  const goals = useApp((s) => s.goals);
  const prefs = useApp((s) => s.prefs);
  const clock = useApp((s) => s.clock);
  const planType = plan?.type ?? type;
  const oneTime = planType === "event";

  const [step, setStep] = useState(STEP_TITLE);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<PlanColor>(1);
  const [mask, setMask] = useState(0);
  const [dates, setDates] = useState<DateKey[]>([]);
  const [weekAnchor, setWeekAnchor] = useState(clock.today);
  const [start, setStart] = useState<Minutes | null>(null);
  const [end, setEnd] = useState<Minutes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<PlanConflict[]>([]);
  const [outranked, setOutranked] = useState<PlanConflict[]>([]);
  const [confirmedOverride, setConfirmedOverride] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(STEP_TITLE);
    setDirection(1);
    setTitle(plan?.title ?? "");
    setDescription(plan?.description ?? "");
    setColor(plan ? planColor(plan, goals) : suggestColor(type, plans, goals));
    setMask(plan?.weekdays ?? 0);
    setDates(plan?.dates ?? (date && date >= clock.today ? [date] : []));
    setWeekAnchor(plan?.dates?.[0] ?? date ?? clock.today);
    setStart(plan?.start ?? null);
    setEnd(plan?.end ?? null);
    setError(null);
    setBlocking([]);
    setOutranked([]);
    setConfirmedOverride(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan, date]);

  const go = (next: number) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
    setError(null);
  };

  const week = useMemo(() => weekDates(weekAnchor, weekStartDay()), [weekAnchor]);
  const weekdayOrder = week.map(weekdayOf);
  const selectableDates = week.filter((d) => d >= clock.today);
  const allSelected = oneTime ? selectableDates.length > 0 && selectableDates.every((d) => dates.includes(d)) : mask === ALL_DAYS;

  const toggleAll = () => {
    if (oneTime) setDates(allSelected ? dates.filter((d) => !selectableDates.includes(d)) : [...new Set([...dates, ...selectableDates])]);
    else setMask(allSelected ? 0 : ALL_DAYS);
    setError(null);
  };

  const candidate = (): Plan | null => {
    if (start == null || end == null) return null;
    const fields = {
      title: title.trim(),
      description: description.trim(),
      start,
      end,
      weekdays: oneTime ? 0 : mask,
      dates: oneTime ? [...dates].sort() : null,
      color: plan?.goalId ? plan.color : color,
    };
    if (plan) return { ...plan, ...fields };
    return makePlan({ type: planType, ...fields, validFrom: oneTime ? null : weekDates(clock.today, weekStartDay())[0] });
  };

  const timeHint = (() => {
    if (start == null || end == null || end <= start) return null;
    const slot = { start, end };
    return blockedOnCalendarDay(prefs).some((b) => overlaps(b, slot)) ? t.lateHint : null;
  })();

  const next = async () => {
    if (step === STEP_TITLE) {
      const problem = textErrorMessage(textProblem(title));
      if (problem) return setError(problem);
      return go(STEP_DESC);
    }
    if (step === STEP_DESC) {
      const problem = textErrorMessage(textProblem(description, { required: false }));
      if (problem) return setError(problem);
      return go(STEP_COLOR);
    }
    if (step === STEP_COLOR) return go(STEP_DAYS);
    if (step === STEP_DAYS) {
      if (oneTime ? dates.length === 0 : mask === 0) return setError(t.errNoDays);
      return go(STEP_TIME);
    }
    if (step === STEP_TIME) {
      const problem = planTimeProblem(start, end);
      if (problem) {
        return setError({ missing: t.errTimeMissing, order: t.errTimeOrder, tooShort: t.errTimeShort }[problem]);
      }
      if (oneTime && dates.includes(clock.today) && start! < clock.nowMin) return setError(t.errTimePast);
      const draft = candidate()!;
      const others = plans.filter((p) => p.id !== draft.id);
      const found = classifyConflicts(draft, others);
      setBlocking(found.blocking);
      setOutranked(found.outranked);
      if (found.blocking.length) return setError(null);
      if (found.outranked.length && !confirmedOverride) {
        setConfirmedOverride(true);
        return setError(null);
      }
      setSaving(true);
      const saved = await savePlan(draft, !plan);
      if (saved && plan?.goalId) await updateGoal(plan.goalId, { color });
      setSaving(false);
      if (saved) go(STEP_DONE);
    }
  };

  const changeTime = (setter: (v: Minutes | null) => void) => (v: Minutes | null) => {
    setter(v);
    setError(null);
    setBlocking([]);
    setOutranked([]);
    setConfirmedOverride(false);
  };

  const isDone = step === STEP_DONE;
  const lastLabel = outranked.length && confirmedOverride && !blocking.length ? t.setAnyway : plan ? t.saveChanges : t.setPlan;

  return (
    <Wizard
      open={open}
      onClose={onClose}
      title={plan ? t.editPlan : planTitle(planType)}
      step={step}
      total={STEP_DONE + 1}
      direction={direction}
      onBack={step > STEP_TITLE ? () => go(step - 1) : undefined}
      onNext={next}
      nextLabel={step === STEP_TIME ? lastLabel : t.continue}
      nextDisabled={saving || (step === STEP_TIME && blocking.length > 0)}
      hideFooter={isDone}
    >
      {step === STEP_TITLE && (
        <>
          <WizardQuestion title={t.qPlanTitle} hint={{ default: t.hintDefault, goal: t.hintManualGoal, event: t.hintEvent }[planType]} />
          <Field label={t.taskTitle}>
            <TextInput className="wiz-input" value={title} maxLength={80} placeholder={t.planTitlePh} onChange={(e) => { setTitle(e.target.value); setError(null); }} />
          </Field>
        </>
      )}

      {step === STEP_DESC && (
        <>
          <WizardQuestion title={t.qPlanDesc} hint={t.optional} />
          <Field label={t.descriptionLabel}>
            <TextArea
              rows={3}
              value={description}
              maxLength={200}
              placeholder={t.planDescPh}
              onChange={(e) => { setDescription(e.target.value); setError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void next();
                }
              }}
            />
          </Field>
        </>
      )}

      {step === STEP_COLOR && (
        <>
          <WizardQuestion title={t.qPlanColor} hint={plan?.goalId ? t.hintGoalColor : t.hintPlanColor} />
          <ColorOptions value={color} onChange={setColor} title={title.trim()} usage={colorUsage(plans, goals, plan?.id)} />
        </>
      )}

      {step === STEP_DAYS && (
        <>
          <WizardQuestion title={t.qPlanDays} hint={oneTime ? t.hintEventDays : t.hintRepeatDays} />
          {oneTime && (
            <div className="wiz-week">
              <IconButton label={t.prevWeek} onClick={() => setWeekAnchor(addDays(weekAnchor, -7))}>
                <ChevronLeft size={17} className="flip-rtl" />
              </IconButton>
              <strong>{formatMonthYear(weekAnchor)}</strong>
              <IconButton label={t.nextWeek} onClick={() => setWeekAnchor(addDays(weekAnchor, 7))}>
                <ChevronRight size={17} className="flip-rtl" />
              </IconButton>
            </div>
          )}
          <div className="wiz-days" role="group" aria-label={t.weekdaysLabel}>
            {weekdayOrder.map((w, i) => {
              const d = week[i];
              const past = oneTime && d < clock.today;
              const on = oneTime ? dates.includes(d) : (mask & dayBit(w)) !== 0;
              return (
                <button
                  key={w}
                  type="button"
                  disabled={past}
                  aria-pressed={on}
                  className={`wiz-day ${on ? "wiz-day--on" : ""}`}
                  onClick={() => {
                    setError(null);
                    if (oneTime) setDates(on ? dates.filter((x) => x !== d) : [...dates, d]);
                    else setMask(mask ^ dayBit(w));
                  }}
                >
                  <span>{t.weekdays[w]}</span>
                  {oneTime && <small>{new Intl.DateTimeFormat(getLang() === "fa" ? "fa-IR" : "en-US", { day: "numeric" }).format(parseDateKey(d))}</small>}
                </button>
              );
            })}
          </div>
          <button type="button" role="radio" aria-checked={allSelected} className="wiz-all" onClick={toggleAll}>
            <span className="wiz-all__dot" aria-hidden="true" />
            {oneTime ? t.selectWholeWeek : t.selectAllDays}
          </button>
        </>
      )}

      {step === STEP_TIME && (
        <>
          <WizardQuestion title={t.qPlanTime} hint={t.hintTime} />
          <div className="wiz-times">
            <Field label={t.startTime}>
              <TimeInput className="wiz-input" value={start} allowEmpty onChange={changeTime(setStart)} />
            </Field>
            <Field label={t.finishTime}>
              <TimeInput className="wiz-input" value={end} allowEmpty onChange={changeTime(setEnd)} />
            </Field>
          </div>
          {start != null && (
            <div className="wiz-chips">
              {[30, 60, 90, 120, 180].map((m) => (
                <Button key={m} size="sm" variant={end === start + m ? "primary" : "ghost"} disabled={start + m > 1440} onClick={() => changeTime(setEnd)(start + m)}>
                  +{formatDuration(m)}
                </Button>
              ))}
            </div>
          )}
          {start != null && end != null && end > start && <p className="wiz-q__hint tabular">{t.lastsFor(formatDuration(end - start))}</p>}
          {timeHint && <p className="wiz-note">{timeHint}</p>}
          {blocking.length > 0 && (
            <div className="wiz-conflicts" role="alert">
              <strong>{t.conflictTitle}</strong>
              <ul>
                {blocking.slice(0, 4).map((c) => (
                  <li key={c.plan.id}>
                    <span className={`plan-dot plan-c${planColor(c.plan, goals)}`} />
                    {t.conflictLine(c.plan.title, conflictDay(c), formatClock(c.plan.start), formatClock(c.plan.end))}
                  </li>
                ))}
              </ul>
              <p>{t.conflictFix}</p>
            </div>
          )}
          {confirmedOverride && !blocking.length && outranked.length > 0 && (
            <div className="wiz-conflicts wiz-conflicts--soft" role="status">
              <strong>{t.outrankTitle}</strong>
              <ul>
                {outranked.slice(0, 4).map((c) => (
                  <li key={c.plan.id}>
                    <span className={`plan-dot plan-c${planColor(c.plan, goals)}`} />
                    {t.conflictLine(c.plan.title, conflictDay(c), formatClock(c.plan.start), formatClock(c.plan.end))}
                  </li>
                ))}
              </ul>
              <p>{t.outrankText}</p>
            </div>
          )}
        </>
      )}

      {isDone && (
        <WizardDone
          title={plan ? t.planUpdated : t.planIsSet}
          action={
            <Button variant="primary" onClick={onClose} data-step-focus>
              {t.doneThanks}
            </Button>
          }
        >
          <p className="wiz-done__summary tabular">
            <strong>{title.trim()}</strong>
            <br />
            {planDaysLabel({ weekdays: mask, dates: oneTime ? dates : null })} · {start != null && formatClock(start)}–{end != null && formatClock(end)}
          </p>
        </WizardDone>
      )}

      {error && <WizardError>{error}</WizardError>}
    </Wizard>
  );
}
