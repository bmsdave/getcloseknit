"use client";

import { useEffect, useState } from "react";

import { schoolPath, type SchoolCard } from "@/lib/school-card";

import { SchoolCardView } from "./school-card";
import { SchoolLink } from "./school-link";

type Loaded = { urn: string; card: SchoolCard | null };

/**
 * A school opened on the map (its cap, or a school link in the panel): the school's own page content in the
 * side panel (phones: the sheet) in place of the area, read from the same card route as /school/<urn>.
 * "‹ Back" returns to the area; "Open school page" is the full page. The panel's width applies as it does
 * to the area (lib/panel-width.ts); the card's own layout follows that width (container queries).
 */
export function PanelSchool({ urn, from = null, onBack, onLoaded }: {
  urn: string;
  /** The area chosen on the map: the full page says how far the school is from it (?from=). */
  from?: string | null;
  onBack: () => void;
  /** The school's name once read (the phone sheet's peek line), or null when it could not be read. */
  onLoaded?: (name: string | null, at: [number, number] | null) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    let current = true;
    fetch(`/api/v1/schools/${encodeURIComponent(urn)}/card`)
      .then((response) => (response.ok ? response.json() as Promise<SchoolCard> : null))
      .catch(() => null)
      .then((body) => {
        if (!current) return;
        const card = body?.schemaVersion === "school-card.v1" ? body : null;
        setLoaded({ urn, card });
        const { latitude, longitude } = card?.school ?? {};
        onLoaded?.(card?.school.name ?? null,
          Number.isFinite(latitude) && Number.isFinite(longitude) ? [longitude as number, latitude as number] : null);
      });
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urn]);
  const card = loaded?.urn === urn ? loaded.card : undefined;
  return (
    <div className="school-panel" data-testid="school-panel" data-urn={urn}>
      <div className="school-panel__bar">
        <button type="button" className="school-panel__back" data-testid="school-panel-back" onClick={onBack} aria-label="Back to the area">
          ‹ Back
        </button>
        <SchoolLink href={schoolPath(urn, from)} className="school-panel__page" data-full-page="" data-testid="school-panel-page">Open school page ›</SchoolLink>
      </div>
      {card === undefined && <p className="area-section__status" role="status">Loading the school…</p>}
      {card === null && <p className="area-section__status" role="status" data-testid="school-panel-failed">Couldn&apos;t load this school.</p>}
      {card && <SchoolCardView card={card} />}
    </div>
  );
}
