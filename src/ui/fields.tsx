import { useEffect, useState, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { formatClock, parseClock } from "../domain/time";
import { useFieldId } from "./primitives";

export function TextInput({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const id = useFieldId();
  return <input id={id} className={`input ${className}`} {...rest} />;
}

export function TextArea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useFieldId();
  return <textarea id={id} className={`textarea ${className}`} {...rest} />;
}

export function SelectInput({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useFieldId();
  return (
    <select id={id} className={`select ${className}`} {...rest}>
      {children}
    </select>
  );
}

/** Time of day as minutes; uses the native time picker. */
export function TimeInput({ value, onChange, allowEmpty, ...rest }: { value: number | null; onChange: (v: number | null) => void; allowEmpty?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const id = useFieldId();
  return (
    <input
      id={id}
      type="time"
      className="input"
      value={value == null ? "" : formatClock(value === 1440 ? 1439 : value)}
      onChange={(e) => {
        if (!e.target.value) {
          if (allowEmpty) onChange(null);
          return;
        }
        const v = parseClock(e.target.value);
        if (v != null) onChange(v);
      }}
      {...rest}
    />
  );
}

export function DateInput({ value, onChange, ...rest }: { value: string | null; onChange: (v: string | null) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const id = useFieldId();
  return <input id={id} type="date" className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} {...rest} />;
}

/** Number input that only commits valid integers within bounds. */
export function NumberInput({ value, onChange, min, max, suffix, ...rest }: { value: number; onChange: (v: number) => void; min: number; max: number; suffix?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min" | "max">) {
  const id = useFieldId();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const n = Number(text);
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
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(v) && v >= min && v <= max) onChange(Math.round(v));
        }}
        onBlur={() => setText(String(value))}
        style={suffix ? { paddingRight: 44 } : undefined}
        {...rest}
      />
      {suffix && (
        <span className="faint" style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%)", fontSize: 12, pointerEvents: "none" }}>
          {suffix}
        </span>
      )}
    </div>
  );
}
