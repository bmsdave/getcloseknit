import Link from "next/link";

import { HelpTip } from "@/components/help-tip";
import { SatinBlock } from "@/components/knit/satin";
import {
  areaUsed,
  bridgeSentence,
  positionSentence,
  priceSpan,
  rangeSentence,
  shortPounds,
  POSITION_BANDS,
  type AreaPriceRange,
  type AreaPrices,
  type PositionBand,
} from "@/lib/property-profile";

/** Band words for the chart's accessible description, low to high. */
const BAND_WORDS: Record<PositionBand, string> = {
  "bottom-10": "bottom 10%", "bottom-quarter": "bottom quarter", "lower-middle": "lower middle",
  "upper-middle": "upper middle", "top-quarter": "top quarter", "top-10": "top 10%",
};
/** Relative widths: the open-ended tails are drawn a little narrower than the four closed bands. */
const WEIGHTS = [0.7, 1, 1, 1, 1, 0.7];
const WIDTH = 360;
const HEIGHT = 16;
const GAP = 3;

function bandSpans(range: AreaPriceRange): { band: PositionBand; from: number | null; to: number | null }[] {
  const edges = [null, range.p10, range.p25, range.p50, range.p75, range.p90, null];
  return POSITION_BANDS.map((band, index) => ({ band, from: edges[index], to: edges[index + 1] }));
}

/**
 * Today's same-type prices in the area as six satin blocks (bottom 10% to top
 * 10%) with the price at each boundary as text. The middle half is stitched
 * in sky and the tails stay plain felt; the band of this home's last sale,
 * when known, in cobalt (never alarm red). Not a scale for one
 * home: there is no marker.
 */
export function PriceBandStrip({ range, highlight }: { range: AreaPriceRange; highlight: PositionBand | null }) {
  const total = WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  const usable = WIDTH - GAP * (WEIGHTS.length - 1);
  let x = 0;
  const blocks = WEIGHTS.map((weight, index) => {
    const start = x;
    const width = (weight / total) * usable;
    x += width + GAP;
    return { start, width, band: POSITION_BANDS[index] };
  });
  const spans = bandSpans(range);
  const description = `Prices today: ${spans.map((span) => `${BAND_WORDS[span.band]} ${priceSpan(span.from, span.to)}`).join(", ")}`;
  return (
    <figure className="price-bands" role="img" aria-label={description} data-testid="area-prices-chart"
      data-highlight={highlight ?? "middle-half"}>
      <svg className="price-bands__strip" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        {blocks.map(({ start, width, band }, index) => {
          const middle = band === "lower-middle" || band === "upper-middle";
          const colour = band === highlight ? "var(--yarn-cobalt)" : middle ? "var(--yarn-sky)" : null;
          return colour
            ? <SatinBlock key={band} x={start} y={0} width={width} height={HEIGHT} colour={colour} slant={4} seed={index + 3} />
            : <rect key={band} x={start} y={0} width={width} height={HEIGHT} rx={2.5} style={{ fill: "var(--wool)" }} />;
        })}
      </svg>
      <div className="price-bands__ticks" aria-hidden="true">
        {blocks.slice(1).map(({ start }, index) => (
          <span key={index} style={{ left: `${((start - GAP / 2) / WIDTH) * 100}%` }}>
            {shortPounds([range.p10, range.p25, range.p50, range.p75, range.p90][index])}
          </span>
        ))}
      </div>
      <figcaption className="price-bands__key">
        <span><i className="price-bands__swatch price-bands__swatch--middle" /> Middle half</span>
        {highlight && <span><i className="price-bands__swatch price-bands__swatch--home" /> Band of this home&apos;s last sale</span>}
      </figcaption>
    </figure>
  );
}

/**
 * "Prices in this area today": what same-type homes in the area sell for now,
 * and where this home's last recorded sale sat in its year. About the area,
 * never a figure for this home (owner decision); below 5 sales it
 * shows only a short note, and the recorded sales stay in their own card.
 */
export function AreaPricesCard({ prices }: { prices: AreaPrices }) {
  const range = prices.range;
  const lead = rangeSentence(prices);
  const position = positionSentence(prices);
  const bridge = bridgeSentence(prices);
  return (
    <section className="property-card area-prices" data-testid="area-prices" aria-labelledby="area-prices-heading">
      <h2 id="area-prices-heading">Prices in this area today <HelpTip id="area-prices" /></h2>
      {range && lead ? (
        <>
          <p className="area-prices__lead" data-testid="area-prices-range">{lead}</p>
          <p className="property-meta" data-testid="area-prices-area">Sales in {areaUsed(range)}</p>
          <PriceBandStrip range={range} highlight={prices.position?.band ?? null} />
          {position && <p className="area-prices__position" data-testid="area-prices-position">{position}</p>}
          {bridge && <p className="area-prices__bridge" data-testid="area-prices-bridge">{bridge}</p>}
        </>
      ) : (
        <p className="area-prices__none" data-testid="area-prices-none">{prices.note ?? "Not enough sales of this type nearby to show a range."}</p>
      )}
      <p className="area-prices__footer" data-testid="area-prices-footer">{prices.disclaimer}</p>
      <p className="property-meta">
        <Link href="/guide/typical-price" data-testid="area-prices-guide">How these ranges are worked out</Link>
      </p>
    </section>
  );
}
