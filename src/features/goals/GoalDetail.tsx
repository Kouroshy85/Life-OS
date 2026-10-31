import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp, CalendarDays, FolderPlus, ListPlus, MoreHorizontal, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { formatDuration, formatShortDate } from "../../domain/time";
import type { Goal, Milestone, Project, ScheduleBlock, Task } from "../../domain/types";
import {
  addMilestone,
  addProject,
  deleteGoal,
  deleteMilestone,
  deleteProject,
  goalProgress,
  renameProject,
  reorder,
  sendToPlanner,
  updateGoal,
  updateMilestone,
  useApp,
} from "../../state/store";
import { InlineText } from "../../ui/InlineText";
import { Bar, Button, Confirm, IconButton, Menu, ProgressRing } from "../../ui/primitives";
import { SourceBadge } from "./GoalComposer";
import { ReviseDialog } from "./ReviseDialog";
import { TaskDialog, type TaskDraft } from "./TaskDialog";
import { TaskRow } from "./TaskRow";

const isOpen = (t: Task) => t.status === "todo" || t.status === "in_progress";

export function GoalDetail({ goal }: { goal: Goal }) {
  const allMilestones = useApp((s) => s.milestones);
  const allProjects = useApp((s) => s.projects);
  const allTasks = useApp((s) => s.tasks);
  const blocks = useApp((s) => s.blocks);
  const today = useApp((s) => s.clock.today);
  const [revising, setRevising] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState<{ task: Task | null; draft?: TaskDraft } | null>(null);

  const milestones = allMilestones.filter((m) => m.goalId === goal.id);
  const tasks = allTasks.filter((t) => t.goalId === goal.id);
  const progress = goalProgress(goal.id, allTasks);
  const openIds = tasks.filter((t) => isOpen(t) && !t.inPlanner).map((t) => t.id);

  // Next upcoming block per task (today or later), so the outline shows when work is scheduled.
  const nextBlock = useMemo(() => {
    const map = new Map<string, ScheduleBlock>();
    for (const b of blocks) {
      if (!b.taskId || b.proposed || b.state !== "planned" || b.date < today) continue;
      const cur = map.get(b.taskId);
      if (!cur || b.date < cur.date || (b.date === cur.date && b.start < cur.start)) map.set(b.taskId, b);
    }
    return map;
  }, [blocks, today]);

  return (
    <div className="goal-detail rise">
      <header className="goal-hero">
        <div className="goal-hero__text">
          <div className="goal-hero__badges">
            <SourceBadge source={goal.source} model={goal.sourceModel} />
            {goal.isSample && <span className="badge-sample">Sample</span>}
            {goal.revision > 1 && <span className="faint" style={{ fontSize: 12 }}>Revision {goal.revision}</span>}
          </div>
          <InlineText className="goal-hero__title" label="Goal title" multiline value={goal.title} onSave={(v) => updateGoal(goal.id, { title: v })} maxLength={160} />
          <InlineText
            className="goal-hero__desc"
            label="Goal description"
            value={goal.description}
            placeholder="Add a description…"
            allowEmpty
            multiline
            maxLength={600}
            onSave={(v) => updateGoal(goal.id, { description: v })}
          />
          <div className="goal-hero__meta">
            <label className="goal-hero__date">
              <CalendarDays size={14} />
              <span className="faint">Target</span>
              <input
                type="date"
                className="input input--bare tabular"
                aria-label="Target date"
                value={goal.targetDate ?? ""}
                onChange={(e) => updateGoal(goal.id, { targetDate: e.target.value || null })}
              />
            </label>
            <span className="faint tabular">
              {progress.done}/{progress.total} tasks · {formatDuration(progress.doneMin)} of {formatDuration(progress.totalMin)}
            </span>
          </div>
          <div className="goal-hero__actions">
            <Button variant="glass" size="sm" icon={<RefreshCcw size={14} />} onClick={() => setRevising(true)}>
              Revise plan
            </Button>
            <Button variant="glass" size="sm" icon={<ListPlus size={14} />} disabled={!openIds.length} onClick={() => sendToPlanner(openIds)} title="Make all open tasks available to the day planner">
              Send open tasks to planner
            </Button>
            <Menu
              label="Goal actions"
              trigger={(p) => (
                <IconButton label="More goal actions" {...p}>
                  <MoreHorizontal size={17} />
                </IconButton>
              )}
              items={[
                { label: "Add milestone", icon: <Plus size={15} />, onSelect: () => addMilestone(goal.id, "New milestone") },
                "separator",
                { label: "Delete goal", icon: <Trash2 size={15} />, danger: true, onSelect: () => setConfirmDelete(true) },
              ]}
            />
          </div>
        </div>
        <div className="goal-hero__side">
          <ProgressRing value={progress.ratio} size={104} stroke={9} label={`${Math.round(progress.ratio * 100)}%`} />
        </div>
      </header>

      {milestones.length > 0 && <MilestonePath milestones={milestones} tasks={tasks} />}

      <div className="outline">
        {milestones.map((m, i) => (
          <MilestoneSection
            key={m.id}
            milestone={m}
            index={i}
            count={milestones.length}
            projects={allProjects.filter((p) => p.milestoneId === m.id)}
            tasks={tasks}
            nextBlock={nextBlock}
            onMove={(dir) => {
              const ids = milestones.map((x) => x.id);
              reorder("milestones", arrayMove(ids, i, i + dir));
            }}
            onEditTask={(task, draft) => setEditing({ task, draft })}
          />
        ))}
        <button type="button" className="outline__add" onClick={() => addMilestone(goal.id, "New milestone")}>
          <Plus size={15} /> Add milestone
        </button>
      </div>

      <TaskDialog open={!!editing} task={editing?.task} draft={editing?.draft} onClose={() => setEditing(null)} />
      <ReviseDialog goal={goal} open={revising} onClose={() => setRevising(false)} />
      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this goal?"
        message={`“${goal.title}” and all ${tasks.length} of its tasks will be deleted, including any scheduled sessions. This can't be undone.`}
        confirmLabel="Delete goal"
        onConfirm={() => deleteGoal(goal.id)}
      />
    </div>
  );
}

