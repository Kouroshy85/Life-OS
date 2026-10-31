import { useEffect, useState } from "react";
import type { Preferences } from "../../domain/types";
import { t } from "../../i18n";
import { savePrefs, useApp, validatePrefs } from "../../state/store";
import { NumberInput, TimeInput } from "../../ui/fields";
import { Button, Dialog, Field } from "../../ui/primitives";

export function PrefsFields({ value, onChange }: { value: Preferences; onChange: (p: Preferences) => void }) {
  const set = (patch: Partial<Preferences>) => onChange({ ...value, ...patch });
  return (
    <div className="prefs-grid">
      <fieldset className="prefs-group">
        <legend>{t.workingHours}</legend>
        <div className="field-row">
          <Field label={t.commitStart}>
            <TimeInput value={value.workStart} onChange={(v) => v != null && set({ workStart: v })} />
          </Field>
          <Field label={t.commitEnd}>
            <TimeInput value={value.workEnd} onChange={(v) => v != null && set({ workEnd: v })} />
          </Field>
        </div>
      </fieldset>
      <fieldset className="prefs-group">
        <legend>{t.focusHours}</legend>
        <div className="field-row">
          <Field label={t.from}>
            <TimeInput value={value.focusStart} onChange={(v) => v != null && set({ focusStart: v })} />
          </Field>
          <Field label={t.until}>
            <TimeInput value={value.focusEnd} onChange={(v) => v != null && set({ focusEnd: v })} />
          </Field>
        </div>
        <p className="field__hint">{t.focusHint}</p>
      </fieldset>
      <fieldset className="prefs-group">
        <legend>{t.pacing}</legend>
        <div className="field-row">
          <Field label={t.breakAfter} hint={t.breakAfterHint}>
            <NumberInput value={value.breakAfterMin} min={0} max={300} suffix={t.min} onChange={(v) => set({ breakAfterMin: v })} />
          </Field>
          <Field label={t.breakLength}>
            <NumberInput value={value.breakLengthMin} min={5} max={60} suffix={t.min} onChange={(v) => set({ breakLengthMin: v })} />
          </Field>
          <Field label={t.bufferBetween}>
            <NumberInput value={value.bufferMin} min={0} max={60} suffix={t.min} onChange={(v) => set({ bufferMin: v })} />
          </Field>
        </div>
      </fieldset>
      <fieldset className="prefs-group">
        <legend>{t.tasksGroup}</legend>
        <div className="field-row">
          <Field label={t.shortestSession} hint={t.shortestSessionHint}>
            <NumberInput value={value.minSessionMin} min={10} max={180} suffix={t.min} onChange={(v) => set({ minSessionMin: v })} />
          </Field>
          <Field label={t.defaultDuration}>
            <NumberInput value={value.defaultEstimateMin} min={5} max={480} suffix={t.min} onChange={(v) => set({ defaultEstimateMin: v })} />
          </Field>
        </div>
      </fieldset>
    </div>
  );
}

export function PrefsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prefs = useApp((s) => s.prefs);
  const [draft, setDraft] = useState(prefs);
  useEffect(() => {
    if (open) setDraft(prefs);
  }, [open, prefs]);
  const error = validatePrefs(draft);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={t.planningPrefs}
      subtitle={t.prefsSub}
      footer={
        <>
          {error && <span className="field__error" style={{ marginInlineEnd: "auto" }}>{error}</span>}
          <Button variant="ghost" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={!!error}
            onClick={async () => {
              if (await savePrefs(draft)) onClose();
            }}
          >
            {t.save}
          </Button>
        </>
      }
    >
      <PrefsFields value={draft} onChange={setDraft} />
    </Dialog>
  );
}
