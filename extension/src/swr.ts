// Stale-while-revalidate for the listing card: the last card per listing (and, for its area's facts, per ~150 m
// cell) is kept in the background for an hour, shown at once, and refreshed from the server behind it.
import type { Card, CardBlock, ListingFacts } from "./types";

export const KEEP_MS = 60 * 60 * 1000;
/** A kept card younger than this is shown without asking the server again. */
export const REVALIDATE_MS = 60 * 1000;
const MAX_ENTRIES = 300;
/** ~150 m: a degree of latitude is ~111 km, a degree of longitude ~69 km at London's latitude. */
const CELL_LAT = 150 / 111_000;
const CELL_LNG = 150 / 69_000;
/** Blocks about the area, not the home: what a neighbour's card can show while this one loads. */
const AREA_BLOCKS = new Set(["header", "match", "cta", "facts", "footnote", "summary"]);
/** Summary groups about the area (the search's fit and places, "Before you offer"); the rest wait for this home. */
const AREA_GROUPS = new Set(["For your search", "Before you offer"]);

type Summary = Extract<CardBlock, { type: "summary" }>;

export interface Kept {
  card: Card;
  age: number;
  /** From a neighbour in the same cell: the home's own rows are placeholders until the server answers. */
  provisional: boolean;
}

/** The ~150 m grid cell of the listing's point, or null without one. */
export function cellOf(facts: Pick<ListingFacts, "lat" | "lng">): string | null {
  if (facts.lat === null || facts.lng === null || !Number.isFinite(facts.lat) || !Number.isFinite(facts.lng)) return null;
  return `${Math.floor(facts.lat / CELL_LAT)}:${Math.floor(facts.lng / CELL_LNG)}`;
}

export class CardMemory {
  private readonly listings = new Map<string, { at: number; card: Card }>();
  private readonly cells = new Map<string, { at: number; card: Card }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** This listing's last card, else an area-only card from its cell; null when neither is under an hour old. */
  get(facts: ListingFacts, profile: string): Kept | null {
    const own = this.fresh(this.listings, listingKey(facts, profile));
    if (own) return { card: own.card, age: this.now() - own.at, provisional: false };
    const cell = cellOf(facts);
    const near = cell ? this.fresh(this.cells, cellKey(cell, facts, profile)) : null;
    const card = near ? areaOnly(near.card) : null;
    return near && card ? { card, age: this.now() - near.at, provisional: true } : null;
  }

  /** Keeps a server card (errors are not kept). */
  set(facts: ListingFacts, profile: string, card: Card): void {
    if (card.status === "error") return;
    const entry = { at: this.now(), card };
    put(this.listings, listingKey(facts, profile), entry);
    const cell = cellOf(facts);
    if (cell && card.status === "ok") put(this.cells, cellKey(cell, facts, profile), entry);
  }

  clear(): void {
    this.listings.clear();
    this.cells.clear();
  }

  private fresh(map: Map<string, { at: number; card: Card }>, key: string) {
    const entry = map.get(key);
    if (!entry) return null;
    if (this.now() - entry.at >= KEEP_MS) {
      map.delete(key);
      return null;
    }
    return entry;
  }
}

function listingKey(facts: ListingFacts, profile: string): string {
  return `${facts.portal}:${facts.listingId}:${profile}`;
}

function cellKey(cell: string, facts: ListingFacts, profile: string): string {
  return `${cell}:${facts.market}:${profile}`;
}

/** Newest last; the oldest goes once there are too many. */
function put<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value as string);
}

/**
 * A neighbour's card cut to what is about the area: its header, match, facts and summary pills. The summary's
 * home-specific groups keep their place with placeholder rows, so the panel does not jump when this home's card
 * arrives. Null when the neighbour's card has nothing to show.
 */
export function areaOnly(card: Card): Card | null {
  if (card.status !== "ok") return null;
  const blocks = card.blocks.filter((b) => AREA_BLOCKS.has(b.type)).map((b) => b.type === "summary" ? pendingHome(b as Summary) : b);
  return blocks.length ? { ...card, blocks } : null;
}

function pendingHome(summary: Summary): Summary {
  return {
    ...summary,
    groups: summary.groups.map((group) => AREA_GROUPS.has(group.title) ? group
      : { ...group, rows: (group.rows ?? []).map(() => ({ label: "", value: "", pending: true })) }),
  };
}

/** What the page shows while the first card loads: the summary panel's usual shape, all placeholders. */
export function skeletonCard(): Card {
  const rows = (n: number) => Array.from({ length: n }, () => ({ label: "", value: "", pending: true }));
  return {
    v: 1, status: "ok", pending: true,
    blocks: [
      { type: "header", title: "Reading the area…", subtitle: "" },
      {
        type: "summary",
        groups: [2, 3, 3, 3].map((n) => ({ title: "", only: false, rows: rows(n) })),
        pills: Array.from({ length: 5 }, () => ({ label: "", value: "", band: null, pending: true })),
      },
    ],
  } as Card;
}
