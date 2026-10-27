"use client";

import {
  BUILD_CHIPS,
  buildChips,
  buildFromChips,
  GROWTH_YEARS,
  PROPERTY_TYPES,
  SALE_ATTRIBUTION,
  SALE_NO_DATA,
  SALE_PIN_MIN_ZOOM,
  saleStops,
  TENURE_CHIPS,
  tenureChips,
  tenureFromChips,
  yearChipOptions,
  yearChips,
  yearsFromChips,
  type PropertyType,
  type SaleColourBy,
  type SaleFilters,
  type SaleScale,
  type SaleView,
} from "@/lib/map-sale-layers";
import { MoneyInput } from "./money-input";
import { RampSatin } from "./ramp-knit";
import { ChipList, Segmented, SubGroup } from "./show-sub-options";
import { Term } from "./term";

const COLOUR_BY: Array<{ id: SaleColourBy; label: string }> = [
  { id: "price", label: "Sold price" },
  { id: "growth", label: "Growth" },
];

const SCALES: Array<{ id: SaleScale; label: string }> = [
  { id: "cheaper", label: "Cheaper" },
  { id: "default", label: "Default" },
  { id: "expensive", label: "Expensive" },
];

/** The legend chip while individual sales are on: what the pins show, and their colours low to high. */
export function SalesLegendCompact({ view }: { view: SaleView }) {
  const stops = saleStops(view);
  return (
    <span className="map-legend map-legend--sales" data-testid="map-legend">
      <span className="map-legend-caption" data-testid="legend-caption">
        Recent sales · {view.colourBy === "growth" ? "their area's price growth" : "price paid"} · grey = no data
      </span>
      <span className="map-legend-bar" aria-hidden="true">
        <RampSatin colours={stops.map((stop) => stop.colour)} steps={9} width={320} height={14} className="map-legend-gradient" />
      </span>
      <span className="map-legend-stops">
        <span data-edge="start" style={{ left: 0 }}>{stops[0]?.label}</span>
        <span data-edge="end" style={{ left: "100%" }}>{stops.at(-1)?.label}</span>
      </span>
    </span>
  );
}

/** What the ⓘ beside "Recent sales" in Show says: the method and HM Land Registry's licence. */
export function SalesAbout() {
  return (
    <>
      <p>One pin per home at its last recorded sale; growth is the change of its area&apos;s £/m² index. No pin carries a value for the home today or its own £/m².</p>
      <p>Zoomed out, cells show the median of the last five years; filters apply to single pins from zoom {SALE_PIN_MIN_ZOOM}.</p>
      <p className="term-row">New to UK buying? <Term id="leasehold" /> <Term id="chain" /> <Term id="gazumping" /></p>
      <p className="licence-note">{SALE_ATTRIBUTION}</p>
    </>
  );
}

/**
 * Show › Recent sales, in Show's one sub-option pattern (show-sub-options.tsx): Colour by,
 * Scale (or Growth over), a one-row key, then chip lists with All · None for type, tenure, new build and
 * years, and the price range. The method and licence sit behind the item's ⓘ; one muted line stays.
 */
export function SalesPanel({ view, latestYear, zoom, onChange }: {
  view: SaleView;
  latestYear: number;
  zoom: number;
  onChange: (view: SaleView) => void;
}) {
  const setFilters = (filters: Partial<SaleFilters>) => onChange({ ...view, filters: { ...view.filters, ...filters } });
  const stops = saleStops(view);
  const filtered = zoom >= SALE_PIN_MIN_ZOOM;
  const tenure = tenureChips(view.filters.tenure);
  const build = buildChips(view.filters.newBuild);
  const years = yearChips(view.filters.years, latestYear);
  return (
    <section className="sales-panel show-sub" data-testid="sales-panel" aria-label="Recent sales options">
      <SubGroup label="Colour by" testId="sales-colour-by">
        <Segmented options={COLOUR_BY} value={view.colourBy} onChange={(colourBy) => onChange({ ...view, colourBy })} />
      </SubGroup>
      {view.colourBy === "growth" ? (
        <SubGroup label="Growth over" testId="sales-growth">
          <Segmented options={GROWTH_YEARS.map((years) => ({ id: years, label: `${years}y` }))} value={view.years}
            onChange={(years) => onChange({ ...view, years })} />
        </SubGroup>
      ) : (
        <SubGroup label="Scale" testId="sales-scale">
          <Segmented options={SCALES} value={view.scale} onChange={(scale) => onChange({ ...view, scale })} />
        </SubGroup>
      )}
      {/* One row: the colours low to high, three labels at most (low · middle · high), then No data. */}
      <div className="show-sub__key" data-testid="sales-legend" role="img"
        aria-label={`Colours from ${stops[0]?.label} to ${stops.at(-1)?.label}; grey: no data`}>
        <span className="show-sub__key-ramp">
          <span className="show-sub__key-swatches">
            {stops.map((stop) => <i key={stop.value} style={{ background: stop.colour }} />)}
          </span>
          <span className="show-sub__key-labels" aria-hidden="true">
            <span>{stops[0]?.label}</span>
            <span>{stops[Math.floor((stops.length - 1) / 2)]?.label}</span>
            <span>{stops.at(-1)?.label}</span>
          </span>
        </span>
        <span className="show-sub__key-none" aria-hidden="true"><i style={{ background: SALE_NO_DATA }} />No data</span>
      </div>
      <ChipList label="Type" testId="sales-types" options={PROPERTY_TYPES} picked={view.filters.types}
        onToggle={(type) => setFilters({ types: toggleType(view.filters.types, type) })}
        onAll={() => setFilters({ types: PROPERTY_TYPES.map((type) => type.id) })} onNone={() => setFilters({ types: [] })} />
      <ChipList label="Tenure" testId="sales-tenure" options={TENURE_CHIPS} picked={tenure}
        onToggle={(chip) => setFilters({ tenure: tenureFromChips(toggle(tenure, chip)) })}
        onAll={() => setFilters({ tenure: "any" })} onNone={() => setFilters({ tenure: "none" })} />
      <ChipList label="New build" testId="sales-build" options={BUILD_CHIPS} picked={build}
        onToggle={(chip) => setFilters({ newBuild: buildFromChips(toggle(build, chip)) })}
        onAll={() => setFilters({ newBuild: "any" })} onNone={() => setFilters({ newBuild: "none" })} />
      <ChipList label="Years" testId="sales-years" options={yearChipOptions(latestYear)} picked={years}
        onToggle={(chip) => setFilters({ years: yearsFromChips(toggle(years, chip), latestYear) })}
        onAll={() => setFilters({ years: null })} onNone={() => setFilters({ years: [] })} />
      <SubGroup label="Price, £" testId="sales-price">
        <div className="show-sub__fields">
          <label><span className="sr-only">Price from, £</span><MoneyInput className="knit-field" value={view.filters.minPrice} onValue={(minPrice) => setFilters({ minPrice })} /></label>
          <span aria-hidden="true">to</span>
          <label><span className="sr-only">Price to, £</span><MoneyInput className="knit-field" value={view.filters.maxPrice} onValue={(maxPrice) => setFilters({ maxPrice })} /></label>
        </div>
      </SubGroup>
      <p className="show-sub__note" data-testid="sales-note">
        HM Land Registry · {filtered ? "filters apply to the pins" : `filters apply from zoom ${SALE_PIN_MIN_ZOOM}`}
      </p>
    </section>
  );
}

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];
}

function toggleType(types: PropertyType[], type: PropertyType): PropertyType[] {
  return toggle(types, type);
}
