import { CalendarRange, LayoutGrid, Languages, Leaf, Moon, Plus, Settings2, Sun, Target, Wallet } from "lucide-react";
import { num } from "../../domain/locale";
import { formatDuration } from "../../domain/time";
import { t } from "../../i18n";
import { navigate, openComposer, openRelaxPicker, setLanguage, setPlannerMode, useApp, type View } from "../../state/store";
import { LiquidGlass } from "../../ui/LiquidGlass";
import { ThemeSwitcher } from "./ThemeSwitcher";

const NAV: { view: View; label: () => string; icon: typeof Sun; key: string }[] = [
  { view: "today", label: () => t.navHome, icon: Sun, key: "1" },
  { view: "week", label: () => t.navWeek, icon: LayoutGrid, key: "2" },
  { view: "planner", label: () => t.navPlanner, icon: CalendarRange, key: "3" },
  { view: "goals", label: () => t.navGoals, icon: Target, key: "4" },
];


export function Sidebar() {
  const view = useApp((s) => s.view);
  const blocks = useApp((s) => s.blocks);
  const today = useApp((s) => s.clock.today);
  const lang = useApp((s) => s.lang);
  const todays = blocks.filter((b) => b.date === today && !b.proposed && b.kind === "task" && b.state !== "skipped");
  const done = todays.filter((b) => b.state === "done");
  const doneMin = done.reduce((s, b) => s + (b.end - b.start), 0);

  return (
    <LiquidGlass as="nav" className="sidebar" radius={28} bezel={20} strength={42} aria-label={t.navMain}>
      <div className="sidebar__brand">
        <span className="sidebar__logo" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="22" height="22">
            <circle cx="16" cy="16" r="10.5" fill="none" style={{ stroke: "var(--line-strong)" }} strokeWidth="3.4" />
            <path d="M16 5.5 A10.5 10.5 0 1 1 6.5 20.4" fill="none" stroke="url(#lg-brand)" strokeWidth="3.4" strokeLinecap="round" />
            <circle cx="16" cy="16" r="3.2" style={{ fill: "var(--text)" }} />
            <defs>
              <linearGradient id="lg-brand" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" style={{ stopColor: "var(--violet-300)" }} />
                <stop offset="1" style={{ stopColor: "var(--violet-600)" }} />
              </linearGradient>
            </defs>
          </svg>
        </span>
        <span className="sidebar__name">Life OS</span>
      </div>

      <button type="button" className="sidebar__new" onClick={() => openComposer(true)} title={`${t.newGoal} (Ctrl+N)`}>
        <Plus size={16} />
        <span className="sidebar__label">{t.newGoal}</span>
      </button>

      <ul className="sidebar__nav">
        {NAV.map(({ view: v, label, icon: Icon, key }) => (
          <li key={v}>
            <button
              type="button"
              className={`navitem ${view === v ? "navitem--active" : ""}`}
              aria-current={view === v ? "page" : undefined}
              onClick={() => {
                if (v === "planner") setPlannerMode("plans");
                navigate(v);
              }}
              title={`${label()} (Ctrl+${key})`}
            >
              <Icon size={18} strokeWidth={view === v ? 2.2 : 1.8} />
              <span className="sidebar__label">{label()}</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="navitem navitem--off" disabled title={t.soon}>
            <Wallet size={18} strokeWidth={1.8} />
            <span className="sidebar__label">{t.navFinancial}</span>
            <span className="navitem__soon">{t.soon}</span>
          </button>
        </li>
        <li>
          <button type="button" className="navitem" title={t.navRelax} onClick={openRelaxPicker}>
            <Leaf size={18} strokeWidth={1.8} />
            <span className="sidebar__label">{t.navRelax}</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className={`navitem ${view === "dreams" ? "navitem--active" : ""}`}
            aria-current={view === "dreams" ? "page" : undefined}
            title={t.navDreams}
            onClick={() => navigate("dreams")}
          >
            <Moon size={18} strokeWidth={view === "dreams" ? 2.2 : 1.8} />
            <span className="sidebar__label">{t.navDreams}</span>
          </button>
        </li>
      </ul>

      <div className="sidebar__spacer" />

      {todays.length > 0 && (
        <div className="sidebar__today sidebar__label-block" aria-label={t.sidebarProgress}>
          <div className="eyebrow">{t.todayShort}</div>
          <div className="sidebar__today-row tabular">
            <strong>{num(done.length)}</strong>
            <span className="faint">{t.sidebarSessions(todays.length)}</span>
          </div>
          <div className="bar" style={{ height: 4 }}>
            <div className="bar__fill" style={{ width: `${(done.length / todays.length) * 100}%` }} />
          </div>
          {doneMin > 0 && <div className="faint" style={{ fontSize: 12 }}>{t.sidebarFocused(formatDuration(doneMin))}</div>}
        </div>
      )}

      <ThemeSwitcher />

      <button
        type="button"
        className="navitem navitem--small"
        lang={lang === "fa" ? "en" : "fa"}
        onClick={() => setLanguage(lang === "fa" ? "en" : "fa")}
        title={t.languageSwitchTitle}
        aria-label={t.languageSwitchTitle}
      >
        <Languages size={17} strokeWidth={1.8} />
        <span className="sidebar__label">{t.languageSwitch}</span>
      </button>

      <button
        type="button"
        className={`navitem navitem--small ${view === "settings" ? "navitem--active" : ""}`}
        aria-current={view === "settings" ? "page" : undefined}
        onClick={() => navigate("settings")}
        title={`${t.navSettings} (Ctrl+,)`}
      >
        <Settings2 size={17} strokeWidth={1.8} />
        <span className="sidebar__label">{t.navSettings}</span>
      </button>
    </LiquidGlass>
  );
}
