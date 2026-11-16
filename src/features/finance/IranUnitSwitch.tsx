import { create } from "zustand";
import { f } from "./copy";
type Unit = "rial" | "toman";
export const useIranUnit = create<{ unit: Unit }>(() => ({ unit: (() => { try { return localStorage.getItem("life-os.iran-unit") === "toman" ? "toman" : "rial"; } catch { return "rial"; } })() }));
export function IranUnitSwitch({ beforeChange }: { beforeChange?: (unit: Unit) => void }) {
  const { unit } = useIranUnit();
  return <button type="button" className="btn btn--glass btn--sm" role="switch" aria-checked={unit === "toman"} aria-label={f("Show and enter tomans", "نمایش و ورود به تومان")} onClick={() => {
    const next = unit === "rial" ? "toman" : "rial";
    try { beforeChange?.(next); } catch { return; }
    useIranUnit.setState({ unit: next });
    try { localStorage.setItem("life-os.iran-unit", next); } catch { /* Display preference remains usable. */ }
  }}>{unit === "rial" ? f("Rials → Tomans", "ریال ← تومان") : f("Tomans → Rials", "تومان ← ریال")}</button>;
}
