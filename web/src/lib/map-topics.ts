/**
 * "Colour the map by": every map layer a household can choose, grouped in the order people decide
 * (cost first, then safety, getting around, ...). The single source of truth for the data selector;
 * tests/map-topics.test.ts keeps every published layer and every ready-made criterion here exactly once.
 * Recent sales and Local places are overlays drawn on top, listed separately in MAP_OVERLAYS.
 */
import { CENSUS_LAYERS, isMsoaFigure, MSOA_FIGURES_NOTE, type CensusLayer } from "./census-layers";
import { isCustomLayerId } from "./custom-criteria";
import { isDescriptiveLayer, type MapLayerId, type MetricDefinition, type MetricId } from "./contracts";
import { customLayerId, describeFormula, type CustomCriterion } from "./custom-criteria";
import { CUSTOM_PRESETS, type CustomPreset } from "./custom-presets";
import type { LegendScaleMode } from "./legend-scale";
import { chunkRegion, type MapCoverage } from "./map-coverage";
import { MERGED_LAYERS } from "./map-state";
import { DETAIL_AREA_LAYER, DETAIL_LAYER_IDS, WILDLIFE_SPECIES } from "./nature-layers";
import { LONDON_REGION } from "./scope-name";
import { sortByTopic, type TopicId } from "./topic-order";
import { TYPICAL_PRICE_TYPES } from "./typical-price";

export type TopicKind = "metric" | "preset" | "custom";

export type TopicGroupId =
  | "cost" | "safety" | "getting-around" | "homes-area" | "nature" | "people" | "food-drink" | "going-out" | "everyday-life" | "my-criteria";

/** One way to read an item: another layer (a type of home) or another scale (rank, change). */
export interface TopicView {
  id: string;
  label: string;
  /** The words on the legend chip and the Layers tooltip when the button's own are short ("Rank" › "Rank in London"). */
  long?: string;
  /** Its own layer; a Green & trees view can be one drawn finer than areas, a Cafés view a ready-made criterion. */
  layer?: MapLayerId;
  scale?: LegendScaleMode;
  /** A second level under this view (Ethnic makeup › Asian: All Asian, Indian, …); the first is the view's own layer. */
  subviews?: readonly TopicView[];
  /** What the view shows, in one line under the views and on the legend (Green & trees: "all greenery from satellite, gardens too"). */
  note?: string;
}

/** A long list picked with a search, under an item's views (Country of birth › Pick a country): each option is its own layer. */
export interface TopicPicks {
  label: string;
  /** The search box's placeholder ("Search countries"). */
  search: string;
  /** Said under the list and on the legend: what the options' figures cover (MSOA figures); none for per-area figures. */
  note?: string;
  options: readonly TopicView[];
}

export interface MapTopic {
  /** The layer id, or "build-your-own" for the item that opens the criterion builder. */
  id: string;
  group: TopicGroupId;
  /** A short, self-explanatory name ("Cycling"): it fits the selector button. */
  label: string;
  kind: TopicKind;
  /** The layer it colours the map with; null for Build your own. */
  layer: MapLayerId | null;
  views?: readonly TopicView[];
  picks?: TopicPicks;
  /** Extra words people search with; label, view and pick labels are searched too. */
  keywords: readonly string[];
  /** An item without views: what it measures in a word or two ("Road and rail"), the phone pill's view. */
  measure?: string;
}

export interface TopicGroup {
  id: TopicGroupId;
  label: string;
  items: readonly MapTopic[];
}

/** Published layers deliberately left out of the selector, with the reason. */
export const LAYER_EXCLUSIONS: Partial<Record<MetricId, string>> = {
  "stock-value-per-square-metre": "Merged into Price per m² (MERGED_LAYERS): homes at house zoom show their recorded sale.",
  // Layers v5 (PR 1): borough-wide figures that paint one colour per borough; ?layer= links still open them.
  "mobile-4g-indoor": "Dropped from the menu (Layers v5): one Ofcom figure per borough, replaced by Broadband (PR 3); its link still paints it.",
  "mobile-5g-outdoor": "Dropped from the menu (Layers v5): one Ofcom figure per borough, replaced by Broadband (PR 3); its link still paints it.",
  // Layers v5: New stations become pins (a points endpoint, PR 2); the km figure stays for find_areas and links.
  "future-station-distance": "Pins only (Layers v5): the km figure serves find_areas and ?layer= links, not the menu.",
  // Layers v5 (PR 3): what a month's rent costs answers more than how fast it moved.
  "rent-change-1y": "Replaced by Typical rent (Layers v5 PR 3); ?layer= links still paint it.",
  "rent-change-5y": "Replaced by Typical rent (Layers v5 PR 3); ?layer= links still paint it.",
};

