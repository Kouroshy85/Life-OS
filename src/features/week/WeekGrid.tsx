import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { layoutLanes, occursOn, planColor, TYPE_COLOR } from "../../domain/plans";
import { addDays, formatClock, formatShortDate, weekdayOf } from "../../domain/time";
import type { DateKey, Plan } from "../../domain/types";
import { t } from "../../i18n";
import { useApp } from "../../state/store";
import { IconButton } from "../../ui/primitives";
import { useIsPhone } from "../../ui/useIsPhone";

const COLUMN = 120;
const DEFAULT_START = 360;
const DAY_END = 1440;
const HOUR_PX = 64;

interface GridProps {
  dates: DateKey[];
  plans: Plan[];
  highlight?: Set<string>;
  onSelect?: (plan: Plan) => void;
  /** Called when the phone's day arrows step past the end of this week. */
  onLeaveWeek?: (date: DateKey) => void;
}

export function WeekGrid(props: GridProps) {
  return useIsPhone() ? <DayGrid {...props} /> : <WideGrid {...props} />;
}

/** On a phone: one day at a time, with the hours down the side. */
function DayGrid({ dates, plans, highlight, onSelect, onLeaveWeek }: GridProps) {
  const { today, nowMin } = useApp((s) => s.clock);
  const goals = useApp((s) => s.goals);
  const opening = () => {
    const lit = highlight && dates.find((d) => plans.some((p) => highlight.has(p.id) && occursOn(p, d)));
    return lit || (dates.includes(today) ? today : dates[0]);
  };
  const [day, setDay] = useState<DateKey>(opening);

  useEffect(() => {
    if (!dates.includes(day)) setDay(opening());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates]);

  const canMove = (delta: number) => !!onLeaveWeek || dates.includes(addDays(day, delta));
  const move = (delta: number) => {
    const next = addDays(day, delta);
    setDay(next);
    if (!dates.includes(next)) onLeaveWeek?.(next);
  };

  const lanes = layoutLanes(plans.filter((p) => occursOn(p, day)));
  const earliest = Math.min(DEFAULT_START, ...lanes.map((l) => l.plan.start));
  const gridStart = Math.floor(earliest / 60) * 60;
  const px = (minutes: number) => (minutes * HOUR_PX) / 60;
  const hours = Array.from({ length: (DAY_END - gridStart) / 60 }, (_, i) => gridStart + i * 60);
  const isToday = day === today;

  return (
    <div className={`day-grid ${day < today ? "day-grid--past" : ""}`}>
      <div className="day-pill glass">
        <IconButton label={t.dayPrev} disabled={!canMove(-1)} onClick={() => move(-1)}>
          <ChevronLeft size={20} className="flip-rtl" />
        </IconButton>
        <div className="day-pill__label" aria-live="polite">
          <strong>{t.weekdays[weekdayOf(day)]}</strong>
          <span className="tabular">{formatShortDate(day)}</span>
          {isToday && <em>{t.todayShort}</em>}
        </div>
        <IconButton label={t.dayNext} disabled={!canMove(1)} onClick={() => move(1)}>
          <ChevronRight size={20} className="flip-rtl" />
        </IconButton>
      </div>

      <div className="day-grid__body" style={{ height: px(DAY_END - gridStart) }}>
        {hours.map((hour) => (
          <div key={hour} className="day-grid__hour" style={{ top: px(hour - gridStart) }}>
            <span className="tabular">{formatClock(hour)}</span>
          </div>
        ))}
        <div className="day-grid__track">
          {lanes.map(({ plan, lane, lanes: count }) => {
            const height = Math.max(26, px(plan.end - plan.start) - 3);
            const label = `${plan.title} · ${formatClock(plan.start)}–${formatClock(plan.end)}${plan.description ? ` · ${plan.description}` : ""}`;
            return (
              <button
                key={plan.id}
                type="button"
                aria-label={label}
                disabled={!onSelect}
                className={`wg__block plan-c${planColor(plan, goals)} ${highlight && !highlight.has(plan.id) ? "wg__block--dim" : ""} ${highlight?.has(plan.id) ? "wg__block--lit" : ""} ${height < 52 ? "wg__block--tight" : ""}`}
                style={{
                  top: px(plan.start - gridStart) + 1,
                  height,
                  insetInlineStart: `${(lane / count) * 100}%`,
                  width: `calc(${100 / count}% - 3px)`,
                }}
                onClick={() => onSelect?.(plan)}
              >
                <span className="wg__title">{plan.title}</span>
                <span className="wg__time tabular">
                  {formatClock(plan.start)}–{formatClock(plan.end)}
                </span>
                {plan.description && <span className="wg__desc">{plan.description}</span>}
              </button>
            );
          })}
          {isToday && nowMin >= gridStart && (
            <div className="day-grid__now" style={{ top: px(nowMin - gridStart) }} aria-label={t.nowAria(formatClock(nowMin))}>
              <span className="tabular">{formatClock(nowMin)}</span>
            </div>
          )}
        </div>
        {plans.length > 0 && lanes.length === 0 && <p className="day-grid__empty faint">{t.dayEmpty}</p>}
      </div>
    </div>
  );
}

