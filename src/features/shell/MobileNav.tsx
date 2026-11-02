import { LayoutGrid, Menu as MenuIcon, Plus, Sun } from "lucide-react";
import { useEffect } from "react";
import { t } from "../../i18n";
import { navigate, openComposer, setDrawerOpen, useApp } from "../../state/store";
import { LiquidGlass } from "../../ui/LiquidGlass";

/** The floating button that opens the side menu. */
export function DrawerButton() {
  const open = useApp((s) => s.drawerOpen);
  return (
    <button type="button" className="drawer-btn glass" aria-label={t.menuOpen} aria-expanded={open} onClick={() => setDrawerOpen(true)}>
      <MenuIcon size={20} />
    </button>
  );
}

/** The dimmed area beside the open side menu. Tapping it closes the menu. */
export function DrawerScrim() {
  const open = useApp((s) => s.drawerOpen);

  useEffect(() => {
    if (!open) return;
    // An entry in history lets Android's back button close the menu instead of the app.
    history.pushState({ drawer: true }, "");
    const onPop = () => setDrawerOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    document.querySelector<HTMLElement>(".sidebar__close")?.focus();
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
      if (history.state?.drawer) history.back();
      document.querySelector<HTMLElement>(".drawer-btn")?.focus();
    };
  }, [open]);

  return <div className={`drawer-scrim ${open ? "drawer-scrim--on" : ""}`} aria-hidden="true" onClick={() => setDrawerOpen(false)} />;
}

/** Bottom bar. Its order is fixed in every language: new goal, home, weekly plan. */
export function TabBar() {
  const view = useApp((s) => s.view);
  const composerOpen = useApp((s) => s.composerOpen);
  const home = view === "today" && !composerOpen;
  const week = view === "week" && !composerOpen;

  return (
    <LiquidGlass as="nav" className="tabbar" lens radius={33} bezel={13} strength={30} blur={12} aria-label={t.navMain}>
      <button type="button" className={`tab ${composerOpen ? "tab--on" : ""}`} onClick={() => openComposer(true)}>
        <Plus size={20} strokeWidth={2.2} />
        <span>{t.tabGoal}</span>
      </button>
      <button type="button" className={`tab ${home ? "tab--on" : ""}`} aria-current={home ? "page" : undefined} onClick={() => navigate("today")}>
        <Sun size={20} strokeWidth={2.2} />
        <span>{t.tabHome}</span>
      </button>
      <button type="button" className={`tab ${week ? "tab--on" : ""}`} aria-current={week ? "page" : undefined} onClick={() => navigate("week")}>
        <LayoutGrid size={19} strokeWidth={2.2} />
        <span>{t.tabWeek}</span>
      </button>
    </LiquidGlass>
  );
}
