"use client";

import { useState } from "react";

import { KnitIcon } from "@/components/knit/knit-icon";
import type { GeographyId, PreferenceProfile } from "@/lib/contracts";
import { marksOf, setNote, toggleMark } from "@/lib/match-brief";

/**
 * Flags, not cuts (FLAGS.md): My match's old in-list card held Like it · Not for me · Note marks. The v4 boards
 * (CUJ06, CUJ13) draw the one area view without them, so they are left out; they stay here, off by default,
 * for the area view opened from My match.
 */
export const MATCH_FLAGS: Readonly<Record<"AREA_MARKS", boolean>> = { AREA_MARKS: false };

const mark = (name: string) => <KnitIcon name={name} colour="var(--icon-yarn, currentColor)" className="knit-inline" style={{ width: 13, height: 13 }} />;

/** Like it · Not for me · Note for one area, written to the household's search (liked / excluded / notes). */
export function AreaMarks({ id, profile, onChange }: {
  id: GeographyId; profile: PreferenceProfile; onChange: (profile: PreferenceProfile) => void;
}) {
  const marks = marksOf(profile);
  const note = marks.notes[id] ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  return (
    <div className="area-marks" data-testid="area-marks">
      <button type="button" aria-pressed={marks.liked.includes(id)} onClick={() => onChange(toggleMark(profile, id, "liked"))}>{mark("heart")} Like it</button>
      <button type="button" aria-pressed={marks.excluded.includes(id)} onClick={() => onChange(toggleMark(profile, id, "excluded"))}>{mark("cross")} Not for me</button>
      <button type="button" aria-expanded={editing} onClick={() => { setDraft(note); setEditing(!editing); }}>{mark("note")} {note ? "Edit note" : "Note"}</button>
      {note && !editing && <p className="area-note" data-testid="area-note">{note}</p>}
      {editing && (
        <form className="area-note-form" onSubmit={(event) => { event.preventDefault(); onChange(setNote(profile, id, draft)); setEditing(false); }}>
          <textarea aria-label="Your note about this area" maxLength={280} value={draft} onChange={(event) => setDraft(event.target.value)}
            placeholder="Viewing on Saturday, noisy main road…" />
          <button type="submit">Save note</button>
        </form>
      )}
    </div>
  );
}