/**
 * Ready-made criteria kept in the API's list (api/area_api/fixtures/custom-presets.json) but out of the menu,
 * with the reason (Layers v5). Their links keep working: /explore/<slug> and ?layer=custom:<id> paint the
 * criterion (lib/explore-redirect.ts, MERGED_LAYERS); one saved in the profile is listed under My criteria.
 */
export const PRESET_EXCLUSIONS: Readonly<Record<string, string>> = {
  "kebab-cafe": "The inverse of Cafés › Coffee vs kebab (MERGED_LAYERS opens that view).",
  "quiet-nights": "Nightlife with the direction set to lower, which every criterion offers (MERGED_LAYERS opens Nightlife).",
  "pret-greggs": "A brand pair, not a question about an area; the builder still makes it.",
  "bakeries-betting": "A novelty pair; the builder still makes it.",
  coworking: "Counts cafés, so it is the Cafés map once more; the builder still makes it.",
  universities: "Replaced by Student areas (Layers v5 PR 3): its link opens Student areas (MERGED_LAYERS), with the universities as points.",
};

/**
 * Show's rows (map-layers.tsx), in order: what is drawn on top of the colours, each keyed by its yarn. `londonOnly`:
 * drawn from a London source that is no metric, so the catalog has no coverage for it (TfL's network file, TfL's
 * cycle lanes, the GLA's street trees); the row says "London only" on the England map.
 */
export const MAP_OVERLAYS = [
  { id: "places", label: "Local places", yarn: "var(--marker-place)" },
  { id: "schools", label: "Schools", yarn: "var(--yarn-sun)" },
  { id: "sales", label: "Recent sales", yarn: "var(--marker-sale)" },
  { id: "stations", label: "Stations", yarn: "var(--yarn-cobalt)", londonOnly: true },
  { id: "mine", label: "My places", yarn: "var(--ink)" },
  { id: "cycle-lanes", label: "Cycle lanes", yarn: "var(--yarn-sky)", londonOnly: true },
  { id: "collisions", label: "Road collisions", yarn: "var(--danger)" },
  { id: "trees", label: "Street trees", yarn: "var(--yarn-leaf)", londonOnly: true },
] as const;

const PRICE_VIEWS: readonly TopicView[] = [
  { id: "actual", label: "Actual", scale: "linear" },
  { id: "rank", label: "Rank", long: "Rank in London", scale: "percentile" },
  { id: "change", label: "Change", scale: "change" },
  // UK HPI (migration 080), a view since Layers v5: one borough-wide figure, the latest month; 5 or 10 years under it.
  { id: "hpi", label: "Borough HPI", long: "Borough HPI · 5 yrs", layer: "hpi-change-5y", note: "change · official borough index", subviews: [
    { id: "hpi-5y", label: "5 yrs", long: "Borough HPI · 5 yrs", layer: "hpi-change-5y" },
    { id: "hpi-10y", label: "10 yrs", long: "Borough HPI · 10 yrs", layer: "hpi-change-10y" },
  ] },
];

/** Wealth (Layers v5): household income and the deprivation index paint near the same map, so one item, two views. */
const WEALTH_VIEWS: readonly TopicView[] = [
  { id: "income", label: "Income", long: "Household income", layer: "income" },
  { id: "deprivation", label: "Deprivation", layer: "deprivation" },
];

/** Green & trees' views: one line each says what it is. */
const GREEN_VIEWS: readonly TopicView[] = [
  { id: "area-score", label: "Area score", layer: "nature-score", note: "green land, street trees, nature sites" },
  { id: "green-cover", label: "Green cover", layer: "canopy", note: "all greenery from satellite, gardens too" },
  // Street trees (Show) come on with it: one dot per tree from street zoom (Layers v5).
  { id: "green-streets", label: "Green streets", layer: "green-streets", note: "council street trees per 100 m of road, each tree at street zoom" },
];

type Item = Omit<MapTopic, "group">;

function metric(id: MetricId, label: string, keywords: string[], views?: readonly TopicView[]): Item {
  return { id, label, kind: "metric", layer: id, keywords, ...(views ? { views } : {}) };
}

/**
 * A Census 2021 item: its first category is shown when chosen, each category is a view (a layer of its own).
 * An Ethnic makeup group's detailed groups are its subviews, after "All <group>" (the group's own layer).
 * A detailed table's categories (Country of birth's 190 countries, MSOA figures) are picks: a searchable
 * list under the views, or the item's only list (Main language).
 */
