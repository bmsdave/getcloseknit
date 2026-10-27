/**
 * Six ready-made comparisons with a short label, an icon and a yarn. The map's "Explore:" chip row is gone
 * (every comparison is in "Colour the map by", components/map-data-selector.tsx); the yarn still paints
 * those comparisons' ramps (custom-criteria.ts), and turning a comparison off returns to the layer before.
 */
import type { MapLayerId } from "./contracts";
import type { CustomCriterion } from "./custom-criteria";
import { CUSTOM_PRESETS, type CustomPreset } from "./custom-presets";
import { DEFAULT_MAP_STATE } from "./map-state";

export interface ExploreChip {
  presetId: string;
  /** A thread icon (lib/thread-icons.ts). */
  icon: string;
  /** Its yarn: a --yarn-* token. */
  yarn?: string;
  label: string;
}

export const EXPLORE_CHIPS: readonly ExploreChip[] = [
  { presetId: "good-coffee", icon: "coffee", yarn: "var(--yarn-tangerine)", label: "Specialty coffee" },
  { presetId: "good-coffee-kebab", icon: "kebab", yarn: "var(--yarn-cherry)", label: "Coffee vs kebab" },
  { presetId: "gyms", icon: "dumbbell", yarn: "var(--yarn-cobalt)", label: "Gyms" },
  { presetId: "nightlife", icon: "cocktail", yarn: "var(--yarn-pink)", label: "Nightlife" },
  { presetId: "culture", icon: "theatre", yarn: "var(--yarn-sky)", label: "Culture" },
  { presetId: "family", icon: "family", yarn: "var(--yarn-sun)", label: "Families" },
];

/** Each chip with the preset it paints; a chip naming a preset that does not exist is a programming error. */
export function exploreChipPresets(chips: readonly ExploreChip[] = EXPLORE_CHIPS): (ExploreChip & { preset: CustomPreset })[] {
  return chips.map((chip) => {
    const preset = CUSTOM_PRESETS.find((entry) => entry.criterion.id === chip.presetId);
    if (!preset) throw new Error(`Explore chip "${chip.label}" names no preset "${chip.presetId}"`);
    return { ...chip, preset };
  });
}

/** The yarn a chip paints its layer in (its --yarn-* token), so the chip, legend and map ramp match; null off the chips. */
export function exploreChipYarn(criterionId: string): string | null {
  return EXPLORE_CHIPS.find((chip) => chip.presetId === criterionId)?.yarn ?? null;
}

/** A tap on a chip: show its criterion, or (the chip already on) turn it off, which is `null`. */
export function toggleExplore(active: CustomCriterion | null, tapped: CustomCriterion): CustomCriterion | null {
  return active?.id === tapped.id ? null : tapped;
}

/** Where turning a comparison off lands: the layer on before it, else the map's default layer (a cold shared link). */
export function layerAfterExplore(before: MapLayerId | null): MapLayerId {
  return before ?? DEFAULT_MAP_STATE.layer;
}
