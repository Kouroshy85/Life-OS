import { ArrowRight, CalendarClock, CalendarRange, Check, Clock3, Flame, ListTodo, Play, Sparkles, SunMedium, Target, Timer, Wand2 } from "lucide-react";
import { subtract, totalLength } from "../../domain/intervals";
import { rankTasks } from "../../domain/scheduler";
import { formatClock, formatDuration, formatLongDate, toDateKey } from "../../domain/time";
import type { ScheduleBlock, Task } from "../../domain/types";
import { commitmentsOn, isOpen, liveBlocks, proposedBlocks, toSchedulable, unplannedMinutes } from "../../state/planning";
import {
  completeBlock,
  dismissWelcome,
  extendBlock,
  goalProgress,
  loadSampleData,
  navigate,
  openComposer,
  proposeDay,
  scheduleTask,
  selectGoal,
  setPlannerDate,
  startBlock,
  useApp,
} from "../../state/store";
import { LiquidGlass } from "../../ui/LiquidGlass";
import { Button, IconButton, ProgressRing } from "../../ui/primitives";
import { TaskMeta } from "../../ui/taskBits";

function greeting(min: number) {
  if (min < 5 * 60) return "Working late";
  if (min < 12 * 60) return "Good morning";
  if (min < 17 * 60) return "Good afternoon";
  return "Good evening";
}

