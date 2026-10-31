import {
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Clock3,
  Coffee,
  ListPlus,
  Lock,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { subtract, totalLength } from "../../domain/intervals";
import { getLang, num } from "../../domain/locale";
import { rankTasks } from "../../domain/scheduler";
import { addDays, formatClock, formatDuration, formatLongDate, relativeDay } from "../../domain/time";
import type { Commitment, Plan, PlanType, ScheduleBlock, Task, UnscheduledNote } from "../../domain/types";
import { explain, t } from "../../i18n";
import { DateInput } from "../../ui/fields";
import { commitmentsOn, isKept, isOpen, liveBlocks, proposedBlocks, toSchedulable, unplannedMinutes } from "../../state/planning";
import {
  acceptProposal,
  completeBlock,
  completeTaskFromBlock,
  extendBlock,
  proposeDay,
  reflowNow,
  rejectProposal,
  reopenBlock,
  scheduleTask,
  sendToPlanner,
  setPlannerDate,
  skipBlock,
  startBlock,
  unscheduleBlock,
  useApp,
} from "../../state/store";
import { LiquidGlass } from "../../ui/LiquidGlass";
import { Button, Empty, IconButton } from "../../ui/primitives";
import { TaskMeta } from "../../ui/taskBits";
import { TaskDialog, type TaskDraft } from "../goals/TaskDialog";
import { PlanWizard } from "./PlanWizard";
import { PlannerSwitch } from "./PlansView";
import { PrefsDialog } from "./PrefsForm";
import { Timeline } from "./Timeline";

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export function PlannerView() {
  const date = useApp((s) => s.plannerDate);
  const clock = useApp((s) => s.clock);
  const prefs = useApp((s) => s.prefs);
  const allBlocks = useApp((s) => s.blocks);
  const allCommitments = useApp((s) => s.commitments);
  const tasks = useApp((s) => s.tasks);
  const skips = useApp((s) => s.skips);
  const dayPlan = useApp((s) => s.dayPlans[date]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [taskDialog, setTaskDialog] = useState<{ task: Task | null; draft?: TaskDraft } | null>(null);
  const plans = useApp((s) => s.plans);
  const [planWizard, setPlanWizard] = useState<{ type: PlanType; plan?: Plan } | null>(null);
  const setCommitDialog = ({ c }: { c: Commitment | null }) => {
    const plan = c ? plans.find((p) => p.id === c.id) : undefined;
    setPlanWizard(plan ? { type: plan.type, plan } : { type: "event" });
  };
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const isToday = date === clock.today;
  const isPast = date < clock.today;
  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const state = { tasks, commitments: allCommitments, blocks: allBlocks, skips, prefs };
  const commitments = commitmentsOn(date, allCommitments);
  const live = liveBlocks(state, date);
  const proposal = proposedBlocks(state, date);
  const hasProposal = proposal.length > 0 || !!dayPlan?.proposalSummary;

  // With a proposal open, show what would remain (kept blocks) plus the proposal.
  const shown = hasProposal ? [...live.filter((b) => isKept(b, date, clock) || b.state === "skipped"), ...proposal] : live;
  const diff = useMemo(() => {
    const map = new Map<string, string>();
    if (!hasProposal) return map;
    for (const p of proposal) {
      if (p.kind !== "task") continue;
      const prev = live.find((b) => b.taskId === p.taskId && b.state === "planned" && b.part === p.part);
      map.set(p.id, !prev ? t.diffNew : prev.start === p.start ? t.diffSame : t.diffWas(formatClock(prev.start)));
    }
    return map;
  }, [hasProposal, proposal, live]);

  const selected = allBlocks.find((b) => b.id === selectedId && b.date === date) ?? null;

  // Backlog: open planner tasks without a live block on this date.
  // Proposed sessions count as planned while a proposal is open; split tasks stay listed for their remainder.
  const proposedMin = (id: string) => proposal.filter((b) => b.taskId === id).reduce((sum, b) => sum + (b.end - b.start), 0);
  const hiddenLive = hasProposal ? live.filter((b) => !shown.includes(b)) : [];
  const stateForBacklog = { ...state, blocks: allBlocks.filter((b) => !hiddenLive.includes(b)) };
  const notes = new Map<string, UnscheduledNote>(((hasProposal ? dayPlan?.proposalNotes : dayPlan?.notes) ?? []).map((n) => [n.taskId, n]));
  const backlog = rankTasks(
    tasks
      .filter((t) => t.inPlanner && isOpen(t) && unplannedMinutes(stateForBacklog, t, date, clock) - proposedMin(t.id) > 0)
      .map((t) => ({ ...toSchedulable(t), task: t })),
    date,
  ).map((x) => x.task);
  const skippedToday = new Set(skips[date] ?? []);

  // Day numbers — all derived from real data.
  const windowStart = isToday ? Math.max(prefs.workStart, clock.nowMin) : prefs.workStart;
  const commitmentMin = totalLength(commitments.map((c) => ({ start: Math.max(c.start, prefs.workStart), end: Math.min(c.end, prefs.workEnd) })).filter((i) => i.end > i.start));
  const workMin = Math.max(0, prefs.workEnd - prefs.workStart);
  const scheduledMin = shown.filter((b) => b.kind === "task" && b.state !== "skipped").reduce((s, b) => s + (b.end - b.start), 0);
  const freeLeft = isPast || windowStart >= prefs.workEnd ? 0 : totalLength(subtract({ start: windowStart, end: prefs.workEnd }, [...commitments, ...shown.filter((b) => b.state !== "skipped")]));

  useEffect(() => setSelectedId(null), [date]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".overlay")) return;
      // Right-to-left, earlier days are to the right.
      const earlier = getLang() === "fa" ? "ArrowRight" : "ArrowLeft";
      const later = getLang() === "fa" ? "ArrowLeft" : "ArrowRight";
      if (e.key === earlier && !(e.target as HTMLElement).closest(".tl-block, .segmented")) setPlannerDate(addDays(date, -1));
      else if (e.key === later && !(e.target as HTMLElement).closest(".tl-block, .segmented")) setPlannerDate(addDays(date, 1));
      else if (e.key.toLowerCase() === "t") setPlannerDate(clock.today);
      else if (e.key.toLowerCase() === "p" && !isPast) void proposeDay(date);
      else if (e.key === "Escape") setSelectedId(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [date, clock.today, isPast]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const remainingPlanned = live.some((b) => b.state === "planned" && !(isToday && b.end <= clock.nowMin));

  return (
    <div className="page page--planner">
      <div className="page-head">
        <div>
          <div className="eyebrow">{t.plannerEyebrow(relativeDay(date, clock.today))}</div>
          <h1 className="page-title" tabIndex={-1} data-page-heading>
            {formatLongDate(date)}
          </h1>
          <p className="page-sub tabular">
            {isPast
              ? t.pastDay
              : t.daySummary(formatDuration(workMin), formatDuration(commitmentMin), formatDuration(scheduledMin), formatDuration(freeLeft), isToday)}
          </p>
        </div>
        <PlannerSwitch mode="day" />
      </div>

      <LiquidGlass className="toolbar" radius={22} bezel={14} strength={30}>
        <div className="toolbar__group">
          <IconButton label={t.prevDay} onClick={() => setPlannerDate(addDays(date, -1))}>
            <ChevronLeft size={18} className="flip-rtl" />
          </IconButton>
          <Button size="sm" variant={isToday ? "glass" : "ghost"} onClick={() => setPlannerDate(clock.today)} title={t.todayTitle}>
            {t.todayShort}
          </Button>
          <IconButton label={t.nextDay} onClick={() => setPlannerDate(addDays(date, 1))}>
            <ChevronRight size={18} className="flip-rtl" />
          </IconButton>
          <span className="toolbar__date">
            <DateInput bare required aria-label={t.goToDate} value={date} onChange={(v) => v && setPlannerDate(v)} />
          </span>
        </div>
        <div className="toolbar__group">
          <Button size="sm" variant="ghost" icon={<Plus size={15} />} onClick={() => setTaskDialog({ task: null, draft: { inPlanner: true } })}>
            {t.task}
          </Button>
          <Button size="sm" variant="ghost" icon={<Lock size={14} />} onClick={() => setCommitDialog({ c: null })}>
            {t.commitment}
          </Button>
          <IconButton label={t.planningPrefs} onClick={() => setPrefsOpen(true)}>
            <SlidersHorizontal size={16} />
          </IconButton>
          {hasProposal ? (
            <>
              <Button size="sm" variant="ghost" icon={<X size={15} />} disabled={busy} onClick={() => run(() => rejectProposal(date))}>
                {t.reject}
              </Button>
              <Button size="sm" variant="primary" icon={<Check size={15} />} disabled={busy} onClick={() => run(() => acceptProposal(date))}>
                {t.acceptPlan}
              </Button>
            </>
          ) : (
            <>
              {remainingPlanned && !isPast && (
                <Button size="sm" variant="glass" icon={<RefreshCcw size={14} />} disabled={busy} onClick={() => run(() => reflowNow(date))} title={t.recalcRestTitle}>
                  {t.recalcRest}
                </Button>
              )}
              <Button size="sm" variant="primary" icon={<Sparkles size={15} />} disabled={busy || isPast} onClick={() => run(() => proposeDay(date))} title={isPast ? t.dayPassedTitle : t.planDayTitle}>
                {live.some((b) => b.kind === "task") ? t.replanDay : t.planDay}
              </Button>
            </>
          )}
        </div>
      </LiquidGlass>

      {hasProposal && (
        <div className="proposal-banner rise" role="status">
          <Sparkles size={16} />
          <div style={{ flex: 1 }}>
            <strong>{t.proposedSchedule}</strong>
            <span className="muted">{t.proposalBanner(explain(dayPlan?.proposalSummary))}</span>
          </div>
        </div>
      )}

      <div className="planner-layout">
        <div className="planner-timeline card">
          {!shown.length && !commitments.length && !isPast && (
            <div className="timeline-hint">
              <CalendarClock size={16} />
              <span>
                {backlog.length
                  ? t.hintBacklogWaiting(backlog.length)
                  : t.hintEmpty}
              </span>
            </div>
          )}
          <Timeline
            date={date}
            isToday={isToday}
            isPast={isPast}
            nowMin={clock.nowMin}
            prefs={prefs}
            commitments={commitments}
            blocks={shown}
            diff={diff}
            tasks={taskMap}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onEditCommitment={(c) => setCommitDialog({ c })}
          />
        </div>

        <aside className="planner-side">
          {selected ? (
            <BlockDetail block={selected} task={selected.taskId ? taskMap.get(selected.taskId) : undefined} isPast={isPast} onClose={() => setSelectedId(null)} onEditTask={(t) => setTaskDialog({ task: t })} />
          ) : null}

          <section className="card side-card" aria-labelledby="backlog-title">
            <div className="card__title">
              <span id="backlog-title">
                {t.backlog} <span className="faint tabular">{num(backlog.length)}</span>
              </span>
              <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setTaskDialog({ task: null, draft: { inPlanner: true } })}>
                {t.add}
              </Button>
            </div>
            {backlog.length === 0 ? (
              <Empty icon={<ListPlus size={20} />} title={t.backlogClear} text={t.backlogClearText} />
            ) : (
              <ul className="backlog">
                {backlog.map((item) => {
                  const note = notes.get(item.id);
                  return (
                    <li key={item.id} className="backlog__item">
                      <button type="button" className="backlog__main" onClick={() => setTaskDialog({ task: item })}>
                        <span className="backlog__title">{item.title}</span>
                        <span className="taskrow__meta">
                          <TaskMeta task={item} today={clock.today} />
                          {skippedToday.has(item.id) && <span className="chip">{t.skippedDay(isToday)}</span>}
                        </span>
                        {note && <span className={`backlog__why backlog__why--${note.reason}`}>{explain(note.message)}</span>}
                      </button>
                      <div className="backlog__actions">
                        {!isPast && (
                          <IconButton label={t.scheduleInSlot(item.title)} onClick={() => scheduleTask(item.id, date)}>
                            <CalendarClock size={16} />
                          </IconButton>
                        )}
                        <IconButton label={t.removeFromPlanner} onClick={() => sendToPlanner([item.id], false)}>
                          <X size={15} />
                        </IconButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card side-card" aria-labelledby="commit-title">
            <div className="card__title">
              <span id="commit-title">{t.fixedCommitments}</span>
              <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setCommitDialog({ c: null })}>
                {t.add}
              </Button>
            </div>
            {commitments.length === 0 ? (
              <p className="faint" style={{ fontSize: 13 }}>
                {t.noCommitments}
              </p>
            ) : (
              <ul className="commit-list">
                {commitments.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="commit-list__item" onClick={() => setCommitDialog({ c })}>
                      {c.kind === "break" ? <Coffee size={14} /> : <Lock size={14} />}
                      <span className="tabular faint">
                        {formatClock(c.start)}–{formatClock(c.end)}
                      </span>
                      <span style={{ flex: 1 }}>{c.title}</span>
                      {!c.date && <span className="chip">{t.weekly}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <SkippedList blocks={live.filter((b) => b.state === "skipped")} tasks={taskMap} />
        </aside>
      </div>

      <TaskDialog open={!!taskDialog} task={taskDialog?.task} draft={taskDialog?.draft} onClose={() => setTaskDialog(null)} />
      <PlanWizard open={!!planWizard} type={planWizard?.type ?? "event"} plan={planWizard?.plan} date={date} onClose={() => setPlanWizard(null)} />
      <PrefsDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </div>
  );
}

function SkippedList({ blocks, tasks }: { blocks: ScheduleBlock[]; tasks: Map<string, Task> }) {
  if (!blocks.length) return null;
  return (
    <section className="card side-card">
      <div className="card__title">{t.skipped}</div>
      <ul className="commit-list">
        {blocks.map((b) => (
          <li key={b.id} className="commit-list__item" style={{ cursor: "default" }}>
            <CircleSlash size={14} />
            <span style={{ flex: 1 }}>{tasks.get(b.taskId ?? "")?.title ?? t.fallbackTask}</span>
            <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} onClick={() => reopenBlock(b.id)}>
              {t.restore}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BlockDetail({ block, task, isPast, onClose, onEditTask }: { block: ScheduleBlock; task?: Task; isPast: boolean; onClose: () => void; onEditTask: (t: Task) => void }) {
  const dur = block.end - block.start;
  const title = block.kind === "break" ? t.breakLabel : (task?.title ?? t.fallbackTask);
  const stateLabel = { planned: block.proposed ? t.stateProposed : t.statePlanned, in_progress: t.stateInProgress, done: t.stateDone, skipped: t.stateSkipped }[block.state];
  return (
    <LiquidGlass dense radius={22} bezel={14} strength={22} className="block-detail rise" aria-label={t.selectedBlock}>
      <div className="block-detail__head">
        <div>
          <div className="eyebrow">{stateLabel}{block.pinned && !block.proposed ? t.pinnedSuffix : ""}</div>
          <h2 className="block-detail__title">{title}</h2>
          <div className="faint tabular" style={{ fontSize: 13, marginTop: 2 }}>
            <Clock3 size={12} style={{ verticalAlign: -1 }} /> {formatClock(block.start)}–{formatClock(block.end)} · {formatDuration(dur)}
            {block.partCount > 1 && t.sessionOf(num(block.part), num(block.partCount))}
          </div>
        </div>
        <IconButton label={t.closeDetails} onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>

      <div className="block-detail__why">
        <div className="eyebrow" style={{ marginBottom: 6 }}>{t.whyHere}</div>
        <p>{explain(block.reason) || t.placedManually}</p>
      </div>

      {task && block.kind === "task" && !block.proposed && !isPast && (
        <div className="block-detail__actions">
          {block.state === "planned" && (
            <>
              <Button size="sm" variant="primary" icon={<Play size={13} />} onClick={() => startBlock(block.id)}>
                {t.start}
              </Button>
              <Button size="sm" variant="glass" icon={<Check size={14} />} onClick={() => completeBlock(block.id)}>
                {t.done}
              </Button>
              <Button size="sm" variant="ghost" icon={<CircleSlash size={14} />} onClick={() => skipBlock(block.id)}>
                {t.skip}
              </Button>
              <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => unscheduleBlock(block.id)} title={t.unscheduleTitle}>
                {t.unschedule}
              </Button>
            </>
          )}
          {block.state === "in_progress" && (
            <>
              <Button size="sm" variant="primary" icon={<Check size={14} />} onClick={() => completeBlock(block.id)}>
                {block.partCount > 1 || task.estimateMin - task.progressMin > dur ? t.sessionDone : t.done}
              </Button>
              <Button size="sm" variant="glass" icon={<Timer size={14} />} onClick={() => extendBlock(block.id, 15)} title={t.extendTitle}>
                +{formatDuration(15)}
              </Button>
              <Button size="sm" variant="glass" onClick={() => extendBlock(block.id, 30)}>
                +{formatDuration(30)}
              </Button>
              <Button size="sm" variant="ghost" icon={<Pause size={13} />} onClick={() => reopenBlock(block.id)}>
                {t.pause}
              </Button>
              <Button size="sm" variant="ghost" icon={<CircleSlash size={14} />} onClick={() => skipBlock(block.id)}>
                {t.skip}
              </Button>
            </>
          )}
          {block.state === "done" && (
            <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => reopenBlock(block.id)}>
              {t.markNotDone}
            </Button>
          )}
          {(block.partCount > 1 || task.estimateMin - task.progressMin > dur) && block.state !== "done" && (
            <Button size="sm" variant="ghost" icon={<Check size={14} />} onClick={() => completeTaskFromBlock(block.id)}>
              {t.finishWhole}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => onEditTask(task)}>
            {t.editTask}
          </Button>
        </div>
      )}
      {block.kind === "task" && !isPast && block.state === "planned" && (
        <p className="faint" style={{ fontSize: 12 }}>
          {block.proposed ? t.adjustProposal : ""}{t.dragHint}
        </p>
      )}
    </LiquidGlass>
  );
}