function census(topic: CensusLayer["topic"]): Item {
  const layer = CENSUS_LAYERS.find((entry) => entry.topic === topic);
  if (!layer) throw new Error(`No Census layer "${topic}"`);
  const first = (layer.views[0] ?? layer.picks?.views[0])!.metric;
  const views = layer.views.map((view): TopicView => ({
    id: view.id, label: view.label, layer: view.metric,
    ...(view.subviews ? { subviews: [
      { id: `${view.id}-all`, label: `All ${view.label}`, layer: view.metric },
      ...view.subviews.map((sub) => ({ id: sub.id, label: sub.label, layer: sub.metric })),
    ] } : {}),
  }));
  const picks = layer.picks ? {
    label: layer.picks.label, search: layer.picks.search,
    ...(layer.picks.views.some((entry) => entry.msoa) ? { note: MSOA_FIGURES_NOTE } : {}),
    options: layer.picks.views.map((entry) => ({ id: entry.id, label: entry.label, layer: entry.metric })),
  } : undefined;
  return {
    id: first, label: layer.label, kind: "metric", layer: first, keywords: [...layer.keywords], ...(views.length ? { views } : {}),
    ...(picks ? { picks } : {}),
  };
}

/**
 * Country of birth with Main language and Passports held as more picks in its one list (Layers v5): they
 * draw the same map again, so each option says which table it is ("Passport: Poland", "Language: Polish").
 */
function countryOfBirth(): Item {
  const base = census("country-of-birth");
  const extra = [["main-language", "Language"], ["passports", "Passport"]] as const;
  const tables = extra.map(([topic, word]) => ({ word, layer: CENSUS_LAYERS.find((entry) => entry.topic === topic)!, topic }));
  const options = tables.flatMap(({ topic, word, layer }) =>
    layer.picks!.views.map((entry): TopicView => ({ id: `${topic}-${entry.id}`, label: `${word}: ${entry.label}`, layer: entry.metric })));
  return {
    ...base, keywords: [...base.keywords, ...tables.flatMap(({ layer }) => layer.keywords)],
    picks: { ...base.picks!, label: "Pick a country, language or passport", search: "Search countries, languages, passports", options: [...base.picks!.options, ...options] },
  };
}

function presetCriterion(criterionId: string): CustomPreset {
  const found = CUSTOM_PRESETS.find((entry) => entry.criterion.id === criterionId);
  if (!found) throw new Error(`No ready-made criterion "${criterionId}"`);
  return found;
}

/** A ready-made criterion under a short name; its long label and description stay searchable. */
function preset(criterionId: string, name: string, keywords: string[]): Item {
  const found = presetCriterion(criterionId);
  const layer = customLayerId(found.criterion);
  return { id: layer, label: name, kind: "preset", layer, keywords: [...keywords, found.criterion.label, found.description] };
}

/** One item over several ready-made criteria, each a view (Cafés: specialty, vs kebab, independent); the first is its own layer. */
function presetViews(name: string, keywords: string[], views: readonly { id: string; label: string; long?: string; criterion: string }[]): Item {
  const found = views.map((view) => ({ ...view, preset: presetCriterion(view.criterion) }));
  return {
    ...preset(found[0].criterion, name, keywords),
    keywords: [...keywords, ...found.flatMap((view) => [view.preset.criterion.label, view.preset.description])],
    views: found.map(({ id, label, long, preset: entry }) => ({ id, label, ...(long ? { long } : {}), layer: customLayerId(entry.criterion) })),
  };
}

const BUILD_YOUR_OWN: Item = {
  id: "build-your-own", label: "Build your own",
  kind: "custom", layer: null, keywords: ["custom", "create", "new", "criterion", "own"],
};

function ownCriterion(criterion: CustomCriterion): Item {
  const layer = customLayerId(criterion);
  return { id: layer, label: criterion.label, kind: "custom", layer, keywords: ["mine", "custom", describeFormula(criterion)] };
}

