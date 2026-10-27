"use client";

import { useState } from "react";

import type { PreferenceProfile } from "@/lib/contracts";
import { shareReviewLines, type ShareInclusions } from "@/lib/saved-shortlists";
import "../styles/share-review.css";

/**
 * The review before a shortlist or brief link is made (the CUJ-08 pattern): what the link
 * carries, and the private parts (budget, exact places, notes) left out unless ticked. Nothing is made
 * or copied until Confirm share.
 */
export function ShareReview({ profile, candidates, notes = false, onConfirm, onCancel }: {
  profile: PreferenceProfile;
  /** The areas' names, as the link shows them. */
  candidates: string[];
  /** The shortlist has its own note. */
  notes?: boolean;
  onConfirm: (inclusions: ShareInclusions) => void;
  onCancel: () => void;
}) {
  const [inclusions, setInclusions] = useState<ShareInclusions>({});
  const lines = shareReviewLines(profile, candidates, inclusions, notes);
  const hasPlaces = shareReviewLines(profile, candidates, { includeDestinations: true }, notes).shared.some((line) => line.startsWith("Exact places"));
  const hasNotes = notes || Object.keys(profile.marks?.notes ?? {}).length > 0;
  const toggle = (key: keyof ShareInclusions, label: string) => (
    <label>
      <input type="checkbox" checked={Boolean(inclusions[key])} data-testid={`share-include-${key}`}
        onChange={(event) => setInclusions({ ...inclusions, [key]: event.target.checked })} />
      {label}
    </label>
  );
  return (
    <div className="share-preview" data-testid="share-review" role="dialog" aria-label="Review before sharing">
      <h3>Review before sharing</h3>
      <p>Left out unless you tick it. Nothing is shared until you confirm.</p>
      <ul data-testid="share-review-shared">
        {lines.shared.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <fieldset className="share-review__include">
        <legend>Also include</legend>
        {toggle("includeBudget", "Budget")}
        {hasPlaces && toggle("includeDestinations", "Exact places")}
        {hasNotes && toggle("includeNotes", "Private notes")}
      </fieldset>
      {lines.left.length > 0 && (
        <p data-testid="share-review-left">Left out: {lines.left.join(" · ")}</p>
      )}
      <div className="share-preview-actions">
        <button type="button" data-testid="share-review-confirm" onClick={() => onConfirm(inclusions)}>Confirm share</button>
        <button type="button" onClick={onCancel}>Cancel share</button>
      </div>
    </div>
  );
}
