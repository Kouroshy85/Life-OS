import { useEffect, useRef, useState } from "react";
import { hasLetters } from "../domain/text";

/** Text that edits in place: Enter or blur saves, Escape reverts. Empty values are refused. */
export function InlineText({
  value,
  onSave,
  className = "",
  label,
  multiline = false,
  placeholder,
  allowEmpty = false,
  maxLength = 200,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
  label: string;
  multiline?: boolean;
  placeholder?: string;
  allowEmpty?: boolean;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const v = draft.trim();
    if (v ? !allowEmpty && !hasLetters(v) : !allowEmpty) {
      setDraft(value);
      return;
    }
    if (v !== value) onSave(v);
  };
  const props = {
    ref,
    dir: "auto",
    "aria-label": label,
    className: `input input--bare inline-text ${className}`,
    value: draft,
    placeholder,
    maxLength,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (!multiline || !e.shiftKey)) {
        e.preventDefault();
        (e.target as HTMLElement).blur();
      }
      if (e.key === "Escape") {
        e.stopPropagation();
        setDraft(value);
        requestAnimationFrame(() => ref.current?.blur());
      }
    },
  };
  return multiline ? <textarea rows={1} {...props} /> : <input {...props} />;
}
