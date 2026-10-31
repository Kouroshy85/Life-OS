import { useEffect, useState } from "react";
import type { Preferences } from "../../domain/types";
import { savePrefs, useApp, validatePrefs } from "../../state/store";
import { NumberInput, TimeInput } from "../../ui/fields";
import { Button, Dialog, Field } from "../../ui/primitives";

export function PrefsFields({ value, onChange }: { value: Preferences; onChange: (p: Preferences) => void }) {
  const set = (patch: Partial<Preferences>) => onChange({ ...value, ...patch });
  return (
    <div className="prefs-grid">
      <fieldset className="prefs-group">
        <legend>Working hours</legend>
        <div className="field-row">
          <Field label="Start">
            <TimeInput value={value.workStart} onChange={(v) => v != null && set({ workStart: v })} />
          </Field>
          <Field label="End">
            <TimeInput value={value.workEnd} onChange={(v) => v != null && set({ workEnd: v })} />
          </Field>
        </div>
      </fieldset>
      <fieldset className="prefs-group">
        <legend>Focus hours</legend>
        <div className="field-row">
          <Field label="From">
            <TimeInput value={value.focusStart} onChange={(v) => v != null && set({ focusStart: v })} />
          </Field>
          <Field label="Until">
            <TimeInput value={value.focusEnd} onChange={(v) => v != null && set({ focusEnd: v })} />
          </Field>
        </div>
        <p className="field__hint">Deep-focus tasks are placed here first; low-energy tasks stay out of it.</p>
      </fieldset>
      <fieldset className="prefs-group">
        <legend>Pacing</legend>
        <div className="field-row">
          <Field label="Break after" hint="0 disables automatic breaks">
            <NumberInput value={value.breakAfterMin} min={0} max={300} suffix="min" onChange={(v) => set({ breakAfterMin: v })} />
          </Field>
          <Field label="Break length">
            <NumberInput value={value.breakLengthMin} min={5} max={60} suffix="min" onChange={(v) => set({ breakLengthMin: v })} />
          </Field>
          <Field label="Buffer between tasks">
            <NumberInput value={value.bufferMin} min={0} max={60} suffix="min" onChange={(v) => set({ bufferMin: v })} />
          </Field>
        </div>
      </fieldset>
      <fieldset className="prefs-group">
        <legend>Tasks</legend>
        <div className="field-row">
          <Field label="Shortest session" hint="Long tasks split into sessions no shorter than this">
            <NumberInput value={value.minSessionMin} min={10} max={180} suffix="min" onChange={(v) => set({ minSessionMin: v })} />
          </Field>
          <Field label="Default duration">
            <NumberInput value={value.defaultEstimateMin} min={5} max={480} suffix="min" onChange={(v) => set({ defaultEstimateMin: v })} />
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
      title="Planning preferences"
      subtitle="The scheduler uses these to build realistic days. Changes apply the next time you plan."
      footer={
        <>
          {error && <span className="field__error" style={{ marginRight: "auto" }}>{error}</span>}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!!error}
            onClick={async () => {
              if (await savePrefs(draft)) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <PrefsFields value={draft} onChange={setDraft} />
    </Dialog>
  );
}
