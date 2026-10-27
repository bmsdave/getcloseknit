import { segmentFill, segmentTone, type ScoreDirection } from "@/lib/chart-geometry";

import { SatinBlocks } from "@/components/ramp-knit";

import { ChartUnknown } from "./chart-unknown";

/**
 * A 1–10 score as ten segments. tone says which end is worrying: only then
 * do filled segments turn bad / good; "neutral" stays one calm colour. The
 * count of filled segments carries the value, so colour is never the only cue.
 * Satin: each segment is its own block, 3px apart; unfilled ones are --wool felt.
 */
export function SegmentScore({ score, tone, label }: { score: number | null; tone: ScoreDirection; label: string }) {
  if (score === null) return <ChartUnknown />;
  const filled = segmentFill(score);
  const blocks = Array.from({ length: 10 }, (_, index) => (index < filled ? "var(--tone)" : null));
  return (
    <div className="chart chart-segments" role="img" aria-label={`${label}: ${filled} out of 10`} data-chart-tone={segmentTone(filled, tone)}>
      <SatinBlocks colours={blocks} width={240} height={14} className="chart-segments__satin" />
    </div>
  );
}