const GROUP_LIST: readonly { id: TopicGroupId; label: string; items: readonly Item[] }[] = [
  { id: "cost", label: "Cost", items: [
    metric("price-per-square-metre", "Price per m²", ["price", "sold", "square metre", "sqm", "value", "cheap", "expensive", "afford",
      "price change", "growth", "house price index", "hpi", "rising", "falling", "land registry"], PRICE_VIEWS),
    // One period only (no timeline): the Layers menu tags it "Latest".
    metric("typical-price", "Typical price", ["price", "house price", "median", "afford", "cheap", "expensive", "typical home price"],
      TYPICAL_PRICE_TYPES.map((type) => (type.id === "typical-price"
        ? { id: type.id, label: "All", long: type.label, layer: type.id }
        : { id: type.id, label: type.label, layer: type.id }))),
    // Borough figures (ONS PIPR, Layers v5 PR 3): the average monthly rent by bedrooms, 2 bedrooms first shown.
    metric("typical-rent", "Typical rent", ["rent", "rents", "renting", "monthly rent", "private rent", "let", "tenancy",
      "bedroom", "rent change", "rent rise"],
      [{ id: "typical-rent-1-bed", label: "1 bed", long: "1 bedroom", layer: "typical-rent-1-bed" },
        { id: "typical-rent", label: "2 beds", long: "2 bedrooms", layer: "typical-rent" },
        { id: "typical-rent-3-bed", label: "3 beds", long: "3 bedrooms", layer: "typical-rent-3-bed" }]),
    metric("council-tax-band-mean", "Council tax band", ["council tax", "band", "bill", "valuation", "voa", "cost"]),
  ] },
  { id: "safety", label: "Safety", items: [
    metric("crime", "Crime", ["safe", "safety", "police", "burglary", "theft", "violence", "antisocial"]),
    // The rate by neighbourhood; choosing it turns the Road collisions dots on at street zoom (Layers v5, use-explorer-controller.ts).
    { ...metric("road-collisions", "Road danger", ["collision", "collisions", "road", "traffic", "accident", "pedestrian", "cyclist", "injury", "safety"]), measure: "Hurt per 1,000" },
  ] },
  { id: "getting-around", label: "Transport", items: [
    metric("station-access", "Station walk", ["station", "walking", "tube", "train", "rail", "overground", "dlr", "commute", "transport"]),
    preset("cycling", "Cycling", ["cycling", "bike", "bicycle", "santander"]),
    preset("ev-charging", "EV charging", ["electric", "car", "ev", "charger"]),
  ] },
  { id: "homes-area", label: "Homes & area", items: [
    metric("income", "Wealth", ["income", "earnings", "wealth", "salary", "deprivation", "imd", "poverty"], WEALTH_VIEWS),
    { ...metric("noise", "Noise", ["noise", "quiet", "loud", "road", "traffic", "rail", "peaceful", "db"]), measure: "Road and rail" },
    // Share of homes in a medium or high NaFRA2 band from rivers and the sea or surface water (Layers v5 PR 3).
    { ...metric("flood-risk", "Flood risk", ["flood", "flooding", "flood risk", "river", "surface water", "rain", "environment agency", "insurance"]), measure: "Rivers, sea, rain" },
    { ...metric("air-no2", "Clean air", ["air", "clean air", "pollution", "no2", "nitrogen dioxide", "emissions", "laei"]), measure: "NO₂" },
    // Social rent is Tenure's third view (its old links open it there).
    census("tenure"),
    census("accommodation"),
    // HMLR CCOD/OCOD land titles per 100 homes (deploy/tools/etl_ownership.py); the card block waits on CLOSE_KNIT_OWNERSHIP.
    metric("ownership-company-share", "Company owners", ["company", "companies", "owned", "ownership", "landlord",
      "overseas", "offshore", "foreign", "investor", "ccod", "ocod", "land registry"], [
      { id: "ownership-company-share", label: "UK", long: "UK companies", layer: "ownership-company-share" },
      { id: "ownership-overseas-share", label: "Overseas", long: "Overseas companies", layer: "ownership-overseas-share" },
    ]),
    metric("short-lets-per-1000", "Short lets", ["short lets", "airbnb", "holiday lets", "tourists", "lettings"]),
    // New homes permitted or being built per 1,000 homes (London Development Database, migration 085).
    metric("pipeline-homes-per-1000", "New homes", ["new homes", "development", "construction", "building", "pipeline",
      "regeneration", "opportunity area", "housing zone", "planning permission", "new build"]),
    // Ofcom per neighbourhood (Layers v5 PR 3 batch 2): where Mobile signal (one figure per borough) sat.
    { ...metric("broadband-gigabit", "Broadband", ["broadband", "internet", "fibre", "full fibre", "gigabit", "wifi",
      "wi-fi", "speed", "work from home", "ofcom"]), measure: "Gigabit available" },
    // Licensed HMOs per 1,000 homes; grey where the borough has not published its register.
    metric("hmo-per-1000", "HMOs", ["hmo", "hmos", "shared house", "house share", "multiple occupation", "landlord licensing", "selective licensing"]),
  ] },
  // Wildlife seen: one view per species, grey where records are too few (lib/nature-layers.ts).
  { id: "nature", label: "Nature", items: [
    // One green item, three views (like Price per m²'s). Area score: green land, street trees and a
    // nature site nearby as one London rank. Green cover (layer "canopy") and Green streets are drawn finer
    // than areas (lib/map-street-trees.ts); their old links (?layer=canopy, ?layer=green-streets) open these views.
    metric("nature-score", "Green & trees", ["green", "greenery", "trees", "leafy", "park", "nature", "garden", "ndvi",
      "canopy", "green cover", "satellite", "gardens", "street trees", "avenue", "tree-lined", "road", "shade"], GREEN_VIEWS),
    metric("wildlife-hedgehog", "Wildlife seen", ["wildlife", "animals", "birds", "bird", "mammal", "species",
      ...WILDLIFE_SPECIES.map((species) => species.label.toLowerCase())],
      WILDLIFE_SPECIES.map((species) => ({ id: species.id, label: species.label, layer: species.id }))),
  ] },
  // Descriptive only: never ranked or matched (tests/census-layers.test.ts).
  { id: "people", label: "People", items: [
    // Main language and Passports held are picks under Country of birth (Layers v5); National identity and
    // Year of arrival stay their own items (owner decision).
    census("ethnicity"), countryOfBirth(), census("religion"), census("age"), census("household-type"),
    census("year-of-arrival"), census("national-identity"),
    // Census 2021 TS066 full-time students (Layers v5 PR 3), descriptive like the Census items; universities
    // and colleges show as points from street zoom (lib/map-university-layer.ts).
    { ...metric("student-share", "Student areas", ["student", "students", "university", "universities", "college", "campus", "halls"]), measure: "Full-time students" },
  ] },
  { id: "food-drink", label: "Food & drink", items: [
    // Four cuts of one café count, one item (Layers v5); Kebab shops vs cafés was the inverse of Coffee vs kebab.
    presetViews("Cafés", ["cafe", "cafes", "coffee", "flat white", "espresso", "kebab", "turkish", "independent", "chain"], [
      { id: "specialty", label: "Specialty", long: "Specialty coffee", criterion: "good-coffee" },
      { id: "vs-kebab", label: "Coffee vs kebab", criterion: "good-coffee-kebab" },
      { id: "independent", label: "Independent", long: "Independent vs chain", criterion: "indie-cafes" },
    ]),
    preset("food-variety", "Variety of cuisines", ["cuisine", "restaurant", "food", "eat"]),
    preset("late-night-food", "Takeaways", ["takeaway", "fast food", "late night"]),
    metric("food-hygiene", "Food hygiene", ["hygiene", "fsa", "rating", "restaurant", "clean"]),
  ] },
  { id: "going-out", label: "Going out", items: [
    preset("nightlife", "Nightlife", ["nightlife", "bar", "pub", "club", "drinks"]),
    preset("culture", "Culture", ["culture", "cinema", "theatre", "museum", "gallery", "arts"]),
  ] },
  { id: "everyday-life", label: "Everyday life", items: [
    // State schools in England's top 25% within 1.5 km of the area's centre (DfE, Layers v5 PR 3).
    metric("good-schools-nearby", "Good schools nearby", ["school", "schools", "good school", "primary", "secondary", "top school", "ks2", "gcse", "education"],
      [{ id: "good-schools-nearby", label: "Primary", layer: "good-schools-nearby" },
        { id: "good-schools-nearby-secondary", label: "Secondary", layer: "good-schools-nearby-secondary" }]),
    // Straight-line walking minutes to the nearest supermarket (OpenStreetMap) and GP practice (NHS England),
    // as the nearest-place criteria estimate a walk (Layers v5 PR 3 batch 2, migration 101).
    { ...metric("supermarket-walk", "Supermarket", ["supermarket", "supermarkets", "grocery", "groceries", "food shop",
      "shopping", "tesco", "sainsbury's", "waitrose", "lidl", "aldi", "co-op", "m&s"]), measure: "Walk to nearest" },
    { ...metric("gp-walk", "GP", ["gp", "doctor", "doctors", "surgery", "health", "medical", "practice", "nhs"]), measure: "Walk to nearest" },
    preset("family", "Families", ["family", "children", "kids", "playground", "nursery"]),
    preset("gyms", "Gyms", ["gym", "fitness", "sport", "exercise"]),
    preset("dog-friendly", "Dog-friendly", ["dog", "pet", "vet"]),
    preset("markets", "Markets", ["market", "street market", "food market"]),
  ] },
  { id: "my-criteria", label: "My criteria", items: [BUILD_YOUR_OWN] },
];

