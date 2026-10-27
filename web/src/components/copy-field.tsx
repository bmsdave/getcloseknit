"use client";

import { useState } from "react";

import { KnitIcon } from "./knit/knit-icon";

/**
 * A value to paste somewhere else (a URL, a few commands): shown whole in a
 * monospace field that selects in one click, with a calm Copy button beside it.
 */
export function CopyField({ value, label, testId, multiline = false }: {
  value: string;
  /** What is copied, for the button's accessible name. */
  label: string;
  testId?: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className={`copy-field${multiline ? " copy-field--multiline" : ""}`}>
      {multiline
        ? <pre className="copy-field__value"><code data-testid={testId}>{value}</code></pre>
        : <code className="copy-field__value" data-testid={testId}>{value}</code>}
      <button type="button" className="copy-field__button" onClick={copy} aria-label={`Copy ${label}`}>
        <KnitIcon name={copied ? "check" : "note"} className="copy-field__icon" />
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}
