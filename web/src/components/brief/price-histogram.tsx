import { SatinBlock } from "@/components/knit/satin";
import { binsInBudget, formatPrice, type PriceContext } from "@/lib/brief-model";

const BOX = { width: 560, height: 150, top: 18, bottom: 26 };

interface PriceHistogramProps {
  context: Extract<PriceContext, { available: true }>;
  budget: [number | null, number | null];
}

/**
 * Sale prices of homes like the one wanted, as satin columns, with the budget band laid over them.
 * Every bar shows its count and every axis its numbers, so the chart reads without hovering.
 */
export function PriceHistogram({ context, budget }: PriceHistogramProps) {
  const { bins } = context;
  const lit = binsInBudget(bins, budget);
  const tallest = Math.max(...bins.map((bin) => bin.count), 1);
  const lo = bins[0].from;
  const hi = bins[bins.length - 1].to;
  const plot = BOX.height - BOX.top - BOX.bottom;
  const barWidth = BOX.width / bins.length;
  // Bars are equal width over geometric price ranges, so a price maps to its bar plus the
  // logarithmic share of the way through it.
  const x = (value: number) => {
    if (value <= lo) return 0;
    if (value >= hi) return BOX.width;
    const index = bins.findIndex((bin) => value < bin.to);
    const bin = bins[index];
    return (index + Math.log(value / bin.from) / Math.log(bin.to / bin.from)) * barWidth;
  };
  const [low, high] = budget;
  const label = `${context.sales} sales between ${formatPrice(lo)} and ${formatPrice(hi)}; median ${formatPrice(context.median)}`;
  return (
    <figure className="brief-histogram" data-testid="price-histogram">
      <svg viewBox={`0 0 ${BOX.width} ${BOX.height}`} role="img" aria-label={label}>
        {(low !== null || high !== null) && (
          <rect className="brief-histogram-budget" x={x(low ?? high!)} y={0}
            width={Math.max(x(high ?? low!) - x(low ?? high!), 3)} height={BOX.height - BOX.bottom} />
        )}
        {bins.map((bin, index) => {
          const height = (bin.count / tallest) * plot;
          const top = BOX.top + plot - height;
          return (
            <g key={bin.from}>
              <title>{`${formatPrice(bin.from)}–${formatPrice(bin.to)}: ${bin.count} sales`}</title>
              {bin.count > 0 && (
                <g className={lit[index] ? "brief-bar brief-bar-lit" : "brief-bar"}>
                  <SatinBlock x={index * barWidth + 3} y={top} width={barWidth - 6} height={Math.max(height, 3)}
                    colour={lit[index] ? "var(--chart-1)" : "var(--chart-neutral)"} slant={4} seed={index + 1} />
                </g>
              )}
              {bin.count > 0 && <text x={index * barWidth + barWidth / 2} y={top - 4} textAnchor="middle">{bin.count}</text>}
            </g>
          );
        })}
        <line className="brief-histogram-median" x1={x(context.median)} x2={x(context.median)} y1={BOX.top - 6} y2={BOX.height - BOX.bottom} />
        {bins.map((bin, index) => (
          <text key={`tick-${bin.from}`} x={index * barWidth} y={BOX.height - 8} textAnchor={index === 0 ? "start" : "middle"}>
            {formatPrice(bin.from)}
          </text>
        ))}
        <text x={BOX.width} y={BOX.height - 8} textAnchor="end">{formatPrice(hi)}</text>
      </svg>
      <figcaption className="brief-legend">
        <span><i className="brief-swatch brief-swatch-budget" /> your budget</span>
        <span><i className="brief-swatch brief-swatch-median" /> median {formatPrice(context.median)}</span>
        <span>middle half {formatPrice(context.p25)}–{formatPrice(context.p75)}</span>
        {context.above > 0 && <span>{context.above} dearer {context.above === 1 ? "sale" : "sales"} above {formatPrice(hi)} not drawn</span>}
      </figcaption>
    </figure>
  );
}