/** Each group's topic: nearby places are Local places, Homes & area is Homes (lib/topic-order.ts). */
const GROUP_TOPIC: Record<TopicGroupId, TopicId> = {
  cost: "price", safety: "safety", "getting-around": "getting-around", "homes-area": "homes", nature: "environment", people: "people",
  "food-drink": "local-places", "going-out": "local-places", "everyday-life": "local-places", "my-criteria": "my-criteria",
};

const GROUPS = sortByTopic(GROUP_LIST, (group) => GROUP_TOPIC[group.id]);

/**
 * All groups, with the household's own criteria at the top of My criteria. A ready-made criterion
 * the household saved already sits in its own group, so it is not listed twice.
 */
export function mapTopicGroups(custom: readonly CustomCriterion[] = []): TopicGroup[] {
  const own = custom.filter((criterion) => {
    // By id: one saved before its preset changed measure (gyms counted, now the nearest) shares the preset's
    // layer id, so it is not listed a second time.
    const preset = CUSTOM_PRESETS.find((entry) => entry.criterion.id === criterion.id);
    return !preset || preset.criterion.id in PRESET_EXCLUSIONS;
  }).map(ownCriterion);
  return GROUPS.map((group) => {
    const items = group.id === "my-criteria" ? [...own, ...group.items] : group.items;
    return { id: group.id, label: group.label, items: items.map((item) => ({ ...item, group: group.id })) };
  });
}

