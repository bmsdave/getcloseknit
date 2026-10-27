/**
 * "Typical home price" (migration 040): the middle price of a whole home in an
 * area, adjusted to today, as one map layer with a type-of-home selector. Each type is its own published metric (and value pack), so the
 * layer follows the ordinary value-pack pipeline; the picker lists only the
 * first, and the legend switches between them. Area-level only.
 */
import type { MapLayerId, MetricId } from "./contracts";

export const TYPICAL_PRICE_TYPES = [
  { id: "typical-price", label: "All homes", words: "all homes" },
  { id: "typical-price-flat", label: "Flats", words: "flats" },
  { id: "typical-price-terraced", label: "Terraced", words: "terraced houses" },
  { id: "typical-price-semi", label: "Semi", words: "semi-detached houses" },
  { id: "typical-price-detached", label: "Detached", words: "detached houses" },
] as const satisfies readonly { id: MetricId; label: string; words: string }[];

export type TypicalPriceLayer = (typeof TYPICAL_PRICE_TYPES)[number]["id"];

export const TYPICAL_PRICE_LAYER: TypicalPriceLayer = "typical-price";

export function isTypicalPriceLayer(id: MapLayerId | string): id is TypicalPriceLayer {
  return TYPICAL_PRICE_TYPES.some((type) => type.id === id);
}

/** The per-type layers are reached through the legend's selector, never listed in the picker. */
export function isTypicalPriceVariant(id: MapLayerId | string): boolean {
  return isTypicalPriceLayer(id) && id !== TYPICAL_PRICE_LAYER;
}

/** "flats", "all homes": what the chosen type covers, for captions. */
export function typicalPriceWords(id: TypicalPriceLayer): string {
  return TYPICAL_PRICE_TYPES.find((type) => type.id === id)?.words ?? "all homes";
}
