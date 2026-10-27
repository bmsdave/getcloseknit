/**
 * Crime category filtering (map-level): the headline rate is rescaled to the
 * selected categories' share of the recorded breakdown. Excluding everything
 * suppresses the value (grey) rather than showing a false zero; a missing
 * breakdown falls back to the headline rate because there is nothing to
 * split.
 */

export function crimeCategories(
  values: readonly { breakdown?: Record<string, number> }[],
): string[] {
  const names = new Set<string>();
  for (const entry of values) {
    for (const category of Object.keys(entry.breakdown ?? {})) names.add(category);
  }
  return [...names].sort((left, right) => left.localeCompare(right, "en-GB"));
}

export function filteredCrimeValue(
  value: number | null,
  breakdown: Record<string, number> | undefined,
  included: readonly string[],
): number | null {
  if (value === null) return null;
  if (included.length === 0) return null;
  if (!breakdown) return value;
  const total = Object.values(breakdown).reduce((sum, count) => sum + count, 0);
  if (total <= 0) return value;
  const selected = included.reduce((sum, category) => sum + (breakdown[category] ?? 0), 0);
  return Math.round((value * selected) / total * 100) / 100;
}

export function toggleCrimeCategory(included: readonly string[], category: string): string[] {
  return included.includes(category)
    ? included.filter((item) => item !== category)
    : [...included, category];
}

export function isCrimeFilterActive(included: readonly string[], all: readonly string[]): boolean {
  return included.length !== all.length || all.some((category) => !included.includes(category));
}