export const MAP_TOPIC_GROUPS: readonly TopicGroup[] = mapTopicGroups();

/** Layers behind a server flag (api/area_api/feature_flags.py, FLAGS.md): offered only when the release lists them. */
export const FLAGGED_LAYERS: readonly MetricId[] = ["air-no2"];

const REGION_SCOPE = "uk:region:";
const LONDON_SCOPE = `${REGION_SCOPE}${LONDON_REGION}`;

/**
 * The layers whose data is London's alone (FLAGS.md CLOSE_KNIT_ENGLAND, decision 4): blank outside London, so the
 * layer list says "London only" on the England map (lib/map-coverage.ts). Read from the release's catalog
 * (`coverage`, metric_coverage, migration 126): a metric whose one region with values is London; a layer drawn finer
 * than areas (Green streets, Green cover) as the area layer under it, built from the same trees and canopy. Empty
 * while the catalog is unknown (demo, or still loading). Never a hand-written list (tests/map-coverage.test.ts);
 * Show's overlays are no metrics and say it on their own row (MAP_OVERLAYS `londonOnly`).
 */
export function londonOnlyLayers(metrics: Iterable<Pick<MetricDefinition, "id" | "coverage">> | null): Set<string> {
  const only = new Set<string>();
  for (const metric of metrics ?? []) {
    const regions = (metric.coverage ?? []).filter((scope) => scope.scopeId.startsWith(REGION_SCOPE));
    if (regions.length > 0 && regions.every((scope) => scope.scopeId === LONDON_SCOPE)) only.add(metric.id);
  }
  if (only.has(DETAIL_AREA_LAYER)) DETAIL_LAYER_IDS.forEach((id) => only.add(id));
  return only;
}

/**
 * The regions (E12 codes) a metric has values in, from the release's catalog (`coverage`); null when it names none
 * (demo, a placeholder, or England-wide without region rows): then every piece is asked for.
 */
export function metricRegions(metric: Pick<MetricDefinition, "coverage">): Set<string> | null {
  const regions = (metric.coverage ?? []).filter((scope) => scope.scopeId.startsWith(REGION_SCOPE));
  return regions.length ? new Set(regions.map((scope) => scope.scopeId.slice(REGION_SCOPE.length))) : null;
}

/**
 * The pieces a metric has values in: one in a region outside the metric's (London's HMOs over Leeds, or the home
 * counties around a London start) is never asked for, so a London-only layer outside London sends no request and
 * the map says "London only" (CoverageNotice). A piece whose region is unknown is kept.
 */
export function piecesWithValues<T extends { chunk: string | null }>(pieces: readonly T[],
  metric: Pick<MetricDefinition, "coverage"> | null | undefined, coverage: MapCoverage | null | undefined): T[] {
  const regions = metric ? metricRegions(metric) : null;
  if (!regions || !coverage) return [...pieces];
  return pieces.filter((piece) => {
    const region = chunkRegion(coverage, piece.chunk);
    return region === null || regions.has(region);
  });
}

/** The flagged layers the release's metrics leave out; none while the list is unknown (demo, or still loading). */
export function hiddenTopicLayers(published: ReadonlySet<string> | null): string[] {
  return published ? FLAGGED_LAYERS.filter((layer) => !published.has(layer)) : [];
}

/** The groups the selector shows: hidden layers left out, then a group with no items yet is hidden. */
export function visibleTopicGroups(custom: readonly CustomCriterion[] = [], hidden: readonly string[] = []): TopicGroup[] {
  return mapTopicGroups(custom)
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.layer || !hidden.includes(item.layer)) }))
    .filter((group) => group.items.length > 0);
}

