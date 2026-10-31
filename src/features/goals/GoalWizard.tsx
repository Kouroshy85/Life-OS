import { CalendarClock, Flame, Quote, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { aiConfigured } from "../../ai/planProvider";
import { validateGoalText } from "../../domain/goalCompiler";
import { planGoalSessions, type GoalPlanResult } from "../../domain/goalPlanner";
import { num, weekStartDay } from "../../domain/locale";
import { weekDates } from "../../domain/plans";
import { textProblem } from "../../domain/text";
import { formatClock, formatDuration } from "../../domain/time";
import { t } from "../../i18n";
import { compilePreview, createGoalWithSessions, navigate, openComposer, selectGoal, useApp } from "../../state/store";
import { NumberInput, TextArea, TextInput } from "../../ui/fields";
import { Button, Field } from "../../ui/primitives";
import { Wizard, WizardError, WizardQuestion } from "../../ui/Wizard";
import { textErrorMessage } from "../planner/PlanWizard";
import { WeekGrid } from "../week/WeekGrid";

const STEP_TITLE = 0;
const STEP_WHAT = 1;
const STEP_HOURS = 2;
const STEP_LOADING = 3;
const STEP_RESULT = 4;
const STEP_FULL = 5;

const LOADING_MS = 2100;

interface Level {
  key: string;
  label: () => string;
  min: number;
  max: number;
  badge?: () => string;
}

const LEVELS: Level[] = [
  { key: "beginner", label: () => t.levelBeginner, min: 3, max: 3 },
  { key: "amateur", label: () => t.levelAmateur, min: 5, max: 5 },
  { key: "popular", label: () => t.levelPopular, min: 7, max: 7, badge: () => t.levelPopularBadge },
  { key: "pro", label: () => t.levelPro, min: 9, max: 9 },
  { key: "legendary", label: () => t.levelLegendary, min: 12, max: 15 },
];

const hoursLabel = (l: Level) => (l.min === l.max ? t.hoursCount(num(l.max)) : t.hoursRange(num(l.min), num(l.max)));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function GoalWizard() {
  const open = useApp((s) => s.composerOpen);
  const ai = useApp((s) => s.ai);
  const plans = useApp((s) => s.plans);
  const prefs = useApp((s) => s.prefs);
  const today = useApp((s) => s.clock.today);

  const [step, setStep] = useState(STEP_TITLE);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [title, setTitle] = useState("");
  const [what, setWhat] = useState("");
  const [hours, setHours] = useState(7);
  const [level, setLevel] = useState<string | null>("popular");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GoalPlanResult | null>(null);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [loadingLine, setLoadingLine] = useState(0);
  const run = useRef(0);

  useEffect(() => {
    if (!open) return;
    setStep(STEP_TITLE);
    setDirection(1);
    setTitle("");
    setWhat("");
    setHours(7);
    setLevel("popular");
    setError(null);
    setResult(null);
    setGoalId(null);
    setAiNote(null);
  }, [open]);

  useEffect(() => {
    if (step !== STEP_LOADING) return;
    setLoadingLine(0);
    const id = setInterval(() => setLoadingLine((n) => n + 1), 700);
    return () => clearInterval(id);
  }, [step]);

  const close = () => {
    run.current += 1;
    openComposer(false);
  };

  const go = (next: number) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
    setError(null);
  };

  const build = async (min: number, max: number) => {
    const ticket = ++run.current;
    go(STEP_LOADING);
    const started = Date.now();
    try {
      const sessions = planGoalSessions({ hoursMin: min, hoursMax: max, plans, prefs, today });
      if (!sessions.ok) {
        await wait(LOADING_MS);
        if (ticket !== run.current) return;
        setResult(sessions);
        setDirection(1);
        setStep(STEP_FULL);
        return;
      }
      const outcome = await compilePreview({ text: what.trim(), targetDate: null, hoursPerWeek: Math.max(1, Math.round(sessions.placedMin / 60)) }, aiConfigured(ai), "");
      await wait(Math.max(0, LOADING_MS - (Date.now() - started)));
      if (ticket !== run.current) return;
      const id = await createGoalWithSessions({ ...outcome.plan, title: title.trim(), description: what.trim() }, sessions.sessions);
      if (!id) {
        setDirection(-1);
        setStep(STEP_HOURS);
        return;
      }
      setResult(sessions);
      setGoalId(id);
      setAiNote(outcome.fallbackReason);
      setDirection(1);
      setStep(STEP_RESULT);
    } catch (e) {
      if (ticket !== run.current) return;
      setDirection(-1);
      setStep(STEP_HOURS);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const next = () => {
    if (step === STEP_TITLE) {
      const problem = textErrorMessage(textProblem(title));
      if (problem) return setError(problem);
      return go(STEP_WHAT);
    }
    if (step === STEP_WHAT) {
      const problem = validateGoalText(what);
      if (problem) return setError(problem);
      return go(STEP_HOURS);
    }
    if (step === STEP_HOURS) {
      if (!Number.isFinite(hours) || hours < 1) return setError(t.errHours);
      const chosen = LEVELS.find((l) => l.key === level);
      void build(chosen?.min ?? hours, chosen?.max ?? hours);
    }
  };

  const fitsHours = result ? Math.floor(result.placedMin / 60) : 0;
  const sessionPlans = plans.filter((p) => p.goalId === goalId);
  const dates = weekDates(today, weekStartDay());
  const quote = t.quotes[(title.length + what.length) % t.quotes.length];

  const titles: Record<number, string> = {
    [STEP_LOADING]: t.goalCreating,
    [STEP_RESULT]: t.goalCreated,
    [STEP_FULL]: t.goalFullTitle,
  };

  return (
    <Wizard
      open={open}
      onClose={close}
      huge={step === STEP_RESULT}
      title={titles[step] ?? t.newGoal}
      step={Math.min(step, STEP_RESULT)}
      total={STEP_RESULT + 1}
      direction={direction}
      onBack={step > STEP_TITLE && step <= STEP_HOURS ? () => go(step - 1) : undefined}
      onNext={next}
      nextLabel={step === STEP_HOURS ? t.createMyPlan : t.continue}
      hideFooter={step >= STEP_LOADING}
    >
      {step === STEP_TITLE && (
        <>
          <WizardQuestion title={t.qGoalTitle} hint={t.hintGoalTitle} />
          <Field label={t.taskTitle}>
            <TextInput className="wiz-input" value={title} maxLength={80} placeholder={t.goalTitlePh} onChange={(e) => { setTitle(e.target.value); setError(null); }} />
          </Field>
        </>
      )}

      {step === STEP_WHAT && (
        <>
          <WizardQuestion title={t.qGoalWhat} hint={t.hintGoalWhat} />
          <Field label={t.goalField}>
            <TextArea
              rows={3}
              value={what}
              maxLength={240}
              placeholder={t.goalPh}
              onChange={(e) => { setWhat(e.target.value); setError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  next();
                }
              }}
            />
          </Field>
          <div className="composer__examples" aria-label={t.examplesLabel}>
            {t.examples.map((ex) => (
              <button key={ex} type="button" className="chip composer__example" onClick={() => setWhat(ex)}>
                {ex}
              </button>
            ))}
          </div>
        </>
      )}

      {step === STEP_HOURS && (
        <>
          <WizardQuestion title={t.qGoalHours} hint={t.hintGoalHours} />
          <div className="level-grid">
            {LEVELS.map((l) => (
              <button
                key={l.key}
                type="button"
                aria-pressed={level === l.key}
                className={`level ${level === l.key ? "level--on" : ""}`}
                onClick={() => {
                  setLevel(l.key);
                  setHours(l.max);
                  setError(null);
                }}
              >
                {l.badge && <em className="level__badge">{l.badge()}</em>}
                <strong>{l.label()}</strong>
                <span className="tabular">{hoursLabel(l)}</span>
              </button>
            ))}
          </div>
          <Field label={t.orTypeHours}>
            <NumberInput
              value={hours}
              min={1}
              max={60}
              suffix={t.hours}
              onChange={(v) => {
                setHours(v);
                setLevel(null);
                setError(null);
              }}
            />
          </Field>
        </>
      )}

      {step === STEP_LOADING && (
        <div className="goal-loading" role="status">
          <span className="goal-loading__orb" aria-hidden="true">
            <Sparkles size={26} />
          </span>
          <h3 className="wiz-q__title">{t.goalCreatingLead}</h3>
          <p key={loadingLine} className="goal-loading__line muted">
            {t.goalLoadingLines[loadingLine % t.goalLoadingLines.length]}
          </p>
        </div>
      )}

      {step === STEP_FULL && result && (
        <div className="goal-full" role="alert">
          <span className="goal-full__icon" aria-hidden="true">
            <CalendarClock size={26} />
          </span>
          <h3 className="wiz-q__title">{t.goalFullLead}</h3>
          <p className="muted">{t.goalFullText(formatDuration(result.neededMin), formatDuration(result.placedMin))}</p>
          <div className="goal-full__actions">
            <Button variant="primary" onClick={() => go(STEP_HOURS)}>
              {t.goalChangeHours}
            </Button>
            {fitsHours >= 1 && (
              <Button
                variant="glass"
                onClick={() => {
                  setHours(fitsHours);
                  setLevel(null);
                  void build(fitsHours, fitsHours);
                }}
              >
                {t.goalUseFits(num(fitsHours))}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                close();
                navigate("week");
              }}
            >
              {t.goalSeeWeek}
            </Button>
          </div>
        </div>
      )}

      {step === STEP_RESULT && result && (
        <div className="goal-result">
          <p className="muted">{t.goalResultSummary(num(result.sessions.length), formatDuration(result.placedMin))}</p>
          {aiNote && <p className="notice notice--warn">{aiNote}</p>}
          <div className="goal-result__grid">
            <WeekGrid dates={dates} plans={plans} highlight={new Set(sessionPlans.map((p) => p.id))} />
          </div>
          <div className="session-cards">
            {result.sessions.map((s, i) => (
              <div key={`${s.weekday}-${s.start}`} className="session-card" style={{ animationDelay: `${i * 60}ms` }}>
                <strong>{t.weekdays[s.weekday]}</strong>
                <span className="tabular">
                  {formatClock(s.start)} – {formatClock(s.end)}
                </span>
                <span className="faint tabular">{formatDuration(s.end - s.start)}</span>
                {s.overEvent && <em className="chip chip--warn">{t.overEvent}</em>}
              </div>
            ))}
          </div>
          <blockquote className="goal-quote">
            <Quote size={16} aria-hidden="true" />
            {quote}
          </blockquote>
          <div className="goal-full__actions">
            <Button
              variant="glass"
              icon={<Flame size={15} />}
              onClick={() => {
                close();
                if (goalId) selectGoal(goalId);
              }}
            >
              {t.goalOpenPlan}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                close();
                navigate("week");
              }}
            >
              {t.goalSeeWeek}
            </Button>
          </div>
        </div>
      )}

      {error && <WizardError>{error}</WizardError>}
    </Wizard>
  );
}
