import { CalendarRange, Plus, Settings2, Sun, Target } from "lucide-react";
import { formatDuration } from "../../domain/time";
import { navigate, openComposer, useApp, type View } from "../../state/store";
import { LiquidGlass } from "../../ui/LiquidGlass";

const NAV: { view: View; label: string; icon: typeof Sun; key: string }[] = [
  { view: "today", label: "Today", icon: Sun, key: "1" },
  { view: "goals", label: "Goals", icon: Target, key: "2" },
  { view: "planner", label: "Planner", icon: CalendarRange, key: "3" },
];

export function Sidebar() {
  const view = useApp((s) => s.view);
  const blocks = useApp((s) => s.blocks);
  const today = useApp((s) => s.clock.today);
  const todays = blocks.filter((b) => b.date === today && !b.proposed && b.kind === "task" && b.state !== "skipped");
  const done = todays.filter((b) => b.state === "done");
  const doneMin = done.reduce((s, b) => s + (b.end - b.start), 0);

  return (
    <LiquidGlass as="nav" className="sidebar" radius={28} bezel={20} strength={42} aria-label="Main">
      <div className="sidebar__brand">
        <span className="sidebar__logo" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="22" height="22">
            <circle cx="16" cy="16" r="10.5" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="3.4" />
            <path d="M16 5.5 A10.5 10.5 0 1 1 6.5 20.4" fill="none" stroke="url(#lg-brand)" strokeWidth="3.4" strokeLinecap="round" />
            <circle cx="16" cy="16" r="3.2" fill="#F5F3FF" />
            <defs>
              <linearGradient id="lg-brand" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#EDE9FE" />
                <stop offset="1" stopColor="#7C3AED" />
              </linearGradient>
            </defs>
          </svg>
        </span>
        <span className="sidebar__name">Life OS</span>
      </div>

      <button type="button" className="sidebar__new" onClick={() => openComposer(true)} title="New goal (Ctrl+N)">
        <Plus size={16} />
        <span className="sidebar__label">New goal</span>
      </button>

      <ul className="sidebar__nav">
        {NAV.map(({ view: v, label, icon: Icon, key }) => (
          <li key={v}>
            <button
              type="button"
              className={`navitem ${view === v ? "navitem--active" : ""}`}
              aria-current={view === v ? "page" : undefined}
              onClick={() => navigate(v)}
              title={`${label} (Ctrl+${key})`}
            >
              <Icon size={18} strokeWidth={view === v ? 2.2 : 1.8} />
              <span className="sidebar__label">{label}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="sidebar__spacer" />

      {todays.length > 0 && (
        <div className="sidebar__today sidebar__label-block" aria-label="Today's progress">
          <div className="eyebrow">Today</div>
          <div className="sidebar__today-row tabular">
            <strong>{done.length}</strong>
            <span className="faint">/ {todays.length} sessions</span>
          </div>
          <div className="bar" style={{ height: 4 }}>
            <div className="bar__fill" style={{ width: `${(done.length / todays.length) * 100}%` }} />
          </div>
          {doneMin > 0 && <div className="faint" style={{ fontSize: 12 }}>{formatDuration(doneMin)} focused</div>}
        </div>
      )}

      <button
        type="button"
        className={`navitem navitem--small ${view === "settings" ? "navitem--active" : ""}`}
        aria-current={view === "settings" ? "page" : undefined}
        onClick={() => navigate("settings")}
        title="Settings (Ctrl+,)"
      >
        <Settings2 size={17} strokeWidth={1.8} />
        <span className="sidebar__label">Settings</span>
      </button>
    </LiquidGlass>
  );
}
