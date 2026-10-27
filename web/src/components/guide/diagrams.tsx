import type { ReactNode } from "react";

import { SatinBlock } from "../knit/satin";

/*
 * Guide article diagrams. Every colour comes from a theme token through the
 * gd-* classes in styles/guide.css, so each picture reads in every interface
 * theme (light and Night). Text never sits on an accent fill: accent colours
 * change lightness between themes, ink and on-ink always contrast.
 *
 * Formula boxes are felt patches with the figure as plain text on the felt
 * (never on threads), and no stitch: running stitches are for the primary and
 * the chosen tag only (DESIGN.md §0). Bars are satin stitch
 * (components/knit/satin.tsx) in --chart-1.
 */

/** The satin colour of a diagram's bars: a chart token, 3:1 on the panel in both themes. */
const SATIN = "var(--chart-1)";

const WIDTH = 400;

function Diagram({ label, height, children }: { label: string; height: number; children: ReactNode }) {
  return (
    <svg className="gd" viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={label} data-testid="guide-diagram">
      {children}
    </svg>
  );
}

/** A felt patch: chip, or ink for the result. */
function Patch({ x, y, width, height, strong = false }: { x: number; y: number; width: number; height: number; strong?: boolean }) {
  return (
    <g className={strong ? "gd-patch gd-patch--strong" : "gd-patch"}>
      <rect x={x} y={y} width={width} height={height} rx={12} className="gd-patch__felt" />
    </g>
  );
}

/** A labelled box: a big figure on a patch with a small caption under it. */
function ValueBox({ x, y, width, value, caption, strong = false }: {
  x: number; y: number; width: number; value: string; caption: string; strong?: boolean;
}) {
  return (
    <g>
      <Patch x={x} y={y} width={width} height={64} strong={strong} />
      <text x={x + width / 2} y={y + 40} textAnchor="middle" className={strong ? "gd-big gd-on-ink" : "gd-big"}>{value}</text>
      <text x={x + width / 2} y={y + 86} textAnchor="middle" className="gd-small gd-muted">{caption}</text>
    </g>
  );
}

function Operator({ x, y, sign }: { x: number; y: number; sign: string }) {
  return <text x={x} y={y} textAnchor="middle" className="gd-big gd-muted">{sign}</text>;
}

export function NestingDiagram() {
  const lsoa = (x: number, y: number, selected = false) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width={68} height={50} rx={6} className={selected ? "gd-paper gd-stroke-strong" : "gd-paper"} />
      <text x={x + 34} y={y + 30} textAnchor="middle" className="gd-small">{selected ? "your LSOA" : "LSOA"}</text>
    </g>
  );
  return (
    <Diagram label="A borough contains MSOAs, and each MSOA contains several LSOAs" height={236}>
      <rect x={6} y={8} width={388} height={222} rx={14} className="gd-chip" />
      <text x={22} y={32} className="gd-label">Borough</text>
      {[20, 206].map((x) => (
        <g key={x}>
          <rect x={x} y={44} width={174} height={174} rx={10} className="gd-surface gd-stroke-dashed" />
          <text x={x + 12} y={64} className="gd-label">MSOA</text>
        </g>
      ))}
      {lsoa(32, 78, true)}{lsoa(112, 78)}{lsoa(32, 156)}{lsoa(112, 156)}
      {lsoa(218, 78)}{lsoa(298, 78)}{lsoa(218, 156)}{lsoa(298, 156)}
    </Diagram>
  );
}

export function HomeCostDiagram() {
  return (
    <Diagram label="70 square metres times £8,000 per square metre is about £560,000" height={120}>
      <ValueBox x={4} y={8} width={100} value="70 m²" caption="floor area" />
      <Operator x={122} y={48} sign="×" />
      <ValueBox x={140} y={8} width={110} value="£8,000" caption="typical £ per m²" />
      <Operator x={268} y={48} sign="=" />
      <ValueBox x={286} y={8} width={110} value="£560k" caption="rough home cost" strong />
    </Diagram>
  );
}

const SORTED_SALES = [5_900, 6_800, 7_200, 7_600, 8_000, 8_400, 9_100, 9_800, 11_000];

export function MedianDiagram() {
  const x = (value: number) => 30 + ((value - 5_000) / 7_000) * 340;
  const middle = SORTED_SALES[Math.floor(SORTED_SALES.length / 2)];
  return (
    <Diagram label="Nine sales sorted by price per square metre; the middle one, £8,000, is the median" height={170}>
      <text x={200} y={24} textAnchor="middle" className="gd-label">£480,000 ÷ 60 m² = £8,000 per m²</text>
      <text x={200} y={44} textAnchor="middle" className="gd-small gd-muted">one sale; repeat for every sale in the area</text>
      <line x1={20} x2={380} y1={110} y2={110} className="gd-axis" />
      {SORTED_SALES.map((value) => (
        <circle key={value} cx={x(value)} cy={110} r={value === middle ? 10 : 7}
          className={value === middle ? "gd-ink" : "gd-accent"} />
      ))}
      <text x={x(middle)} y={86} textAnchor="middle" className="gd-label">median</text>
      <text x={20} y={140} className="gd-small gd-muted">£5k / m²</text>
      <text x={380} y={140} textAnchor="end" className="gd-small gd-muted">£12k / m²</text>
      <text x={200} y={162} textAnchor="middle" className="gd-small gd-muted">half the sales are cheaper, half dearer</text>
    </Diagram>
  );
}

