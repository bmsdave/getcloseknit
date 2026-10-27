"use client";

/** Opens the browser's print dialog (print CSS hides this button). */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className="no-print" data-testid="print-button" onClick={() => window.print()}>
      {label}
    </button>
  );
}
