import { CalendarPlus, ChevronLeft, ChevronRight, Clock3, Coffee, Pencil, Sparkles, Target, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { freeTimes } from "../../domain/availability";
import { weekStartDay } from "../../domain/locale";
import { planColor, weekDates } from "../../domain/plans";
import { addDays, formatClock, formatDayClock, formatDuration, formatMonthYear, formatShortDate, weekdayOf } from "../../domain/time";
import type { Plan, PlanType } from "../../domain/types";
import { t } from "../../i18n";
import { deletePlan, navigate, openComposer, setPlanColor, useApp } from "../../state/store";
import { DateInput } from "../../ui/fields";
import { LiquidGlass } from "../../ui/LiquidGlass";
import { Button, Confirm, Dialog, IconButton } from "../../ui/primitives";
import { ColorPicker } from "../planner/ColorPicker";
import { PLAN_ICON, planDaysLabel, PlanWizard } from "../planner/PlanWizard";
import { PlanLegend, WeekGrid } from "./WeekGrid";

export function WeekView() {
  const clock = useApp((s) => s.clock);
  const plans = useApp((s) => s.plans);
  const [anchor, setAnchor] = useState(clock.today);
  const [adding, setAdding] = useState<{ type: PlanType; plan?: Plan } | null>(null);
  const [selected, setSelected] = useState<Plan | null>(null);
  const [removing, setRemoving] = useState<Plan | null>(null);
  const [freeOpen, setFreeOpen] = useState(false);

  const dates = useMemo(() => weekDates(anchor, weekStartDay()), [anchor]);
  const isThisWeek = dates.includes(clock.today);

  return (
    <div className="page page--week">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            {formatMonthYear(dates[0])} · {formatShortDate(dates[0])} – {formatShortDate(dates[6])}
          </div>
          <h1 className="page-title" tabIndex={-1} data-page-heading>
            {isThisWeek ? t.navWeek : t.weekTitleOther}
          </h1>
        </div>
        <div className="week-actions">
          <Button variant="glass" icon={<Target size={15} />} onClick={() => openComposer(true)}>
            {t.addGoal}
          </Button>
          <Button variant="glass" icon={<CalendarPlus size={15} />} onClick={() => setAdding({ type: "default" })}>
            {t.addPlan}
          </Button>
          <Button variant="primary" icon={<Sparkles size={15} />} onClick={() => setFreeOpen(true)}>
            {t.whenFree}
          </Button>
        </div>
      </div>

      <LiquidGlass className="toolbar" radius={22} bezel={14} strength={30}>
        <div className="toolbar__group">
          <IconButton label={t.prevWeek} onClick={() => setAnchor(addDays(anchor, -7))}>
            <ChevronLeft size={18} className="flip-rtl" />
          </IconButton>
          <Button size="sm" variant={isThisWeek ? "glass" : "ghost"} onClick={() => setAnchor(clock.today)}>
            {t.thisWeek}
          </Button>
          <IconButton label={t.nextWeek} onClick={() => setAnchor(addDays(anchor, 7))}>
            <ChevronRight size={18} className="flip-rtl" />
          </IconButton>
          <span className="toolbar__date">
            <DateInput bare required aria-label={t.goToDate} value={anchor} onChange={(v) => v && setAnchor(v)} />
          </span>
        </div>
        <PlanLegend />
      </LiquidGlass>

      <div className="card week-card rise">
        <WeekGrid dates={dates} plans={plans} onSelect={setSelected} />
        {plans.length === 0 && <p className="week-empty muted">{t.weekEmpty}</p>}
      </div>

      <PlanWizard open={!!adding} type={adding?.type ?? "default"} plan={adding?.plan} date={isThisWeek ? clock.today : dates[0]} onClose={() => setAdding(null)} />
      <FreeDialog open={freeOpen} onClose={() => setFreeOpen(false)} dates={dates} />
      <PlanDialog
        plan={selected}
        onClose={() => setSelected(null)}
        onEdit={(plan) => {
          setSelected(null);
          setAdding({ type: plan.type, plan: plans.find((p) => p.id === plan.id) ?? plan });
        }}
        onDelete={(plan) => {
          setSelected(null);
          setRemoving(plan);
        }}
      />
      <Confirm
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={t.deletePlanQ}
        message={removing ? t.deletePlanMsg(removing.title) : ""}
        onConfirm={() => removing && deletePlan(removing.id)}
      />
    </div>
  );
}

function PlanDialog({ plan, onClose, onEdit, onDelete }: { plan: Plan | null; onClose: () => void; onEdit: (p: Plan) => void; onDelete: (p: Plan) => void }) {
  const plans = useApp((s) => s.plans);
  const goals = useApp((s) => s.goals);
  if (!plan) return null;
  const current = plans.find((p) => p.id === plan.id) ?? plan;
  const Icon = PLAN_ICON[plan.type];
  const typeName = { default: t.groupDefault, goal: t.groupGoal, event: t.groupEvent }[plan.type];
  return (
    <Dialog
      open
      onClose={onClose}
      title={plan.title}
      subtitle={plan.description || undefined}
      footer={
        <>
          <Button variant="danger-ghost" icon={<Trash2 size={15} />} onClick={() => onDelete(plan)}>
            {t.delete}
          </Button>
          <span className="spacer" />
          <Button variant="primary" icon={<Pencil size={14} />} onClick={() => onEdit(plan)}>
            {t.edit}
          </Button>
        </>
      }
    >
      <div className="taskrow__meta">
        <span className="chip">
          <Icon size={12} />
          {typeName}
        </span>
        <span className="chip tabular">
          <Clock3 size={12} />
          {formatClock(plan.start)}–{formatClock(plan.end)} · {formatDuration(plan.end - plan.start)}
        </span>
        <span className="chip">{planDaysLabel(plan)}</span>
      </div>
      <div className="color-field">
        <span className="muted">{plan.goalId ? t.goalColorLabel : t.planColorLabel}</span>
        <ColorPicker label={t.colorOf(plan.title)} value={planColor(current, goals)} onChange={(color) => setPlanColor(current, color)} />
      </div>
    </Dialog>
  );
}

function FreeDialog({ open, onClose, dates }: { open: boolean; onClose: () => void; dates: string[] }) {
  const plans = useApp((s) => s.plans);
  const prefs = useApp((s) => s.prefs);
  const clock = useApp((s) => s.clock);
  if (!open) return null;
  const days = dates.filter((d) => d >= clock.today).map((date) => ({ date, free: freeTimes(date, plans, prefs, { today: clock.today, nowMin: clock.nowMin }) }));
  const total = days.reduce((sum, d) => sum + d.free.reduce((s2, f) => s2 + (f.end - f.start), 0), 0);
  return (
    <Dialog
      open
      wide
      huge
      onClose={onClose}
      title={t.freeTitle}
      subtitle={`${t.freeTotal(formatDuration(total))} ${prefs.planGap ? t.freeGapOn : t.freeGapOff}`}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              onClose();
              navigate("settings");
            }}
          >
            {t.freeSettings}
          </Button>
          <span className="spacer" />
          <Button variant="primary" onClick={onClose}>
            {t.doneThanks}
          </Button>
        </>
      }
    >
      {days.length === 0 && <p className="muted">{t.freePast}</p>}
      <div className="free-days">
        {days.map(({ date, free }, i) => (
          <section key={date} className="free-day" style={{ animationDelay: `${i * 45}ms` }}>
            <h3 className="free-day__title">
              {t.weekdays[weekdayOf(date)]} <span className="faint tabular">{formatShortDate(date)}</span>
              {date === clock.today && <em className="chip chip--accent">{t.todayShort}</em>}
            </h3>
            {free.length === 0 ? (
              <p className="faint free-day__none">{t.freeNone}</p>
            ) : (
              <div className="free-cards">
                {free.map((f) => (
                  <div key={f.start} className="free-card">
                    <Coffee size={15} />
                    <strong className="tabular">
                      {formatDayClock(f.start)} – {formatDayClock(f.end)}
                    </strong>
                    <span className="faint tabular">{t.freeFor(formatDuration(f.end - f.start))}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </Dialog>
  );
}