/**
 * The week as a grid: one row per day, one column per two hours. Earlier columns
 * appear only when a plan in this week needs them.
 */
function WideGrid({ dates, plans, highlight, onSelect }: GridProps) {
  const { today, nowMin } = useApp((s) => s.clock);
  const goals = useApp((s) => s.goals);
  const inWeek = dates.flatMap((date) => plans.filter((p) => occursOn(p, date)));
  const earliest = Math.min(DEFAULT_START, ...inWeek.map((p) => p.start));
  const gridStart = Math.floor(earliest / COLUMN) * COLUMN;
  const span = DAY_END - gridStart;
  const columns = Array.from({ length: span / COLUMN }, (_, i) => gridStart + i * COLUMN);
  const pct = (minutes: number) => `${(minutes / span) * 100}%`;
  const nowInGrid = nowMin >= gridStart;

  return (
    <div className="wg-scroll">
      <div className="wg" style={{ ["--wg-cols" as string]: columns.length }}>
        <div className="wg__corner" />
        <div className="wg__head">
          {columns.map((c) => {
            const current = dates.includes(today) && nowMin >= c && nowMin < c + COLUMN;
            return (
              <div key={c} className={`wg__hour tabular ${current ? "wg__hour--now" : ""}`}>
                {formatClock(c)}
              </div>
            );
          })}
        </div>

        {dates.map((date) => {
          const isToday = date === today;
          const lanes = layoutLanes(plans.filter((p) => occursOn(p, date)));
          return (
            <div key={date} className={`wg__row ${isToday ? "wg__row--today" : ""} ${date < today ? "wg__row--past" : ""}`}>
              <div className="wg__day">
                <strong>{t.weekdays[weekdayOf(date)]}</strong>
                <span className="tabular">{formatShortDate(date)}</span>
                {isToday && <em>{t.todayShort}</em>}
              </div>
              <div className="wg__track">
                {columns.map((c) => (
                  <div key={c} className={`wg__cell ${isToday && nowMin >= c && nowMin < c + COLUMN ? "wg__cell--now" : ""}`} />
                ))}
                {lanes.map(({ plan, lane, lanes: count }) => {
                  const dimmed = highlight && !highlight.has(plan.id);
                  const lit = highlight?.has(plan.id);
                  const label = `${plan.title} · ${formatClock(plan.start)}–${formatClock(plan.end)}${plan.description ? ` · ${plan.description}` : ""}`;
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      title={label}
                      aria-label={label}
                      disabled={!onSelect}
                      className={`wg__block plan-c${planColor(plan, goals)} ${dimmed ? "wg__block--dim" : ""} ${lit ? "wg__block--lit" : ""} ${count > 1 ? "wg__block--tight" : ""} ${plan.end - plan.start < 90 ? "wg__block--narrow" : ""}`}
                      style={{
                        insetInlineStart: pct(plan.start - gridStart),
                        width: pct(plan.end - plan.start),
                        top: `calc(${(lane / count) * 100}% + 3px)`,
                        height: `calc(${100 / count}% - 6px)`,
                      }}
                      onClick={() => onSelect?.(plan)}
                    >
                      <span className="wg__title">{plan.title}</span>
                      <span className="wg__time tabular">
                        {formatClock(plan.start)}–{formatClock(plan.end)}
                      </span>
                      {plan.description && <span className="wg__desc">{plan.description}</span>}
                    </button>
                  );
                })}
                {isToday && nowInGrid && (
                  <div className="wg__now" style={{ insetInlineStart: pct(nowMin - gridStart) }} aria-label={t.nowAria(formatClock(nowMin))}>
                    <span className="tabular">{formatClock(nowMin)}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PlanLegend() {
  const plans = useApp((s) => s.plans);
  const goals = useApp((s) => s.goals);
  // Colours only mean a type until you start choosing your own.
  const byType = plans.every((p) => planColor(p, goals) === TYPE_COLOR[p.type]);
  return (
    <div className="wg-legend" aria-label={t.legendLabel}>
      {byType && (
        <>
          <span><i className="plan-dot plan-dot--default" /> {t.groupDefault}</span>
          <span><i className="plan-dot plan-dot--goal" /> {t.groupGoal}</span>
          <span><i className="plan-dot plan-dot--event" /> {t.groupEvent}</span>
        </>
      )}
      <span className="faint">{t.legendPriority}</span>
    </div>
  );
}
