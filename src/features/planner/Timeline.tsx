import { Check, Coffee, Lock, Pin, Play } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { subtract, type Interval } from "../../domain/intervals";
import { formatClock, formatDuration } from "../../domain/time";
import type { Commitment, DateKey, Preferences, ScheduleBlock, Task } from "../../domain/types";
import { moveBlock } from "../../state/store";

export const PX_PER_MIN = 1.6;

export interface TimelineProps {
  date: DateKey;
  isToday: boolean;
  isPast: boolean;
  nowMin: number;
  prefs: Preferences;
  commitments: Commitment[];
  blocks: ScheduleBlock[];
  /** For proposed blocks: label describing the change versus the live plan. */
  diff: Map<string, string>;
  tasks: Map<string, Task>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEditCommitment: (c: Commitment) => void;
}

export function Timeline(props: TimelineProps) {
  const { prefs, commitments, blocks, isToday, nowMin } = props;
  const items: Interval[] = [...commitments, ...blocks];
  const rangeStart = Math.max(0, Math.floor((Math.min(prefs.workStart, ...items.map((i) => i.start)) - 30) / 60) * 60);
  const rangeEnd = Math.min(1440, Math.ceil((Math.max(prefs.workEnd, ...items.map((i) => i.end)) + 30) / 60) * 60);
  const y = (min: number) => (min - rangeStart) * PX_PER_MIN;
  const height = y(rangeEnd);

  const hours: number[] = [];
  for (let m = rangeStart; m <= rangeEnd; m += 60) hours.push(m);

  const windowStart = isToday ? Math.max(prefs.workStart, nowMin) : prefs.workStart;
  const gaps =
    props.isPast || windowStart >= prefs.workEnd
      ? []
      : subtract({ start: windowStart, end: prefs.workEnd }, [...commitments, ...blocks.filter((b) => b.state !== "skipped")]).filter((g) => g.end - g.start >= 15);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Bring "now" (or the start of the day) into view when switching days.
    // Deferred so it runs after the app's scroll-to-top on navigation.
    const timer = setTimeout(() => {
      const el = scrollRef.current;
      const main = el?.closest(".main");
      if (!el || !main) return;
      const top = main.scrollTop + el.getBoundingClientRect().top - main.getBoundingClientRect().top;
      const target = isToday ? y(nowMin) - 220 : y(prefs.workStart) - 120;
      main.scrollTo({ top: Math.max(0, top + target), behavior: "smooth" });
    }, 80);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.date]);

  return (
    <div className="timeline" ref={scrollRef} style={{ height }} onClick={(e) => e.target === e.currentTarget && props.onSelect(null)}>
      {/* Working-hours band */}
      <div className="tl-band tl-band--work" style={{ top: y(prefs.workStart), height: (prefs.workEnd - prefs.workStart) * PX_PER_MIN }} aria-hidden="true" />
      {prefs.focusEnd > prefs.focusStart && (
        <div className="tl-band tl-band--focus" style={{ top: y(prefs.focusStart), height: (prefs.focusEnd - prefs.focusStart) * PX_PER_MIN }} aria-hidden="true">
          <span>Focus hours</span>
        </div>
      )}

      {hours.map((m) => (
        <div key={m} className="tl-hour" style={{ top: y(m) }} aria-hidden="true">
          <span className="tl-hour__label tabular">{formatClock(m)}</span>
        </div>
      ))}

      {gaps.map((g) => (
        <div key={`g${g.start}`} className="tl-gap" style={{ top: y(g.start) + 3, height: (g.end - g.start) * PX_PER_MIN - 6 }}>
          <span className="tabular">{formatDuration(g.end - g.start)} free</span>
        </div>
      ))}

      {commitments.map((c) => {
        const h = (c.end - c.start) * PX_PER_MIN;
        return (
          <button
            key={c.id}
            type="button"
            className={`tl-commit ${c.kind === "break" ? "tl-commit--break" : ""} ${h < 58 ? "tl-item--compact" : ""}`}
            style={{ top: y(c.start), height: Math.max(h, 20) }}
            onClick={() => props.onEditCommitment(c)}
            title={`${c.title} · ${formatClock(c.start)}–${formatClock(c.end)} · fixed`}
          >
            <span className="tl-item__time tabular">
              {c.kind === "break" ? <Coffee size={11} /> : <Lock size={11} />}
              {formatClock(c.start)}–{formatClock(c.end)}
            </span>
            <span className="tl-item__title">{c.title}</span>
          </button>
        );
      })}

      {blocks
        .filter((b) => b.state !== "skipped")
        .map((b) => (
          <TimelineBlock key={b.id} block={b} y={y} task={b.taskId ? props.tasks.get(b.taskId) : undefined} diff={props.diff.get(b.id)} selected={props.selectedId === b.id} onSelect={props.onSelect} editable={!props.isPast} />
        ))}

      {isToday && nowMin >= rangeStart && nowMin <= rangeEnd && (
        <div className="tl-now" style={{ top: y(nowMin) }} aria-label={`Now, ${formatClock(nowMin)}`}>
          <span className="tl-now__label tabular">{formatClock(nowMin)}</span>
        </div>
      )}
    </div>
  );
}

