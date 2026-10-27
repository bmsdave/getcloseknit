/**
 * Census 2021 map layers (deploy/tools/etl_census_layers.py): each LSOA coloured by the share of its
 * residents, or households, in one category. Each category is its own published metric (and value
 * pack), reached as a view inside its item, like Typical home price; Social rent is the older
 * `social-renting` metric, now a view of Tenure, so its links keep working. Ethnic makeup has two
 * levels: a group (Asian, Black, Mixed, White, Other), then all of it or one of its 19 detailed groups.
 *
 * The detailed tables add one layer per category with at least 1,000 London residents
 * (lib/census-picks.ts, generated from the ONS files), picked from a searchable list: ethnic group's
 * 287 write-in groups (TS022, "Japanese (Asian)"), 190 countries of birth, passports held (TS013),
 * national identity (TS028) and beliefs (TS031) exist down to MSOAs only, so each LSOA shows its MSOA's
 * share and every label says "MSOA figures"; main language (26) and year of arrival (TS015) are per LSOA.
 *
 * Descriptive only (user decision): factual labels with the source on the legend, always
 * the neutral palette, never a rank in London, never a ranking page and never a Find my area
 * criterion (tests/census-layers.test.ts). The area's full breakdown is its People section (the
 * detailed tables are on the map only).
 */
import { CENSUS_PICK_IDS, CENSUS_PICK_TOPICS } from "./census-picks";
import type { PeopleTopicId } from "./people-profile";

/** Every Census layer published as its own metric; Social rent is `social-renting`. */
export const CENSUS_METRIC_IDS = [
  "census-ethnicity-asian",
  "census-ethnicity-black",
  "census-ethnicity-mixed",
  "census-ethnicity-white",
  "census-ethnicity-other",
  // The 19 detailed groups (TS021), inside their group above.
  "census-ethnicity-indian",
  "census-ethnicity-pakistani",
  "census-ethnicity-bangladeshi",
  "census-ethnicity-chinese",
  "census-ethnicity-other-asian",
  "census-ethnicity-african",
  "census-ethnicity-caribbean",
  "census-ethnicity-other-black",
  "census-ethnicity-mixed-white-asian",
  "census-ethnicity-mixed-white-black-african",
  "census-ethnicity-mixed-white-black-caribbean",
  "census-ethnicity-other-mixed",
  "census-ethnicity-white-british",
  "census-ethnicity-white-irish",
  "census-ethnicity-gypsy-traveller",
  "census-ethnicity-roma",
  "census-ethnicity-other-white",
  "census-ethnicity-arab",
  "census-ethnicity-any-other",
  "census-religion-christian",
  "census-religion-muslim",
  "census-religion-hindu",
  "census-religion-jewish",
  "census-religion-sikh",
  "census-religion-buddhist",
  "census-religion-none",
  "census-religion-other",
  "census-age-0-14",
  "census-age-15-24",
  "census-age-25-44",
  "census-age-45-64",
  "census-age-65-plus",
  "census-household-one-person",
  "census-household-couple-no-children",
  "census-household-couple-children",
  "census-household-lone-parent",
  "census-household-other",
  "census-tenure-owned",
  "census-tenure-private-rent",
  "census-accommodation-detached",
  "census-accommodation-semi-detached",
  "census-accommodation-terraced",
  "census-accommodation-flat",
  "census-accommodation-other",
  // Country of birth: 11 world regions (TS004), per area.
  "census-birth-uk",
  "census-birth-eu14",
  "census-birth-eu8",
  "census-birth-eu2",
  "census-birth-other-eu",
  "census-birth-other-europe",
  "census-birth-africa",
  "census-birth-middle-east-asia",
  "census-birth-americas-caribbean",
  "census-birth-oceania-other",
  "census-birth-british-overseas",
  // One per detailed category (lib/census-picks.ts).
  ...CENSUS_PICK_IDS,
] as const;

export type CensusMetricId = (typeof CENSUS_METRIC_IDS)[number];
export type CensusLayerId = CensusMetricId | "social-renting";
export type CensusUniverse = "residents" | "households" | "residents aged 3+";
/** Map-only items: detailed tables with no People section yet. */
export type CensusMapTopicId = "year-of-arrival" | "main-language" | "passports" | "national-identity";

