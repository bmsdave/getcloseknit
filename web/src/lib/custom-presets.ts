/**
 * Ready-made custom criteria for the "My criteria" chips. The API serves the same list to Claude
 * (api/area_api/fixtures/custom-presets.json); tests/custom-criteria.test.ts keeps them identical.
 */
import type { CustomCriterion, CustomMatcher } from "./custom-criteria";

export interface CustomPreset {
  /**
   * Its public name in links (/explore/<slug>): descriptive, no brand, no value word. The criterion id
   * stays the key everywhere else (?layer=custom:<id>, saved matches, the API), so old links still open.
   */
  slug: string;
  criterion: CustomCriterion;
  /** The direction most people mean ("Fewer bars, pubs and clubs" = less); the household can flip it. */
  direction: "higher" | "lower";
  /** The definition in one sentence: the first line of its card, before the source tags. */
  description: string;
}

export const CUSTOM_PRESETS: readonly CustomPreset[] = [
  {
    slug: "kebab-shops-vs-cafes",
    criterion: { id: "kebab-cafe", label: "Kebab shops vs cafés", formula: "share", radiusMetres: 800, sets: {
      a: { label: "Kebabs & Turkish grills", any: [{ cuisine: "kebab" }, { cuisine: "turkish" }] },
      b: { label: "Cafés", any: [{ amenity: "cafe" }] },
    } },
    direction: "lower",
    description: "Kebab shops and Turkish grills as a share of them and cafés: lower means more cafés.",
  },
  {
    slug: "specialty-coffee-vs-kebab-shops",
    criterion: { id: "good-coffee-kebab", label: "Specialty coffee vs kebab shops", formula: "share", radiusMetres: 800, sets: {
      a: { label: "Specialty coffee", any: [{ cuisine: "specialty_coffee" }] },
      b: { label: "Kebabs & Turkish grills", any: [{ cuisine: "kebab" }, { cuisine: "turkish" }] },
    } },
    direction: "higher",
    description: "Coffee-led shops (sources agree it is a coffee shop, never a big chain) as a share of them and kebab shops and Turkish grills.",
  },
  {
    slug: "specialty-coffee-shops",
    criterion: { id: "good-coffee", label: "Specialty coffee shops", formula: "per_resident", radiusMetres: 800, sets: {
      a: { label: "Specialty coffee", any: [{ cuisine: "specialty_coffee" }] },
    } },
    direction: "higher",
    description: "Specialty coffee shops and roasters in the area per 1,000 residents, not cafés with coffee on the menu.",
  },
  {
    slug: "sandwich-chains-vs-bakery-chains",
    criterion: { id: "pret-greggs", label: "Sandwich chains vs bakery chains", formula: "share", radiusMetres: 1000, sets: {
      a: { label: "Pret", any: [{ brand: "Pret A Manger" }] },
      b: { label: "Greggs", any: [{ brand: "Greggs" }] },
    } },
    direction: "higher",
    description: "Pret A Manger shops as a share of Pret and Greggs shops, counted from the shops themselves.",
  },
  {
    slug: "independent-vs-chain-cafes",
    criterion: { id: "indie-cafes", label: "Independent vs chain cafés", formula: "share", radiusMetres: 800, sets: {
      a: { label: "Independent cafés", any: [{ amenity: "cafe", brand: null }] },
      b: { label: "Chain cafés", any: [{ amenity: "cafe", brand: "*" }] },
    } },
    direction: "higher",
    description: "The share of cafés without a chain brand.",
  },
  {
    slug: "gyms-and-sports-centres",
    criterion: { id: "gyms", label: "Nearest gym or sports centre", formula: "nearest", radiusMetres: 1000, sets: {
      a: { label: "Gyms and sports centres", any: [{ leisure: ["fitness_centre", "sports_centre"] }] },
    } },
    direction: "higher",
    description: "Walking minutes to the nearest gym, fitness studio or sports centre.",
  },
  {
    slug: "bars-pubs-and-clubs",
    criterion: { id: "nightlife", label: "Bars, pubs and clubs", formula: "per_resident", radiusMetres: 800, sets: {
      a: { label: "Bars, pubs and clubs", any: [{ amenity: ["bar", "nightclub", "pub"] }] },
    } },
    direction: "higher",
    description: "Bars, pubs and nightclubs in the area per 1,000 residents.",
  },
  {
    slug: "fewer-bars-pubs-and-clubs",
    criterion: { id: "quiet-nights", label: "Fewer bars, pubs and clubs", formula: "per_resident", radiusMetres: 500, sets: {
      a: { label: "Bars, pubs and clubs", any: [{ amenity: ["bar", "nightclub", "pub"] }] },
    } },
    direction: "lower",
    description: "Fewest bars, pubs and nightclubs per 1,000 residents: add it as \"less\".",
  },
  {
    slug: "cinemas-theatres-museums-and-galleries",
    criterion: { id: "culture", label: "Cinemas, theatres, museums and galleries", formula: "per_resident", radiusMetres: 1500, sets: {
      a: { label: "Cinemas, theatres, arts centres, museums and galleries", any: [{ amenity: ["arts_centre", "cinema", "theatre"] }, { tourism: ["gallery", "museum"] }] },
    } },
    direction: "higher",
    description: "Cinemas, theatres, arts centres, museums and galleries in the area per 1,000 residents.",
  },
  {
    slug: "universities-and-colleges",
    criterion: { id: "universities", label: "Universities and colleges", formula: "count", radiusMetres: 1500, sets: {
      a: { label: "Universities and colleges", any: [{ amenity: ["college", "university"] }] },
    } },
    direction: "higher",
    description: "University and college buildings in the area.",
  },
  {
    slug: "playgrounds-nurseries-and-libraries",
    criterion: { id: "family", label: "Nearest playground or nursery", formula: "nearest", radiusMetres: 800, sets: {
      a: { label: "Playgrounds and nurseries", any: [{ leisure: "playground" }, { amenity: ["childcare", "kindergarten"] }] },
    } },
    direction: "higher",
    description: "Walking minutes to the nearest playground or nursery.",
  },
  {
    slug: "variety-of-cuisines",
    criterion: { id: "food-variety", label: "Variety of cuisines", formula: "variety", radiusMetres: 1000, sets: {
      a: { label: "Places to eat", any: [{ amenity: ["cafe", "fast_food", "restaurant"], cuisine: "*" }] },
    } },
    direction: "higher",
    description: "How many different cuisines the area has.",
  },
  {
    slug: "bakeries-vs-betting-shops",
    criterion: { id: "bakeries-betting", label: "Bakeries vs betting shops", formula: "share", radiusMetres: 1000, sets: {
      a: { label: "Bakeries", any: [{ shop: "bakery" }] },
      b: { label: "Betting shops", any: [{ shop: "bookmaker" }, { amenity: "gambling" }] },
    } },
    direction: "higher",
    description: "Bakeries as a share of bakeries, betting shops and gambling venues.",
  },
  {
    slug: "takeaways-and-fast-food",
    criterion: { id: "late-night-food", label: "Takeaways and fast food", formula: "per_resident", radiusMetres: 800, sets: {
      a: { label: "Takeaways", any: [{ amenity: "fast_food" }] },
    } },
    direction: "higher",
    description: "Takeaways and fast food in the area per 1,000 residents.",
  },
  {
    slug: "coworking-spaces-libraries-and-cafes",
    criterion: { id: "coworking", label: "Coworking spaces, libraries and cafés", formula: "count", radiusMetres: 1000, sets: {
      a: { label: "Coworking spaces and libraries", any: [{ office: "coworking" }, { amenity: ["coworking_space", "library"] }] },
      b: { label: "Cafés", any: [{ amenity: "cafe" }] },
    } },
    direction: "higher",
    description: "Coworking spaces, libraries and cafés to work from in the area.",
  },
  {
    slug: "bike-parking-hire-docks-and-bike-shops",
    criterion: { id: "cycling", label: "Bike parking, hire docks and bike shops", formula: "count", radiusMetres: 500, sets: {
      a: { label: "Bike parking, hire docks and bike shops", any: [{ amenity: ["bicycle_parking", "bicycle_rental"] }, { shop: "bicycle" }] },
    } },
    direction: "higher",
    description: "Bike stands, hire docks and bike shops in the area.",
  },
  {
    slug: "ev-charging-points",
    criterion: { id: "ev-charging", label: "Nearest EV charging point", formula: "nearest", radiusMetres: 1000, sets: {
      a: { label: "Charging points", any: [{ amenity: "charging_station" }] },
    } },
    direction: "higher",
    description: "Walking minutes to the nearest electric-vehicle charging point.",
  },
  {
    slug: "nearest-market",
    criterion: { id: "markets", label: "Nearest market", formula: "nearest", radiusMetres: 1000, sets: {
      a: { label: "Markets", any: [{ amenity: "marketplace" }] },
    } },
    direction: "higher",
    description: "Walking minutes to the nearest market.",
  },
  {
    slug: "dog-parks-vets-and-pet-shops",
    criterion: { id: "dog-friendly", label: "Nearest dog park, vet or pet shop", formula: "nearest", radiusMetres: 1000, sets: {
      a: { label: "Dog parks, vets and pet shops", any: [{ leisure: "dog_park" }, { amenity: "veterinary" }, { shop: "pet" }] },
    } },
    direction: "higher",
    description: "Walking minutes to the nearest dog park, vet or pet shop.",
  },
];

