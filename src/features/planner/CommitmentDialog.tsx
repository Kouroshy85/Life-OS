import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Commitment, DateKey } from "../../domain/types";
import { weekdayOf } from "../../domain/time";
import { newId, nowIso } from "../../persistence/repository";
import { deleteCommitment, saveCommitment, validateCommitment } from "../../state/store";
import { DateInput, TextInput, TimeInput } from "../../ui/fields";
import { Button, Dialog, Field, Segmented } from "../../ui/primitives";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CommitmentDialog({ open, onClose, commitment, date }: { open: boolean; onClose: () => void; commitment: Commitment | null; date: DateKey }) {
  const [form, setForm] = useState<Commitment | null>(null);
  const [repeat, setRepeat] = useState<"once" | "weekly">("once");

  useEffect(() => {
    if (!open) return;
    if (commitment) {
      setForm(commitment);
      setRepeat(commitment.date ? "once" : "weekly");
    } else {
      setForm({ id: newId(), title: "", kind: "commitment", date, weekdays: 1 << weekdayOf(date), start: 14 * 60, end: 15 * 60, createdAt: nowIso() });
      setRepeat("once");
    }
  }, [open, commitment, date]);

  if (!form) return null;
  const effective: Commitment = repeat === "once" ? { ...form, date: form.date ?? date, weekdays: 0 } : { ...form, date: null };
  const error = form.title.trim() || commitment ? validateCommitment(effective) : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={commitment ? "Edit commitment" : "Add a fixed commitment"}
      subtitle="The planner never schedules over commitments or breaks. Existing plans that collide are recalculated."
      footer={
        <>
          {commitment && (
            <Button
              variant="danger-ghost"
              icon={<Trash2 size={15} />}
              onClick={async () => {
                await deleteCommitment(commitment.id);
                onClose();
              }}
            >
              Delete
            </Button>
          )}
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!!validateCommitment(effective)}
            onClick={async () => {
              if (await saveCommitment(effective)) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <Field label="Name" error={error}>
        <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Lecture, Gym, Lunch" maxLength={80} autoFocus />
      </Field>
      <div className="field">
        <span className="field__label">Type</span>
        <Segmented
          label="Type"
          value={form.kind}
          onChange={(v) => setForm({ ...form, kind: v })}
          options={[
            { value: "commitment", label: "Commitment" },
            { value: "break", label: "Break" },
          ]}
        />
      </div>
      <div className="field-row">
        <Field label="Start">
          <TimeInput value={form.start} onChange={(v) => v != null && setForm({ ...form, start: v })} />
        </Field>
        <Field label="End">
          <TimeInput value={form.end} onChange={(v) => v != null && setForm({ ...form, end: v })} />
        </Field>
      </div>
      <div className="field">
        <span className="field__label">Repeats</span>
        <Segmented
          label="Repeats"
          value={repeat}
          onChange={setRepeat}
          options={[
            { value: "once", label: "One day" },
            { value: "weekly", label: "Weekly" },
          ]}
        />
      </div>
      {repeat === "once" ? (
        <Field label="Date">
          <DateInput value={form.date ?? date} onChange={(v) => setForm({ ...form, date: v })} />
        </Field>
      ) : (
        <div className="field">
          <span className="field__label">On</span>
          <div className="weekdays" role="group" aria-label="Weekdays">
            {DAYS.map((d, i) => {
              const on = (form.weekdays & (1 << i)) !== 0;
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  className={`weekday ${on ? "weekday--on" : ""}`}
                  onClick={() => setForm({ ...form, weekdays: form.weekdays ^ (1 << i) })}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Dialog>
  );
}
