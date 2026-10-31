/**
 * Every colour, shadow and glow in the app comes from one of these palettes.
 * Stylesheets only refer to the tokens these values fill in.
 */

export type ThemeId = "default" | "jungle" | "shadow" | "strawberry" | "neutral" | "sky" | "wine";

export interface Theme {
  id: ThemeId;
  scheme: "dark" | "light";
  bg: string;
  bg2: string;
  bg3: string;
  /** Solid background of cards that stack, like notes. */
  card: string;
  /** Colour of hairlines and hover tints: white on dark themes, dark on light ones. */
  ink: string;
  /** Tint inside input fields. */
  well: string;
  /** Colour of drop shadows. */
  shadow: string;
  text: string;
  text2: string;
  text3: string;
  onAccent: string;
  /** Accent scale. 300 is used for accent-coloured text, 600 for solid buttons. */
  a300: string;
  a400: string;
  a500: string;
  a600: string;
  a700: string;
  /** Second hue for the background glow. */
  alt: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  warningInk: string;
  dangerInk: string;
  infoInk: string;
  planDefault: string;
  planGoal: string;
  planEvent: string;
  /** The "current time" marker. */
  now: string;
  glass: string;
  overlay: string;
  titleFrom: string;
  titleTo: string;
  cdDark: string;
  cdMid: string;
  cdLight: string;
  /** How solid panels are, so a theme's scene never sits behind text. */
  panel: number;
  /** Finer shades. Only Default sets these, to keep its look exact; others use their nearest colour. */
  shades?: Partial<Record<ShadeName, string>>;
}

type ShadeName = "aBright" | "aDeep" | "aDeepest" | "alt2" | "danger2" | "planEvent2" | "planGoal2" | "now2" | "nowSoft" | "glassStrong" | "cdSheen" | "cdTint" | "relaxBg" | "onAccentSoft" | "onDanger" | "cdTint2";

