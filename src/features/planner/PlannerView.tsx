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
import { rankTasks } from "../../domain/scheduler";
import { addDays, formatClock, formatDuration, formatLongDate, relativeDay } from "../../domain/time";
import type { Commitment, ScheduleBlock, Task, UnscheduledNote } from "../../domain/types";
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
import { CommitmentDialog } from "./CommitmentDialog";
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
  const [commitDialog, setCommitDialog] = useState<{ c: Commitment | null } | null>(null);
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
      map.set(p.id, !prev ? "New" : prev.start === p.start ? "Unchanged" : `Was ${formatClock(prev.start)}`);
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
      if (e.key === "ArrowLeft" && !(e.target as HTMLElement).closest(".tl-block, .segmented")) setPlannerDate(addDays(date, -1));
      else if (e.key === "ArrowRight" && !(e.target as HTMLElement).closest(".tl-block, .segmented")) setPlannerDate(addDays(date, 1));
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
          <div className="eyebrow">Adaptive Day Planner · {relativeDay(date, clock.today)}</div>
          <h1 className="page-title" tabIndex={-1} data-page-heading>
            {formatLongDate(date)}
          </h1>
          <p className="page-sub tabular">
            {isPast
              ? "This day has passed — its plan is kept as a record."
              : `${formatDuration(workMin)} working · ${formatDuration(commitmentMin)} committed · ${formatDuration(scheduledMin)} scheduled · ${formatDuration(freeLeft)} free${isToday ? " from now" : ""}`}
          </p>
        </div>
      </div>

      <LiquidGlass className="toolbar" radius={22} bezel={14} strength={30}>
        <div className="toolbar__group">
          <IconButton label="Previous day (←)" onClick={() => setPlannerDate(addDays(date, -1))}>
            <ChevronLeft size={18} />
          </IconButton>
          <Button size="sm" variant={isToday ? "glass" : "ghost"} onClick={() => setPlannerDate(clock.today)} title="Today (T)">
            Today
          </Button>
          <IconButton label="Next day (→)" onClick={() => setPlannerDate(addDays(date, 1))}>
            <ChevronRight size={18} />
          </IconButton>
          <input type="date" className="input input--bare toolbar__date tabular" aria-label="Go to date" value={date} onChange={(e) => e.target.value && setPlannerDate(e.target.value)} />
        </div>
        <div className="toolbar__group">
          <Button size="sm" variant="ghost" icon={<Plus size={15} />} onClick={() => setTaskDialog({ task: null, draft: { inPlanner: true } })}>
            Task
          </Button>
          <Button size="sm" variant="ghost" icon={<Lock size={14} />} onClick={() => setCommitDialog({ c: null })}>
            Commitment
          </Button>
          <IconButton label="Planning preferences" onClick={() => setPrefsOpen(true)}>
            <SlidersHorizontal size={16} />
          </IconButton>
          {hasProposal ? (
            <>
              <Button size="sm" variant="ghost" icon={<X size={15} />} disabled={busy} onClick={() => run(() => rejectProposal(date))}>
                Reject
              </Button>
              <Button size="sm" variant="primary" icon={<Check size={15} />} disabled={busy} onClick={() => run(() => acceptProposal(date))}>
                Accept plan
              </Button>
            </>
          ) : (
            <>
              {remainingPlanned && !isPast && (
                <Button size="sm" variant="glass" icon={<RefreshCcw size={14} />} disabled={busy} onClick={() => run(() => reflowNow(date))} title="Re-flow the rest of the day around what has happened">
                  Recalculate rest
                </Button>
              )}
              <Button size="sm" variant="primary" icon={<Sparkles size={15} />} disabled={busy || isPast} onClick={() => run(() => proposeDay(date))} title={isPast ? "This day has passed" : "Propose a schedule (P)"}>
                {live.some((b) => b.kind === "task") ? "Re-plan day" : "Plan day"}
              </Button>
            </>
          )}
        </div>
      </LiquidGlass>

      {hasProposal && (
        <div className="proposal-banner rise" role="status">
          <Sparkles size={16} />
          <div style={{ flex: 1 }}>
            <strong>Proposed schedule</strong>
            <span className="muted"> — {dayPlan?.proposalSummary || "nothing could be placed"}. Review the dashed blocks, then accept or reject. Started and pinned blocks stay as they are.</span>
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
                  ? `${backlog.length} task${backlog.length === 1 ? "" : "s"} waiting in the backlog — press Plan day to schedule them.`
                  : "Add tasks to the backlog or send tasks from a goal, then plan the day."}
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
                Backlog <span className="faint tabular">{backlog.length}</span>
              </span>
              <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setTaskDialog({ task: null, draft: { inPlanner: true } })}>
                Add
              </Button>
            </div>
            {backlog.length === 0 ? (
              <Empty icon={<ListPlus size={20} />} title="Backlog is clear" text="Tasks you add here, or send from a goal, wait in the backlog until they're scheduled." />
            ) : (
              <ul className="backlog">
                {backlog.map((t) => {
                  const note = notes.get(t.id);
                  return (
                    <li key={t.id} className="backlog__item">
                      <button type="button" className="backlog__main" onClick={() => setTaskDialog({ task: t })}>
                        <span className="backlog__title">{t.title}</span>
                        <span className="taskrow__meta">
                          <TaskMeta task={t} today={clock.today} />
                          {skippedToday.has(t.id) && <span className="chip">Skipped {isToday ? "today" : "this day"}</span>}
                        </span>
                        {note && <span className={`backlog__why backlog__why--${note.reason}`}>{note.message}</span>}
                      </button>
                      <div className="backlog__actions">
                        {!isPast && (
                          <IconButton label={`Schedule “${t.title}” in the next free slot`} onClick={() => scheduleTask(t.id, date)}>
                            <CalendarClock size={16} />
                          </IconButton>
                        )}
                        <IconButton label="Remove from planner" onClick={() => sendToPlanner([t.id], false)}>
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
              <span id="commit-title">Fixed commitments</span>
              <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setCommitDialog({ c: null })}>
                Add
              </Button>
            </div>
            {commitments.length === 0 ? (
              <p className="faint" style={{ fontSize: 13 }}>
                Nothing fixed on this day. Add classes, meetings or breaks so the planner works around them.
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
                      {!c.date && <span className="chip">Weekly</span>}
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
      <CommitmentDialog open={!!commitDialog} commitment={commitDialog?.c ?? null} date={date} onClose={() => setCommitDialog(null)} />
      <PrefsDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </div>
  );
}

function SkippedList({ blocks, tasks }: { blocks: ScheduleBlock[]; tasks: Map<string, Task> }) {
  if (!blocks.length) return null;
  return (
    <section className="card side-card">
      <div className="card__title">Skipped</div>
      <ul className="commit-list">
        {blocks.map((b) => (
          <li key={b.id} className="commit-list__item" style={{ cursor: "default" }}>
            <CircleSlash size={14} />
            <span style={{ flex: 1 }}>{tasks.get(b.taskId ?? "")?.title ?? "Task"}</span>
            <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} onClick={() => reopenBlock(b.id)}>
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BlockDetail({ block, task, isPast, onClose, onEditTask }: { block: ScheduleBlock; task?: Task; isPast: boolean; onClose: () => void; onEditTask: (t: Task) => void }) {
  const dur = block.end - block.start;
  const title = block.kind === "break" ? "Break" : (task?.title ?? "Task");
  const stateLabel = { planned: block.proposed ? "Proposed" : "Planned", in_progress: "In progress", done: "Completed", skipped: "Skipped" }[block.state];
  return (
    <LiquidGlass dense radius={22} bezel={14} strength={22} className="block-detail rise" aria-label="Selected block">
      <div className="block-detail__head">
        <div>
          <div className="eyebrow">{stateLabel}{block.pinned && !block.proposed ? " · pinned" : ""}</div>
          <h2 className="block-detail__title">{title}</h2>
          <div className="faint tabular" style={{ fontSize: 13, marginTop: 2 }}>
            <Clock3 size={12} style={{ verticalAlign: -1 }} /> {formatClock(block.start)}–{formatClock(block.end)} · {formatDuration(dur)}
            {block.partCount > 1 && ` · session ${block.part} of ${block.partCount}`}
          </div>
        </div>
        <IconButton label="Close details" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>

      <div className="block-detail__why">
        <div className="eyebrow" style={{ marginBottom: 6 }}>Why it's here</div>
        <p>{block.reason || "Placed manually."}</p>
      </div>

      {task && block.kind === "task" && !block.proposed && !isPast && (
        <div className="block-detail__actions">
          {block.state === "planned" && (
            <>
              <Button size="sm" variant="primary" icon={<Play size={13} />} onClick={() => startBlock(block.id)}>
                Start
              </Button>
              <Button size="sm" variant="glass" icon={<Check size={14} />} onClick={() => completeBlock(block.id)}>
                Done
              </Button>
              <Button size="sm" variant="ghost" icon={<CircleSlash size={14} />} onClick={() => skipBlock(block.id)}>
                Skip
              </Button>
              <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => unscheduleBlock(block.id)} title="Return the task to the backlog">
                Unschedule
              </Button>
            </>
          )}
          {block.state === "in_progress" && (
            <>
              <Button size="sm" variant="primary" icon={<Check size={14} />} onClick={() => completeBlock(block.id)}>
                {block.partCount > 1 || task.estimateMin - task.progressMin > dur ? "Session done" : "Done"}
              </Button>
              <Button size="sm" variant="glass" icon={<Timer size={14} />} onClick={() => extendBlock(block.id, 15)} title="Running long — extend and recalculate the rest of the day">
                +15m
              </Button>
              <Button size="sm" variant="glass" onClick={() => extendBlock(block.id, 30)}>
                +30m
              </Button>
              <Button size="sm" variant="ghost" icon={<Pause size={13} />} onClick={() => reopenBlock(block.id)}>
                Pause
              </Button>
              <Button size="sm" variant="ghost" icon={<CircleSlash size={14} />} onClick={() => skipBlock(block.id)}>
                Skip
              </Button>
            </>
          )}
          {block.state === "done" && (
            <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => reopenBlock(block.id)}>
              Mark not done
            </Button>
          )}
          {(block.partCount > 1 || task.estimateMin - task.progressMin > dur) && block.state !== "done" && (
            <Button size="sm" variant="ghost" icon={<Check size={14} />} onClick={() => completeTaskFromBlock(block.id)}>
              Finish whole task
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => onEditTask(task)}>
            Edit task
          </Button>
        </div>
      )}
      {block.kind === "task" && !isPast && block.state === "planned" && (
        <p className="faint" style={{ fontSize: 12 }}>
          {block.proposed ? "Adjust this proposal before accepting. " : ""}Drag the block to move it, or its bottom edge to resize. With it focused, use ↑/↓ (Shift for 15 min, Alt to resize). Overlaps are never allowed.
        </p>
      )}
    </LiquidGlass>
  );
}
