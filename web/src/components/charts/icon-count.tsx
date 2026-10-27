import { KnitIcon } from "@/components/knit/knit-icon";
import type { ChartTone } from "@/lib/chart-geometry";

/** Icon names IconCount draws (thread icons in lib/thread-icons.ts); any other name falls back to a loop. */
export const CHART_ICON_NAMES = ["school", "building-school", "baby-carriage", "train", "bus", "tree", "shopping-cart", "beer",
  "tools-kitchen", "pill", "stethoscope", "home", "book"];

const TONES: ChartTone[] = ["c1", "c2", "c3", "c4", "c5", "c6"];
const MAX_ICONS = 10;

/** A knitted glyph in the text colour (or `colour`), boxed by .chart-icon like the old line icons. */
export function ChartIcon({ name, colour = "var(--icon-yarn, currentColor)" }: { name: string; colour?: string }) {
  return <KnitIcon name={name} colour={colour} />;
}

/**
 * Counts drawn as repeated icons with the number beside them ("3 primary ·
 * 1 secondary"). Each group takes the next categorical colour; past ten
 * icons the rest show as "+n".
 */
export function IconCount({ groups, label }: { groups: { id: string; label: string; count: number; icon: string }[]; label: string }) {
  const sentence = groups.map((group) => `${group.count} ${group.label}`).join(", ");
  return (
    <div className="chart chart-icons" role="img" aria-label={`${label}: ${sentence}`}>
      {groups.map((group, index) => (
        <span key={group.id} className="chart-icons__group" data-chart-tone={TONES[index % TONES.length]} data-zero={group.count === 0 ? "" : undefined}>
          {group.count > 0 && (
            <span className="chart-icons__glyphs">
              {Array.from({ length: Math.min(group.count, MAX_ICONS) }, (_, n) => <ChartIcon key={n} name={group.icon} colour="var(--tone)" />)}
              {group.count > MAX_ICONS && <span className="chart-icons__more">+{group.count - MAX_ICONS}</span>}
            </span>
          )}
          <span className="chart-icons__count"><strong>{group.count}</strong> {group.label}</span>
        </span>
      ))}
    </div>
  );
}