export function TodayView() {
  const s = useApp();
  const { today, nowMin } = s.clock;
  const state = { tasks: s.tasks, commitments: s.commitments, blocks: s.blocks, skips: s.skips, prefs: s.prefs };
  const commitments = commitmentsOn(today, s.commitments);
  const blocks = liveBlocks(state, today).filter((b) => b.state !== "skipped");
  const proposal = proposedBlocks(state, today);
  const taskMap = new Map(s.tasks.map((t) => [t.id, t]));
  const goals = s.goals.filter((g) => !g.archived);

  const isNewUser = goals.length === 0 && s.tasks.length === 0 && s.commitments.length === 0;

  const current = blocks.find((b) => b.kind === "task" && (b.state === "in_progress" || (b.state === "planned" && b.start <= nowMin && nowMin < b.end)));
  const upcoming = blocks.filter((b) => b.state === "planned" && b.start >= nowMin).sort((a, b) => a.start - b.start);
  const next = upcoming.find((b) => b.kind === "task" && b.id !== current?.id);

  const windowStart = Math.max(s.prefs.workStart, nowMin);
  const freeLeft = windowStart >= s.prefs.workEnd ? 0 : totalLength(subtract({ start: windowStart, end: s.prefs.workEnd }, [...commitments, ...blocks]));
  const remainingScheduled = blocks.filter((b) => b.kind === "task" && b.state !== "done" && b.end > nowMin).reduce((acc, b) => acc + (b.end - Math.max(b.start, nowMin)), 0);
  const doneBlocks = blocks.filter((b) => b.kind === "task" && b.state === "done");
  const completedToday = s.tasks.filter((t) => t.status === "done" && t.completedAt && toDateKey(new Date(t.completedAt)) === today).length;
  const focusedMin = doneBlocks.reduce((acc, b) => acc + (b.end - b.start), 0);

  const backlog = rankTasks(
    s.tasks.filter((t) => t.inPlanner && isOpen(t) && unplannedMinutes(state, t, today, s.clock) > 0).map((t) => ({ ...toSchedulable(t), task: t })),
    today,
  ).map((x) => x.task);

  const summary = (() => {
    if (isNewUser) return "Let's set up your first plan.";
    const parts: string[] = [];
    if (remainingScheduled > 0) parts.push(`${formatDuration(remainingScheduled)} of planned work ahead`);
    if (freeLeft > 0) parts.push(`${formatDuration(freeLeft)} still unplanned`);
    else if (nowMin >= s.prefs.workEnd) parts.push("your working hours are over");
    if (backlog.length) parts.push(`${backlog.length} in the backlog`);
    return parts.length ? `${parts.join(" · ")}.` : "Nothing scheduled yet today.";
  })();

  const planToday = async () => {
    await proposeDay(today);
    setPlannerDate(today);
    navigate("planner");
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{formatLongDate(today)}</div>
          <h1 className="page-title" tabIndex={-1} data-page-heading>
            {greeting(nowMin)}
          </h1>
          <p className="page-sub">{summary}</p>
        </div>
      </div>

      {isNewUser && !s.flags.welcomeDismissed ? (
        <Welcome />
      ) : (
        <div className="today-grid">
          <LiquidGlass className="now-card rise" radius={28} bezel={18} strength={34}>
            <NowCard current={current} next={next} taskMap={taskMap} hasProposal={proposal.length > 0} hasBlocks={blocks.some((b) => b.kind === "task")} backlogCount={backlog.length} onPlan={planToday} nowMin={nowMin} workEnd={s.prefs.workEnd} />
          </LiquidGlass>

          <div className="stats rise rise-1" aria-label="Today in numbers">
            <Stat icon={<SunMedium size={15} />} label="Unplanned time left" value={formatDuration(freeLeft)} hint={`until ${formatClock(s.prefs.workEnd)}`} />
            <Stat icon={<Clock3 size={15} />} label="Planned ahead" value={formatDuration(remainingScheduled)} hint={`${upcoming.filter((b) => b.kind === "task").length} sessions`} />
            <Stat icon={<Check size={15} />} label="Completed today" value={String(completedToday)} hint={focusedMin ? `${formatDuration(focusedMin)} of sessions done` : "tasks finished"} />
            <Stat icon={<ListTodo size={15} />} label="Backlog" value={String(backlog.length)} hint="waiting for a slot" />
          </div>

          <section className="card rise rise-2 today-schedule" aria-labelledby="sched-title">
            <div className="card__title">
              <span id="sched-title">Rest of today</span>
              <Button size="sm" variant="ghost" icon={<CalendarRange size={14} />} onClick={() => { setPlannerDate(today); navigate("planner"); }}>
                Open planner
              </Button>
            </div>
            <Agenda blocks={blocks} commitments={commitments} taskMap={taskMap} nowMin={nowMin} />
          </section>

          <section className="card rise rise-2 today-priorities" aria-labelledby="prio-title">
            <div className="card__title">
              <span id="prio-title">Next priorities</span>
              <span className="faint" style={{ fontWeight: 500 }}>Unscheduled, by urgency</span>
            </div>
            {backlog.length === 0 ? (
              <p className="faint" style={{ fontSize: 13.5 }}>
                Nothing waiting. Send tasks from a goal to the planner, or add a quick task in the Planner.
              </p>
            ) : (
              <ul className="prio-list">
                {backlog.slice(0, 5).map((t) => (
                  <li key={t.id}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="prio-list__title">{t.title}</div>
                      <div className="taskrow__meta">
                        <TaskMeta task={t} today={today} />
                      </div>
                    </div>
                    {nowMin < s.prefs.workEnd && (
                      <IconButton label={`Schedule “${t.title}” in today's next free slot`} onClick={() => scheduleTask(t.id, today)}>
                        <CalendarClock size={16} />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="today-goals rise rise-3" aria-labelledby="goals-title">
            <div className="today-goals__head">
              <h2 className="section-title" id="goals-title">Goal progress</h2>
              <Button size="sm" variant="ghost" icon={<Wand2 size={14} />} onClick={() => openComposer(true)}>
                New goal
              </Button>
            </div>
            {goals.length === 0 ? (
              <div className="card">
                <p className="muted">No goals yet. Compile one to see progress here.</p>
              </div>
            ) : (
              <div className="goal-tiles">
                {goals.map((g) => {
                  const p = goalProgress(g.id, s.tasks);
                  const nextTask = s.tasks
                    .filter((t) => t.goalId === g.id && isOpen(t))
                    .sort((a, b) => {
                      const ma = s.milestones.find((m) => m.id === a.milestoneId)?.sortOrder ?? 0;
                      const mb = s.milestones.find((m) => m.id === b.milestoneId)?.sortOrder ?? 0;
                      return ma - mb || a.sortOrder - b.sortOrder;
                    })[0];
                  return (
                    <button key={g.id} type="button" className="goal-tile" onClick={() => selectGoal(g.id)}>
                      <ProgressRing value={p.ratio} size={54} stroke={5} label={`${Math.round(p.ratio * 100)}`} />
                      <span className="goal-tile__body">
                        <span className="goal-tile__title">
                          {g.title} {g.isSample && <span className="badge-sample">Sample</span>}
                        </span>
                        <span className="faint goal-tile__next">
                          {nextTask ? <>Next: {nextTask.title}</> : p.total ? "All tasks complete" : "No tasks yet"}
                        </span>
                      </span>
                      <ArrowRight size={16} className="goal-tile__arrow" />
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="stat">
      <div className="stat__label">
        {icon}
        {label}
      </div>
      <div className="stat__value tabular">{value}</div>
      <div className="stat__hint">{hint}</div>
    </div>
  );
}

function NowCard({
  current,
  next,
  taskMap,
  hasProposal,
  hasBlocks,
  backlogCount,
  onPlan,
  nowMin,
  workEnd,
}: {
  current?: ScheduleBlock;
  next?: ScheduleBlock;
  taskMap: Map<string, Task>;
  hasProposal: boolean;
  hasBlocks: boolean;
  backlogCount: number;
  onPlan: () => void;
  nowMin: number;
  workEnd: number;
}) {
  const block = current ?? next;
  const task = block?.taskId ? taskMap.get(block.taskId) : undefined;
  if (hasProposal) {
    return (
      <div className="now">
        <div className="eyebrow now__eyebrow"><Sparkles size={13} /> Proposal waiting</div>
        <h2 className="now__title">Your day plan is ready to review</h2>
        <p className="muted">Accept it, adjust blocks by hand, or reject it — nothing changes until you decide.</p>
        <div className="now__actions">
          <Button variant="primary" icon={<ArrowRight size={16} />} onClick={() => navigate("planner")}>
            Review proposal
          </Button>
        </div>
      </div>
    );
  }
  if (!block || !task) {
    const over = nowMin >= workEnd;
    return (
      <div className="now">
        <div className="eyebrow now__eyebrow"><Flame size={13} /> {hasBlocks ? "All done" : "No plan yet"}</div>
        <h2 className="now__title">
          {over ? "Working hours are over" : hasBlocks ? "Nothing else scheduled today" : backlogCount ? "Turn your backlog into a realistic day" : "Start by giving the planner something to plan"}
        </h2>
        <p className="muted">
          {over
            ? "Tomorrow can be planned from the Planner whenever you're ready."
            : backlogCount
              ? `${backlogCount} task${backlogCount === 1 ? " is" : "s are"} waiting. The planner fits them around your commitments and explains every choice.`
              : "Add a task or send tasks from one of your goals to the planner."}
        </p>
        <div className="now__actions">
          {over ? (
            <Button variant="glass" icon={<CalendarRange size={15} />} onClick={() => navigate("planner")}>
              Open planner
            </Button>
          ) : backlogCount ? (
            <Button variant="primary" icon={<Sparkles size={15} />} onClick={onPlan}>
              Plan my day
            </Button>
          ) : (
            <>
              <Button variant="primary" icon={<Target size={15} />} onClick={() => navigate("goals")}>
                Go to goals
              </Button>
              <Button variant="glass" onClick={() => navigate("planner")}>
                Open planner
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }
  const running = block.state === "in_progress";
  const live = block === current;
  const minsLeft = block.end - nowMin;
  return (
    <div className="now">
      <div className="eyebrow now__eyebrow">
        {running ? <><span className="pulse" /> In progress</> : live ? "Scheduled now" : `Up next · ${formatClock(block.start)}`}
      </div>
      <h2 className="now__title">{task.title}</h2>
      <div className="now__meta tabular">
        <span>{formatClock(block.start)}–{formatClock(block.end)}</span>
        <span className="faint">·</span>
        <span>{live && minsLeft > 0 ? `${formatDuration(minsLeft)} left` : live ? "running over" : `in ${formatDuration(block.start - nowMin)}`}</span>
        {block.partCount > 1 && <span className="faint">· session {block.part}/{block.partCount}</span>}
      </div>
      <p className="now__why">{block.reason}</p>
      <div className="now__actions">
        {!running && (
          <Button variant="primary" icon={<Play size={14} />} onClick={() => startBlock(block.id)}>
            Start now
          </Button>
        )}
        <Button variant={running ? "primary" : "glass"} icon={<Check size={15} />} onClick={() => completeBlock(block.id)}>
          Mark done
        </Button>
        {running && (
          <Button variant="glass" icon={<Timer size={15} />} onClick={() => extendBlock(block.id, 15)} title="Running long — extend by 15 minutes and recalculate">
            Need 15 more min
          </Button>
        )}
      </div>
    </div>
  );
}

function Agenda({ blocks, commitments, taskMap, nowMin }: { blocks: ScheduleBlock[]; commitments: ReturnType<typeof commitmentsOn>; taskMap: Map<string, Task>; nowMin: number }) {
  const items = [
    ...blocks.filter((b) => b.end > nowMin || b.state === "in_progress").map((b) => ({ key: b.id, start: b.start, end: b.end, title: b.kind === "break" ? "Break" : (taskMap.get(b.taskId ?? "")?.title ?? "Task"), kind: b.kind === "break" ? "break" : "task", state: b.state })),
    ...commitments.filter((c) => c.end > nowMin).map((c) => ({ key: c.id, start: c.start, end: c.end, title: c.title, kind: c.kind === "break" ? "break" : "commitment", state: "planned" as const })),
  ].sort((a, b) => a.start - b.start);
  if (!items.length) return <p className="faint" style={{ fontSize: 13.5 }}>Nothing left on today's timeline.</p>;
  return (
    <ol className="agenda">
      {items.slice(0, 8).map((i) => (
        <li key={i.key} className={`agenda__item agenda__item--${i.kind} ${i.state === "done" ? "agenda__item--done" : ""}`}>
          <span className="agenda__time tabular">{formatClock(i.start)}</span>
          <span className="agenda__bar" />
          <span className="agenda__title">{i.title}</span>
          <span className="agenda__dur faint tabular">{i.state === "in_progress" ? "now" : formatDuration(i.end - i.start)}</span>
        </li>
      ))}
      {items.length > 8 && <li className="faint" style={{ fontSize: 12.5, paddingLeft: 64 }}>+{items.length - 8} more</li>}
    </ol>
  );
}

function Welcome() {
  return (
    <div className="welcome rise">
      <LiquidGlass className="welcome__hero" radius={30} bezel={20} strength={40}>
        <div className="eyebrow now__eyebrow"><Sparkles size={13} /> Welcome to Life OS</div>
        <h2 className="welcome__title">Design your days around what matters.</h2>
        <p className="muted welcome__lead">Compile a goal into a plan, tell the planner when you work, and let it build a realistic day — with a reason for every block.</p>
        <div className="now__actions">
          <Button variant="primary" size="lg" icon={<Wand2 size={17} />} onClick={() => openComposer(true)}>
            Compile your first goal
          </Button>
          <Button variant="glass" size="lg" onClick={() => navigate("planner")}>
            Set working hours
          </Button>
        </div>
      </LiquidGlass>
      <ol className="welcome__steps">
        <li className="card">
          <span className="welcome__num">1</span>
          <strong>Compile a goal</strong>
          <p className="muted">Write it in your own words. Get milestones, projects and tasks you can edit.</p>
        </li>
        <li className="card">
          <span className="welcome__num">2</span>
          <strong>Set your day</strong>
          <p className="muted">Working hours, focus hours, breaks and fixed commitments.</p>
        </li>
        <li className="card">
          <span className="welcome__num">3</span>
          <strong>Plan and adapt</strong>
          <p className="muted">Accept a proposed schedule, then let it adapt when things run long.</p>
        </li>
      </ol>
      <div className="welcome__sample">
        <span className="faint">Just looking around?</span>
        <Button size="sm" variant="ghost" onClick={loadSampleData}>
          Load sample data
        </Button>
        <span className="faint">— clearly marked, removable in Settings ·</span>
        <Button size="sm" variant="ghost" onClick={dismissWelcome}>
          Skip intro
        </Button>
      </div>
    </div>
  );
}