/** A group this small shows every item's views at once (Cost: Price per m² and Typical price): no second level. */
export const FLAT_GROUP_ITEMS = 3;
export const FLAT_ITEM_VIEWS = 6;

export function isFlatGroup(group: Pick<TopicGroup, "items">): boolean {
  return group.items.length <= FLAT_GROUP_ITEMS && group.items.every((item) =>
    (item.views?.length ?? 0) <= FLAT_ITEM_VIEWS && !item.picks && !item.views?.some((view) => view.subviews));
}

/** Only Price per m² has monthly history: its row carries the timeline. */
export function hasTimeline(item: Pick<MapTopic, "id">): boolean {
  return item.id === "price-per-square-metre";
}

/** One period only: tagged "Latest" in the Layers menu (Typical rent: the latest month's borough rents). */
export function isSinglePeriod(item: Pick<MapTopic, "id">): boolean {
  return item.id === "typical-price" || item.id === "typical-rent";
}

/**
 * Census layers (and Student areas, from the Census) are described, never ranked: the Layers menu gives them no "Top 10 →". Deprivation
 * (owner decision), household income and social renting rank like any layer.
 */
export function isRankedLayer(layer: string): boolean {
  return !isDescriptiveLayer(layer);
}

/** Columns of an item's view buttons: one row up to five short views, else rows of three. */
export function topicViewColumns(item: MapTopic): number {
  const views = item.views ?? [];
  const long = views.some((view) => view.label.length > 9);
  return views.length <= 3 ? Math.max(1, views.length) : views.length > 5 || long ? 3 : views.length;
}

/** A view and its subviews, flat. */
function withSubviews(views: readonly TopicView[]): TopicView[] {
  return views.flatMap((view) => [view, ...(view.subviews ?? [])]);
}

/** The ready-made criterion behind a view's or an item's layer (Cafés › Independent); null for a metric. */
export function presetOfLayer(layer: MapLayerId | string | null | undefined): CustomPreset | null {
  if (!layer || !isCustomLayerId(layer)) return null;
  return CUSTOM_PRESETS.find((entry) => customLayerId(entry.criterion) === layer) ?? null;
}

/** Every layer an item can colour the map with: its own, its views', their subviews' and its picks'. */
export function topicLayers(item: MapTopic): MapLayerId[] {
  const layers = [item.layer, ...withSubviews(item.views ?? []).map((view) => view.layer), ...(item.picks?.options ?? []).map((view) => view.layer)];
  return [...new Set(layers.filter((layer): layer is MapLayerId => !!layer))];
}

/** The item behind a layer (a type view or a merged layer finds its item); null when none lists it. */
export function findTopic(layerId: MapLayerId | string, custom: readonly CustomCriterion[] = []): MapTopic | null {
  const target = MERGED_LAYERS[layerId as MapLayerId] ?? layerId;
  for (const group of mapTopicGroups(custom)) {
    const item = group.items.find((entry) => topicLayers(entry).includes(target as MapLayerId));
    if (item) return item;
  }
  return null;
}