export interface CensusView {
  /** The view's id inside its item ("asian"). */
  id: string;
  metric: CensusLayerId;
  /** Short, for the view buttons ("Asian"). */
  label: string;
  /** For the legend and the map's lines: "% of residents, Asian (Census 2021)". */
  words: string;
  /** The People categories (api/area_api/people.py) summed into this one; a detailed table's own category. */
  categories: readonly string[];
  /** Ethnic makeup: the group's detailed Census groups, one category each (the group sums them). */
  subviews?: readonly CensusView[];
  /** An MSOA's figure painted on each of its areas (a table ONS publishes down to MSOAs only). */
  msoa?: true;
  /** A detailed category's London share per thousand (lib/census-picks.ts), for the preview's values. */
  perMille?: number;
}

/** A long list of detailed categories, each its own layer, picked with a search. */
export interface CensusPicks {
  label: string;
  /** The search box's placeholder ("Search countries"). */
  search: string;
  views: readonly CensusView[];
}

export interface CensusLayer {
  topic: PeopleTopicId | CensusMapTopicId;
  group: "people" | "homes-area";
  label: string;
  universe: CensusUniverse;
  keywords: readonly string[];
  views: readonly CensusView[];
  picks?: CensusPicks;
}

/** Said wherever an MSOA figure is shown: the legend, the picker and the layer's caveats. */
export const MSOA_FIGURES_NOTE = "MSOA figures: each MSOA is one colour";

function view(metric: CensusLayerId, id: string, label: string, words: string, categories: readonly string[], subviews?: readonly CensusView[]): CensusView {
  return { id, metric, label, words, categories, ...(subviews ? { subviews } : {}) };
}

/** One detailed ethnic group: its own layer, one TS021 category. */
function detail(category: string, label: string, words: string): CensusView {
  return view(`census-ethnicity-${category}` as CensusMetricId, category, label, words, [category]);
}

/** A high-level group with its detailed groups as subviews; its categories are theirs. */
function ethnicGroup(metric: CensusMetricId, id: string, label: string, words: string, subviews: readonly CensusView[]): CensusView {
  return view(metric, id, label, words, subviews.flatMap((entry) => entry.categories), subviews);
}

/** A detailed table's categories (lib/census-picks.ts), each its own layer; an MSOA table's say so. */
function detailed(topic: string): CensusView[] {
  const table = CENSUS_PICK_TOPICS.find((entry) => entry.topic === topic);
  if (!table) throw new Error(`No detailed Census table "${topic}"`);
  return table.picks.map(([category, label, words, perMille]) => ({
    ...view(`${table.prefix}${category}` as CensusMetricId, category, label, words, [category]),
    perMille, ...(table.geography === "msoa" ? { msoa: true as const } : {}),
  }));
}

function picks(label: string, search: string, topic: string): CensusPicks {
  return { label, search, views: detailed(topic) };
}