export const THEMES: Theme[] = [
  {
    id: "default",
    scheme: "dark",
    bg: "#09090f", bg2: "#11111b", bg3: "#171724", card: "#1a1828",
    ink: "#ffffff", well: "#000000", shadow: "#000000",
    text: "#f5f3ff", text2: "#a5a1b5", text3: "#6f6b82", onAccent: "#ffffff",
    a300: "#c4b5fd", a400: "#a78bfa", a500: "#8b5cf6", a600: "#7c3aed", a700: "#6d28d9", alt: "#6366f1",
    success: "#4ade80", warning: "#fbbf24", danger: "#fb7185", info: "#7dd3fc",
    warningInk: "#fde68a", dangerInk: "#fecdd3", infoInk: "#bae6fd",
    planDefault: "#a78bfa", planGoal: "#2dd4bf", planEvent: "#fbbf24", now: "#f472b6",
    glass: "#1c192c", overlay: "#05050a", titleFrom: "#ffffff", titleTo: "#c9c2e6",
    cdDark: "#1c1930", cdMid: "#2b2640", cdLight: "#a79cc9", panel: 0,
    shades: {
      aBright: "#9466f7", aDeep: "#5b21b6", aDeepest: "#3b1d7a", alt2: "#4338ca", danger2: "#e11d48",
      planEvent2: "#f59e0b", planGoal2: "#14b8a6", now2: "#db2777", nowSoft: "#f9a8d4", glassStrong: "#181626",
      cdSheen: "#8e86ad", cdTint: "#6f5aa8", relaxBg: "#07070c", onAccentSoft: "#ede9fe", onDanger: "#ffe4e8", cdTint2: "#6754a0",
    },
  },
  {
    id: "jungle",
    scheme: "dark",
    bg: "#14100a", bg2: "#1c1710", bg3: "#262015", card: "#1e2a1c",
    ink: "#f1ead8", well: "#000000", shadow: "#060402",
    text: "#f1ead8", text2: "#c0b59b", text3: "#958a72", onAccent: "#ffffff",
    a300: "#b7d8a8", a400: "#8fbf7f", a500: "#5f9a55", a600: "#3f7a3d", a700: "#2c5a30", alt: "#7a5230",
    success: "#8fce7a", warning: "#dfb35a", danger: "#e88a6a", info: "#a9c79a",
    warningInk: "#ecd39a", dangerInk: "#f3c3b0", infoInk: "#cfe3c5",
    planDefault: "#8fbf7f", planGoal: "#d9a066", planEvent: "#d8c465", now: "#f0b24a",
    glass: "#1e2616", overlay: "#080503", titleFrom: "#f7f1e0", titleTo: "#b7d8a8",
    cdDark: "#1b1209", cdMid: "#3a2a18", cdLight: "#8fbf7f", panel: 0.9,
  },
  {
    id: "shadow",
    scheme: "dark",
    bg: "#050505", bg2: "#0e0e0e", bg3: "#171717", card: "#131313",
    ink: "#ffffff", well: "#000000", shadow: "#000000",
    text: "#f7f7f7", text2: "#adadad", text3: "#858585", onAccent: "#0a0a0a",
    a300: "#f2f2f2", a400: "#d6d6d6", a500: "#ececec", a600: "#ffffff", a700: "#bdbdbd", alt: "#4a4a4a",
    success: "#e2e2e2", warning: "#cfcfcf", danger: "#ffffff", info: "#bdbdbd",
    warningInk: "#e6e6e6", dangerInk: "#ffffff", infoInk: "#e0e0e0",
    planDefault: "#ffffff", planGoal: "#a3a3a3", planEvent: "#6f6f6f", now: "#ffffff",
    glass: "#161616", overlay: "#000000", titleFrom: "#ffffff", titleTo: "#8f8f8f",
    cdDark: "#0a0a0a", cdMid: "#2a2a2a", cdLight: "#c8c8c8", panel: 0.9,
  },
  {
    id: "strawberry",
    scheme: "light",
    bg: "#ffe9f3", bg2: "#fff3f8", bg3: "#fbd9ea", card: "#fff6fb",
    ink: "#50185a", well: "#ffffff", shadow: "#78286e",
    text: "#43164a", text2: "#6c3a75", text3: "#85568d", onAccent: "#ffffff",
    a300: "#8a2a8f", a400: "#a8399f", a500: "#c93a95", a600: "#a6247f", a700: "#7b1fa2", alt: "#c77dff",
    success: "#16794a", warning: "#9a5408", danger: "#c01a55", info: "#3560c4",
    warningInk: "#7d4405", dangerInk: "#9c1344", infoInk: "#2a4ea3",
    planDefault: "#d6409f", planGoal: "#7b3fe4", planEvent: "#e8765c", now: "#e0218a",
    glass: "#ffeef6", overlay: "#5a1e5a", titleFrom: "#5a1a66", titleTo: "#c2368f",
    cdDark: "#f3c6e4", cdMid: "#fbdcef", cdLight: "#b98af0", panel: 0.9,
  },
  {
    id: "neutral",
    scheme: "light",
    bg: "#ffdbbb", bg2: "#ffe6d1", bg3: "#f4cfae", card: "#ffe9d6",
    ink: "#664930", well: "#fff5eb", shadow: "#664930",
    text: "#4a3321", text2: "#664930", text3: "#755a44", onAccent: "#ffffff",
    a300: "#664930", a400: "#7a5c43", a500: "#8a6f58", a600: "#664930", a700: "#4f3622", alt: "#ccbeb1",
    success: "#47702f", warning: "#8a4f0d", danger: "#a02c1a", info: "#4f6b7c",
    warningInk: "#6f3f09", dangerInk: "#852213", infoInk: "#3f5766",
    planDefault: "#664930", planGoal: "#997e67", planEvent: "#b5764a", now: "#a02c1a",
    glass: "#ffe6d1", overlay: "#664930", titleFrom: "#664930", titleTo: "#997e67",
    cdDark: "#997e67", cdMid: "#ccbeb1", cdLight: "#ffdbbb", panel: 0.9,
  },
  {
    id: "sky",
    scheme: "light",
    bg: "#e3f1fb", bg2: "#f2f8fd", bg3: "#d4e6f4", card: "#ffffff",
    ink: "#28425e", well: "#ffffff", shadow: "#3c5a78",
    text: "#1d3347", text2: "#425d73", text3: "#587489", onAccent: "#ffffff",
    a300: "#1f6aa8", a400: "#2a7bbf", a500: "#3584c6", a600: "#2470ad", a700: "#1b5a8e", alt: "#9fc4dd",
    success: "#16794f", warning: "#935709", danger: "#bb3345", info: "#2470ad",
    warningInk: "#784706", dangerInk: "#992636", infoInk: "#1b5a8e",
    planDefault: "#2a7bbf", planGoal: "#2f9aa8", planEvent: "#7d8a96", now: "#d9534f",
    glass: "#f5faff", overlay: "#3c5a78", titleFrom: "#1d3347", titleTo: "#2a7bbf",
    cdDark: "#b8c7d3", cdMid: "#dbe6ee", cdLight: "#ffffff", panel: 0.9,
  },
  {
    id: "wine",
    scheme: "dark",
    bg: "#0c0506", bg2: "#160709", bg3: "#220b0f", card: "#1c0a0d",
    ink: "#f6e9ea", well: "#000000", shadow: "#000000",
    text: "#f6e9ea", text2: "#c4a6aa", text3: "#9a7b7f", onAccent: "#ffffff",
    a300: "#e7a2ac", a400: "#cf5f70", a500: "#a82a3f", a600: "#8e1b2e", a700: "#5f0f1d", alt: "#3d0a14",
    success: "#9cc27f", warning: "#dcae66", danger: "#ff7385", info: "#d1abb2",
    warningInk: "#edd2a5", dangerInk: "#ffc4cc", infoInk: "#e6cfd3",
    planDefault: "#cf5f70", planGoal: "#e0b4bb", planEvent: "#b38a5a", now: "#ff5a6e",
    glass: "#240c10", overlay: "#050102", titleFrom: "#fbeff0", titleTo: "#cf5f70",
    cdDark: "#1a0508", cdMid: "#3d0a14", cdLight: "#cf5f70", panel: 0.9,
  },
];