const TREND = [[30, 150], [55, 141], [80, 146], [105, 122], [130, 118], [155, 101], [180, 93], [205, 80]];
const MAP_CELLS = ["rise", "rise", "flat", "rise", "fall", "rise", "flat", "fall", "rise"] as const;

export function TrendDiagram() {
  return (
    <Diagram label="A price line rising 25% over five years, and a small map with up arrows where prices rose and down arrows where they fell" height={214}>
      <line x1={20} x2={220} y1={176} y2={176} className="gd-axis" />
      <polyline points={TREND.map((point) => point.join(",")).join(" ")} className="gd-trend" />
      <circle cx={30} cy={150} r={6} className="gd-ink" />
      <circle cx={205} cy={80} r={6} className="gd-ink" />
      <text x={30} y={134} className="gd-small">£6,400</text>
      <text x={205} y={64} textAnchor="end" className="gd-small">£8,000</text>
      <text x={130} y={88} textAnchor="middle" className="gd-label">+25%</text>
      <text x={30} y={196} className="gd-small gd-muted">5 years ago</text>
      <text x={205} y={196} textAnchor="end" className="gd-small gd-muted">now</text>
      <text x={312} y={22} textAnchor="middle" className="gd-small gd-muted">on the map</text>
      {MAP_CELLS.map((kind, index) => {
        const x = 246 + (index % 3) * 46;
        const y = 34 + Math.floor(index / 3) * 46;
        return (
          <g key={index}>
            <rect x={x} y={y} width={42} height={42} rx={6} className={`gd-${kind}`} />
            <text x={x + 21} y={y + 27} textAnchor="middle" className={kind === "flat" ? "gd-label" : "gd-label gd-on-trend"}>
              {kind === "rise" ? "▲" : kind === "fall" ? "▼" : "–"}
            </text>
          </g>
        );
      })}
      <text x={246} y={196} className="gd-small gd-muted">▲ dearer  ▼ cheaper</text>
    </Diagram>
  );
}

/** Deterministic "sales": month position and £/m², no randomness at render. */
const SCATTER = Array.from({ length: 34 }, (_, index) => {
  const x = 30 + ((index * 97) % 340);
  const wobble = ((index * 53) % 41) - 20;
  return { x, y: 112 - (x - 30) * 0.12 + wobble };
});

export function RollingMedianDiagram() {
  const windowStart = 210;
  const inWindow = SCATTER.filter((point) => point.x >= windowStart).map((point) => point.y).sort((a, b) => a - b);
  const medianY = inWindow[Math.floor(inWindow.length / 2)];
  return (
    <Diagram label="Each dot is one sale. The median of the sales in the last 12 months is the area's price per square metre" height={196}>
      <rect x={windowStart - 6} y={22} width={186} height={144} rx={8} className="gd-chip" />
      <text x={windowStart + 87} y={16} textAnchor="middle" className="gd-small gd-muted">last 12 months</text>
      {SCATTER.map((point, index) => (
        <circle key={index} cx={point.x} cy={point.y} r={4.5} className={point.x >= windowStart ? "gd-ink" : "gd-muted-dot"} />
      ))}
      <line x1={windowStart} x2={384} y1={medianY} y2={medianY} className="gd-median" />
      <text x={windowStart - 12} y={medianY + 4} textAnchor="end" className="gd-label">median</text>
      <line x1={20} x2={390} y1={172} y2={172} className="gd-axis" />
      <text x={20} y={190} className="gd-small gd-muted">2 years ago</text>
      <text x={390} y={190} textAnchor="end" className="gd-small gd-muted">now</text>
    </Diagram>
  );
}

