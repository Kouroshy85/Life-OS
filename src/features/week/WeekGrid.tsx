import { layoutLanes, occursOn } from "../../domain/plans";
import { formatClock, formatShortDate, weekdayOf } from "../../domain/time";
import type { DateKey, Plan } from "../../domain/types";
import { t } from "../../i18n";
import { useApp } from "../../state/store";

const COLUMN = 120;
const DEFAULT_START = 360;
const DAY_END = 1440;

/**
 * The week as a grid: one row per day, one column per two hours. Earlier columns
 * appear only when a plan in this week needs them.
 */
export function WeekGrid({ dates, plans, highlight, onSelect }: { dates: DateKey[]; plans: Plan[]; highlight?: Set<string>; onSelect?: (plan: Plan) => void }) {
  const { today, nowMin } = useApp((s) => s.clock);
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
                      className={`wg__block wg__block--${plan.type} ${dimmed ? "wg__block--dim" : ""} ${lit ? "wg__block--lit" : ""} ${count > 1 ? "wg__block--tight" : ""} ${plan.end - plan.start < 90 ? "wg__block--narrow" : ""}`}
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
  return (
    <div className="wg-legend" aria-label={t.legendLabel}>
      <span><i className="plan-dot plan-dot--default" /> {t.groupDefault}</span>
      <span><i className="plan-dot plan-dot--goal" /> {t.groupGoal}</span>
      <span><i className="plan-dot plan-dot--event" /> {t.groupEvent}</span>
      <span className="faint">{t.legendPriority}</span>
    </div>
  );
}
