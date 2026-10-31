import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Ban, CalendarPlus, Check, CircleDot, GripVertical, ListMinus, ListPlus, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { formatClock, relativeDay } from "../../domain/time";
import type { ScheduleBlock, Task } from "../../domain/types";
import { deleteTask, scheduleTask, sendToPlanner, setTaskStatus, useApp } from "../../state/store";
import { IconButton, Menu } from "../../ui/primitives";
import { TaskMeta } from "../../ui/taskBits";

export function TaskRow({ task, onEdit, block }: { task: Task; onEdit: (t: Task) => void; block?: ScheduleBlock }) {
  const today = useApp((s) => s.clock.today);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const done = task.status === "done";
  const skipped = task.status === "skipped";

  return (
    <li
      ref={setNodeRef}
      className={`taskrow ${done ? "taskrow--done" : ""} ${skipped ? "taskrow--skipped" : ""} ${isDragging ? "taskrow--dragging" : ""}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <button type="button" className="taskrow__grip" aria-label={`Reorder “${task.title}”`} {...attributes} {...listeners}>
        <GripVertical size={15} />
      </button>
      <button
        type="button"
        className="tick"
        role="checkbox"
        aria-checked={done ? true : task.status === "in_progress" ? "mixed" : false}
        aria-label={done ? `Mark “${task.title}” as not done` : `Complete “${task.title}”`}
        onClick={() => setTaskStatus(task.id, done ? "todo" : "done")}
      >
        {done ? <Check size={12} strokeWidth={3} /> : task.status === "in_progress" ? <CircleDot size={10} /> : null}
      </button>
      <button type="button" className="taskrow__main" onClick={() => onEdit(task)}>
        <span className="taskrow__title">{task.title}</span>
        <span className="taskrow__meta">
          <TaskMeta task={task} today={today} />
          {block ? (
            <span className="chip chip--accent">
              <CalendarPlus size={12} />
              {relativeDay(block.date, today)} {formatClock(block.start)}
            </span>
          ) : task.inPlanner && !done && !skipped ? (
            <span className="chip chip--accent">In planner</span>
          ) : null}
          {skipped && <span className="chip">Won't do</span>}
        </span>
      </button>
      <div className="taskrow__actions">
        {!done && !skipped && !block && (
          <IconButton label="Schedule into today's next free slot" onClick={() => scheduleTask(task.id, today)}>
            <CalendarPlus size={16} />
          </IconButton>
        )}
        <Menu
          label={`Actions for ${task.title}`}
          trigger={(p) => (
            <IconButton label="More actions" {...p}>
              <MoreHorizontal size={16} />
            </IconButton>
          )}
          items={[
            { label: "Edit", icon: <Pencil size={15} />, onSelect: () => onEdit(task) },
            ...(!done && !skipped
              ? [
                  task.inPlanner
                    ? { label: "Remove from planner", icon: <ListMinus size={15} />, onSelect: () => sendToPlanner([task.id], false) }
                    : { label: "Add to planner backlog", icon: <ListPlus size={15} />, onSelect: () => sendToPlanner([task.id]) },
                  { label: "Schedule today", icon: <CalendarPlus size={15} />, onSelect: () => scheduleTask(task.id, today) },
                  task.status === "in_progress"
                    ? { label: "Mark not started", icon: <RotateCcw size={15} />, onSelect: () => setTaskStatus(task.id, "todo") }
                    : { label: "Mark in progress", icon: <CircleDot size={15} />, onSelect: () => setTaskStatus(task.id, "in_progress") },
                  { label: "Won't do (skip)", icon: <Ban size={15} />, onSelect: () => setTaskStatus(task.id, "skipped") },
                ]
              : [{ label: "Reopen", icon: <RotateCcw size={15} />, onSelect: () => setTaskStatus(task.id, "todo") }]),
            "separator" as const,
            { label: "Delete", icon: <Trash2 size={15} />, danger: true, onSelect: () => deleteTask(task.id) },
          ]}
        />
      </div>
    </li>
  );
}