function MilestonePath({ milestones, tasks }: { milestones: Milestone[]; tasks: Task[] }) {
  return (
    <nav className="mpath" aria-label="Milestones">
      {milestones.map((m, i) => {
        const list = tasks.filter((t) => t.milestoneId === m.id && t.status !== "skipped");
        const done = list.filter((t) => t.status === "done").length;
        const ratio = list.length ? done / list.length : 0;
        const complete = list.length > 0 && done === list.length;
        return (
          <a key={m.id} href={`#ms-${m.id}`} className={`mpath__node ${complete ? "mpath__node--done" : ""}`} onClick={(e) => {
            e.preventDefault();
            document.getElementById(`ms-${m.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}>
            <span className="mpath__dot" style={{ ["--p" as string]: `${ratio * 360}deg` }}>
              <span>{i + 1}</span>
            </span>
            <span className="mpath__title">{m.title}</span>
            <span className="mpath__sub tabular">
              {done}/{list.length}
              {m.deadline ? ` · ${formatShortDate(m.deadline)}` : ""}
            </span>
          </a>
        );
      })}
    </nav>
  );
}

function MilestoneSection({
  milestone,
  index,
  count,
  projects,
  tasks,
  nextBlock,
  onMove,
  onEditTask,
}: {
  milestone: Milestone;
  index: number;
  count: number;
  projects: Project[];
  tasks: Task[];
  nextBlock: Map<string, ScheduleBlock>;
  onMove: (dir: -1 | 1) => void;
  onEditTask: (task: Task | null, draft?: TaskDraft) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const mTasks = tasks.filter((t) => t.milestoneId === milestone.id);
  const counted = mTasks.filter((t) => t.status !== "skipped");
  const done = counted.filter((t) => t.status === "done").length;
  const openIds = mTasks.filter((t) => isOpen(t) && !t.inPlanner).map((t) => t.id);
  const orphanTasks = mTasks.filter((t) => !projects.some((p) => p.id === t.projectId));

  return (
    <section className="milestone" id={`ms-${milestone.id}`} aria-labelledby={`ms-title-${milestone.id}`}>
      <div className="milestone__head">
        <span className="milestone__num">{index + 1}</span>
        <div className="milestone__titles">
          <InlineText className="milestone__title" label="Milestone title" multiline value={milestone.title} onSave={(v) => updateMilestone(milestone.id, { title: v })} />
          <InlineText
            className="milestone__desc"
            label="Milestone description"
            value={milestone.description}
            placeholder="Add a description…"
            allowEmpty
            multiline
            onSave={(v) => updateMilestone(milestone.id, { description: v })}
            maxLength={400}
          />
        </div>
        <div className="milestone__side">
          <label className="milestone__deadline" title="Milestone deadline">
            <CalendarDays size={13} />
            <input
              type="date"
              className="input input--bare tabular"
              aria-label="Milestone deadline"
              value={milestone.deadline ?? ""}
              onChange={(e) => updateMilestone(milestone.id, { deadline: e.target.value || null })}
            />
          </label>
          <div className="milestone__progress">
            <span className="faint tabular" style={{ fontSize: 12 }} id={`ms-title-${milestone.id}`}>
              {done}/{counted.length}
            </span>
            <div style={{ width: 72 }}>
              <Bar value={counted.length ? done / counted.length : 0} />
            </div>
          </div>
          <Menu
            label={`Actions for milestone ${milestone.title}`}
            trigger={(p) => (
              <IconButton label="Milestone actions" {...p}>
                <MoreHorizontal size={16} />
              </IconButton>
            )}
            items={[
              { label: "Add project", icon: <FolderPlus size={15} />, onSelect: () => addProject(milestone.id, "New project") },
              { label: "Send open tasks to planner", icon: <ListPlus size={15} />, disabled: !openIds.length, onSelect: () => sendToPlanner(openIds) },
              { label: "Move up", icon: <ArrowUp size={15} />, disabled: index === 0, onSelect: () => onMove(-1) },
              { label: "Move down", icon: <ArrowDown size={15} />, disabled: index === count - 1, onSelect: () => onMove(1) },
              "separator",
              { label: "Delete milestone", icon: <Trash2 size={15} />, danger: true, onSelect: () => setConfirm(true) },
            ]}
          />
        </div>
      </div>

      <div className="milestone__projects">
        {projects.map((p) => (
          <ProjectBlock
            key={p.id}
            project={p}
            single={projects.length === 1}
            tasks={mTasks.filter((t) => t.projectId === p.id)}
            nextBlock={nextBlock}
            onEditTask={onEditTask}
            draft={{ goalId: milestone.goalId, milestoneId: milestone.id, projectId: p.id, inPlanner: false }}
          />
        ))}
        {orphanTasks.length > 0 && (
          <ProjectBlock
            project={null}
            single={false}
            tasks={orphanTasks}
            nextBlock={nextBlock}
            onEditTask={onEditTask}
            draft={{ goalId: milestone.goalId, milestoneId: milestone.id, projectId: null, inPlanner: false }}
          />
        )}
        {projects.length === 0 && orphanTasks.length === 0 && (
          <button type="button" className="outline__add outline__add--inline" onClick={() => addProject(milestone.id, "Tasks")}>
            <FolderPlus size={14} /> Add a project to start adding tasks
          </button>
        )}
      </div>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete milestone?"
        message={`“${milestone.title}” and its ${mTasks.length} task${mTasks.length === 1 ? "" : "s"} will be deleted.`}
        onConfirm={() => deleteMilestone(milestone.id)}
      />
    </section>
  );
}

function ProjectBlock({
  project,
  single,
  tasks,
  nextBlock,
  onEditTask,
  draft,
}: {
  project: Project | null;
  single: boolean;
  tasks: Task[];
  nextBlock: Map<string, ScheduleBlock>;
  onEditTask: (task: Task | null, draft?: TaskDraft) => void;
  draft: TaskDraft;
}) {
  const sorted = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = sorted.map((t) => t.id);
    reorder("tasks", arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))));
  };

  return (
    <div className="project">
      {project && (
        <div className={`project__head ${single ? "project__head--quiet" : ""}`}>
          <InlineText className="project__title" label="Project title" value={project.title} onSave={(v) => renameProject(project.id, v)} maxLength={120} />
          <Menu
            label={`Actions for project ${project.title}`}
            trigger={(p) => (
              <IconButton label="Project actions" {...p}>
                <MoreHorizontal size={15} />
              </IconButton>
            )}
            items={[{ label: "Delete project and its tasks", icon: <Trash2 size={15} />, danger: true, onSelect: () => deleteProject(project.id) }]}
          />
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={sorted.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <ul className="tasklist">
            {sorted.map((t) => (
              <TaskRow key={t.id} task={t} block={nextBlock.get(t.id)} onEdit={(task) => onEditTask(task)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <button type="button" className="outline__add outline__add--inline" onClick={() => onEditTask(null, draft)}>
        <Plus size={14} /> Add task
      </button>
    </div>
  );
}