export const CENSUS_LAYERS: readonly CensusLayer[] = [
  {
    topic: "ethnicity", group: "people", label: "Ethnic makeup", universe: "residents",
    keywords: ["ethnicity", "ethnic group", "census"],
    views: [
      ethnicGroup("census-ethnicity-asian", "asian", "Asian", "Asian", [
        detail("indian", "Indian", "Indian"), detail("pakistani", "Pakistani", "Pakistani"), detail("bangladeshi", "Bangladeshi", "Bangladeshi"),
        detail("chinese", "Chinese", "Chinese"), detail("other-asian", "Other Asian", "other Asian")]),
      ethnicGroup("census-ethnicity-black", "black", "Black", "Black", [
        detail("african", "African", "Black African"), detail("caribbean", "Caribbean", "Black Caribbean"), detail("other-black", "Other Black", "other Black")]),
      ethnicGroup("census-ethnicity-mixed", "mixed", "Mixed", "Mixed or multiple", [
        detail("mixed-white-asian", "White and Asian", "mixed White and Asian"), detail("mixed-white-black-african", "White and Black African", "mixed White and Black African"),
        detail("mixed-white-black-caribbean", "White and Black Caribbean", "mixed White and Black Caribbean"), detail("other-mixed", "Other Mixed", "other mixed or multiple")]),
      ethnicGroup("census-ethnicity-white", "white", "White", "White", [
        detail("white-british", "White British", "White British"), detail("white-irish", "Irish", "Irish"), detail("gypsy-traveller", "Gypsy or Irish Traveller", "Gypsy or Irish Traveller"),
        detail("roma", "Roma", "Roma"), detail("other-white", "Other White", "other White")]),
      ethnicGroup("census-ethnicity-other", "other", "Other", "other ethnic group", [detail("arab", "Arab", "Arab"), detail("any-other", "Any other", "any other ethnic group")]),
    ],
    picks: picks("Pick a group (MSOA level)", "Search groups", "ethnicity-detailed"),
  },
  {
    topic: "religion", group: "people", label: "Religion", universe: "residents",
    keywords: ["religion", "faith", "census"],
    views: [
      view("census-religion-christian", "christian", "Christian", "Christian", ["christian"]),
      view("census-religion-muslim", "muslim", "Muslim", "Muslim", ["muslim"]),
      view("census-religion-hindu", "hindu", "Hindu", "Hindu", ["hindu"]),
      view("census-religion-jewish", "jewish", "Jewish", "Jewish", ["jewish"]),
      view("census-religion-sikh", "sikh", "Sikh", "Sikh", ["sikh"]),
      view("census-religion-buddhist", "buddhist", "Buddhist", "Buddhist", ["buddhist"]),
      view("census-religion-none", "none", "No religion", "no religion", ["no-religion"]),
      view("census-religion-other", "other", "Other", "another religion", ["other"]),
    ],
    picks: picks("Pick a belief (MSOA level)", "Search beliefs", "religion-detailed"),
  },
  {
    topic: "age", group: "people", label: "Residents' age", universe: "residents",
    keywords: ["age", "older", "younger", "census"],
    views: [
      view("census-age-0-14", "0-14", "0–14", "aged 0–14", ["0-14"]),
      view("census-age-15-24", "15-24", "15–24", "aged 15–24", ["15-24"]),
      view("census-age-25-44", "25-44", "25–44", "aged 25–44", ["25-44"]),
      view("census-age-45-64", "45-64", "45–64", "aged 45–64", ["45-64"]),
      view("census-age-65-plus", "65-plus", "65+", "aged 65 and over", ["65-plus"]),
    ],
  },
  {
    topic: "household-type", group: "people", label: "Household type", universe: "households",
    keywords: ["household", "living alone", "couple", "lone parent", "flatshare", "census"],
    views: [
      view("census-household-one-person", "one-person", "One person", "one person", ["one-person"]),
      view("census-household-couple-no-children", "couple-no-children", "Couple, no children", "couple, no children", ["couple-no-children"]),
      view("census-household-couple-children", "couple-children", "Couple with children", "couple with children", ["couple-children"]),
      view("census-household-lone-parent", "lone-parent", "Lone parent", "lone parent", ["lone-parent"]),
      view("census-household-other", "other", "Other", "other, including shared", ["other"]),
    ],
  },
  {
    topic: "tenure", group: "homes-area", label: "Tenure", universe: "households",
    keywords: ["tenure", "owner", "own", "mortgage", "rent", "renting", "social housing", "council", "housing association"],
    views: [
      view("census-tenure-owned", "owned", "Owned", "owned (outright, mortgage or shared)", ["owned-outright", "mortgage", "shared-ownership"]),
      view("census-tenure-private-rent", "private-rent", "Private rent", "private rent", ["private-rent"]),
      view("social-renting", "social-rent", "Social rent", "social rent", ["council", "other-social"]),
    ],
  },
  {
    topic: "accommodation", group: "homes-area", label: "Accommodation type", universe: "households",
    keywords: ["accommodation", "type of home", "house", "flat", "detached", "terraced", "census"],
    views: [
      view("census-accommodation-detached", "detached", "Detached", "detached house", ["detached"]),
      view("census-accommodation-semi-detached", "semi-detached", "Semi", "semi-detached house", ["semi-detached"]),
      view("census-accommodation-terraced", "terraced", "Terraced", "terraced house", ["terraced"]),
      view("census-accommodation-flat", "flat", "Flat", "flat", ["purpose-built-flat", "converted-flat", "other-converted", "commercial"]),
      view("census-accommodation-other", "other", "Other", "caravan or temporary home", ["temporary"]),
    ],
  },
  {
    topic: "country-of-birth", group: "people", label: "Country of birth", universe: "residents",
    keywords: ["country of birth", "born", "birthplace", "migrants", "immigration", "census"],
    views: [
      view("census-birth-uk", "uk", "UK", "born in the UK", ["uk"]),
      view("census-birth-eu14", "eu14", "EU before 2004", "born in an older EU member (France, Germany, Italy, Spain, Portugal, Ireland, Greece, …)", ["eu14"]),
      view("census-birth-eu8", "eu8", "Joined EU 2004", "born in a country that joined the EU in 2004 (Poland, Lithuania, Latvia, Estonia, Czechia, Slovakia, Hungary, Slovenia)", ["eu8"]),
      view("census-birth-eu2", "eu2", "Romania, Bulgaria", "born in Romania or Bulgaria", ["eu2"]),
      view("census-birth-other-eu", "other-eu", "Croatia, Cyprus, Malta", "born in Croatia, Cyprus or Malta", ["other-eu"]),
      view("census-birth-other-europe", "other-europe", "Europe, non-EU", "born in Europe outside the EU (Turkey, Ukraine, Albania, Switzerland, …)", ["other-europe"]),
      view("census-birth-africa", "africa", "Africa", "born in Africa", ["africa"]),
      view("census-birth-middle-east-asia", "middle-east-asia", "Middle East & Asia", "born in the Middle East or Asia", ["middle-east-asia"]),
      view("census-birth-americas-caribbean", "americas-caribbean", "Americas & Caribbean", "born in the Americas or the Caribbean", ["americas-caribbean"]),
      view("census-birth-oceania-other", "oceania-other", "Oceania & other", "born in Oceania, Antarctica or elsewhere", ["oceania-other"]),
      view("census-birth-british-overseas", "british-overseas", "British Overseas", "born in a British Overseas Territory", ["british-overseas"]),
    ],
    picks: picks("Pick a country (MSOA level)", "Search countries", "country-of-birth-extended"),
  },
  {
    topic: "year-of-arrival", group: "people", label: "Year of arrival", universe: "residents",
    keywords: ["year of arrival", "arrived", "migrants", "immigration", "census"],
    views: detailed("year-of-arrival"),
  },
  {
    topic: "main-language", group: "people", label: "Main language", universe: "residents aged 3+",
    keywords: ["language", "main language", "speak", "census"],
    views: [],
    picks: picks("Pick a language", "Search languages", "main-language"),
  },
  {
    topic: "passports", group: "people", label: "Passports held", universe: "residents",
    keywords: ["passport", "citizenship", "nationality", "census"],
    views: [],
    picks: picks("Pick a passport (MSOA level)", "Search passports", "passports"),
  },
  {
    topic: "national-identity", group: "people", label: "National identity", universe: "residents",
    keywords: ["national identity", "identity", "nationality", "british", "english", "census"],
    views: [],
    picks: picks("Pick an identity (MSOA level)", "Search identities", "national-identity"),
  },
];

