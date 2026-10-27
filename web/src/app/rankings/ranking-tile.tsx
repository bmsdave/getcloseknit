"use client";

import Link from "next/link";
import { useState } from "react";

import { SatinMeter } from "@/components/ramp-knit";
import type { RankingPreviewRow } from "@/lib/area-pages";

/** One choice of a tile: a ranking's page (or /area/london for Boroughs), its title, level and top three. */
export interface TileVariant {
  slug: string | null;
  href?: string;
  title: string;
  level: "Areas" | "Schools" | "Boroughs";
  top: RankingPreviewRow[];
}

/**
 * A tile on /rankings: a short name, a mirror-pair switch (Highest | Lowest) and a
 * type switch (Flat | Terraced …) where the ranking has them. The whole tile opens the full ranking
 * and shows its top three with satin mini bars, on a phone and a desktop alike.
 * `variants[pair][type]`; a choice with no data (null) is disabled.
 */
export function RankingTileCard({ id, label, typeLabels, pair, types, yarn, variants, start = 0 }: {
  id: string;
  label: string;
  /** The short name per type ("Typical flat price"), else `label`. */
  typeLabels?: readonly string[];
  pair?: readonly [string, string];
  types?: readonly string[];
  yarn: string;
  variants: (TileVariant | null)[][];
  /** The pair choice it opens on: the layer's good end (lib/area-pages.ts tileGoodPair). */
  start?: number;
}) {
  const first = firstChoice(variants, start);
  const [choice, setChoice] = useState(first);
  // A choice with no data falls back to the first one that has it.
  const at = variants[choice.pair]?.[choice.type] ? choice : first;
  const shown = variants[at.pair][at.type]!;
  const href = shown.slug ? `/rankings/${shown.slug}` : shown.href ?? "/rankings";
  const max = Math.max(0, ...shown.top.map((row) => row.value ?? 0));
  return (
    <li className="rankings-tile" data-testid={`ranking-tile-${id}`}>
      <div className="rankings-tile__row">
        {/* The short name (board CUJ04 step 1: "Grade 5+ English & maths"); the full title for screen readers. */}
        <Link href={href} className="rankings-tile__name" title={shown.title} data-testid="ranking-tile-link">
          <span className="rankings-tile__short" aria-hidden="true">{typeLabels?.[at.type] ?? label}</span>
          <span className="sr-only">{shown.title}</span>
        </Link>
        <span className="rankings-tile__level">{shown.level}</span>
      </div>
      {(pair || types) && (
        <div className="rankings-tile__switches">
          {pair && (
            <Switch label={`${label}: order`} options={pair} current={choice.pair}
              enabled={(index) => Boolean(variants[index]?.[choice.type])} onPick={(index) => setChoice({ ...choice, pair: index })} />
          )}
          {types && (
            <Switch label={`${label}: type`} options={types} current={choice.type}
              enabled={(index) => Boolean(variants[choice.pair]?.[index])} onPick={(index) => setChoice({ ...choice, type: index })} />
          )}
        </div>
      )}
      {shown.top.length > 0 && (
        <ol className="rankings-tile__top" aria-label={`Top ${shown.top.length}`}>
          {shown.top.map((row, index) => (
            <li key={`${row.name}-${index}`}>
              <span className="rankings-tile__rank">{index + 1}.</span>
              <span className="rankings-tile__area">{row.name}</span>
              {row.value !== null && max > 0 && (
                <SatinMeter value={row.value / max} colour={yarn} width={56} height={8} className="rankings-tile__bar" />
              )}
              <span className="rankings-tile__value">{row.display}</span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function Switch({ label, options, current, enabled, onPick }: {
  label: string; options: readonly string[]; current: number; enabled: (index: number) => boolean; onPick: (index: number) => void;
}) {
  return (
    <div className="rankings-seg" role="group" aria-label={label}>
      {options.map((option, index) => (
        <button key={option} type="button" aria-pressed={current === index} disabled={!enabled(index)} onClick={() => onPick(index)}>{option}</button>
      ))}
    </div>
  );
}

function firstChoice(variants: (TileVariant | null)[][], start: number): { pair: number; type: number } {
  const opening = variants[start]?.findIndex(Boolean) ?? -1;
  if (opening >= 0) return { pair: start, type: opening };
  for (const [pair, row] of variants.entries()) {
    const type = row.findIndex(Boolean);
    if (type >= 0) return { pair, type };
  }
  return { pair: 0, type: 0 };
}
