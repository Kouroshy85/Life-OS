import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp, CalendarDays, FolderPlus, ListPlus, MoreHorizontal, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { num, pct } from "../../domain/locale";
import { formatDuration, formatShortDate } from "../../domain/time";
import { t } from "../../i18n";
import { DateInput } from "../../ui/fields";
import type { Goal, Milestone, Project, ScheduleBlock, Task } from "../../domain/types";
import {
  addMilestone,
  addProject,
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
import { AbandonGoalDialog } from "./AbandonGoalDialog";
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
            {goal.isSample && <span className="badge-sample">{t.sample}</span>}
            {goal.revision > 1 && <span className="faint" style={{ fontSize: 12 }}>{t.revisionN(num(goal.revision))}</span>}
          </div>
          <InlineText className="goal-hero__title" label={t.goalTitleLabel} multiline value={goal.title} onSave={(v) => updateGoal(goal.id, { title: v })} maxLength={160} />
          <InlineText
            className="goal-hero__desc"
            label={t.goalDescLabel}
            value={goal.description}
            placeholder={t.addDescription}
            allowEmpty
            multiline
            maxLength={600}
            onSave={(v) => updateGoal(goal.id, { description: v })}
          />
          <div className="goal-hero__meta">
            <span className="goal-hero__date">
              <CalendarDays size={14} />
              <span className="faint">{t.target}</span>
              <DateInput bare aria-label={t.targetDate} value={goal.targetDate} onChange={(v) => updateGoal(goal.id, { targetDate: v })} />
            </span>
            <span className="faint tabular">
              {t.tasksCount(num(progress.done), num(progress.total))} · {t.ofDuration(formatDuration(progress.doneMin), formatDuration(progress.totalMin))}
            </span>
          </div>
          <div className="goal-hero__actions">
            <Button variant="glass" size="sm" icon={<RefreshCcw size={14} />} onClick={() => setRevising(true)}>
              {t.revisePlan}
            </Button>
            <Button variant="glass" size="sm" icon={<ListPlus size={14} />} disabled={!openIds.length} onClick={() => sendToPlanner(openIds)} title={t.sendOpenTitle}>
              {t.sendOpen}
            </Button>
            <Button variant="danger-ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => setConfirmDelete(true)}>
              {t.deleteGoal}
            </Button>
            <Menu
              label={t.goalActions}
              trigger={(p) => (
                <IconButton label={t.moreGoalActions} {...p}>
                  <MoreHorizontal size={17} />
                </IconButton>
              )}
              items={[
                { label: t.addMilestone, icon: <Plus size={15} />, onSelect: () => addMilestone(goal.id, t.newMilestone) },
              ]}
            />
          </div>
        </div>
        <div className="goal-hero__side">
          <ProgressRing value={progress.ratio} size={104} stroke={9} label={pct(Math.round(progress.ratio * 100))} />
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
        <button type="button" className="outline__add" onClick={() => addMilestone(goal.id, t.newMilestone)}>
          <Plus size={15} /> {t.addMilestone}
        </button>
      </div>

      <TaskDialog open={!!editing} task={editing?.task} draft={editing?.draft} onClose={() => setEditing(null)} />
      <ReviseDialog goal={goal} open={revising} onClose={() => setRevising(false)} />
      <AbandonGoalDialog goal={goal} open={confirmDelete} onClose={() => setConfirmDelete(false)} />
    </div>
  );
}

function MilestonePath({ milestones, tasks }: { milestones: Milestone[]; tasks: Task[] }) {
  return (
    <nav className="mpath" aria-label={t.milestonesNav}>
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
              <span>{num(i + 1)}</span>
            </span>
            <span className="mpath__title">{m.title}</span>
            <span className="mpath__sub tabular">
              {num(`${done}/${list.length}`)}
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
        <span className="milestone__num">{num(index + 1)}</span>
        <div className="milestone__titles">
          <InlineText className="milestone__title" label={t.milestoneTitle} multiline value={milestone.title} onSave={(v) => updateMilestone(milestone.id, { title: v })} />
          <InlineText
            className="milestone__desc"
            label={t.milestoneDesc}
            value={milestone.description}
            placeholder={t.addDescription}
            allowEmpty
            multiline
            onSave={(v) => updateMilestone(milestone.id, { description: v })}
            maxLength={400}
          />
        </div>
        <div className="milestone__side">
          <span className="milestone__deadline" title={t.milestoneDeadline}>
            <CalendarDays size={13} />
            <DateInput bare aria-label={t.milestoneDeadline} value={milestone.deadline} onChange={(v) => updateMilestone(milestone.id, { deadline: v })} />
          </span>
          <div className="milestone__progress">
            <span className="faint tabular" style={{ fontSize: 12 }} id={`ms-title-${milestone.id}`}>
              {num(`${done}/${counted.length}`)}
            </span>
            <div style={{ width: 72 }}>
              <Bar value={counted.length ? done / counted.length : 0} />
            </div>
          </div>
          <Menu
            label={t.actionsForMilestone(milestone.title)}
            trigger={(p) => (
              <IconButton label={t.milestoneActions} {...p}>
                <MoreHorizontal size={16} />
              </IconButton>
            )}
            items={[
              { label: t.addProject, icon: <FolderPlus size={15} />, onSelect: () => addProject(milestone.id, t.newProject) },
              { label: t.sendOpen, icon: <ListPlus size={15} />, disabled: !openIds.length, onSelect: () => sendToPlanner(openIds) },
              { label: t.moveUp, icon: <ArrowUp size={15} />, disabled: index === 0, onSelect: () => onMove(-1) },
              { label: t.moveDown, icon: <ArrowDown size={15} />, disabled: index === count - 1, onSelect: () => onMove(1) },
              "separator",
              { label: t.deleteMilestone, icon: <Trash2 size={15} />, danger: true, onSelect: () => setConfirm(true) },
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
          <button type="button" className="outline__add outline__add--inline" onClick={() => addProject(milestone.id, t.defaultProject)}>
            <FolderPlus size={14} /> {t.addProjectFirst}
          </button>
        )}
      </div>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t.deleteMilestoneQ}
        message={t.deleteMilestoneMsg(milestone.title, mTasks.length)}
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
          <InlineText className="project__title" label={t.projectTitle} value={project.title} onSave={(v) => renameProject(project.id, v)} maxLength={120} />
          <Menu
            label={t.actionsForProject(project.title)}
            trigger={(p) => (
              <IconButton label={t.projectActions} {...p}>
                <MoreHorizontal size={15} />
              </IconButton>
            )}
            items={[{ label: t.deleteProject, icon: <Trash2 size={15} />, danger: true, onSelect: () => deleteProject(project.id) }]}
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
        <Plus size={14} /> {t.taskAdd}
      </button>
    </div>
  );
}