/** Six bands of today's same-type sales in an area; the middle half stitched, one band picked out. */
export function PriceBandsDiagram() {
  const edges = ["£430k", "£520k", "£620k", "£760k", "£905k"];
  const words = ["bottom 10%", "bottom ¼", "lower middle", "upper middle", "top ¼", "top 10%"];
  const width = 392 / 6;
  return (
    <Diagram label="Flat sales in an area today, adjusted to today, in six bands: bottom 10% below £430k, bottom quarter £430k to £520k, lower middle £520k to £620k, upper middle £620k to £760k, top quarter £760k to £905k, top 10% above £905k. The middle half, £520k to £760k, is stitched" height={110}>
      {words.map((word, index) => {
        const x = 4 + index * width;
        const middle = index === 2 || index === 3;
        return (
          <g key={word}>
            {middle
              // As on the property page: the middle half in sky, the band picked out in cobalt.
              ? <SatinBlock x={x} y={30} width={width - 3} height={22} colour={index === 3 ? "var(--yarn-cobalt)" : "var(--yarn-sky)"} slant={5} seed={index + 2} />
              : <rect x={x} y={30} width={width - 3} height={22} rx={3} className="gd-patch" />}
            <text x={x + (width - 3) / 2} y={20} textAnchor="middle" className="gd-small gd-muted">{word}</text>
          </g>
        );
      })}
      {edges.map((edge, index) => (
        <text key={edge} x={4 + (index + 1) * width - 1.5} y={72} textAnchor="middle" className="gd-small">{edge}</text>
      ))}
      <text x={200} y={100} textAnchor="middle" className="gd-small gd-muted">stitched: the middle half · cobalt: one band picked out</text>
    </Diagram>
  );
}

export function CrimeRateDiagram() {
  return (
    <Diagram label="54 crimes in a year among 1,800 residents is 30 crimes per 1,000 residents" height={120}>
      <ValueBox x={4} y={8} width={100} value="54" caption="crimes in a year" />
      <Operator x={122} y={48} sign="÷" />
      <ValueBox x={140} y={8} width={110} value="1,800" caption="residents" />
      <Operator x={268} y={48} sign="=" />
      <ValueBox x={286} y={8} width={110} value="30" caption="per 1,000 people" strong />
    </Diagram>
  );
}

export function DecileDiagram() {
  const chosen = 6;
  return (
    <Diagram label="A bar split into ten deciles from 1, most deprived, to 10, least deprived; this area is in decile 6" height={130}>
      {Array.from({ length: 10 }, (_, index) => {
        const decile = index + 1;
        const x = 20 + index * 36;
        return (
          <g key={decile}>
            <rect x={x} y={44} width={34} height={34} rx={4} className={decile === chosen ? "gd-ink" : "gd-chip"} />
            <text x={x + 17} y={66} textAnchor="middle" className={decile === chosen ? "gd-small gd-on-ink" : "gd-small"}>{decile}</text>
          </g>
        );
      })}
      <text x={20 + (chosen - 1) * 36 + 17} y={32} textAnchor="middle" className="gd-label">this area</text>
      <text x={20} y={102} className="gd-small gd-muted">← most deprived 10%</text>
      <text x={380} y={102} textAnchor="end" className="gd-small gd-muted">least deprived 10% →</text>
    </Diagram>
  );
}

export function SharedEstimateDiagram() {
  return (
    <Diagram label="One MSOA income estimate of £52,000 is shown for every LSOA inside it" height={196}>
      <rect x={60} y={8} width={280} height={180} rx={12} className="gd-surface gd-stroke-dashed" />
      <text x={74} y={30} className="gd-label">MSOA estimate: £52k a year</text>
      {[0, 1, 2, 3].map((index) => {
        const x = 78 + (index % 2) * 126;
        const y = 44 + Math.floor(index / 2) * 70;
        return (
          <g key={index}>
            <rect x={x} y={y} width={118} height={62} rx={8} className="gd-chip" />
            <text x={x + 59} y={y + 28} textAnchor="middle" className="gd-label">£52k</text>
            <text x={x + 59} y={y + 46} textAnchor="middle" className="gd-small gd-muted">LSOA</text>
          </g>
        );
      })}
    </Diagram>
  );
}

export function WaffleDiagram() {
  const filled = 29;
  return (
    <Diagram label="100 squares stand for 100 households; 29 are filled for households renting from a council or housing association" height={190}>
      {Array.from({ length: 100 }, (_, index) => (
        <rect key={index} x={10 + (index % 10) * 17} y={10 + Math.floor(index / 10) * 17} width={14} height={14} rx={2}
          className={index < filled ? "gd-ink" : "gd-chip"} />
      ))}
      <text x={200} y={60} className="gd-big">29 in 100</text>
      <text x={200} y={86} className="gd-small">households rent from a</text>
      <text x={200} y={104} className="gd-small">council or housing</text>
      <text x={200} y={122} className="gd-small">association</text>
    </Diagram>
  );
}

const SCHOOLS: [number, number][] = [[176, 92], [236, 128], [190, 152], [292, 84], [118, 160], [140, 46], [272, 186], [306, 136]];

