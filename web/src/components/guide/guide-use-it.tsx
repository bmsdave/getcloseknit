"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { KnitIcon } from "@/components/knit/knit-icon";
import { areaPath } from "@/lib/area-pages";
import type { GeographyId } from "@/lib/contracts";
import type { GuideAction } from "@/lib/guide-routes";
import type { DataMode } from "@/lib/map-state";
import { useSaved } from "@/lib/saved-items";
import { fetchSectionJson } from "@/lib/section-fetch";
import { readStandouts, standoutsPath, type StandoutTileId } from "@/lib/standouts";

/** Saved areas the line reads, at most. */
const YOUR_AREAS = 3;

/**
 * The article's "Use it" block, under its answer (board CUJ-11): its layer on the map or its
 * tool (the one primary), a second way to use it, and the reader's saved areas in London words
 * ("More crime than 97%", never x/10). The saved areas live on this device: read after hydration.
 */
export function GuideUseIt({ action, more, tile, mode }: {
  action: GuideAction; more: GuideAction | null; tile: StandoutTileId | null; mode: DataMode;
}) {
  return (
    <section className="guide-use" data-testid="guide-use-it" aria-labelledby="guide-use-title">
      <h2 id="guide-use-title">Use it</h2>
      <div className="guide-use__actions">
        <Link href={action.href} className="primary-action guide-use__primary"
          data-testid={action.kind === "map" ? "guide-see-on-map" : "guide-tool-link"}>
          <KnitIcon name={action.kind === "map" ? "layers" : "arrow-right"} colour="var(--on-primary)" className="guide-use__icon" />
          {action.label}
        </Link>
        {more && (
          <Link href={more.href} className="guide-use__quiet" data-testid="guide-use-more">
            {more.label}<KnitIcon name="arrow-right" className="guide-use__icon" />
          </Link>
        )}
      </div>
      {tile && <YourAreas tile={tile} mode={mode} />}
    </section>
  );
}

type Line = { geographyId: GeographyId; name: string; words: string | null };

function YourAreas({ tile, mode }: { tile: StandoutTileId; mode: DataMode }) {
  const { areas } = useSaved();
  const key = JSON.stringify(areas.filter((area) => area.geographyId.startsWith("uk:lsoa:")).slice(0, YOUR_AREAS)
    .map((area) => [area.geographyId, area.name]));
  const [lines, setLines] = useState<{ key: string; rows: Line[] } | null>(null);
  useEffect(() => {
    const wanted = JSON.parse(key) as [GeographyId, string][];
    if (!wanted.length) return;
    let current = true;
    void Promise.all(wanted.map(([id]) => fetchSectionJson<unknown>(standoutsPath(id)).then((payload) => {
      const found = readStandouts(payload, mode)?.tiles.find((entry) => entry.id === tile);
      return found?.available ? found.display : null;
    }))).then((words) => {
      if (current) setLines({ key, rows: wanted.map(([geographyId, name], index) => ({ geographyId, name, words: words[index] })) });
    });
    return () => { current = false; };
  }, [key, tile, mode]);
  const rows = lines?.key === key ? lines.rows.filter((row) => row.words) : [];
  if (!rows.length) return null;
  return (
    <div className="guide-use__areas" data-testid="guide-your-areas">
      <p className="guide-use__lead">Your areas</p>
      <ul>
        {rows.map((row) => (
          <li key={row.geographyId}>
            <Link href={areaPath({ geographyId: row.geographyId })}>{row.name}</Link>
            <span>{row.words}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