export const DEFAULT_THEME: ThemeId = "default";

export const themeById = (id: string | null | undefined): Theme => THEMES.find((x) => x.id === id) ?? THEMES[0];

/** "#7c3aed" as "124 58 237", the form the stylesheets use with an opacity. */
export function hexToTriplet(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** WCAG contrast ratio between two colours. */
export function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = hexToTriplet(hex).split(" ").map((v) => {
      const c = Number(v) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** White or near-black, whichever can be read on this colour. */
export function readableOn(color: string): string {
  return contrast("#ffffff", color) >= 4.4 ? "#ffffff" : "#1c1917";
}

/** Every stylesheet token a theme fills in. */
export function themeTokens(t: Theme): Record<string, string> {
  const shade = t.shades ?? {};
  const now2 = shade.now2 ?? t.now;
  const triplets: Record<string, string> = {
    "--ink": t.ink, "--well": t.well, "--shadow-rgb": t.shadow,
    "--a300": t.a300, "--a400": t.a400, "--a500": t.a500, "--a600": t.a600, "--a700": t.a700, "--alt": t.alt,
    "--success-rgb": t.success, "--warning-rgb": t.warning, "--danger-rgb": t.danger, "--info-rgb": t.info,
    "--plan-default-rgb": t.planDefault, "--plan-goal-rgb": t.planGoal, "--plan-event-rgb": t.planEvent,
    "--now-rgb": t.now, "--glass-rgb": t.glass, "--overlay-rgb": t.overlay, "--bg-rgb": t.bg, "--bg2-rgb": t.bg2,
    "--a-bright": shade.aBright ?? t.a500, "--a-deep": shade.aDeep ?? t.a700, "--a-deepest": shade.aDeepest ?? t.a700,
    "--alt-2": shade.alt2 ?? t.alt, "--danger-2": shade.danger2 ?? t.danger,
    "--plan-event-2": shade.planEvent2 ?? t.planEvent, "--plan-goal-2": shade.planGoal2 ?? t.planGoal,
    "--now-2": now2, "--now-soft": shade.nowSoft ?? t.now, "--glass-strong-rgb": shade.glassStrong ?? t.glass,
  };
  const out: Record<string, string> = {
    "--bg": t.bg, "--bg-2": t.bg2, "--bg-3": t.bg3, "--card": t.card,
    "--text": t.text, "--text-2": t.text2, "--text-3": t.text3, "--text-on-accent": t.onAccent,
    "--warning-ink": t.warningInk, "--danger-ink": t.dangerInk, "--info-ink": t.infoInk,
    "--title-from": t.titleFrom, "--title-to": t.titleTo,
    "--cd-dark": t.cdDark, "--cd-mid": t.cdMid, "--cd-light": t.cdLight,
    "--cd-sheen": shade.cdSheen ?? t.cdLight, "--cd-tint": shade.cdTint ?? t.a500, "--relax-bg": shade.relaxBg ?? t.bg,
    "--on-accent-soft": shade.onAccentSoft ?? t.onAccent, "--on-danger": shade.onDanger ?? t.dangerInk, "--cd-tint-2": shade.cdTint2 ?? t.a500, "--on-now": readableOn(now2), "--on-plan-event": readableOn(t.planEvent),
    "--panel-alpha": String(t.panel),
  };
  for (const [k, v] of Object.entries(triplets)) out[k] = hexToTriplet(v);
  return out;
}