export function SchoolRadiusDiagram() {
  const [cx, cy, inner, outer] = [200, 116, 58, 96];
  return (
    <Diagram label="Circles of 1 km and 1.5 km around a point in the area, with school dots inside them" height={222}>
      <circle cx={cx} cy={cy} r={outer} className="gd-ring" />
      <circle cx={cx} cy={cy} r={inner} className="gd-ring gd-ring-strong" />
      <path d="M182,98 L222,92 L230,126 L196,140 L176,122 Z" className="gd-chip" />
      {SCHOOLS.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={6} className="gd-accent gd-dot-edge" />)}
      <circle cx={cx} cy={cy} r={4} className="gd-ink" />
      <text x={cx} y={cy - inner - 6} textAnchor="middle" className="gd-small">1 km</text>
      <text x={cx} y={cy - outer - 6} textAnchor="middle" className="gd-small gd-muted">1.5 km</text>
      <text x={8} y={214} className="gd-small gd-muted">● school  · straight-line distance, not a catchment</text>
    </Diagram>
  );
}

const HOMES_DB = [42, 46, 48, 50, 51, 53, 54, 57, 61, 67];

/** Two areas with different numbers of records: the share, not the count, makes them comparable. */
export function WildlifeShareDiagram() {
  const area = (x: number, records: number, seen: number, words: string, grey = false) => (
    <g>
      <rect x={x} y={20} width={110} height={70} rx={8} className={grey ? "gd-chip" : "gd-accent"} opacity={grey ? 1 : 0.25} />
      {Array.from({ length: records }, (_, index) => (
        <circle key={index} cx={x + 12 + (index % 9) * 11} cy={32 + Math.floor(index / 9) * 11} r={3.5}
          className={index < seen ? "gd-ink" : "gd-muted-dot"} />
      ))}
      <text x={x + 55} y={110} textAnchor="middle" className="gd-small">{words}</text>
    </g>
  );
  return (
    <Diagram label="Three areas: 36 records with 4 hedgehogs, 9 records with 1 hedgehog, and 3 records, too few to say" height={140}>
      {area(20, 36, 4, "36 records · 11%")}
      {area(150, 9, 1, "9 records · 11%")}
      {area(280, 3, 0, "3 records · too few", true)}
      <text x={200} y={132} textAnchor="middle" className="gd-label">Same share, same shade; grey when records are too few</text>
    </Diagram>
  );
}

export function NoiseScaleDiagram() {
  const x = (db: number) => 20 + ((db - 40) / 35) * 360;
  return (
    <Diagram label="Ten homes placed on a noise scale from 40 to 75 decibels; three are at 55 decibels or more" height={140}>
      <rect x={x(40)} y={60} width={x(55) - x(40)} height={14} rx={4} className="gd-chip" />
      <rect x={x(55)} y={60} width={x(65) - x(55)} height={14} className="gd-accent" />
      <rect x={x(65)} y={60} width={x(75) - x(65)} height={14} rx={4} className="gd-rise" />
      {HOMES_DB.map((db, index) => (
        <circle key={index} cx={x(db)} cy={index % 2 ? 36 : 46} r={6} className={db >= 55 ? "gd-ink" : "gd-muted-dot"} />
      ))}
      <line x1={x(55)} x2={x(55)} y1={20} y2={84} className="gd-axis" />
      <line x1={x(65)} x2={x(65)} y1={20} y2={84} className="gd-axis" />
      <text x={x(55)} y={100} textAnchor="middle" className="gd-small">55 dB</text>
      <text x={x(65)} y={100} textAnchor="middle" className="gd-small">65 dB</text>
      <text x={x(40)} y={100} className="gd-small gd-muted">40</text>
      <text x={x(75)} y={100} textAnchor="end" className="gd-small gd-muted">75</text>
      <text x={200} y={128} textAnchor="middle" className="gd-label">3 of 10 homes at 55 dB or more</text>
    </Diagram>
  );
}

const HOMES_NO2 = [16, 18, 19, 20, 21, 21, 22, 24, 27, 31];

export function AirScaleDiagram() {
  const x = (level: number) => 20 + ((level - 5) / 40) * 360;
  return (
    <Diagram label="Ten homes placed on a nitrogen dioxide scale from 5 to 45 micrograms per cubic metre, between the WHO guideline of 10 and the UK limit of 40" height={140}>
      <rect x={x(5)} y={60} width={x(10) - x(5)} height={14} rx={4} className="gd-chip" />
      <rect x={x(10)} y={60} width={x(40) - x(10)} height={14} className="gd-accent" />
      <rect x={x(40)} y={60} width={x(45) - x(40)} height={14} rx={4} className="gd-rise" />
      {HOMES_NO2.map((level, index) => (
        <circle key={index} cx={x(level)} cy={index % 2 ? 36 : 46} r={6} className="gd-ink" />
      ))}
      <line x1={x(10)} x2={x(10)} y1={20} y2={84} className="gd-axis" />
      <line x1={x(40)} x2={x(40)} y1={20} y2={84} className="gd-axis" />
      <text x={x(10)} y={100} textAnchor="middle" className="gd-small">WHO 10</text>
      <text x={x(40)} y={100} textAnchor="middle" className="gd-small">UK limit 40</text>
      <text x={200} y={128} textAnchor="middle" className="gd-label">area value: the mean of its homes, 22 µg/m³</text>
    </Diagram>
  );
}

