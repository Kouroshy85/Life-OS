import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Ban, CalendarPlus, Check, CircleDot, GripVertical, ListMinus, ListPlus, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { formatClock, relativeDay } from "../../domain/time";
import type { ScheduleBlock, Task } from "../../domain/types";
import { t } from "../../i18n";
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
      <button type="button" className="taskrow__grip" aria-label={t.reorderTask(task.title)} {...attributes} {...listeners}>
        <GripVertical size={15} />
      </button>
      <button
        type="button"
        className="tick"
        role="checkbox"
        aria-checked={done ? true : task.status === "in_progress" ? "mixed" : false}
        aria-label={done ? t.uncompleteTask(task.title) : t.completeTask(task.title)}
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
            <span className="chip chip--accent">{t.inPlanner}</span>
          ) : null}
          {skipped && <span className="chip">{t.wontDo}</span>}
        </span>
      </button>
      <div className="taskrow__actions">
        {!done && !skipped && !block && (
          <IconButton label={t.scheduleNextSlot} onClick={() => scheduleTask(task.id, today)}>
            <CalendarPlus size={16} />
          </IconButton>
        )}
        <Menu
          label={t.actionsFor(task.title)}
          trigger={(p) => (
            <IconButton label={t.moreActions} {...p}>
              <MoreHorizontal size={16} />
            </IconButton>
          )}
          items={[
            { label: t.edit, icon: <Pencil size={15} />, onSelect: () => onEdit(task) },
            ...(!done && !skipped
              ? [
                  task.inPlanner
                    ? { label: t.removeFromPlanner, icon: <ListMinus size={15} />, onSelect: () => sendToPlanner([task.id], false) }
                    : { label: t.addToPlanner, icon: <ListPlus size={15} />, onSelect: () => sendToPlanner([task.id]) },
                  { label: t.scheduleToday, icon: <CalendarPlus size={15} />, onSelect: () => scheduleTask(task.id, today) },
                  task.status === "in_progress"
                    ? { label: t.markNotStarted, icon: <RotateCcw size={15} />, onSelect: () => setTaskStatus(task.id, "todo") }
                    : { label: t.markInProgress, icon: <CircleDot size={15} />, onSelect: () => setTaskStatus(task.id, "in_progress") },
                  { label: t.wontDoSkip, icon: <Ban size={15} />, onSelect: () => setTaskStatus(task.id, "skipped") },
                ]
              : [{ label: t.reopen, icon: <RotateCcw size={15} />, onSelect: () => setTaskStatus(task.id, "todo") }]),
            "separator" as const,
            { label: t.delete, icon: <Trash2 size={15} />, danger: true, onSelect: () => deleteTask(task.id) },
          ]}
        />
      </div>
    </li>
  );
}
