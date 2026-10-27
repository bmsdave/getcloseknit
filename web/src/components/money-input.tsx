"use client";

import { useState, type InputHTMLAttributes } from "react";

import { parseMoneyInput } from "@/lib/housing-cost";

/** "520,000" (or "£520,000" with `pound`); "" for no value. */
export function moneyFieldText(value: number | null, pound = false): string {
  if (value === null || !Number.isFinite(value)) return "";
  return `${pound ? "£" : ""}${Math.round(value).toLocaleString("en-GB")}`;
}

/**
 * A pounds field: a text input with a numeric keypad, never type=number, so the mouse
 * wheel cannot change the figure and phones show no spinner. It reads "£520,000", "520000", "520k"
 * or "0.5m", and shows the figure with thousands commas once you leave it.
 */
export function MoneyInput({ value, onValue, pound = false, onFocus, onBlur, ...rest }: {
  value: number | null;
  onValue: (value: number | null) => void;
  /** Writes "£" into the text; leave off when the £ sits beside the field or in its label. */
  pound?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "inputMode">) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      value={draft ?? moneyFieldText(value, pound)}
      // The typed text is held from the first keystroke, not from focus: a figure that arrives while the field is
      // focused and still untouched (an autofocused budget waiting for a "Like this" area's price band) still shows.
      onFocus={onFocus}
      onBlur={(event) => { setDraft(null); onBlur?.(event); }}
      onChange={(event) => {
        setDraft(event.target.value);
        onValue(parseMoneyInput(event.target.value));
      }}
    />
  );
}