const BUILDINGS: [number, number][] = [[90, 60], [130, 48], [170, 70], [220, 52], [260, 80], [300, 60], [110, 110], [160, 120], [210, 104], [250, 128], [290, 116], [320, 150]];

export function FloodShareDiagram() {
  return (
    <Diagram label="An area outline with a river flood extent across one corner; most buildings sit outside it" height={200}>
      <path d="M50,30 L350,22 L364,172 L40,180 Z" className="gd-surface gd-stroke-strong" />
      <path d="M300,23 C290,80 330,120 364,140 L364,172 L250,176 C280,130 260,70 300,23 Z" className="gd-water" />
      {BUILDINGS.map(([x, y]) => <rect key={`${x}-${y}`} x={x - 6} y={y - 6} width={12} height={12} rx={2} className="gd-ink" />)}
      <text x={200} y={196} textAnchor="middle" className="gd-small gd-muted">shaded: mapped flood extent · squares: buildings</text>
    </Diagram>
  );
}

export function PlanningStagesDiagram() {
  const stages = ["planned", "approved", "completed"];
  return (
    <Diagram label="Planning records move from planned to approved to completed; withdrawn applications stay labelled" height={130}>
      {stages.map((stage, index) => {
        const x = 8 + index * 134;
        return (
          <g key={stage}>
            <rect x={x} y={20} width={116} height={50} rx={10} className={index === 0 ? "gd-ink" : "gd-chip"} />
            <text x={x + 58} y={50} textAnchor="middle" className={index === 0 ? "gd-label gd-on-ink" : "gd-label"}>{stage}</text>
            {index < 2 && <text x={x + 125} y={51} textAnchor="middle" className="gd-label gd-muted">→</text>}
          </g>
        );
      })}
      <path d="M66,72 L66,100 L110,100" className="gd-axis" />
      <text x={116} y={104} className="gd-small gd-muted">or withdrawn by the applicant (kept, labelled)</text>
    </Diagram>
  );
}

const FACTOR_BARS = [
  { label: "Affordability", fit: 80, weight: 3 },
  { label: "Crime", fit: 60, weight: 2 },
  { label: "Schools", fit: 90, weight: 1 },
  { label: "Commute", fit: null, weight: 2 },
];

export function MatchDiagram() {
  return (
    <Diagram label="Three factor fits weighted 3, 2 and 1 combine into a match of 75 out of 100; a factor without evidence is left out" height={200}>
      <text x={8} y={16} className="gd-small gd-muted">fit (0–100)</text>
      <text x={300} y={16} className="gd-small gd-muted">weight</text>
      {FACTOR_BARS.map((factor, index) => {
        const y = 28 + index * 34;
        return (
          <g key={factor.label}>
            <text x={8} y={y + 16} className="gd-small">{factor.label}</text>
            <rect x={104} y={y + 4} width={180} height={16} rx={4} className="gd-chip" />
            {factor.fit === null
              ? <text x={110} y={y + 16} className="gd-small gd-muted">no evidence: left out</text>
              : <SatinBlock x={104} y={y + 4} width={(180 * factor.fit) / 100} height={16} colour={SATIN} seed={index + 1} />}
            <text x={310} y={y + 16} className="gd-small">{factor.fit === null ? "–" : `× ${factor.weight}`}</text>
          </g>
        );
      })}
      <Patch x={96} y={162} width={196} height={36} strong />
      <text x={194} y={186} textAnchor="middle" className="gd-label gd-on-ink">Your match 75 / 100</text>
    </Diagram>
  );
}

export function DemoRealDiagram() {
  return (
    <Diagram label="Demo shows made-up preview areas; Real shows published releases or says what is unavailable" height={150}>
      <rect x={6} y={10} width={176} height={128} rx={12} className="gd-chip" />
      <text x={94} y={40} textAnchor="middle" className="gd-label">Demo</text>
      <text x={94} y={70} textAnchor="middle" className="gd-small">made-up preview areas</text>
      <text x={94} y={90} textAnchor="middle" className="gd-small">fixed, repeatable numbers</text>
      <text x={94} y={118} textAnchor="middle" className="gd-small gd-muted">not for decisions</text>
      <text x={200} y={80} textAnchor="middle" className="gd-label gd-muted">⇄</text>
      <rect x={218} y={10} width={176} height={128} rx={12} className="gd-ink" />
      <text x={306} y={40} textAnchor="middle" className="gd-label gd-on-ink">Real</text>
      <text x={306} y={70} textAnchor="middle" className="gd-small gd-on-ink">official sources</text>
      <text x={306} y={90} textAnchor="middle" className="gd-small gd-on-ink">each figure names its release</text>
      <text x={306} y={118} textAnchor="middle" className="gd-small gd-on-ink">missing stays “unavailable”</text>
    </Diagram>
  );
}

