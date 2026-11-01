import { describe, expect, it } from "vitest";
import { makePlan } from "../persistence/repository";
import { colorUsage, planColor, suggestColor, TYPE_COLOR } from "./plans";
import { contrast, hexToTriplet, planColors, readableOn, THEMES } from "./themes";
import type { Goal } from "./types";

const goal = (id: string, color: Goal["color"] = null) => ({ id, title: id, color }) as Goal;
const plan = (type: "default" | "goal" | "event", extra = {}) => makePlan({ type, title: "p", start: 540, end: 600, weekdays: 2, ...extra });

describe("plan colours", () => {
  it("keeps each type's usual colour until you choose one", () => {
    expect(planColor(plan("default"), [])).toBe(TYPE_COLOR.default);
    expect(planColor(plan("goal"), [])).toBe(TYPE_COLOR.goal);
    expect(planColor(plan("event"), [])).toBe(TYPE_COLOR.event);
  });

  it("uses the colour you chose", () => {
    expect(planColor(plan("default", { color: 4 }), [])).toBe(4);
  });

  it("colours all of a goal's sessions by the goal", () => {
    const goals = [goal("g", 3)];
    expect(planColor(plan("goal", { goalId: "g" }), goals)).toBe(3);
    expect(planColor(plan("goal", { goalId: "g", color: 1 }), goals)).toBe(3);
  });

  it("suggests the colour nothing else uses yet", () => {
    const plans = [plan("default", { color: 1 }), plan("default", { color: 2 }), plan("default", { color: 4 })];
    expect(suggestColor("default", plans, [])).toBe(3);
  });

  it("prefers the type's own colour on a tie", () => {
    expect(suggestColor("event", [], [])).toBe(TYPE_COLOR.event);
  });

  it("counts a goal with many sessions once", () => {
    const goals = [goal("g", 1)];
    const sessions = [plan("goal", { goalId: "g" }), plan("goal", { goalId: "g" }), plan("goal", { goalId: "g" })];
    const usage = colorUsage(sessions, goals);
    expect(usage[1]).toEqual(["g"]);
    expect(usage[2]).toEqual([]);
  });

  it("can leave out the plan being edited", () => {
    const p = plan("default", { color: 2 });
    expect(colorUsage([p], [], p.id)[2]).toEqual([]);
  });

  for (const theme of THEMES) {
    describe(theme.id, () => {
      const colors = planColors(theme);

      it("offers exactly four different colours", () => {
        expect(colors).toHaveLength(4);
        expect(new Set(colors).size).toBe(4);
      });

      it("keeps all four visible on the background", () => {
        for (const c of colors) expect(contrast(c, theme.bg), c).toBeGreaterThanOrEqual(2);
      });

      it("keeps labels readable on a block filled with each colour", () => {
        for (const c of colors) expect(contrast(readableOn(c), c), c).toBeGreaterThanOrEqual(4);
      });

      it("keeps all four easy to tell apart", () => {
        const rgb = colors.map((c) => hexToTriplet(c).split(" ").map(Number));
        for (let a = 0; a < 4; a++) {
          for (let b = a + 1; b < 4; b++) {
            const distance = Math.hypot(rgb[a][0] - rgb[b][0], rgb[a][1] - rgb[b][1], rgb[a][2] - rgb[b][2]);
            expect(distance, `${colors[a]} and ${colors[b]}`).toBeGreaterThanOrEqual(50);
          }
        }
      });
    });
  }
});