/** A layer's theme (its selector group) and page section (the group's topic); null when no item lists it. */
export function topicOfLayer(layerId: string): { group: TopicGroupId; topic: TopicId } | null {
  const item = findTopic(layerId);
  return item ? { group: item.group, topic: GROUP_TOPIC[item.group] } : null;
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Items whose label, views, picks, group or keywords hold every word of the query, in group order. */
export function searchTopics(query: string, custom: readonly CustomCriterion[] = [], hidden: readonly string[] = []): MapTopic[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return visibleTopicGroups(custom, hidden).flatMap((group) => group.items.filter((item) => {
    const labels = [...withSubviews(item.views ?? []), ...(item.picks?.options ?? [])].map((view) => view.label);
    const haystack = fold([group.label, item.label, ...labels, ...item.keywords].join(" "));
    return words.every((word) => haystack.includes(word));
  }));
}

/** What the selector reads from the map to say which view of an item is on. */
export interface TopicViewState {
  layer: MapLayerId;
  scaleMode: LegendScaleMode;
}

/** The view of an item the map shows: its layer (a type of home), else its scale; null for an item without views or on a pick. */
export function activeTopicView(item: MapTopic, state: TopicViewState): TopicView | null {
  const views = item.views;
  if (!views || activeTopicPick(item, state)) return null;
  const target = MERGED_LAYERS[state.layer] ?? state.layer;
  const byLayer = views.find((view) => view.layer === target || view.subviews?.some((sub) => sub.layer === target));
  if (byLayer) return byLayer;
  return views.find((view) => view.scale === state.scaleMode) ?? views.find((view) => view.scale || view.layer) ?? null;
}

/** The one line a layer's view says what it is (Green & trees › Green cover: "all greenery from satellite, gardens too"); null when none. */
export function topicViewNote(layerId: MapLayerId | string): string | null {
  for (const group of MAP_TOPIC_GROUPS) {
    for (const item of group.items) {
      const note = item.views?.find((view) => view.layer === layerId)?.note;
      if (note) return note;
    }
  }
  return null;
}

/** The subview the map shows under the active view (Ethnic makeup › Asian › Indian); null when the view has none. */
export function activeTopicSubview(item: MapTopic, state: TopicViewState): TopicView | null {
  const target = MERGED_LAYERS[state.layer] ?? state.layer;
  return activeTopicView(item, state)?.subviews?.find((sub) => sub.layer === target) ?? null;
}

/** The option of an item's picks the map shows (Country of birth › Poland); null when none is. */
export function activeTopicPick(item: MapTopic, state: Pick<TopicViewState, "layer">): TopicView | null {
  return item.picks?.options.find((option) => option.layer === state.layer) ?? null;
}

/**
 * The scale to paint an item with once chosen: the current one when the item offers it (Rank in London
 * carries from Price per m² to Crime), else actual values. An item without scale views is always actual.
 */
export function scaleForTopic(item: MapTopic, current: LegendScaleMode): LegendScaleMode {
  const scales = (item.views ?? []).map((view) => view.scale).filter((scale): scale is LegendScaleMode => !!scale);
  return scales.includes(current) ? current : "linear";
}

/**
 * The selector button's words: "Price per m² · Rank in London", "Typical home price · Flats",
 * "Price per m² · 5-year change". Actual values go unsaid; a layer no item lists
 * (My match) falls back to `fallback`.
 */
export function topicTitle(state: TopicViewState & { changeWindow: number; rankScope?: string }, custom: readonly CustomCriterion[], fallback: string): string {
  const { name, view } = topicTrigger(state, custom, fallback);
  return view ? `${name} · ${view}` : name;
}

/**
 * The phone's layer pill (CUJ16): the layer and always its view, "Price per m² · Actual",
 * "Noise · Road and rail", "Ethnic makeup · Indian"; the name alone only when the item has neither views
 * nor a measure (My match, a criterion of your own).
 */
export function topicPillLabel(state: TopicViewState & { changeWindow: number; rankScope?: string }, custom: readonly CustomCriterion[], fallback: string): string {
  const { name, view } = topicTrigger(state, custom, fallback);
  const item = findTopic(state.layer, custom);
  const words = view ?? (item ? activeTopicView(item, state)?.label ?? item.measure : undefined);
  return words ? `${name} · ${words}` : name;
}

/** The rank scope while the reader's own colour range paints the map (components/close-knit.tsx). */
export const CUSTOM_RANGE_SCOPE = "your range";

/**
 * A view's words for the map in view: "Rank in London" reads "Rank in North West" over one region of the England map,
 * "Rank in its region" over several (lib/map-coverage viewScopeWords). Absent: London, as the words are written.
 */
export function inScope(words: string, scope: string | undefined): string {
  // The reader's own colour range (lib/legend-range.ts) is no rank: "Your range".
  if (scope === CUSTOM_RANGE_SCOPE && / in London$/.test(words)) return "Your range";
  return scope ? words.replace(/ in London$/, ` in ${scope}`) : words;
}

/** The selector button's two lines: the item ("Price per m²") and the view shown ("Rank in London"), null for actual values. */
export function topicTrigger(state: TopicViewState & { changeWindow: number; rankScope?: string }, custom: readonly CustomCriterion[], fallback: string): { name: string; view: string | null } {
  const item = findTopic(state.layer, custom);
  if (!item) return { name: fallback, view: null };
  // A pick from an MSOA table says so ("Japan (MSOA)").
  const pick = activeTopicPick(item, state);
  if (pick) return { name: item.label, view: pick.layer && isMsoaFigure(pick.layer) ? `${pick.label} (MSOA)` : pick.label };
  const view = activeTopicView(item, state);
  if (!view || view.scale === "linear") return { name: item.label, view: null };
  if (view.scale === "change") return { name: item.label, view: `${state.changeWindow}-year change` };
  // A detailed group names itself ("Indian"); "All Asian" is the group ("Asian").
  const sub = activeTopicSubview(item, state);
  return { name: item.label, view: inScope(sub && sub.layer !== view.layer ? sub.long ?? sub.label : view.long ?? view.label, state.rankScope) };
}
