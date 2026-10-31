import { Check } from "lucide-react";
import { THEMES, themeById, type Theme } from "../../domain/themes";
import { t } from "../../i18n";
import { setTheme, useApp } from "../../state/store";
import { Menu } from "../../ui/primitives";

/** A small disc showing a theme's colours. */
export function ThemeSwatch({ theme, size = 18 }: { theme: Theme; size?: number }) {
  return (
    <span
      className="theme-swatch"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${theme.bg} 0 25%, ${theme.a600} 0 50%, ${theme.a300} 0 75%, ${theme.bg3} 0)`,
      }}
    />
  );
}

/** In the sidebar: shows the current theme and opens the list. */
export function ThemeSwitcher() {
  const current = useApp((s) => s.theme);
  const theme = themeById(current);
  const name = t.themeNames[theme.id];
  return (
    <Menu
      label={t.themeTitle}
      align="start"
      trigger={(p) => (
        <button type="button" className="navitem navitem--small theme-trigger" title={t.themeChange(name)} aria-label={t.themeChange(name)} {...p}>
          <ThemeSwatch theme={theme} />
          <span className="sidebar__label">{name}</span>
        </button>
      )}
      items={THEMES.map((option) => ({
        label: t.themeNames[option.id],
        icon: <ThemeSwatch theme={option} />,
        checked: option.id === current,
        onSelect: () => setTheme(option.id),
      }))}
    />
  );
}

/** In Settings: every theme as a little preview of itself. */
export function ThemeSection() {
  const current = useApp((s) => s.theme);
  return (
    <section className="card settings-section rise" aria-labelledby="set-theme">
      <h2 className="settings-section__title" id="set-theme">
        <ThemeSwatch theme={themeById(current)} size={17} /> {t.themeTitle}
      </h2>
      <p className="field__hint">{t.themeHint}</p>
      <div className="theme-grid" role="radiogroup" aria-labelledby="set-theme">
        {THEMES.map((option) => {
          const on = option.id === current;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`theme-card ${on ? "theme-card--on" : ""}`}
              style={{ background: option.bg, color: option.text, borderColor: on ? option.a400 : undefined }}
              onClick={() => setTheme(option.id)}
            >
              <span className="theme-card__mock" aria-hidden="true">
                <i style={{ background: option.bg3 }} />
                <b style={{ background: option.a600 }} />
                <em style={{ background: option.planGoal }} />
                <u style={{ background: option.planEvent }} />
              </span>
              <strong>{t.themeNames[option.id]}</strong>
              <small style={{ color: option.text2 }}>{t.themeBlurbs[option.id]}</small>
              {on && (
                <span className="theme-card__check" style={{ background: option.a600, color: option.onAccent }}>
                  <Check size={13} strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
