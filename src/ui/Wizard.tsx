import { Check } from "lucide-react";
import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { num } from "../domain/locale";
import { t } from "../i18n";
import { Button, Dialog } from "./primitives";

/** Moves focus into each step as it appears, so typing and Enter just work. */
function useStepFocus(step: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      (el.querySelector<HTMLElement>("input, textarea, [data-step-focus]") ?? el.querySelector<HTMLElement>("button"))?.focus();
    }, 60);
    return () => clearTimeout(timer);
  }, [step]);
  return ref;
}

/**
 * One question at a time: a progress bar, a sliding step, and Back / Continue.
 * The owner keeps the answers and decides when a step may move on.
 */
export function Wizard({
  open,
  onClose,
  title,
  step,
  total,
  direction,
  onBack,
  onNext,
  nextLabel = t.continue,
  nextDisabled,
  hideFooter,
  huge,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  step: number;
  total: number;
  direction: 1 | -1;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  hideFooter?: boolean;
  huge?: boolean;
  children: ReactNode;
}) {
  const ref = useStepFocus(step);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!nextDisabled) onNext?.();
  };
  const shown = Math.min(step + 1, total);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      huge={huge}
      title={title}
      footer={
        hideFooter ? undefined : (
          <>
            {onBack && (
              <Button variant="ghost" onClick={onBack}>
                {t.back}
              </Button>
            )}
            <span className="spacer" />
            <Button variant="primary" onClick={onNext} disabled={nextDisabled}>
              {nextLabel}
            </Button>
          </>
        )
      }
    >
      <div className="wiz-progress" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={shown} aria-label={t.stepOf(num(shown), num(total))}>
        <div className="wiz-progress__fill" style={{ width: `${(shown / total) * 100}%` }} />
      </div>
      <form onSubmit={submit}>
        <div ref={ref} key={step} className={`wiz-step wiz-step--${direction === 1 ? "next" : "prev"}`}>
          {children}
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function WizardQuestion({ title, hint }: { title: ReactNode; hint?: ReactNode }) {
  return (
    <div className="wiz-q">
      <h3 className="wiz-q__title">{title}</h3>
      {hint && <p className="wiz-q__hint">{hint}</p>}
    </div>
  );
}

export function WizardError({ children }: { children: ReactNode }) {
  return (
    <p className="wiz-error" role="alert">
      {children}
    </p>
  );
}

/** The closing step: a check that draws itself and a short message. */
export function WizardDone({ title, children, action }: { title: ReactNode; children?: ReactNode; action: ReactNode }) {
  return (
    <div className="wiz-done">
      <span className="wiz-done__check" aria-hidden="true">
        <Check size={34} strokeWidth={2.6} />
      </span>
      <h3 className="wiz-q__title">{title}</h3>
      {children}
      <div className="wiz-done__action">{action}</div>
    </div>
  );
}
