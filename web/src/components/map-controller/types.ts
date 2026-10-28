import type { Map as MapLibreMap } from "maplibre-gl";

import type { GeographyId, MapDefinition, MatchPack, ValuePack } from "@/lib/contracts";
import type { AreaBoxes } from "@/lib/area-boxes";
import type { CustomRollup } from "@/lib/custom-criteria";
import type { PaintedValues } from "@/lib/layer-explainer";
import type { LegendScaleMode, LegendStop } from "@/lib/legend-scale";
import type { CollisionView } from "@/lib/map-collisions";
import type { MapCard } from "@/lib/map-pick";
import type { PlaceView } from "@/lib/map-place-layers";
import type { DwellingFeature } from "@/lib/map-property-layers";
import type { SalePinSelection, SaleView } from "@/lib/map-sale-layers";
import type { SchoolFilter } from "@/lib/map-school-layer";
import type { DataMode, MapState } from "@/lib/map-state";
import type { UpdateScope } from "@/lib/map-update-scheduler";
import type { DetailLayerId } from "@/lib/nature-layers";
import type { ChangeWindow } from "@/lib/price-change";

export interface AreaMapProps {
  metric: MapDefinition;
  matchPack: MatchPack | null;
  /** A pack built in the browser (a custom criterion): painted as is with the metric's legend, never fetched. */
  clientPack?: ValuePack | null;
  /** Hover lines for an area of the client pack (a custom criterion's exact counts). */
  clientTooltip?: ((geographyId: string) => string[]) | null;
  /**
   * The client pack rolled up to MSOAs, which the map paints below WIDE_ZOOM as for every other layer (a ready-made
   * criterion: England's 6,900 MSOAs instead of 33,000 LSOAs, perf/layer-load); it resolves null for a household's own.
   */
  clientRollup?: (() => Promise<CustomRollup | null>) | null;
  mode: DataMode;
  release: string;
  period: string;
  scaleMode: LegendScaleMode;
  /** Years compared by the change scale. */
  changeWindow: ChangeWindow;
  excludedCrime: string[];
  onLegendStops: (stops: LegendStop[] | null) => void;
  /** London median of the painted price pack (null for other layers), for the legend tick. */
  onMedian: (median: number | null) => void;
  /** Every area's painted value (the legend "?" places London typical and the chosen area on the scale). */
  onPainted?: (painted: PaintedValues) => void;
  /** Layers › None: the plain map, area colours off (areas still take a tap). */
  plain?: boolean;
  /** Crime types in the painted pack (empty for other layers), for the dock's checklist. */
  onCrimeCategories: (categories: string[]) => void;
  /** Where the ⓘ corner shows the map attribution; null until it mounts. */
  attributionHost: HTMLElement | null;
  /** Hands the MapLibre instance to overlays drawn outside this component (My match); null on teardown. */
  onMap?: (map: MapLibreMap | null) => void;
  selected: GeographyId | null;
  pitch: number;
  focus: [number, number] | null;
  /** The home picked from search: a pin at its location; null for none. */
  pin?: [number, number] | null;
  /** A tapped object's card (a place, a school, a collision, a tree) for the sheet; null when a tap lands elsewhere. */
  onPick?: (card: MapCard | null) => void;
  initialCamera: MapState;
  onCamera: (state: MapState) => void;
  onPitch: (pitch: number) => void;
  onSelect: (id: GeographyId) => void;
  onSelectDwelling: (dwelling: DwellingFeature) => void;
  /** Individual-sales view on the house-level layers; null where it does not apply. */
  sales: SaleView | null;
  /** The Places overlay, drawn over whichever layer colours the map. */
  places: PlaceView;
  /** The Cycle lanes overlay (TfL), drawn under the labels. */
  cycleLanes?: boolean;
  /** Show › Stations: the rail network (on unless turned off). */
  stations?: boolean;
  /** Show › Schools: every open school as a cap; a tap opens its card. */
  schools?: boolean;
  /** Show › Schools' filters: which types, Ofsted grades, Top 10% only. */
  schoolFilter?: SchoolFilter;
  /** The Road collisions overlay (DfT STATS19) with its filters; null or absent when off. */
  collisions?: CollisionView | null;
  /** Show › Street trees (GLA): a green heat from zoom 12, one dot per tree from 16. */
  streetTrees?: boolean;
  /** Layers › Nature › Green & trees › Green streets (road links by their street trees) or Green cover (canopy): the area fill is left clear. */
  detailLayer?: DetailLayerId | null;
  /** Fit the view to this area (set when a ranked match is chosen). */
  /** An area to fit; with a zoom (a link's ?z=), centred at that zoom instead of its whole box. */
  zoomTo: { id: GeographyId; nonce: number; zoom?: number } | null;
  onSelectSale: (sale: SalePinSelection) => void;
  /** Parcel of the selected dwelling (from its property payload); highlighted on the map. */
  selectedParcelId: string | null;
  /** The home chosen on the map ([lng, lat] from its property payload): a cobalt ring at the home. */
  chosenHome?: [number, number] | null;
}

/** The parent's handlers, kept current by the component (the map's events read the latest). */
export interface MapCallbacks {
  onCamera: (state: MapState) => void;
  onPitch: (pitch: number) => void;
  onSelect: (id: GeographyId) => void;
  onSelectDwelling: (dwelling: DwellingFeature) => void;
  onSelectSale: (sale: SalePinSelection) => void;
  onMedian: (median: number | null) => void;
  onPainted?: (painted: PaintedValues) => void;
}

export interface RefreshOutcome {
  ready: boolean;
  pack: ValuePack | null;
  rescale: LegendStop[] | null;
  /** What did not load: the layer's values (colours) or the area shapes. */
  failed?: "colours" | "shapes";
}

export interface RefreshTicket {
  sequence: number;
  scope: UpdateScope;
}

/** What the map paints: pack values already reduced to display values
 * (crime filter, percentile mode) plus the legend stops that describe them. */
export interface AnalyticsView {
  pack: ValuePack;
  metric: MapDefinition;
  selected: GeographyId | null;
  scaleMode: LegendScaleMode;
  rescale: LegendStop[] | null;
  /** Price: London median of the pack as published, for the legend tick; null for other layers. */
  median: number | null;
  /** The rank scale's breaks taken from the areas in view (lib/view-scale.ts); null on any other scale. */
  viewBreaks?: readonly number[] | null;
  /** The measured values behind a view-scale paint (pack.values hold places on the scale), for the explainer. */
  raw?: ValuePack["values"] | null;
  /** The reader's own range (lib/legend-range.ts): the ramp's colours evenly over 0..100, pack.values places on it. */
  custom?: LegendStop[] | null;
}

/** What the last paint drew, to recolour it when the view moves without new pieces (rescaleOnMove). */
export interface LastPaint {
  pack: ValuePack;
  props: AreaMapProps;
  base: ValuePack | null;
  data: AreaBoxes;
  level: string;
  ticket: RefreshTicket;
}

/** One morph frame: when it ran, ms spent writing weights, timeline position (morphs landed + progress) and weight t. */
export interface MorphSample {
  at: number;
  writeMs: number;
  position: number;
  weight: number;
}
