"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { showMapToast } from "@/lib/map-toast";

/**
 * Show's sub-options, one layout for every Show item: indented under the item, each option
 * group is a small label on its own line, then a segmented control or a chip list that wraps inside
 * the panel (never a fixed width, never past its edge). Buttons are 44 px targets.
 *
 *   <SubGroup label="Colour by"><Segmented options={…} value={…} onChange={…} /></SubGroup>
 *   <ChipList label="Type" options={…} picked={…} onToggle={…} onAll={…} onNone={…} />
 */
export function SubGroup({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  const id = useId();
  return (
    <div className="show-sub__group" role="group" aria-labelledby={id} data-testid={testId}>
      <span className="show-sub__label" id={id}>{label}</span>
      {children}
    </div>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange }: {
  options: readonly { id: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div className="show-sub__seg">
      {options.map((option) => (
        <button key={String(option.id)} type="button" aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A chip list with "All · None" (as Road collisions); emptied, the map toast says "Pick at least one.". */
export function ChipList<T extends string>({ label, options, picked, onToggle, onAll, onNone, testId }: {
  label: string;
  options: readonly { id: T; label: string }[];
  picked: readonly T[];
  onToggle: (id: T) => void;
  onAll: () => void;
  onNone: () => void;
  testId?: string;
}) {
  const id = useId();
  const count = options.filter((option) => picked.includes(option.id)).length;
  const before = useRef(count);
  useEffect(() => {
    if (count === 0 && before.current > 0) showMapToast("Pick at least one.", { ms: 4000, kind: "pick-one" });
    before.current = count;
  }, [count]);
  return (
    <div className="show-sub__group" role="group" aria-labelledby={id} data-testid={testId}>
      <div className="show-sub__head">
        <span className="show-sub__label" id={id}>{label}</span>
        <button type="button" className="show-sub__action" disabled={count === options.length} aria-label={`${label}: all`} onClick={onAll}>All</button>
        <span aria-hidden="true">·</span>
        <button type="button" className="show-sub__action" disabled={count === 0} aria-label={`${label}: none`} onClick={onNone}>None</button>
      </div>
      <div className="show-sub__chips" data-empty={count === 0 || undefined}>
        {options.map((option) => (
          <button key={option.id} type="button" aria-pressed={picked.includes(option.id)} onClick={() => onToggle(option.id)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
