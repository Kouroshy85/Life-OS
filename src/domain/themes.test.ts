import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast, hexToTriplet, readableOn, THEMES, themeById, themeTokens } from "./themes";

describe("themes", () => {
  it("has the seven requested themes", () => {
    expect(THEMES.map((t) => t.id)).toEqual(["default", "jungle", "shadow", "strawberry", "neutral", "sky", "wine"]);
  });

  it("uses your exact neutral elegance colours", () => {
    const n = themeById("neutral");
    const used = JSON.stringify(n);
    for (const hex of ["#ffdbbb", "#ccbeb1", "#997e67", "#664930"]) expect(used).toContain(hex);
  });

  it("falls back to the default for unknown names", () => {
    expect(themeById("nope").id).toBe("default");
    expect(themeById(null).id).toBe("default");
  });

  it("converts colours for the stylesheets", () => {
    expect(hexToTriplet("#7c3aed")).toBe("124 58 237");
  });

  it("calculates contrast correctly", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  for (const t of THEMES) {
    describe(t.id, () => {
      const surfaces = { bg: t.bg, bg2: t.bg2, bg3: t.bg3, card: t.card };

      it("has readable text on every surface", () => {
        for (const [name, s] of Object.entries(surfaces)) {
          expect(contrast(t.text, s), `text on ${name}`).toBeGreaterThanOrEqual(7);
          expect(contrast(t.text2, s), `secondary text on ${name}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(t.text3, s), `faint text on ${name}`).toBeGreaterThanOrEqual(3);
        }
      });

      it("has readable buttons and accent text", () => {
        expect(contrast(t.onAccent, t.a600), "button label").toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.onAccent, t.a500), "button label at its lightest").toBeGreaterThanOrEqual(3);
        expect(contrast(t.a300, t.bg), "accent text").toBeGreaterThanOrEqual(4.5);
      });

      it("has readable status colours", () => {
        for (const c of [t.success, t.warning, t.danger, t.info]) expect(contrast(c, t.bg)).toBeGreaterThanOrEqual(3);
        for (const c of [t.warningInk, t.dangerInk, t.infoInk]) expect(contrast(c, t.bg)).toBeGreaterThanOrEqual(4.5);
      });

      it("keeps the three plan colours and the now marker visible", () => {
        for (const c of [t.planDefault, t.planGoal, t.planEvent, t.now]) expect(contrast(c, t.bg)).toBeGreaterThanOrEqual(2);
        expect(new Set([t.planDefault, t.planGoal, t.planEvent]).size).toBe(3);
      });

      it("keeps labels readable on the now marker and event plans", () => {
        const tokens = themeTokens(t);
        expect(contrast(tokens["--on-plan-event"], t.planEvent)).toBeGreaterThanOrEqual(4.4);
        expect(contrast(readableOn(t.now), t.now)).toBeGreaterThanOrEqual(4.4);
      });

      it("fills in every token", () => {
        for (const value of Object.values(themeTokens(t))) expect(value).not.toMatch(/NaN|undefined/);
      });
    });
  }

  it("starts from the same values as the default theme, so the first paint never flashes", () => {
    const css = readFileSync("src/styles/tokens.css", "utf8");
    for (const [token, value] of Object.entries(themeTokens(themeById("default")))) {
      expect(css, token).toContain(`${token}: ${value};`);
    }
  });

  it("leaves no hard-coded colours in the stylesheets, so a theme really changes everything", () => {
    const dir = "src/styles";
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".css") && f !== "scenes.css" && f !== "tokens.css")) {
      readFileSync(`${dir}/${file}`, "utf8").split("\n").forEach((line, i) => {
        if (line.includes("url(")) return;
        const allowed = line.replace(/rgba\(255, 255, 255, [\d.]+\)/g, "");
        if (/#[0-9a-f]{3,8}\b/i.test(allowed) || /rgba?\(\d/.test(allowed)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
