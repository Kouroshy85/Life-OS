import { CalendarClock, Clock3, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { num } from "../../domain/locale";
import { PLAN_PRIORITY, planColor } from "../../domain/plans";
import { formatClock, formatDuration } from "../../domain/time";
import type { Plan, PlanType } from "../../domain/types";
import { t } from "../../i18n";
import { deletePlan, selectGoal, setPlanColor, setPlannerMode, useApp, type PlannerMode } from "../../state/store";
import { Button, Confirm, Empty, IconButton, Segmented } from "../../ui/primitives";
import { ColorPicker } from "./ColorPicker";
import { PLAN_ICON, planDaysLabel, PlanWizard } from "./PlanWizard";

export function PlannerSwitch({ mode }: { mode: PlannerMode }) {
  return (
    <Segmented
      label={t.navPlanner}
      value={mode}
      onChange={setPlannerMode}
      options={[
        { value: "plans", label: t.myPlans },
        { value: "day", label: t.dayTimeline },
      ]}
    />
  );
}

const TYPES: PlanType[] = ["default", "goal", "event"];

export function PlansView() {
  const plans = useApp((s) => s.plans);
  const goals = useApp((s) => s.goals);
  const [wizard, setWizard] = useState<{ type: PlanType; plan?: Plan } | null>(null);
  const [removing, setRemoving] = useState<Plan | null>(null);

  const groupTitle = { default: t.groupDefault, goal: t.groupGoal, event: t.groupEvent };
  const groupHint = { default: t.groupDefaultHint, goal: t.groupGoalHint, event: t.groupEventHint };
  const addLabel = { default: t.addDefault, goal: t.addManualGoal, event: t.addEvent };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{t.plannerEyebrowShort}</div>
          <h1 className="page-title" tabIndex={-1} data-page-heading>
            {t.navPlanner}
          </h1>
          <p className="page-sub">{t.plannerSub}</p>
        </div>
        <PlannerSwitch mode="plans" />
      </div>

      <div className="plan-adders">
        {TYPES.map((type, i) => {
          const Icon = PLAN_ICON[type];
          return (
            <button key={type} type="button" className={`plan-adder plan-adder--${type} rise rise-${i + 1}`} onClick={() => setWizard({ type })}>
              <span className="plan-adder__icon">
                <Icon size={20} />
              </span>
              <strong>{addLabel[type]}</strong>
              <span className="muted">{groupHint[type]}</span>
            </button>
          );
        })}
      </div>

      {plans.length === 0 ? (
        <div className="card rise rise-3">
          <Empty icon={<CalendarClock size={22} />} title={t.noPlans} text={t.noPlansText} />
        </div>
      ) : (
        [...TYPES]
          .sort((a, b) => PLAN_PRIORITY[a] - PLAN_PRIORITY[b])
          .map((type) => {
            const list = plans.filter((p) => p.type === type);
            if (!list.length) return null;
            return (
              <section key={type} className="plan-group rise rise-3" aria-labelledby={`group-${type}`}>
                <h2 className="plan-group__title" id={`group-${type}`}>
                  <span className={`plan-dot plan-dot--${type}`} />
                  {groupTitle[type]} <span className="faint tabular">{num(list.length)}</span>
                </h2>
                <ul className="plan-list">
                  {list.map((plan) => {
                    const goal = plan.goalId ? goals.find((g) => g.id === plan.goalId) : null;
                    return (
                      <li key={plan.id} className={`plan-row plan-c${planColor(plan, goals)}`}>
                        <div className="plan-row__main">
                          <strong className="plan-row__title">
                            {plan.title} {plan.isSample && <span className="badge-sample">{t.sample}</span>}
                          </strong>
                          {plan.description && <p className="plan-row__desc">{plan.description}</p>}
                          <div className="taskrow__meta">
                            <span className="chip tabular">
                              <Clock3 size={12} />
                              {formatClock(plan.start)}–{formatClock(plan.end)} · {formatDuration(plan.end - plan.start)}
                            </span>
                            <span className="chip">{planDaysLabel(plan)}</span>
                            {goal && (
                              <button type="button" className="chip chip--accent plan-row__goal" onClick={() => selectGoal(goal.id)}>
                                {t.partOfGoal}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="plan-row__actions">
                          <ColorPicker label={t.colorOf(plan.title)} value={planColor(plan, goals)} onChange={(color) => setPlanColor(plan, color)} />
                          <IconButton label={t.editPlanOf(plan.title)} onClick={() => setWizard({ type: plan.type, plan })}>
                            <Pencil size={16} />
                          </IconButton>
                          <IconButton label={t.deletePlanOf(plan.title)} onClick={() => setRemoving(plan)}>
                            <Trash2 size={16} />
                          </IconButton>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <Button size="sm" variant="ghost" onClick={() => setWizard({ type })}>
                  + {addLabel[type]}
                </Button>
              </section>
            );
          })
      )}

      <PlanWizard open={!!wizard} type={wizard?.type ?? "default"} plan={wizard?.plan} onClose={() => setWizard(null)} />
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