function TimelineBlock({
  block,
  y,
  task,
  diff,
  selected,
  onSelect,
  editable,
}: {
  block: ScheduleBlock;
  y: (m: number) => number;
  task?: Task;
  diff?: string;
  selected: boolean;
  onSelect: (id: string) => void;
  editable: boolean;
}) {
  const [drag, setDrag] = useState<{ mode: "move" | "resize"; originY: number; delta: number } | null>(null);
  const movable = editable && block.kind === "task" && block.state !== "done";
  const dur = block.end - block.start;

  const previewStart = drag?.mode === "move" ? block.start + drag.delta : block.start;
  const previewDur = drag?.mode === "resize" ? Math.max(5, dur + drag.delta) : dur;
  const h = previewDur * PX_PER_MIN;

  const onPointerDown = (mode: "move" | "resize") => (e: PointerEvent) => {
    if (!movable || e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ mode, originY: e.clientY, delta: 0 });
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag) return;
    const delta = Math.round((e.clientY - drag.originY) / PX_PER_MIN / 5) * 5;
    if (delta !== drag.delta) setDrag({ ...drag, delta });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (d.delta === 0) {
      onSelect(block.id);
      return;
    }
    if (d.mode === "move") void moveBlock(block.id, block.start + d.delta);
    else void moveBlock(block.id, block.start, Math.max(5, dur + d.delta));
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(block.id);
      return;
    }
    if (!movable || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const step = (e.shiftKey ? 15 : 5) * (e.key === "ArrowUp" ? -1 : 1);
    if (e.altKey) void moveBlock(block.id, block.start, Math.max(5, dur + step));
    else void moveBlock(block.id, block.start + step);
  };

  const title = block.kind === "break" ? "Break" : (task?.title ?? "Task");
  const compact = h < 58;
  const cls = [
    "tl-block",
    block.kind === "break" ? "tl-block--break" : "",
    block.proposed ? "tl-block--proposed" : "",
    `tl-block--${block.state}`,
    selected ? "tl-block--selected" : "",
    drag ? "tl-block--dragging" : "",
    compact ? "tl-item--compact" : "",
    movable ? "tl-block--movable" : "",
  ].join(" ");

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${title}, ${formatClock(previewStart)} to ${formatClock(previewStart + previewDur)}${block.proposed ? ", proposed" : ""}, ${block.state.replace("_", " ")}${movable ? ". Arrow keys move, Alt+arrows resize." : ""}`}
      className={cls}
      style={{ top: y(previewStart), height: Math.max(h, 20) }}
      onPointerDown={onPointerDown("move")}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onClick={(e) => {
        e.stopPropagation();
        if (!movable) onSelect(block.id);
      }}
      onKeyDown={onKeyDown}
    >
      <span className="tl-item__time tabular">
        {block.state === "done" && <Check size={11} strokeWidth={3} />}
        {block.state === "in_progress" && <Play size={10} fill="currentColor" />}
        {block.pinned && block.state === "planned" && <Pin size={10} />}
        {formatClock(previewStart)}–{formatClock(previewStart + previewDur)}
        {!compact && <span className="tl-item__dur">{formatDuration(previewDur)}</span>}
      </span>
      <span className="tl-item__title">
        {title}
        {block.partCount > 1 && <span className="tl-item__part"> · {block.part}/{block.partCount}</span>}
      </span>
      {diff && <span className="tl-block__diff">{diff}</span>}
      {movable && <span className="tl-block__resize" onPointerDown={onPointerDown("resize")} aria-hidden="true" />}
    </div>
  );
}
