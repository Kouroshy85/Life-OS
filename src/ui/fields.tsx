import { useEffect, useState, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { num, toLatinDigits } from "../domain/locale";
import { digitsOnly, timeChars } from "../domain/text";
import { formatClock, parseClock } from "../domain/time";
import { useFieldId } from "./primitives";

export { DateInput } from "./DatePicker";

export function TextInput({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const id = useFieldId();
  return <input id={id} dir="auto" className={`input ${className}`} {...rest} />;
}

export function TextArea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useFieldId();
  return <textarea id={id} dir="auto" className={`textarea ${className}`} {...rest} />;
}

export function SelectInput({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useFieldId();
  return (
    <select id={id} className={`select ${className}`} {...rest}>
      {children}
    </select>
  );
}

/**
 * Time of day as minutes, typed as HH:MM on a 24-hour clock. A text field rather
 * than the native picker, which would ignore the app language and digits.
 */
export function TimeInput({ value, onChange, allowEmpty, className = "", ...rest }: { value: number | null; onChange: (v: number | null) => void; allowEmpty?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const id = useFieldId();
  const shown = value == null ? "" : formatClock(value);
  const [text, setText] = useState(shown);
  // Never rewrite what's being typed: only follow changes that came from outside.
  useEffect(() => setText((cur) => (parseClock(cur) === value || (value == null && cur.trim() !== "") ? cur : shown)), [shown, value]);
  const empty = text.trim() === "";
  const invalid = empty ? !allowEmpty : parseClock(text) == null;
  return (
    <input
      id={id}
      dir="ltr"
      inputMode="numeric"
      className={`input tabular ${className}`}
      placeholder={num("00:00")}
      aria-invalid={invalid}
      value={text}
      onChange={(e) => {
        const clean = timeChars(e.target.value);
        setText(clean);
        if (clean === "") {
          if (allowEmpty) onChange(null);
          return;
        }
        const v = parseClock(clean);
        // A half-typed time must not leave the previous value quietly in place.
        if (v != null || allowEmpty) onChange(v);
      }}
      onBlur={() => setText(shown)}
      {...rest}
    />
  );
}

/** Number input that only commits valid integers within bounds. Accepts Persian digits. */
export function NumberInput({ value, onChange, min, max, suffix, ...rest }: { value: number; onChange: (v: number) => void; min: number; max: number; suffix?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min" | "max">) {
  const id = useFieldId();
  const [text, setText] = useState(num(value));
  useEffect(() => setText(num(value)), [value]);
  const n = Number(toLatinDigits(text));
  const invalid = text.trim() === "" || !Number.isFinite(n) || n < min || n > max;
  return (
    <div style={{ position: "relative" }}>
      <input
        id={id}
        inputMode="numeric"
        className="input tabular"
        aria-invalid={invalid}
        value={text}
        onChange={(e) => {
          const clean = digitsOnly(e.target.value);
          setText(clean);
          const v = Number(toLatinDigits(clean));
          if (clean !== "" && Number.isFinite(v) && v >= min && v <= max) onChange(v);
        }}
        onBlur={() => setText(num(value))}
        style={suffix ? { paddingInlineEnd: 56 } : undefined}
        {...rest}
      />
      {suffix && (
        <span className="faint" style={{ position: "absolute", insetInlineEnd: 13, top: "50%", transform: "translateY(-50%)", fontSize: 12, pointerEvents: "none" }}>
          {suffix}
        </span>
      )}
    </div>
  );
}
