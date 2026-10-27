import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import {
  BandScale, BarList, ChartFrame, DistanceRings, IconCount, RingScore, ScaleMarker, SegmentScore, StackedBar, Waffle,
  formatShare, scalePosition, type ChartTone,
} from "@/components/charts";

import { ThemeSwitch } from "./theme-switch";
import "./dev-charts.css";

export const metadata: Metadata = { title: "Chart kit", robots: { index: false, follow: false } };

// Brent-like numbers so the demo reads like the real panel.
const FLOOD = [
  { id: "high", label: "High", value: 0.003, tone: "bad" },
  { id: "medium", label: "Medium", value: 0.021, tone: "c2" },
  { id: "low", label: "Low", value: 0.096, tone: "c5" },
  { id: "very-low", label: "Very low", value: 0.04, tone: "c1" },
  { id: "none", label: "Outside", value: 0.84, tone: "neutral" },
] satisfies { id: string; label: string; value: number; tone: ChartTone }[];

const TENURE = [
  { id: "owned", label: "Owned", value: 0.38, tone: "c1" },
  { id: "social", label: "Social rent", value: 0.24, tone: "c2" },
  { id: "private", label: "Private rent", value: 0.36, tone: "c3" },
  { id: "other", label: "Other", value: 0.02, tone: "neutral" },
] satisfies { id: string; label: string; value: number; tone: ChartTone }[];

const STATIONS = [
  { id: "wembley-park", label: "Wembley Park", distanceMetres: 420, bearingDegrees: 40, tone: "c1" },
  { id: "wembley-stadium", label: "Wembley Stadium", distanceMetres: 690, bearingDegrees: 150, tone: "c4" },
  { id: "wembley-central", label: "Wembley Central", distanceMetres: 1180, bearingDegrees: 235, tone: "c3" },
  { id: "stonebridge", label: "Stonebridge Park", distanceMetres: 1350, bearingDegrees: 200, tone: "c3" },
  { id: "neasden", label: "Neasden", distanceMetres: 1420, bearingDegrees: 105, tone: "c1" },
  { id: "preston-road", label: "Preston Road", distanceMetres: 1460, bearingDegrees: 340, tone: "c1" },
  { id: "kingsbury", label: "Kingsbury", distanceMetres: 2100, bearingDegrees: 20, tone: "c1" },
] satisfies { id: string; label: string; distanceMetres: number; bearingDegrees: number; tone: ChartTone }[];

const CLUSTER = [
  { id: "a", label: "Oakington Manor Primary", distanceMetres: 310, bearingDegrees: 90, tone: "c1" },
  { id: "b", label: "Ark Elvin Academy", distanceMetres: 330, bearingDegrees: 98, tone: "c2" },
  { id: "c", label: "Wembley Primary", distanceMetres: 350, bearingDegrees: 84, tone: "c1" },
  { id: "d", label: "Preston Manor", distanceMetres: 980, bearingDegrees: 320, tone: "c2" },
] satisfies { id: string; label: string; distanceMetres: number; bearingDegrees: number; tone: ChartTone }[];

const CRIME_TYPES = [
  { id: "violence", label: "Violence and sexual offences", value: 41.2, display: "41 per 1,000", marker: 30.5 },
  { id: "asb", label: "Anti-social behaviour", value: 22.8, display: "23 per 1,000", marker: 19.1 },
  { id: "theft", label: "Theft from the person", value: 6.1, display: "6 per 1,000", marker: 9.8 },
  { id: "burglary", label: "Burglary", value: 4.4, display: "4 per 1,000", marker: 5.2 },
  { id: "drugs", label: "Drugs", value: 0.2, display: "0.2 per 1,000", marker: 3.1 },
];

const BY_TYPE = [
  { id: "flat", label: "Flats", value: 412_000, display: "£412,000 · 38 sales" },
  { id: "terraced", label: "Terraced", value: 615_000, display: "£615,000 · 12 sales" },
  { id: "semi", label: "Semi-detached", value: 702_500, display: "£702,500 · 6 sales" },
  { id: "detached", label: "Detached", value: 0, display: "no sales" },
];

const EPC = (["A", "B", "C", "D", "E", "F", "G"] as const).map((band, index) => ({
  id: band, label: band, tone: (["good", "good", "c3", "c5", "c2", "bad", "bad"] as const)[index] as ChartTone,
}));
const FLOOD_BANDS: { id: string; label: string; tone: ChartTone }[] = [
  { id: "very-low", label: "Very low", tone: "c1" },
  { id: "low", label: "Low", tone: "c5" },
  { id: "medium", label: "Medium", tone: "c2" },
  { id: "high", label: "High", tone: "bad" },
];
const COUNCIL_TAX = "ABCDEFGH".split("").map((band) => ({ id: band, label: band, tone: "c1" as ChartTone }));

function Card({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="dev-charts__card">
      {children}
      {note && <small className="dev-charts__note">{note}</small>}
    </div>
  );
}

