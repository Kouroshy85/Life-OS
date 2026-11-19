import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getLang, num } from "../domain/locale";
import { appClock, calendarMonth, calendarParts, calendarWeekday, getCalendar, shiftCalendarMonth, shiftDate, dateDistance } from "../domain/calendar";
import { formatFullDate, formatMonthYear } from "../domain/time";
import type { DateKey } from "../domain/types";
import { t } from "../i18n";
import { LiquidGlass } from "./LiquidGlass";
import { useFieldId } from "./primitives";

/** A calendar-aware field that always stores a Gregorian date key. */
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
  const today = appClock().today;
  const calendar = getCalendar();
  const [draft, setDraft] = useState(value ?? today);
  const [focusDay, setFocusDay] = useState<DateKey>(value ?? today);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const rtl = getLang() === "fa";
  const month = calendarMonth(focusDay, calendar);
  const days = Array.from({ length: dateDistance(month.start, month.end) + 1 }, (_, index) => shiftDate(month.start, index));
  // The Persian week starts on Saturday.
  const weekStart = calendar === "persian" || rtl ? 6 : 0;
  const lead = (calendarWeekday(days[0]) - weekStart + 7) % 7;
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
      if (e.key === "Tab" && ref.current) {
        const buttons = Array.from(ref.current.querySelectorAll<HTMLButtonElement>('button:not([tabindex="-1"])'));
        const first = buttons[0];
        const last = buttons.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [anchor, onClose]);

  const shiftMonth = (dir: 1 | -1) => setFocusDay((day) => shiftCalendarMonth(day, dir, calendar));

  const onGridKey = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1, ArrowUp: -7, ArrowDown: 7 };
    if (step[e.key]) {
      e.preventDefault();
      setFocusDay(shiftDate(focusDay, step[e.key]));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const direction = e.key === "PageUp" ? -1 : 1;
      if (e.shiftKey) setFocusDay(shiftCalendarMonth(focusDay, direction * 12, calendar));
      else shiftMonth(direction);
    }
  };

  return createPortal(
    <LiquidGlass ref={ref} dense radius={18} strength={14} bezel={10} className="datepicker datepicker--confirm" role="dialog" aria-label={t.pickDate} style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}>
      <div className="datepicker__head">
        <button type="button" className="icon-btn" aria-label={t.prevMonth} onClick={() => shiftMonth(-1)}>
          <ChevronLeft size={16} className="flip-rtl" />
        </button>
        <strong>{formatMonthYear(focusDay)}</strong>
        <button type="button" className="icon-btn" aria-label={t.nextMonth} onClick={() => shiftMonth(1)}>
          <ChevronRight size={16} className="flip-rtl" />
        </button>
      </div>
      <div className="datepicker__grid" role="grid" aria-label={formatMonthYear(focusDay)} onKeyDown={onGridKey}>
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
            aria-selected={d === draft}
            aria-current={d === today ? "date" : undefined}
            aria-label={formatFullDate(d)}
            className={`datepicker__day tabular ${d === draft ? "datepicker__day--on" : ""} ${d === today ? "datepicker__day--today" : ""} ${calendar === "persian" && calendarWeekday(d) === 5 ? "datepicker__day--holiday" : ""}`}
            onClick={() => { setDraft(d); setFocusDay(d); }}
          >
            {num(calendarParts(d, calendar).day)}
          </button>
        ))}
      </div>
      <div className="datepicker__foot">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setDraft(today); setFocusDay(today); }}>
          {t.todayShort}
        </button>
        {!required && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onPick(null)}>
            {t.clearDate}
          </button>
        )}
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>{t.cancel}</button>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => onPick(draft)}>{t.calendarConfirm}</button>
      </div>
    </LiquidGlass>,
    document.body,
  );
}
