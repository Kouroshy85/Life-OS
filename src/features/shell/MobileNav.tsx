import { LayoutGrid, Menu as MenuIcon, Sun, Wallet } from "lucide-react";
import { useEffect } from "react";
import { t } from "../../i18n";
import { navigate, setDrawerOpen, useApp } from "../../state/store";
import { LiquidGlass } from "../../ui/LiquidGlass";
import { MobileQuickAdd } from "./MobileQuickAdd";

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

/** Bottom bar with shortcuts to the most-used views. */
export function TabBar() {
  const view = useApp((s) => s.view);
  const composerOpen = useApp((s) => s.composerOpen);
  const home = view === "today" && !composerOpen;
  const week = view === "week" && !composerOpen;
  const finance = view === "finance" && !composerOpen;

  return (
    <LiquidGlass as="nav" className="tabbar" radius={26} bezel={9} strength={14} blur={16} aria-label={t.navMain}>
      <button type="button" className={`tab ${home ? "tab--on" : ""}`} aria-current={home ? "page" : undefined} onClick={() => navigate("today")}>
        <Sun size={20} strokeWidth={2.2} />
        <span>{t.tabHome}</span>
      </button>
      <button type="button" className={`tab ${week ? "tab--on" : ""}`} aria-current={week ? "page" : undefined} onClick={() => navigate("week")}>
        <LayoutGrid size={19} strokeWidth={2.2} />
        <span>{t.tabWeek}</span>
      </button>
      <button type="button" className={`tab ${finance ? "tab--on" : ""}`} aria-current={finance ? "page" : undefined} onClick={() => navigate("finance")}>
        <Wallet size={20} strokeWidth={2.2} />
        <span>{t.navFinancial}</span>
      </button>
      <MobileQuickAdd />
    </LiquidGlass>
  );
}
