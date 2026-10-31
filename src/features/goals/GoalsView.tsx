import { Plus, Target, Wand2 } from "lucide-react";
import { useEffect } from "react";
import { goalProgress, openComposer, selectGoal, useApp } from "../../state/store";
import { Bar, Button, Empty } from "../../ui/primitives";
import { GoalComposer } from "./GoalComposer";
import { GoalDetail } from "./GoalDetail";

export function GoalsView() {
  const goals = useApp((s) => s.goals);
  const tasks = useApp((s) => s.tasks);
  const selected = useApp((s) => s.selectedGoalId);
  const active = goals.filter((g) => !g.archived);
  const current = active.find((g) => g.id === selected) ?? active[0];

  useEffect(() => {
    if (current && current.id !== selected) useApp.setState({ selectedGoalId: current.id });
  }, [current, selected]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Goal Compiler</div>
          <h1 className="page-title" tabIndex={-1} data-page-heading>
            Goals
          </h1>
          <p className="page-sub">Turn intentions into milestones, projects and tasks you can actually schedule.</p>
        </div>
        <Button variant="primary" size="lg" icon={<Wand2 size={17} />} onClick={() => openComposer(true)}>
          New goal
        </Button>
      </div>

      {active.length === 0 ? (
        <div className="card rise">
          <Empty
            icon={<Target size={22} />}
            title="No goals yet"
            text="Describe something you want to achieve — “Prepare for my university exams” — and Life OS will compile an editable plan."
            action={
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => openComposer(true)}>
                Compile your first goal
              </Button>
            }
          />
        </div>
      ) : (
        <div className="goals-layout">
          <aside className="goal-list" aria-label="Goals">
            {active.map((g, i) => {
              const p = goalProgress(g.id, tasks);
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`goal-card rise rise-${Math.min(i + 1, 4)} ${current?.id === g.id ? "goal-card--active" : ""}`}
                  aria-current={current?.id === g.id ? "true" : undefined}
                  onClick={() => selectGoal(g.id)}
                >
                  <span className="goal-card__title">
                    {g.title}
                    {g.isSample && <span className="badge-sample" style={{ marginLeft: 8 }}>Sample</span>}
                  </span>
                  <span className="goal-card__meta tabular">
                    <span>{Math.round(p.ratio * 100)}%</span>
                    <span className="faint">
                      {p.done}/{p.total} tasks
                    </span>
                  </span>
                  <Bar value={p.ratio} />
                </button>
              );
            })}
          </aside>
          {current && <GoalDetail key={current.id} goal={current} />}
        </div>
      )}
      <GoalComposer />
    </div>
  );
}
