import { ArrowRight, CalendarRange, Check, Clock3, Flame, ListTodo, Play, Sparkles, SunMedium, Target, Timer, Wand2 } from "lucide-react";
import { subtract, totalLength } from "../../domain/intervals";
import { num } from "../../domain/locale";
import { rankTasks } from "../../domain/scheduler";
import { formatClock, formatDuration, formatLongDate, toDateKey } from "../../domain/time";
import type { ScheduleBlock, Task } from "../../domain/types";
import { explain, t } from "../../i18n";
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
  selectGoal,
  setPlannerDate,
  startBlock,
  useApp,
} from "../../state/store";
import { LiquidGlass } from "../../ui/LiquidGlass";
import { LiveClock, NotesSection } from "./NotesDeck";
import { Button, ProgressRing } from "../../ui/primitives";

export function TodayView() {
  const s = useApp();
  const { today, nowMin } = s.clock;
  const state = { tasks: s.tasks, commitments: s.commitments, blocks: s.blocks, skips: s.skips, prefs: s.prefs };
  const commitments = commitmentsOn(today, s.commitments);
  const blocks = liveBlocks(state, today).filter((b) => b.state !== "skipped");
  const proposal = proposedBlocks(state, today);
  const taskMap = new Map(s.tasks.map((t) => [t.id, t]));
  const goals = s.goals.filter((g) => !g.archived);

  const isNewUser = goals.length === 0 && s.tasks.length === 0 && s.plans.length === 0 && s.notes.length === 0;

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
    if (isNewUser) return t.todayFirstPlan;
    const parts: string[] = [];
    if (remainingScheduled > 0) parts.push(t.todayPlannedAhead(formatDuration(remainingScheduled)));
    if (freeLeft > 0) parts.push(t.todayUnplanned(formatDuration(freeLeft)));
    else if (nowMin >= s.prefs.workEnd) parts.push(t.todayHoursOver);
    if (backlog.length) parts.push(t.todayInBacklog(num(backlog.length)));
    if (!parts.length) return t.todayNothing;
    const line = `${parts.join(" · ")}.`;
    return line[0].toUpperCase() + line.slice(1);
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
          <div className="today-head">
            <h1 className="page-title" tabIndex={-1} data-page-heading>
              {t.greeting(nowMin)}
            </h1>
            <LiveClock />
          </div>
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

          <div className="stats rise rise-1" aria-label={t.todayNumbers}>
            <Stat icon={<SunMedium size={15} />} label={t.statUnplanned} value={formatDuration(freeLeft)} hint={t.statUntil(formatClock(s.prefs.workEnd))} />
            <Stat icon={<Clock3 size={15} />} label={t.statPlanned} value={formatDuration(remainingScheduled)} hint={t.statSessions(num(upcoming.filter((b) => b.kind === "task").length))} />
            <Stat icon={<Check size={15} />} label={t.statCompleted} value={num(completedToday)} hint={focusedMin ? t.statSessionsDone(formatDuration(focusedMin)) : t.statTasksFinished} />
            <Stat icon={<ListTodo size={15} />} label={t.statBacklog} value={num(backlog.length)} hint={t.statWaiting} />
          </div>

          <section className="card rise rise-2 today-schedule" aria-labelledby="sched-title">
            <div className="card__title">
              <span id="sched-title">{t.restOfToday}</span>
              <Button size="sm" variant="ghost" icon={<CalendarRange size={14} />} onClick={() => { setPlannerDate(today); navigate("planner"); }}>
                {t.openPlanner}
              </Button>
            </div>
            <Agenda blocks={blocks} commitments={commitments} taskMap={taskMap} nowMin={nowMin} />
          </section>

          <NotesSection />

          <section className="today-goals rise rise-3" aria-labelledby="goals-title">
            <div className="today-goals__head">
              <h2 className="section-title" id="goals-title">{t.goalProgress}</h2>
              <Button size="sm" variant="ghost" icon={<Wand2 size={14} />} onClick={() => openComposer(true)}>
                {t.newGoal}
              </Button>
            </div>
            {goals.length === 0 ? (
              <div className="card">
                <p className="muted">{t.noGoalsToday}</p>
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
                      <ProgressRing value={p.ratio} size={54} stroke={5} label={num(Math.round(p.ratio * 100))} />
                      <span className="goal-tile__body">
                        <span className="goal-tile__title">
                          {g.title} {g.isSample && <span className="badge-sample">{t.sample}</span>}
                        </span>
                        <span className="faint goal-tile__next">
                          {nextTask ? <>{t.nextTask}{nextTask.title}</> : p.total ? t.allComplete : t.noTasksYet}
                        </span>
                      </span>
                      <ArrowRight size={16} className="goal-tile__arrow flip-rtl" />
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
        <div className="eyebrow now__eyebrow"><Sparkles size={13} /> {t.proposalWaiting}</div>
        <h2 className="now__title">{t.proposalReady}</h2>
        <p className="muted">{t.proposalReadyText}</p>
        <div className="now__actions">
          <Button variant="primary" icon={<ArrowRight size={16} className="flip-rtl" />} onClick={() => navigate("planner")}>
            {t.reviewProposal}
          </Button>
        </div>
      </div>
    );
  }
  if (!block || !task) {
    const over = nowMin >= workEnd;
    return (
      <div className="now">
        <div className="eyebrow now__eyebrow"><Flame size={13} /> {hasBlocks ? t.nowAllDone : t.nowNoPlan}</div>
        <h2 className="now__title">
          {over ? t.nowHoursOver : hasBlocks ? t.nowNothingElse : backlogCount ? t.nowTurnBacklog : t.nowGiveTasks}
        </h2>
        <p className="muted">
          {over
            ? t.nowTomorrow
            : backlogCount
              ? t.nowWaiting(backlogCount)
              : t.nowAddTask}
        </p>
        <div className="now__actions">
          {over ? (
            <Button variant="glass" icon={<CalendarRange size={15} />} onClick={() => navigate("planner")}>
              {t.openPlanner}
            </Button>
          ) : backlogCount ? (
            <Button variant="primary" icon={<Sparkles size={15} />} onClick={onPlan}>
              {t.planMyDay}
            </Button>
          ) : (
            <>
              <Button variant="primary" icon={<Target size={15} />} onClick={() => navigate("goals")}>
                {t.goToGoals}
              </Button>
              <Button variant="glass" onClick={() => navigate("planner")}>
                {t.openPlanner}
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
        {running ? <><span className="pulse" /> {t.nowInProgress}</> : live ? t.nowScheduled : t.nowUpNext(formatClock(block.start))}
      </div>
      <h2 className="now__title">{task.title}</h2>
      <div className="now__meta tabular">
        <span>{formatClock(block.start)}–{formatClock(block.end)}</span>
        <span className="faint">·</span>
        <span>{live && minsLeft > 0 ? t.durationLeft(formatDuration(minsLeft)) : live ? t.runningOver : t.inDuration(formatDuration(block.start - nowMin))}</span>
        {block.partCount > 1 && <span className="faint">{t.sessionShort(num(block.part), num(block.partCount))}</span>}
      </div>
      <p className="now__why">{explain(block.reason)}</p>
      <div className="now__actions">
        {!running && (
          <Button variant="primary" icon={<Play size={14} />} onClick={() => startBlock(block.id)}>
            {t.startNow}
          </Button>
        )}
        <Button variant={running ? "primary" : "glass"} icon={<Check size={15} />} onClick={() => completeBlock(block.id)}>
          {t.markDone}
        </Button>
        {running && (
          <Button variant="glass" icon={<Timer size={15} />} onClick={() => extendBlock(block.id, 15)} title={t.need15Title}>
            {t.need15}
          </Button>
        )}
      </div>
    </div>
  );
}

function Agenda({ blocks, commitments, taskMap, nowMin }: { blocks: ScheduleBlock[]; commitments: ReturnType<typeof commitmentsOn>; taskMap: Map<string, Task>; nowMin: number }) {
  const items = [
    ...blocks.filter((b) => b.end > nowMin || b.state === "in_progress").map((b) => ({ key: b.id, start: b.start, end: b.end, title: b.kind === "break" ? t.breakLabel : (taskMap.get(b.taskId ?? "")?.title ?? t.fallbackTask), kind: b.kind === "break" ? "break" : "task", state: b.state })),
    ...commitments.filter((c) => c.end > nowMin).map((c) => ({ key: c.id, start: c.start, end: c.end, title: c.title, kind: c.kind === "break" ? "break" : "commitment", state: "planned" as const })),
  ].sort((a, b) => a.start - b.start);
  if (!items.length) return <p className="faint" style={{ fontSize: 13.5 }}>{t.agendaEmpty}</p>;
  return (
    <ol className="agenda">
      {items.slice(0, 8).map((i) => (
        <li key={i.key} className={`agenda__item agenda__item--${i.kind} ${i.state === "done" ? "agenda__item--done" : ""}`}>
          <span className="agenda__time tabular">{formatClock(i.start)}</span>
          <span className="agenda__bar" />
          <span className="agenda__title">{i.title}</span>
          <span className="agenda__dur faint tabular">{i.state === "in_progress" ? t.agendaNow : formatDuration(i.end - i.start)}</span>
        </li>
      ))}
      {items.length > 8 && <li className="faint" style={{ fontSize: 12.5, paddingInlineStart: 64 }}>{t.agendaMore(num(items.length - 8))}</li>}
    </ol>
  );
}

function Welcome() {
  return (
    <div className="welcome rise">
      <LiquidGlass className="welcome__hero" radius={30} bezel={20} strength={40}>
        <div className="eyebrow now__eyebrow"><Sparkles size={13} /> {t.welcome}</div>
        <h2 className="welcome__title">{t.welcomeTitle}</h2>
        <p className="muted welcome__lead">{t.welcomeLead}</p>
        <div className="now__actions">
          <Button variant="primary" size="lg" icon={<Wand2 size={17} />} onClick={() => openComposer(true)}>
            {t.compileFirst}
          </Button>
          <Button variant="glass" size="lg" onClick={() => navigate("settings")}>
            {t.setWorkingHours}
          </Button>
        </div>
      </LiquidGlass>
      <ol className="welcome__steps">
        <li className="card">
          <span className="welcome__num">{num(1)}</span>
          <strong>{t.step1Title}</strong>
          <p className="muted">{t.step1Text}</p>
        </li>
        <li className="card">
          <span className="welcome__num">{num(2)}</span>
          <strong>{t.step2Title}</strong>
          <p className="muted">{t.step2Text}</p>
        </li>
        <li className="card">
          <span className="welcome__num">{num(3)}</span>
          <strong>{t.step3Title}</strong>
          <p className="muted">{t.step3Text}</p>
        </li>
      </ol>
      <div className="welcome__sample">
        <span className="faint">{t.justLooking}</span>
        <Button size="sm" variant="ghost" onClick={loadSampleData}>
          {t.loadSample}
        </Button>
        <span className="faint">{t.sampleNote}</span>
        <Button size="sm" variant="ghost" onClick={dismissWelcome}>
          {t.skipIntro}
        </Button>
      </div>
    </div>
  );
}