/** An item's every view: its views, their subviews, then its picks. */
function layerViews(layer: CensusLayer): CensusView[] {
  return [...layer.views, ...layer.views.flatMap((entry) => entry.subviews ?? []), ...(layer.picks?.views ?? [])];
}

/** Every Census view: each item's views, their subviews, its picks (Social rent included). */
export const ALL_CENSUS_VIEWS: readonly CensusView[] = CENSUS_LAYERS.flatMap(layerViews);

/** A new Census layer (not the older Social rent): descriptive only, never ranked or matched. */
export function isCensusMetric(id: string): id is CensusMetricId {
  return (CENSUS_METRIC_IDS as readonly string[]).includes(id);
}

/** The item and view (detailed subview or pick) behind a Census layer (Social rent included); null for any other layer. */
export function censusView(id: string): { layer: CensusLayer; view: CensusView } | null {
  for (const layer of CENSUS_LAYERS) {
    const found = layerViews(layer).find((entry) => entry.metric === id);
    if (found) return { layer, view: found };
  }
  return null;
}

/** A layer whose areas each show their MSOA's figure (a table ONS publishes down to MSOAs only). */
export function isMsoaFigure(id: string): boolean {
  return censusView(id)?.view.msoa === true;
}

/** The legend's words: "% of residents, Asian (Census 2021)", "… (Census 2021, MSOA figures)"; null for any other layer. */
export function censusLegendTitle(id: string): string | null {
  const found = censusView(id);
  if (!found) return null;
  return `% of ${found.layer.universe}, ${found.view.words} (Census 2021${found.view.msoa ? ", MSOA figures" : ""})`;
}

/** One area's value: "34% of residents, Asian", "0.4% of residents, born in Japan (MSOA figure)"; null for any other layer or no value. */
export function censusValueText(id: string, value: number | null): string | null {
  const found = censusView(id);
  if (!found || value === null || !Number.isFinite(value)) return null;
  // A value under 1% keeps a decimal: detailed groups are small ("0.4% of residents, …").
  const shown = value > 0 && value < 1 ? value.toFixed(1) : String(Math.round(value));
  return `${shown}% of ${found.layer.universe}, ${found.view.words}${found.view.msoa ? " (MSOA figure)" : ""}`;
}
