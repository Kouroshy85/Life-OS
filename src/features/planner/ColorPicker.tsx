import { Check } from "lucide-react";
import { num } from "../../domain/locale";
import { PLAN_COLORS, type PlanColor } from "../../domain/types";
import { t } from "../../i18n";

/** The current theme's four plan colours, as a compact row of swatches. */
export function ColorPicker({ value, onChange, label }: { value: PlanColor; onChange: (color: PlanColor) => void; label: string }) {
  return (
    <div className="color-pick" role="radiogroup" aria-label={label}>
      {PLAN_COLORS.map((color) => {
        const on = color === value;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={t.colorName(num(color))}
            title={t.colorName(num(color))}
            className={`color-swatch plan-c${color} ${on ? "color-swatch--on" : ""}`}
            onClick={() => onChange(color)}
          >
            {on && <Check size={13} strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}

/** The same choice at full size: each option previews the block and says who already uses that colour. */
export function ColorOptions({ value, onChange, title, usage }: { value: PlanColor; onChange: (color: PlanColor) => void; title: string; usage: Record<PlanColor, string[]> }) {
  return (
    <div className="color-opts" role="radiogroup" aria-label={t.qPlanColor}>
      {PLAN_COLORS.map((color) => {
        const on = color === value;
        const used = usage[color];
        return (
          <button key={color} type="button" role="radio" aria-checked={on} className={`color-opt plan-c${color} ${on ? "color-opt--on" : ""}`} onClick={() => onChange(color)}>
            <span className="color-opt__block">
              <strong>{title || t.colorName(num(color))}</strong>
              {on && <Check size={15} strokeWidth={3} />}
            </span>
            <small className="faint">{used.length ? t.colorUsed(used.slice(0, 2).join(t.listJoin) + (used.length > 2 ? ` +${num(used.length - 2)}` : "")) : t.colorFree}</small>
          </button>
        );
      })}
    </div>
  );
}
