import { CircleAlert } from "lucide-react";
import { useEffect } from "react";
import { GoalsView } from "./features/goals/GoalsView";
import { PlannerView } from "./features/planner/PlannerView";
import { SettingsView } from "./features/settings/SettingsView";
import { Sidebar } from "./features/shell/Sidebar";
import { TodayView } from "./features/today/TodayView";
import { init, navigate, openComposer, tick, useApp } from "./state/store";
import { LiquidGlass } from "./ui/LiquidGlass";
import { Toasts } from "./ui/primitives";

function Ambient() {
  return (
    <div className="ambient" aria-hidden="true">
      <div className="ambient__orb ambient__orb--a" />
      <div className="ambient__orb ambient__orb--b" />
      <div className="ambient__grain" />
    </div>
  );
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export default function App() {
  const status = useApp((s) => s.status);
  const fatal = useApp((s) => s.fatal);
  const view = useApp((s) => s.view);

  useEffect(() => {
    void init();
    const id = setInterval(tick, 15_000);
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      if (document.querySelector(".overlay")) return;
      const map: Record<string, () => void> = {
        "1": () => navigate("today"),
        "2": () => navigate("goals"),
        "3": () => navigate("planner"),
        ",": () => navigate("settings"),
        n: () => openComposer(true),
      };
      const fn = map[e.key.toLowerCase()];
      if (fn && !(e.key === "n" && isTyping(e.target))) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Move focus to the new page's heading so keyboard and screen-reader users land in context.
  useEffect(() => {
    document.querySelector<HTMLElement>(".main")?.scrollTo({ top: 0 });
    document.querySelector<HTMLElement>("[data-page-heading]")?.focus({ preventScroll: true });
  }, [view]);

  if (status !== "ready") {
    return (
      <>
        <Ambient />
        <div className="boot">
          {status === "error" ? (
            <LiquidGlass dense className="boot__card" radius={24}>
              <CircleAlert size={28} color="var(--danger)" />
              <h1 className="section-title">Life OS couldn't open its database</h1>
              <p className="muted">{fatal}</p>
              <p className="faint" style={{ fontSize: 13 }}>
                Your data has not been modified. Restart the app; if this keeps happening, check that the app data folder is writable.
              </p>
            </LiquidGlass>
          ) : (
            <span className="faint" aria-live="polite">
              Opening your data…
            </span>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <Ambient />
      <div className="app">
        <Sidebar />
        <main className="main">
          {view === "today" && <TodayView />}
          {view === "goals" && <GoalsView />}
          {view === "planner" && <PlannerView />}
          {view === "settings" && <SettingsView />}
        </main>
      </div>
      <Toasts />
    </>
  );
}