const TENURE_BARS = [
  { label: "Own their home", share: 41, london: 47 },
  { label: "Rent privately", share: 35, london: 30 },
  { label: "Rent from a council or housing association", share: 24, london: 23 },
];

export function PeopleShareDiagram() {
  const barWidth = 300;
  return (
    <Diagram label="Three bars for how households live here: 41% own, 35% rent privately, 24% rent from a council or housing association; a thin line on each bar marks the share for London" height={190}>
      {TENURE_BARS.map((bar, index) => {
        const y = 8 + index * 54;
        const markX = 8 + (barWidth * bar.london) / 100;
        return (
          <g key={bar.label}>
            <text x={8} y={y + 12} className="gd-small">{bar.label}</text>
            <rect x={8} y={y + 20} width={barWidth} height={18} rx={4} className="gd-chip" />
            <SatinBlock x={8} y={y + 21} width={(barWidth * bar.share) / 100} height={16} colour={SATIN} seed={index + 2} />
            <line x1={markX} x2={markX} y1={y + 15} y2={y + 43} className="gd-arrow" />
            <text x={barWidth + 20} y={y + 34} className="gd-label">{bar.share}%</text>
          </g>
        );
      })}
      <text x={8} y={184} className="gd-small gd-muted">thin line: the share for London as a whole</text>
    </Diagram>
  );
}

const STATION_DOTS = [
  { name: "A", metres: 300, angle: -2.4, note: "300 m, 2 tube lines: 2 points" },
  { name: "B", metres: 800, angle: 0.5, note: "800 m, 1 Overground line, counts half: 0.5" },
  { name: "C", metres: 1_500, angle: -0.8, note: "1,500 m: too far, 0" },
];

export function ConnectivityDiagram() {
  const [cx, cy, perMetre] = [110, 116, 96 / 1_200];
  return (
    <Diagram label="Rings of 400 and 1,200 metres around an area. Station A at 300 metres counts fully, station B at 800 metres counts half, station C at 1,500 metres does not count. 2.5 points give a score of 7 out of 10" height={296}>
      <circle cx={cx} cy={cy} r={1_200 * perMetre} className="gd-ring" />
      <circle cx={cx} cy={cy} r={400 * perMetre} className="gd-ring gd-ring-strong" />
      <circle cx={cx} cy={cy} r={5} className="gd-ink" />
      <text x={cx} y={cy - 400 * perMetre - 6} textAnchor="middle" className="gd-small">400 m</text>
      <text x={cx} y={cy + 1_200 * perMetre + 16} textAnchor="middle" className="gd-small gd-muted">1,200 m</text>
      {STATION_DOTS.map((station) => {
        const x = cx + Math.cos(station.angle) * station.metres * perMetre;
        const y = cy + Math.sin(station.angle) * station.metres * perMetre;
        return (
          <g key={station.name}>
            <circle cx={x} cy={y} r={9} className={station.metres > 1_200 ? "gd-chip gd-dot-edge" : "gd-accent gd-dot-edge"} />
            <text x={x} y={y + 4} textAnchor="middle" className="gd-small">{station.name}</text>
          </g>
        );
      })}
      <ValueBox x={250} y={60} width={140} value="7 / 10" caption="2.5 points in all" strong />
      {STATION_DOTS.map((station, index) => (
        <text key={station.name} x={8} y={252 + index * 20} className="gd-small">{station.name}: {station.note}</text>
      ))}
    </Diagram>
  );
}

const TAX_BANDS: [string, number][] = [["A", 6], ["B", 7], ["C", 8], ["D", 9], ["E", 11], ["F", 13], ["G", 15], ["H", 18]];

export function CouncilTaxDiagram() {
  const bandD = 1_800;
  const base = 176;
  return (
    <Diagram label="Council tax bands A to H as bars; with Band D at £1,800, band A pays £1,200 and band H pays £3,600" height={212}>
      {TAX_BANDS.map(([band, ninths], index) => {
        const x = 8 + index * 49;
        const height = ninths * 7;
        return (
          <g key={band}>
            <rect x={x} y={base - height} width={42} height={height} rx={4} className={band === "D" ? "gd-ink" : "gd-chip"} />
            <text x={x + 21} y={base - height - 6} textAnchor="middle" className="gd-small">
              £{((bandD * ninths) / 9).toLocaleString("en-GB")}
            </text>
            <text x={x + 21} y={base + 16} textAnchor="middle" className="gd-label">{band}</text>
            <text x={x + 21} y={base + 32} textAnchor="middle" className="gd-small gd-muted">{ninths}/9</text>
          </g>
        );
      })}
    </Diagram>
  );
}

const SPREAD = { p5: 330_000, p25: 450_000, median: 520_000, p75: 640_000, p95: 850_000 };

