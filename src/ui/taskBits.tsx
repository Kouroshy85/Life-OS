import { BatteryLow, BatteryMedium, CalendarClock, Clock3, Zap } from "lucide-react";
import { formatClock, formatDuration, relativeDay } from "../domain/time";
import { PRIORITY_LABEL, type DateKey, type Energy, type Priority, type Task } from "../domain/types";

export const PRIORITY_COLOR: Record<Priority, string> = {
  1: "var(--priority-1)",
  2: "var(--priority-2)",
  3: "var(--priority-3)",
  4: "var(--priority-4)",
};

export function PriorityDot({ priority }: { priority: Priority }) {
  return <span className="prio-dot" style={{ background: PRIORITY_COLOR[priority] }} title={`${PRIORITY_LABEL[priority]} priority`} aria-label={`${PRIORITY_LABEL[priority]} priority`} />;
}

export function EnergyIcon({ energy, size = 12 }: { energy: Energy; size?: number }) {
  if (energy === "high") return <Zap size={size} />;
  if (energy === "medium") return <BatteryMedium size={size} />;
  return <BatteryLow size={size} />;
}

const ENERGY_SHORT: Record<Energy, string> = { low: "Low energy", medium: "Medium", high: "Deep focus" };

export function DeadlineChip({ task, today }: { task: Pick<Task, "deadline" | "deadlineTime" | "status">; today: DateKey }) {
  if (!task.deadline) return null;
  const overdue = task.deadline < today && task.status !== "done";
  const dueToday = task.deadline === today;
  return (
    <span className={`chip ${overdue ? "chip--danger" : dueToday ? "chip--warn" : ""}`} title={`Deadline ${task.deadline}`}>
      <CalendarClock size={12} />
      {overdue ? "Overdue · " : ""}
      {relativeDay(task.deadline, today)}
      {task.deadlineTime != null ? ` ${formatClock(task.deadlineTime)}` : ""}
    </span>
  );
}

export function TaskMeta({ task, today, showPriority = true }: { task: Task; today: DateKey; showPriority?: boolean }) {
  const remaining = Math.max(0, task.estimateMin - task.progressMin);
  return (
    <>
      {showPriority && task.priority >= 3 && (
        <span className="chip" style={{ color: PRIORITY_COLOR[task.priority] }}>
          {PRIORITY_LABEL[task.priority]}
        </span>
      )}
      <span className="chip" title="Estimated duration">
        <Clock3 size={12} />
        {task.progressMin > 0 && task.status !== "done" ? `${formatDuration(remaining)} left` : formatDuration(task.estimateMin)}
      </span>
      {task.energy && (
        <span className={`chip ${task.energy === "high" ? "chip--accent" : ""}`}>
          <EnergyIcon energy={task.energy} />
          {ENERGY_SHORT[task.energy]}
        </span>
      )}
      <DeadlineChip task={task} today={today} />
    </>
  );
}