/** A ready-made criterion by its slug, or by its id (the older name of its link); null when there is none. */
export function presetBySlug(slugOrId: string): CustomPreset | null {
  return CUSTOM_PRESETS.find((preset) => preset.slug === slugOrId)
    ?? CUSTOM_PRESETS.find((preset) => preset.criterion.id === slugOrId) ?? null;
}

/**
 * The ready-made criterion behind a criterion, when it is one (same id, places and formula): one saved
 * before a preset changed its measure (Layers v5: gyms counted, now the nearest) is the household's own.
 */
export function presetFor(criterion: CustomCriterion): CustomPreset | null {
  const preset = CUSTOM_PRESETS.find((entry) => entry.criterion.id === criterion.id);
  return preset && preset.criterion.formula === criterion.formula
    && JSON.stringify(preset.criterion.sets) === JSON.stringify(criterion.sets) ? preset : null;
}

/** The ready-made criteria shown first in "My criteria" (neutral, everyday ones); the rest wait behind "More…". */
export const FEATURED_PRESET_IDS: readonly string[] = ["kebab-cafe", "gyms", "nightlife", "culture", "family", "food-variety"];

/** Friendly place types for "Build your own": each is one matcher over the whitelisted OSM keys. */
export interface PlaceType { id: string; label: string; matcher: CustomMatcher }