export function MarketSpreadDiagram() {
  const x = (price: number) => 20 + ((price - 300_000) / 600_000) * 360;
  const k = (price: number) => `£${Math.round(price / 1_000)}k`;
  return (
    <Diagram label="This small area had 7 sales, under 10, so the bigger area around it with 64 sales is used. There the middle half of sales went for £450k to £640k, the middle price was £520k, and all but the cheapest and dearest 5% fell between £330k and £850k" height={212}>
      <Patch x={8} y={8} width={170} height={40} />
      <text x={93} y={33} textAnchor="middle" className="gd-small">small area: 7 sales</text>
      <text x={200} y={33} textAnchor="middle" className="gd-label gd-muted">→</text>
      <Patch x={222} y={8} width={170} height={40} strong />
      <text x={307} y={33} textAnchor="middle" className="gd-small gd-on-ink">bigger area: 64 sales</text>
      <line x1={x(SPREAD.p5)} x2={x(SPREAD.p95)} y1={112} y2={112} className="gd-arrow" />
      <SatinBlock x={x(SPREAD.p25)} y={98} width={x(SPREAD.p75) - x(SPREAD.p25)} height={28} colour={SATIN} slant={5} seed={4} />
      <line x1={x(SPREAD.median)} x2={x(SPREAD.median)} y1={88} y2={136} className="gd-arrow" />
      <text x={x(SPREAD.median)} y={80} textAnchor="middle" className="gd-label">middle {k(SPREAD.median)}</text>
      {[SPREAD.p5, SPREAD.p25, SPREAD.p75, SPREAD.p95].map((price, index) => (
        <text key={price} x={x(price)} y={index % 3 === 0 ? 132 : 152} textAnchor="middle" className="gd-small">{k(price)}</text>
      ))}
      <text x={200} y={182} textAnchor="middle" className="gd-small gd-muted">box: the middle half of sales</text>
      <text x={200} y={200} textAnchor="middle" className="gd-small gd-muted">line: all but the cheapest and dearest 5%</text>
    </Diagram>
  );
}

const ENERGY_BANDS = ["A", "B", "C", "D", "E", "F", "G"];

export function EnergyRatingDiagram() {
  const [now, could] = ["D", "C"];
  return (
    <Diagram label="Energy rating bands from A, most efficient, to G, least efficient. This home is rated D now and could reach C" height={210}>
      {ENERGY_BANDS.map((band, index) => {
        const y = 8 + index * 26;
        const width = 70 + index * 26;
        const current = band === now;
        return (
          <g key={band}>
            <rect x={8} y={y} width={width} height={22} rx={4}
              className={current ? "gd-ink" : band === could ? "gd-chip gd-stroke-strong" : "gd-chip"} />
            <text x={18} y={y + 16} className={current ? "gd-label gd-on-ink" : "gd-label"}>{band}</text>
            {current && <text x={width + 18} y={y + 16} className="gd-small">← this home now</text>}
            {band === could && <text x={width + 18} y={y + 16} className="gd-small">← could reach</text>}
          </g>
        );
      })}
      <text x={8} y={204} className="gd-small gd-muted">A: most efficient · G: least efficient</text>
    </Diagram>
  );
}

const SDLT_SLICES = [
  { from: 0, to: 125_000, rate: 0 },
  { from: 125_000, to: 250_000, rate: 2 },
  { from: 250_000, to: 500_000, rate: 5 },
];

export function StampDutyDiagram() {
  const x = (price: number) => 20 + (price / 500_000) * 360;
  const k = (price: number) => (price === 0 ? "£0" : `£${price / 1_000}k`);
  return (
    <Diagram label="A £500,000 price cut into slices: nothing on the first £125,000, 2% on the next £125,000, which is £2,500, and 5% on the last £250,000, which is £12,500. Total £15,000" height={176}>
      {SDLT_SLICES.map((slice, index) => {
        const middle = (x(slice.from) + x(slice.to)) / 2;
        return (
          <g key={slice.from}>
            <text x={middle} y={22} textAnchor="middle" className="gd-small gd-muted">{k(slice.from)}–{k(slice.to)}</text>
            {index === 0
              ? <rect x={x(slice.from) + 1} y={30} width={x(slice.to) - x(slice.from) - 2} height={40} rx={6} className="gd-chip" />
              : <SatinBlock x={x(slice.from) + 1.5} y={32} width={x(slice.to) - x(slice.from) - 3} height={36} colour={SATIN} slant={5} seed={index + 3} />}
            <text x={middle} y={92} textAnchor="middle" className="gd-label">{slice.rate}%</text>
            <text x={middle} y={112} textAnchor="middle" className="gd-small">
              £{(((slice.to - slice.from) * slice.rate) / 100).toLocaleString("en-GB")}
            </text>
          </g>
        );
      })}
      <Patch x={100} y={126} width={200} height={44} strong />
      <text x={200} y={153} textAnchor="middle" className="gd-label gd-on-ink">Stamp duty £15,000</text>
    </Diagram>
  );
}

