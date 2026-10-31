import { Check, CircleAlert, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { dismissToast, useApp } from "../state/store";
import { LiquidGlass } from "./LiquidGlass";

// ---- Button ---------------------------------------------------------------------------

type Variant = "primary" | "glass" | "ghost" | "danger" | "danger-ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  iconOnly?: boolean;
}

export function Button({ variant = "glass", size = "md", icon, iconOnly, className = "", children, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn--${variant} ${size !== "md" ? `btn--${size}` : ""} ${iconOnly ? "btn--icon" : ""} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, active, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button type="button" className={`icon-btn ${active ? "icon-btn--active" : ""} ${className}`} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

// ---- Dialog ---------------------------------------------------------------------------

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide,
  initialFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  initialFocus?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    // Respect autoFocus on a field; otherwise start in the content rather than on the Close button.
    setTimeout(() => {
      if (!el || (!initialFocus && el.contains(document.activeElement))) return;
      const first =
        (initialFocus && el.querySelector<HTMLElement>(initialFocus)) ||
        el.querySelector<HTMLElement>(`.dialog__body :is(${FOCUSABLE})`) ||
        el.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && el) {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
        if (!items.length) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <LiquidGlass
        ref={ref}
        dense
        radius={26}
        strength={22}
        className={`dialog ${wide ? "dialog--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dialog__head">
          <div>
            <h2 className="dialog__title" id={titleId}>
              {title}
            </h2>
            {subtitle && <p className="dialog__sub">{subtitle}</p>}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="dialog__body">{children}</div>
        {footer && <div className="dialog__foot">{footer}</div>}
      </LiquidGlass>
    </div>,
    document.body,
  );
}

// ---- Confirm --------------------------------------------------------------------------

export function Confirm({
  open,
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      initialFocus="[data-cancel]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} data-cancel>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="muted">{message}</p>
    </Dialog>
  );
}

// ---- Menu -----------------------------------------------------------------------------

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function Menu({ trigger, items, label, align = "end" }: { trigger: (props: { onClick: (e: React.MouseEvent) => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => ReactNode; items: (MenuItem | "separator")[]; label: string; align?: "start" | "end" }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const close = useCallback(() => setAnchor(null), []);

  useLayoutEffect(() => {
    if (!anchor || !menuRef.current) return;
    const m = menuRef.current.getBoundingClientRect();
    let left = align === "end" ? anchor.right - m.width : anchor.left;
    left = Math.max(8, Math.min(window.innerWidth - m.width - 8, left));
    let top = anchor.bottom + 6;
    if (top + m.height > window.innerHeight - 8) top = anchor.top - m.height - 6;
    setPos({ top, left });
    menuRef.current.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus();
  }, [anchor, align]);

  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      const list = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? [])];
      const idx = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        list[(idx + 1) % list.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        list[(idx - 1 + list.length) % list.length]?.focus();
      } else if (e.key === "Tab") {
        close();
      }
    };
    const onScroll = () => close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [anchor, close]);

  return (
    <>
      {trigger({
        onClick: (e) => {
          e.stopPropagation();
          setPos(null);
          setAnchor(anchor ? null : (e.currentTarget as HTMLElement).getBoundingClientRect());
        },
        "aria-expanded": !!anchor,
        "aria-haspopup": "menu",
      })}
      {anchor &&
        createPortal(
          <LiquidGlass
            ref={menuRef}
            dense
            radius={16}
            strength={14}
            bezel={10}
            className="menu"
            role="menu"
            aria-label={label}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          >
            {items.map((item, i) =>
              item === "separator" ? (
                <div key={`s${i}`} className="menu__sep" role="separator" />
              ) : (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  className={`menu__item ${item.danger ? "menu__item--danger" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    item.onSelect();
                  }}
                >
                  {item.icon}
                  {item.label}
                </button>
              ),
            )}
          </LiquidGlass>,
          document.body,
        )}
    </>
  );
}

// ---- Segmented control ------------------------------------------------------------------

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
    else setThumb(null);
  }, [value, options.length]);
  const idx = options.findIndex((o) => o.value === value);
  return (
    <div
      ref={ref}
      className="segmented"
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          const next = options[(idx + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length];
          onChange(next.value);
          requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
        }
      }}
    >
      {thumb && <span className="segmented__thumb" style={{ left: thumb.left, width: thumb.width }} />}
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          title={o.title}
          aria-checked={o.value === value}
          tabIndex={o.value === value || (idx === -1 && o === options[0]) ? 0 : -1}
          className="segmented__item"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---- Switch -------------------------------------------------------------------------------

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="switch__thumb" />
    </button>
  );
}

// ---- Field --------------------------------------------------------------------------------

const FieldCtx = createContext<string | undefined>(undefined);
export const useFieldId = () => useContext(FieldCtx);

export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  const id = useId();
  return (
    <FieldCtx.Provider value={id}>
      <div className="field">
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        {children}
        {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
      </div>
    </FieldCtx.Provider>
  );
}

// ---- Progress -------------------------------------------------------------------------------

export function ProgressRing({ value, size = 56, stroke = 6, label }: { value: number; size?: number; stroke?: number; label?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gid = useId().replace(/:/g, "");
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }} role="img" aria-label={`${Math.round(value * 100)}% complete`}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#c4b5fd" />
            <stop offset="1" stopColor="#7c3aed" />
          </linearGradient>
        </defs>
        <circle className="ring__track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="ring__value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))}
        />
      </svg>
      {label != null && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontWeight: 650, fontSize: size * 0.24 }} className="tabular">
          {label}
        </div>
      )}
    </div>
  );
}

export function Bar({ value }: { value: number }) {
  return (
    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div className="bar__fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

// ---- Empty --------------------------------------------------------------------------------------

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <div className="empty__title">{title}</div>
      {text && <div className="empty__text">{text}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

// ---- Toasts ---------------------------------------------------------------------------------------

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <LiquidGlass key={t.id} dense radius={16} strength={12} bezel={10} className={`toast toast--${t.kind}`}>
          <span className="toast__icon">
            {t.kind === "success" ? <Check size={16} /> : t.kind === "error" ? <CircleAlert size={16} /> : <Info size={16} />}
          </span>
          <span style={{ flex: 1 }}>{t.message}</span>
          <IconButton label="Dismiss" onClick={() => dismissToast(t.id)} style={{ width: 22, height: 22, marginTop: -2 }}>
            <X size={14} />
          </IconButton>
        </LiquidGlass>
      ))}
    </div>,
    document.body,
  );
}