function Value({ big, small }: { big: string; small?: string }) {
  return <span className="dev-charts__value">{big}{small && <small> {small}</small>}</span>;
}

function FloodTable() {
  return (
    <table>
      <thead><tr><th scope="col">Chance</th><th scope="col">Share of land</th></tr></thead>
      <tbody>{FLOOD.map((part) => <tr key={part.id}><td>{part.label}</td><td>{formatShare(part.value)}</td></tr>)}</tbody>
    </table>
  );
}

export default function ChartsDemoPage() {
  // Development only; the e2e server's production build keeps it (CLOSE_KNIT_DEMO_PAGES, playwright.config.ts).
  if (process.env.NODE_ENV === "production" && process.env.CLOSE_KNIT_DEMO_PAGES !== "on") notFound();
  const londonPrice = scalePosition(7_600, 4_000, 16_000);
  const areaPrice = scalePosition(9_400, 4_000, 16_000);
  return (
    <main className="dev-charts" data-testid="dev-charts">
      <header className="dev-charts__head">
        <div>
          <p className="eyebrow">Development only</p>
          <h1>Chart kit</h1>
        </div>
        <ThemeSwitch />
      </header>

      <h2 className="dev-charts__section">Panel width (320px)</h2>
      <div className="dev-charts__grid">
        <Card note="ScaleMarker: position, London marker, end labels">
          <ChartFrame title="Price vs London" help="scorecard-price">
            <Value big="£9,400" small="per m²" />
            <ScaleMarker position={areaPrice} marker={londonPrice} low="Cheaper" high="Dearer" label="Price per m²: £9,400 here, £7,600 London" />
          </ChartFrame>
          <ChartFrame title="Middle 50% of prices">
            <ScaleMarker position={0.46} range={[0.3, 0.71]} low="£6,100" high="£14,800" label="Middle half of sales £7,700 to £12,500, median £9,400" />
          </ChartFrame>
          <ChartFrame title="Price vs London">
            <ScaleMarker position={null} low="Cheaper" high="Dearer" label="Price unknown" />
          </ChartFrame>
        </Card>

        <Card note="SegmentScore: worse-high, better-high, neutral, unknown">
          <ChartFrame title="Crime" help="scorecard-crime">
            <Value big="8" small="of 10 · high" />
            <SegmentScore score={8} tone="worse-high" label="Crime score" />
          </ChartFrame>
          <ChartFrame title="Income" help="scorecard-income">
            <Value big="3" small="of 10" />
            <SegmentScore score={3} tone="better-high" label="Income score" />
          </ChartFrame>
          <ChartFrame title="Getting around">
            <SegmentScore score={6} tone="neutral" label="Connectivity score" />
          </ChartFrame>
          <ChartFrame title="Deprivation">
            <SegmentScore score={null} tone="worse-high" label="Deprivation score" />
          </ChartFrame>
        </Card>

        <Card note="StackedBar: legend, tiny share, table toggle, sources">
          <ChartFrame
            title="Rivers and sea"
            help="flood-source"
            table={<FloodTable />}
            sources={<p>Environment Agency Risk of Flooding from Rivers and Sea. Contains public sector information licensed under the Open Government Licence v3.0.</p>}
          >
            <StackedBar parts={FLOOD} label="Land by flood chance" />
          </ChartFrame>
          <ChartFrame title="Tenure">
            <StackedBar parts={TENURE} label="Homes by tenure" />
          </ChartFrame>
          <ChartFrame title="Surface water" unknown="Surface water data unknown here">
            <StackedBar parts={[]} label="Surface water" />
          </ChartFrame>
        </Card>

        <Card note="Waffle: share, tiny share, unknown">
          <ChartFrame title="Homes at 55 dB+" help="noise-lden">
            <div className="dev-charts__row">
              <Waffle share={0.649} label="Homes at 55 dB or more" />
              <Value big="65%" small="London 41%" />
            </div>
          </ChartFrame>
          <ChartFrame title="Rail noise">
            <div className="dev-charts__row">
              <Waffle share={0.003} label="Homes at 55 dB or more from rail" />
              <Value big={formatShare(0.003)} />
            </div>
          </ChartFrame>
          <ChartFrame title="Social renting">
            <Waffle share={null} label="Social renting" />
          </ChartFrame>
        </Card>

        <Card note="RingScore: 56px, 88px, unknown">
          <ChartFrame title="Getting around">
            <div className="dev-charts__row">
              <RingScore score={7} label="Connectivity" />
              <RingScore score={9.5} label="Connectivity" size={88} />
              <RingScore score={0} label="Connectivity" />
            </div>
          </ChartFrame>
          <ChartFrame title="Getting around">
            <RingScore score={null} label="Connectivity" />
          </ChartFrame>
        </Card>

        <Card note="DistanceRings: long names, place past 1.5 km">
          <ChartFrame
            title="Stations"
            table={(
              <table>
                <thead><tr><th scope="col">Station</th><th scope="col">Distance</th></tr></thead>
                <tbody>{STATIONS.map((s) => <tr key={s.id}><td>{s.label}</td><td>{s.distanceMetres} m</td></tr>)}</tbody>
              </table>
            )}
          >
            <DistanceRings points={STATIONS} label="Stations near the area" />
          </ChartFrame>
        </Card>

        <Card note="DistanceRings: clustered points, empty">
          <ChartFrame title="Schools" help="schools-distance">
            <DistanceRings points={CLUSTER} label="Schools near the area" />
          </ChartFrame>
          <ChartFrame title="Parks">
            <DistanceRings points={[]} label="Parks near the area" />
          </ChartFrame>
        </Card>

        <Card note="IconCount: zero group, more than ten">
          <ChartFrame title="Schools within 1 km">
            <IconCount
              label="Schools within 1 km"
              groups={[
                { id: "primary", label: "primary", count: 3, icon: "building-school" },
                { id: "secondary", label: "secondary", count: 1, icon: "school" },
                { id: "special", label: "special", count: 0, icon: "school" },
              ]}
            />
          </ChartFrame>
          <ChartFrame title="Within 10 minutes">
            <IconCount
              label="Places within a 10 minute walk"
              groups={[
                { id: "groceries", label: "shops", count: 6, icon: "shopping-cart" },
                { id: "pubs", label: "pubs", count: 14, icon: "beer" },
                { id: "food", label: "places to eat", count: 9, icon: "tools-kitchen" },
                { id: "pharmacies", label: "pharmacies", count: 2, icon: "pill" },
                { id: "gps", label: "GPs", count: 1, icon: "stethoscope" },
                { id: "parks", label: "parks", count: 2, icon: "tree" },
                { id: "stations", label: "stations", count: 3, icon: "train" },
                { id: "bus", label: "bus stops", count: 8, icon: "bus" },
              ]}
            />
          </ChartFrame>
        </Card>

        <Card note="BarList: London marker, tiny and zero values">
          <ChartFrame
            title="Crime by type"
            table={(
              <table>
                <thead><tr><th scope="col">Type</th><th scope="col">Here</th></tr></thead>
                <tbody>{CRIME_TYPES.map((row) => <tr key={row.id}><td>{row.label}</td><td>{row.display}</td></tr>)}</tbody>
              </table>
            )}
          >
            <BarList rows={CRIME_TYPES} label="Crimes per 1,000 people" />
          </ChartFrame>
          <ChartFrame title="Median price by type">
            <BarList rows={BY_TYPE} label="Median price by home type" />
          </ChartFrame>
        </Card>

        <Card note="BandScale: current and potential, current only, unknown">
          <ChartFrame title="Energy rating">
            <BandScale bands={EPC} current="D" potential="B" label="Energy rating" />
          </ChartFrame>
          <ChartFrame title="Energy rating">
            <BandScale bands={EPC} current="G" potential="G" label="Energy rating" />
          </ChartFrame>
          <ChartFrame title="Flood chance here" help="flood-source">
            <BandScale bands={FLOOD_BANDS} current="low" label="Flood chance at this address" />
          </ChartFrame>
          <ChartFrame title="Council tax">
            <BandScale bands={COUNCIL_TAX} current="A" label="Council tax band" />
          </ChartFrame>
          <ChartFrame title="Energy rating">
            <BandScale bands={EPC} current={null} label="Energy rating" />
          </ChartFrame>
        </Card>
      </div>

      <h2 className="dev-charts__section">Tile width (150px)</h2>
      <div className="dev-charts__tiles">
        <div className="dev-charts__tile"><span>Price</span><Value big="£9,400" /><ScaleMarker position={areaPrice} marker={londonPrice} low="Cheap" high="Dear" label="Price per m²: £9,400 here, £7,600 London" /></div>
        <div className="dev-charts__tile"><span>Crime</span><Value big="8/10" /><SegmentScore score={8} tone="worse-high" label="Crime score" /></div>
        <div className="dev-charts__tile"><span>Flood</span><Value big="2%" small="medium+" /><StackedBar parts={FLOOD} label="Land by flood chance" compact /></div>
        <div className="dev-charts__tile"><span>Getting around</span><div className="dev-charts__row"><RingScore score={7} label="Connectivity" size={48} /><small>Wembley Park 420 m</small></div></div>
        <div className="dev-charts__tile"><span>Noise</span><div className="dev-charts__row"><Waffle share={0.649} label="Homes at 55 dB or more" /><Value big="65%" /></div></div>
        <div className="dev-charts__tile"><span>Schools</span><IconCount label="Schools within 1 km" groups={[{ id: "p", label: "primary", count: 3, icon: "building-school" }, { id: "s", label: "secondary", count: 1, icon: "school" }]} /></div>
        <div className="dev-charts__tile"><span>Income</span><Value big="unknown" /><SegmentScore score={null} tone="better-high" label="Income score" /></div>
        <div className="dev-charts__tile"><span>Council tax</span><Value big="£1,964" /><BandScale bands={COUNCIL_TAX} current="D" label="Council tax band" /></div>
      </div>
    </main>
  );
}