const AUGUST_2026_RATES: [string, number][] = [["Bank Rate", 3.75], ["2-year fixed", 4.92], ["3-year fixed", 4.77], ["5-year fixed", 4.78]];

export function MortgageRatesDiagram() {
  const width = (rate: number) => (rate / 6) * 220;
  return (
    <Diagram label="August 2026: Bank Rate 3.75%, 2-year fixed 4.92%, 3-year fixed 4.77%, 5-year fixed 4.78%" height={182}>
      {AUGUST_2026_RATES.map(([label, rate], index) => {
        const y = 8 + index * 36;
        return (
          <g key={label}>
            <text x={8} y={y + 19} className="gd-small">{label}</text>
            {index === 0
              ? <rect x={104} y={y + 6} width={width(rate)} height={18} rx={4} className="gd-ink" />
              : <SatinBlock x={104} y={y + 6} width={width(rate)} height={18} colour={SATIN} seed={index + 1} />}
            <text x={104 + width(rate) + 8} y={y + 20} className="gd-label">{rate.toFixed(2)}%</text>
          </g>
        );
      })}
      <text x={8} y={172} className="gd-small gd-muted">August 2026 monthly averages · fixed at 75% loan-to-value</text>
    </Diagram>
  );
}

const BTL_ROWS = [
  { label: "Rent for a year", value: "£21,600", from: 0, to: 21_600, kind: "gd-chip" },
  { label: "Empty weeks", value: "−£831", from: 20_769, to: 21_600, kind: "gd-accent" },
  { label: "Running costs", value: "−£3,277", from: 17_492, to: 20_769, kind: "gd-accent" },
  { label: "Mortgage", value: "−£15,000", from: 2_492, to: 17_492, kind: "gd-accent" },
  { label: "Left over", value: "£2,492", from: 0, to: 2_492, kind: "gd-ink" },
];

export function BuyToLetDiagram() {
  const x = (amount: number) => 120 + (amount / 21_600) * 270;
  return (
    <Diagram label="A year's rent of £21,600, minus £831 for empty weeks, £3,277 running costs and £15,000 mortgage interest, leaves £2,492" height={196}>
      {BTL_ROWS.map((row, index) => {
        const y = 4 + index * 38;
        return (
          <g key={row.label}>
            <text x={8} y={y + 14} className="gd-small">{row.label}</text>
            <text x={8} y={y + 30} className="gd-small gd-muted">{row.value}</text>
            {row.kind === "gd-accent"
              ? <SatinBlock x={x(row.from)} y={y + 7} width={Math.max(3, x(row.to) - x(row.from))} height={20} colour={SATIN} seed={index + 1} />
              : <rect x={x(row.from)} y={y + 7} width={Math.max(3, x(row.to) - x(row.from))} height={20} rx={3} className={row.kind} />}
          </g>
        );
      })}
    </Diagram>
  );
}

/** England's school years from age 3 to 18: the stages, and the tests at 11, 16 and 18 (Schools 101). */
const SCHOOL_STAGES = [
  { from: 3, to: 4, label: "Nursery", colour: "var(--yarn-pink)" },
  { from: 4, to: 11, label: "Primary", colour: "var(--yarn-sun)" },
  { from: 11, to: 16, label: "Secondary", colour: "var(--yarn-sky)" },
  { from: 16, to: 18, label: "Sixth form", colour: "var(--yarn-cobalt)" },
] as const;
const SCHOOL_TESTS = [[11, "SATs"], [16, "GCSEs"], [18, "A levels"]] as const;

export function SchoolPhasesDiagram() {
  const x = (age: number) => 20 + (age - 3) * 24;
  return (
    <Diagram label="Ages 3 to 18: nursery 3 to 4, primary 4 to 11, secondary 11 to 16, sixth form 16 to 18; tests at 11, 16 and 18" height={152}>
      {[3, 4, 11, 16, 18].map((age) => (
        <text key={age} x={x(age)} y={28} textAnchor="middle" className="gd-small gd-muted">{age}</text>
      ))}
      {SCHOOL_STAGES.map((stage, index) => (
        <g key={stage.label}>
          <SatinBlock x={x(stage.from) + 1} y={38} width={x(stage.to) - x(stage.from) - 2} height={24} colour={stage.colour} seed={index + 1} />
          <text x={(x(stage.from) + x(stage.to)) / 2} y={82} textAnchor={index === 0 ? "start" : "middle"} className="gd-label"
            dx={index === 0 ? -12 : 0}>{stage.label}</text>
        </g>
      ))}
      {SCHOOL_TESTS.map(([age, label]) => (
        <g key={label}>
          <circle cx={x(age)} cy={102} r={5} className="gd-ink" />
          {/* 16 and 18 sit close: A levels drops a line. */}
          <text x={x(age)} y={age === 18 ? 142 : 126} textAnchor={age === 18 ? "end" : "middle"} className="gd-small">{label}</text>
        </g>
      ))}
    </Diagram>
  );
}
