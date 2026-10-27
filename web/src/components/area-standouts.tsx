"use client";

import { useEffect, useState, type MouseEvent } from "react";

import type { GeographyId } from "@/lib/contracts";
import type { DataMode } from "@/lib/map-state";
import { fetchSectionJson } from "@/lib/section-fetch";
import { readStandouts, standoutsPath, stripPosition, stripWords, visibleTiles, type AreaStandouts, type TileView } from "@/lib/standouts";
import { scopeName, type RankScope } from "@/lib/scope-name";
import { mergeTags, type PersonalTag } from "@/lib/area-tailor";

import { Dot } from "./knit";
import { KnitIcon } from "./knit/knit-icon";

/** Each tile's plied-yarn icon: the 12 standouts, then the area layers' (lib/area-layers.ts OVERVIEW_LAYERS). */
const TILE_ICON: Readonly<Record<string, string>> = {
  price: "trend", safety: "crime", schools: "school", "station-walk": "walk", cycling: "bicycle", noise: "noise",
  nature: "tree", air: "heart", gp: "stethoscope", "food-hygiene": "tools-kitchen", nightlife: "cocktail", families: "family",
  "price-per-square-metre": "trend", "station-access": "walk", crime: "crime", "road-collisions": "car", "nature-score": "tree",
  deprivation: "home", income: "income", "social-renting": "fact-tenure",
  "custom:nightlife": "cocktail", "custom:culture": "theatre", "custom:good-coffee": "coffee", "custom:family": "family",
  "custom:gyms": "dumbbell", "custom:cycling": "bicycle", "custom:markets": "shopping-cart", "custom:food-variety": "tools-kitchen",
  "custom:late-night-food": "kebab", "custom:universities": "building-school", "custom:ev-charging": "car",
};

/** Tiles a phone shows before "Show all 12". */
const PHONE_TILES = 6;

/** Areas with tiles, tags and a verdict: neighbourhoods, wider neighbourhoods (MSOAs) and boroughs. */
export function hasStandouts(geographyId: GeographyId): boolean {
  return /^uk:(lsoa|msoa|lad):/.test(geographyId);
}

/**
 * The area's standouts: the server-rendered ones when the page had them (so crawlers and the first
 * paint get the full header and tiles), else read once here. null while loading, "unknown" when none.
 */
export function useStandouts(geographyId: GeographyId, mode: DataMode, initial: AreaStandouts | null = null): AreaStandouts | null | "unknown" {
  const [value, setValue] = useState<AreaStandouts | null | "unknown">(initial);
  useEffect(() => {
    if (initial || !hasStandouts(geographyId)) {
      if (!initial) setValue("unknown");
      return;
    }
    let current = true;
    void fetchSectionJson<unknown>(standoutsPath(geographyId)).then((payload) => {
      if (current) setValue(readStandouts(payload, mode) ?? "unknown");
    });
    return () => { current = false; };
  }, [geographyId, mode, initial]);
  return value;
}

/** A tag or tile link: a plain #section link the page's own handler scrolls under the chips. */
type Go = (section: string, event: MouseEvent<HTMLAnchorElement>) => void;

/**
 * The verdict line and the tags under the name: the household's own first ("Within
 * budget", "Fails: King's Cross 52 min"), then the area's London extremes, at most three green pros
 * and two amber cons. Each tag leads to its section.
 */