export const PLACE_TYPES: readonly PlaceType[] = [
  { id: "cafes", label: "Cafés", matcher: { amenity: "cafe" } },
  { id: "indie-cafes", label: "Independent cafés", matcher: { amenity: "cafe", brand: null } },
  { id: "chain-cafes", label: "Chain cafés", matcher: { amenity: "cafe", brand: "*" } },
  { id: "restaurants", label: "Restaurants", matcher: { amenity: "restaurant" } },
  { id: "takeaways", label: "Takeaways and fast food", matcher: { amenity: "fast_food" } },
  { id: "kebab", label: "Kebab shops", matcher: { cuisine: "kebab" } },
  { id: "turkish-grill", label: "Turkish grills", matcher: { cuisine: "turkish" } },
  { id: "specialty-coffee", label: "Specialty coffee", matcher: { cuisine: "specialty_coffee" } },
  { id: "pizza", label: "Pizza places", matcher: { cuisine: "pizza" } },
  { id: "chicken", label: "Fried chicken shops", matcher: { cuisine: "chicken" } },
  { id: "fish-chips", label: "Fish and chip shops", matcher: { cuisine: "fish_and_chips" } },
  { id: "indian", label: "Indian restaurants", matcher: { cuisine: "indian" } },
  { id: "italian", label: "Italian restaurants", matcher: { cuisine: "italian" } },
  { id: "pubs", label: "Pubs", matcher: { amenity: "pub" } },
  { id: "bars", label: "Bars", matcher: { amenity: "bar" } },
  { id: "nightclubs", label: "Nightclubs", matcher: { amenity: "nightclub" } },
  { id: "bakeries", label: "Bakeries", matcher: { shop: "bakery" } },
  { id: "betting", label: "Betting shops", matcher: { shop: "bookmaker" } },
  { id: "supermarkets", label: "Supermarkets", matcher: { shop: "supermarket" } },
  { id: "corner-shops", label: "Corner shops", matcher: { shop: "convenience" } },
  { id: "butchers", label: "Butchers", matcher: { shop: "butcher" } },
  { id: "greengrocers", label: "Greengrocers", matcher: { shop: "greengrocer" } },
  { id: "delis", label: "Delis", matcher: { shop: "deli" } },
  { id: "bookshops", label: "Bookshops", matcher: { shop: "books" } },
  { id: "charity-shops", label: "Charity shops", matcher: { shop: "charity" } },
  { id: "hairdressers", label: "Hairdressers and barbers", matcher: { shop: "hairdresser" } },
  { id: "beauty", label: "Nail and beauty salons", matcher: { shop: "beauty" } },
  { id: "vape-shops", label: "Vape shops", matcher: { shop: "e-cigarette" } },
  { id: "pawnbrokers", label: "Pawnbrokers", matcher: { shop: "pawnbroker" } },
  { id: "gyms", label: "Gyms", matcher: { leisure: "fitness_centre" } },
  { id: "sports-centres", label: "Sports centres", matcher: { leisure: "sports_centre" } },
  { id: "playgrounds", label: "Playgrounds", matcher: { leisure: "playground" } },
  { id: "tennis", label: "Tennis courts", matcher: { sport: "tennis" } },
  { id: "yoga", label: "Yoga studios", matcher: { sport: "yoga" } },
  { id: "cinemas", label: "Cinemas", matcher: { amenity: "cinema" } },
  { id: "theatres", label: "Theatres", matcher: { amenity: "theatre" } },
  { id: "museums", label: "Museums and galleries", matcher: { tourism: ["museum", "gallery"] } },
  { id: "libraries", label: "Libraries", matcher: { amenity: "library" } },
  { id: "nurseries", label: "Nurseries", matcher: { amenity: ["childcare", "kindergarten"] } },
  { id: "dentists", label: "Dentists", matcher: { amenity: "dentist" } },
  { id: "pharmacies", label: "Pharmacies", matcher: { amenity: "pharmacy" } },
  { id: "vets", label: "Vets", matcher: { amenity: "veterinary" } },
  { id: "bike-parking", label: "Bike parking", matcher: { amenity: "bicycle_parking" } },
  { id: "ev-chargers", label: "EV chargers", matcher: { amenity: "charging_station" } },
  { id: "coworking", label: "Coworking spaces", matcher: { office: "coworking" } },
  { id: "hotels", label: "Hotels", matcher: { tourism: "hotel" } },
];

/** A criterion from two place types (or one, for the single-set formulas). */
export function buildCriterion(a: PlaceType, b: PlaceType | null, formula: CustomCriterion["formula"], radiusMetres: number): CustomCriterion {
  const pair = formula === "balance" || formula === "share";
  const label = pair && b ? `${a.label} vs ${b.label.toLowerCase()}` : a.label;
  // The types, formula and radius decide the id: two different home-made criteria never share one.
  const base = `my-${pair && b ? `${a.id}-${b.id}` : a.id}`.slice(0, 17).replace(/-+$/, "");
  const id = `${base}-${shortHash(`${a.id}|${pair && b ? b.id : ""}|${formula}|${radiusMetres}`)}`;
  return {
    id, label: label.slice(0, 60), formula, radiusMetres,
    sets: pair && b
      ? { a: { label: a.label, any: [a.matcher] }, b: { label: b.label, any: [b.matcher] } }
      : { a: { label: a.label, any: [a.matcher] } },
  };
}

function shortHash(text: string): string {
  let hash = 5381;
  for (const char of text) hash = (Math.imul(hash, 33) ^ char.charCodeAt(0)) >>> 0;
  return hash.toString(36).padStart(6, "0").slice(-6);
}
