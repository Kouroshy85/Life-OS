import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getLang, num } from "../domain/locale";
import { addDays, formatFullDate, toDateKey, weekdayOf } from "../domain/time";
import type { DateKey } from "../domain/types";
import { t } from "../i18n";
import { LiquidGlass } from "./LiquidGlass";
import { useFieldId } from "./primitives";

/** Year, month and day of a date in the calendar of the current language. */
function calendarParts(key: DateKey) {
  const calendar = getLang() === "fa" ? "persian" : "gregory";
  const [y, m, d] = key.split("-").map(Number);
  const parts = new Intl.DateTimeFormat(`en-u-ca-${calendar}`, { year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(y, m - 1, d));
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** All days of the month containing `key`. Walks real dates, so it works for either calendar. */
function monthDays(key: DateKey): DateKey[] {
  const { day, month } = calendarParts(key);
  const first = addDays(key, -(day - 1));
  const days: DateKey[] = [];
  for (let cur = first; calendarParts(cur).month === month; cur = addDays(cur, 1)) days.push(cur);
  return days;
}

const monthTitle = (key: DateKey) =>
  new Intl.DateTimeFormat(getLang() === "fa" ? "fa-IR" : "en-US", { year: "numeric", month: "long" }).format(new Date(`${key}T12:00:00`));

/**
 * Date field that follows the app language: Solar Hijri with Persian digits in
 * Persian, Gregorian in English. Values are always stored as Gregorian date keys.
 */
export function DateInput({
  value,
  onChange,
  bare,
  required,
  "aria-label": ariaLabel,
}: {
  value: DateKey | null;
  onChange: (v: DateKey | null) => void;
  bare?: boolean;
  required?: boolean;
  "aria-label"?: string;
}) {
  const fieldId = useFieldId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        id={fieldId}
        type="button"
        className={`date-field ${bare ? "date-field--bare" : "input"} tabular`}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={value ? "" : "faint"}>{value ? formatFullDate(value) : t.noDate}</span>
        {!bare && <CalendarDays size={15} className="faint" />}
      </button>
      {open && (
        <Calendar
          anchor={button.current!}
          value={value}
          required={required}
          onPick={(v) => {
            onChange(v);
            setOpen(false);
            button.current?.focus();
          }}
          onClose={() => {
            setOpen(false);
            button.current?.focus();
          }}
        />
      )}
    </>
  );
}

function Calendar({ anchor, value, required, onPick, onClose }: { anchor: HTMLElement; value: DateKey | null; required?: boolean; onPick: (v: DateKey | null) => void; onClose: () => void }) {
  const today = toDateKey(new Date());
  const [focusDay, setFocusDay] = useState<DateKey>(value ?? today);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const rtl = getLang() === "fa";
  const days = monthDays(focusDay);
  // The Persian week starts on Saturday.
  const weekStart = rtl ? 6 : 0;
  const lead = (weekdayOf(days[0]) - weekStart + 7) % 7;
  const headers = Array.from({ length: 7 }, (_, i) => {
    const index = (weekStart + i) % 7;
    return { index, label: t.weekdays[index].slice(0, rtl ? 1 : 2) };
  });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const a = anchor.getBoundingClientRect();
    const m = ref.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - m.width - 8, rtl ? a.right - m.width : a.left));
    let top = a.bottom + 6;
    if (top + m.height > window.innerHeight - 8) top = Math.max(8, a.top - m.height - 6);
    setPos({ top, left });
  }, [anchor, rtl]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-focus-day]")?.focus();
  }, [focusDay, pos === null]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [anchor, onClose]);

  const shiftMonth = (dir: 1 | -1) => {
    const edge = dir === 1 ? addDays(days[days.length - 1], 1) : addDays(days[0], -1);
    const target = monthDays(edge);
    const day = calendarParts(focusDay).day;
    setFocusDay(target[Math.min(day, target.length) - 1]);
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1, ArrowUp: -7, ArrowDown: 7 };
    if (step[e.key]) {
      e.preventDefault();
      setFocusDay(addDays(focusDay, step[e.key]));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      shiftMonth(e.key === "PageUp" ? -1 : 1);
    }
  };

  return createPortal(
    <LiquidGlass ref={ref} dense radius={18} strength={14} bezel={10} className="datepicker" role="dialog" aria-label={t.pickDate} style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}>
      <div className="datepicker__head">
        <button type="button" className="icon-btn" aria-label={t.prevMonth} onClick={() => shiftMonth(-1)}>
          <ChevronLeft size={16} className="flip-rtl" />
        </button>
        <strong>{monthTitle(focusDay)}</strong>
        <button type="button" className="icon-btn" aria-label={t.nextMonth} onClick={() => shiftMonth(1)}>
          <ChevronRight size={16} className="flip-rtl" />
        </button>
      </div>
      <div className="datepicker__grid" role="grid" onKeyDown={onGridKey}>
        {headers.map((h) => (
          <span key={h.index} className="datepicker__dow" aria-hidden="true">
            {h.label}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`pad${i}`} />
        ))}
        {days.map((d) => (
          <button
            key={d}
            type="button"
            role="gridcell"
            tabIndex={d === focusDay ? 0 : -1}
            data-focus-day={d === focusDay ? "" : undefined}
            aria-selected={d === value}
            aria-label={formatFullDate(d)}
            className={`datepicker__day tabular ${d === value ? "datepicker__day--on" : ""} ${d === today ? "datepicker__day--today" : ""}`}
            onClick={() => onPick(d)}
          >
            {num(calendarParts(d).day)}
          </button>
        ))}
      </div>
      <div className="datepicker__foot">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onPick(today)}>
          {t.todayShort}
        </button>
        {!required && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onPick(null)}>
            {t.clearDate}
          </button>
        )}
      </div>
    </LiquidGlass>,
    document.body,
  );
}