export function AreaVerdict({ standouts, personal = [], prefix = "", onGo, href }: {
  standouts: AreaStandouts | null | "unknown"; personal?: readonly PersonalTag[]; prefix?: string; onGo?: Go;
  /** Where a tag leads when its section is not on this page (the map sheet's peek: the full area page). */
  href?: (section: string) => string;
}) {
  const ready = standouts && standouts !== "unknown" ? standouts : null;
  type Shown = { kind: "pro" | "con"; text: string; section: string; mine: boolean };
  const tags = mergeTags<Shown>(personal.map((tag) => ({ ...tag, mine: true })), (ready?.tags ?? []).map((tag) => ({ ...tag, mine: false })));
  if (!ready && tags.length === 0) return null;
  return (
    <div className="area-verdict" data-testid="area-verdict">
      {ready && <p className="area-verdict__line" data-testid="area-verdict-line">{ready.verdict}</p>}
      {tags.length > 0 && (
        <ul className="area-tags" aria-label="What stands out" data-testid="area-tags">
          {tags.map((tag) => (
            <li key={`${tag.kind}-${tag.text}`}>
              <a className="area-tag" data-kind={tag.kind} data-mine={tag.mine ? "" : undefined} href={href ? href(tag.section) : `#${prefix}${tag.section}`}
                data-testid={`area-tag-${tag.kind}`} onClick={(event) => onGo?.(tag.section, event)}>
                <span className="area-tag__sign" aria-hidden="true">{tag.kind === "pro" ? "+" : "−"}</span>
                <span className="sr-only">{tag.kind === "pro" ? "Stands out: " : "Watch out: "}</span>
                {tag.text}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The 12 fixed tiles, the same on every area in one order, so pages compare at a glance: 4×3 on a
 * desktop, two columns and the first six on a phone (all 12 are in the page; "Show all 12" only
 * unfolds them). Each is a title row and a mini London strip; a tile without data says "No data here"
 * and keeps its place.
 */
export function AreaTiles({ standouts, prefix = "", onGo, href, limit }: {
  standouts: { tiles: readonly TileView[]; withheld?: readonly string[]; rankScope?: RankScope | null } | null | "unknown"; prefix?: string; onGo?: Go;
  /** Where a tile leads (the map with its layer on, the full area page); its section on this page when left out. */
  href?: (tile: TileView) => string;
  /** Only the first tiles, two columns, no "Show all" (the map sheet's peek shows 4). */
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  if (standouts === null) {
    return <div className="standout-tiles standout-tiles--loading" data-testid="area-tiles" data-limit={limit} aria-busy="true" />;
  }
  if (standouts === "unknown") return null;
  const tiles = visibleTiles(standouts.tiles, standouts.withheld);
  const shown = limit === undefined ? tiles : tiles.slice(0, limit);
  const scope = scopeName(standouts);
  return (
    <div className="standout-tiles-wrap" id={`${prefix}overview`} data-testid="evidence-summary">
      <ul className="standout-tiles" data-testid="area-tiles" data-all={all ? "" : undefined} data-limit={limit} aria-label="At a glance">
        {shown.map((tile, index) => (
          <li key={tile.id} data-phone-extra={limit === undefined && index >= PHONE_TILES ? "" : undefined}>
            <StandoutTileCard tile={tile} href={href ? href(tile) : `#${prefix}${tile.section}`} onGo={onGo} scope={scope} />
          </li>
        ))}
      </ul>
      {limit === undefined && (
        <button type="button" className="text-button standout-tiles__more" aria-expanded={all} data-testid="area-tiles-more" onClick={() => setAll(!all)}>
          {all ? `Show first ${PHONE_TILES}` : `Show all ${tiles.length}`}
        </button>
      )}
    </div>
  );
}

/**
 * A tile's arrow: from its percent (half a per cent or more), or from its direction alone when there is no
 * percent (a rise from zero); null when flat or without a trend.
 */
export function tileTrend(tile: Pick<TileView, "trend">): { up: boolean; title: string; spoken: string } | null {
  const trend = tile.trend;
  if (!trend) return null;
  const { percent, years } = trend;
  if (percent === null) {
    if (trend.direction !== "up" && trend.direction !== "down") return null;
    const up = trend.direction === "up";
    return { up, title: `${up ? "Up" : "Down"} in ${years} year`, spoken: `${up ? "up" : "down"} in a year` };
  }
  if (Math.abs(percent) < 0.5) return null;
  const up = percent > 0;
  return { up, title: `${up ? "+" : "−"}${Math.abs(percent)}% in ${years} year`, spoken: `${up ? "up" : "down"} ${Math.abs(percent)}% in a year` };
}

function StandoutTileCard({ tile, href, onGo, scope }: { tile: TileView; href: string; onGo?: Go; scope: string }) {
  const trend = tileTrend(tile);
  return (
    <a className="standout-tile" href={href} data-testid={`area-tile-${tile.id}`} data-extreme={tile.extreme ?? undefined}
      data-empty={tile.available ? undefined : ""} onClick={(event) => { if (tile.section) onGo?.(tile.section, event); }}>
      <span className="standout-tile__head">
        <KnitIcon name={TILE_ICON[tile.id] ?? "dot"} colour="var(--muted)" className="standout-tile__icon" />
        <span className="standout-tile__label">{tile.label}</span>
        <span className="standout-tile__value">
          {tile.available ? tile.display : "No data here"}
          {trend && (
            <span className="standout-tile__trend" title={trend.title}>
              <KnitIcon name={trend.up ? "rise" : "fall"} colour="currentColor" className="standout-tile__arrow" />
              <span className="sr-only">{trend.spoken}</span>
            </span>
          )}
        </span>
      </span>
      <LondonStrip tile={tile} scope={scope} />
    </a>
  );
}

/**
 * A mini strip against the area's region (`scope`, London by default): a felt track, the region's middle as a
 * tick, this area as a dot (the better end on the right; for price and nightlife simply the higher). The dot is
 * green in the region's best 10%, amber in its worst. Never a gradient.
 */
export function LondonStrip({ tile, scope = "London" }: { tile: TileView; scope?: string }) {
  const position = tile.available ? stripPosition(tile) : null;
  const tone = tile.extreme === "pro" ? "var(--pro)" : tile.extreme === "con" ? "var(--con)" : "var(--ink)";
  return (
    <span className="london-strip" role="img" aria-label={position === null ? `No ${scope} rank` : stripWords(tile, scope)} data-testid="london-strip">
      <span className="london-strip__track" />
      <span className="london-strip__middle" title={`${scope}'s middle`} />
      {position !== null && (
        <span className="london-strip__dot" style={{ left: `${position}%` }}><Dot colour={tone} size={12} /></span>
      )}
    </span>
  );
}
