// Listing-only facts worked out in the browser (2026-10-18-extension-legal-strategy.md §1, §6.5): the server
// gets the minimum (where, what, how much); costs, the price story, lease and EPC come from the page and this
// device, and are merged into the server's card here.
import type { BadgesMessage, Chip, ResultItem } from "./adapters/results/types";
import type { BuyerAssumptions, Card, CardBlock, ListingFacts, PricePoint, Tone } from "./types";

/** All a listing-card request may carry about the listing. */
export const LISTING_FIELDS = ["portal", "listingId", "url", "lat", "lng", "postcode", "market", "askingPrice",
  "bedrooms", "propertyType", "floorAreaSqm", "locationApproximate"] as const;
/** All a listing-badges request may carry about each result (no `listedOn`: days on the market are counted here). */
export const BADGE_FIELDS = ["listingId", "url", "lat", "lng", "postcode", "market", "askingPrice", "bedrooms",
  "propertyType"] as const;

export type ListingRequest = Pick<ListingFacts, (typeof LISTING_FIELDS)[number]>;
export type BadgeRequestItem = Pick<ResultItem, (typeof BADGE_FIELDS)[number]>;

function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) if (value[key] !== undefined) out[key] = value[key];
  return out;
}

export function listingRequest(facts: ListingFacts): ListingRequest {
  return pick(facts, LISTING_FIELDS);
}

export function badgeRequestItems(items: BadgesMessage["items"]): BadgeRequestItem[] {
  return items.map((item) => pick(item, BADGE_FIELDS));
}

/** The listing-card request body: the minimum about the listing, and the saved search if the user chose to use it. */
export function cardRequestBody(facts: ListingFacts, profile: unknown): string {
  return JSON.stringify({ v: 1, ...listingRequest(facts), profile });
}

/** The listing-badges request body: the minimum about each result. */
export function badgesRequestBody(portal: BadgesMessage["portal"], items: BadgesMessage["items"], profile: unknown): string {
  return JSON.stringify({ v: 1, portal, items: badgeRequestItems(items), profile });
}

/** JSON headers, and a plain "no usage analytics" signal when the user turned analytics off. */
export function requestHeaders(analytics: boolean): Record<string, string> {
  return { "content-type": "application/json", accept: "application/json", ...(analytics ? {} : { "x-close-knit-analytics": "off" }) };
}

// --- Stamp duty and the mortgage: a port of api/area_api/listing_costs.py (England, the table in force on 2026-10-05).
const STANDARD_BANDS: [number, number | null, number][] = [[0, 125_000, 0], [125_000, 250_000, 2], [250_000, 925_000, 5],
  [925_000, 1_500_000, 10], [1_500_000, null, 12]];
const FIRST_TIME_BUYER_BANDS: [number, number | null, number][] = [[0, 300_000, 0], [300_000, 500_000, 5]];
const FIRST_TIME_BUYER_MAX_PRICE = 500_000;
const ADDITIONAL_SURCHARGE_PCT = 5;
const ADDITIONAL_MIN_PRICE = 40_000;
export const SHORT_LEASE_YEARS = 80;

export function stampDuty(price: number, firstTime = false, additional = false): number {
  const ftb = firstTime && !additional && price <= FIRST_TIME_BUYER_MAX_PRICE;
  const surcharge = additional && price >= ADDITIONAL_MIN_PRICE ? ADDITIONAL_SURCHARGE_PCT : 0;
  let tax = 0;
  for (const [low, high, rate] of ftb ? FIRST_TIME_BUYER_BANDS : STANDARD_BANDS) {
    const top = high === null ? price : Math.min(price, high);
    tax += (Math.max(0, top - low) * (rate + surcharge)) / 100;
  }
  return Math.floor(tax + 1e-9);
}

export function monthlyRepayment(loan: number, ratePct: number, years: number): number {
  const months = years * 12;
  if (loan <= 0) return 0;
  const rate = ratePct / 100 / 12;
  return rate === 0 ? loan / months : (loan * rate) / (1 - (1 + rate) ** -months);
}

type Costs = Extract<CardBlock, { type: "costs" }>;
type Story = Extract<CardBlock, { type: "priceStory" }>;
type Summary = Extract<CardBlock, { type: "summary" }>;
type Sections = Extract<CardBlock, { type: "sections" }>;
type Row = { label: string; value: string; tone?: Tone };

/**
 * Buying only: the mortgage on the user's assumptions, council tax for the listing's band from the server's
 * `councilTaxByBand` (£ a month), and the service charge and ground rent the page shows.
 */
export function costsBlock(facts: ListingFacts, buyer: BuyerAssumptions, server?: Partial<Costs> | null): Costs | null {
  const price = facts.askingPrice;
  if (facts.market !== "buy" || !price) return null;
  const deposit = Math.round((price * buyer.depositPct) / 100);
  const parts = [{ label: "Mortgage", amount: Math.round(monthlyRepayment(price - deposit, buyer.ratePct, buyer.years)) }];
  const byBand = (server as { councilTaxByBand?: Record<string, unknown> } | null | undefined)?.councilTaxByBand;
  const tax = facts.councilTaxBand ? byBand?.[facts.councilTaxBand] : undefined;
  if (typeof tax === "number" && tax > 0) parts.push({ label: "Council tax", amount: Math.round(tax) });
  for (const [label, yearly] of [["Service charge", facts.serviceChargeYearly], ["Ground rent", facts.groundRentYearly]] as const) {
    if (yearly) parts.push({ label, amount: Math.round(yearly / 12) });
  }
  return {
    type: "costs", monthly: parts.reduce((sum, part) => sum + part.amount, 0), parts,
    upfront: [{ label: "Deposit", amount: deposit }, { label: "Stamp duty", amount: stampDuty(price, buyer.firstTime, buyer.additionalHome) }],
    assumptions: { ...buyer }, chips: Array.isArray(server?.chips) ? server.chips : [],
  };
}

/** Whole days from YYYY-MM-DD to today (YYYY-MM-DD), null when unknown or in the future. */
export function daysOnMarket(listedOn: string | null | undefined, today: string): number | null {
  if (!listedOn || !/^\d{4}-\d{2}-\d{2}$/.test(listedOn)) return null;
  const days = Math.round((Date.parse(today) - Date.parse(listedOn)) / 86_400_000);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

export interface Memory {
  firstSeen: PricePoint | null;
  priceChanges: PricePoint[];
}

/** How long the listing has been up and how its price moved: the page's dates and this device's memory. */
export function priceStoryBlock(facts: ListingFacts, memory: Memory, today: string, areaTurnoverPct?: number): Story | null {
  const changes = memory.priceChanges ?? [];
  const seen = memory.firstSeen;
  const days = daysOnMarket(facts.listedOn, today);
  if (days === null && !changes.length && !seen) return null;
  const block: Story = { type: "priceStory", changes, text: "" };
  const parts: string[] = [];
  if (days !== null) {
    block.listedOn = facts.listedOn!;
    block.daysOnMarket = days;
    parts.push(days === 0 ? "Listed today" : `On the market ${days} day${days === 1 ? "" : "s"}`);
  }
  if (changes.length) {
    parts.push(`Price changed ${changes.length === 1 ? "once" : `${changes.length} times`}, last on ${day(changes.at(-1)!.date)}`);
  }
  if (seen) {
    block.firstSeen = seen;
    const delta = (facts.askingPrice ?? seen.price) - seen.price;
    parts.push(delta === 0 ? `Same price since you first saw it on ${day(seen.date)}` :
      `${delta < 0 ? "Down" : "Up"} ${pounds(Math.abs(delta))} since you first saw it on ${day(seen.date)}`);
  }
  if (typeof areaTurnoverPct === "number") {
    block.areaTurnoverPct = areaTurnoverPct;
    parts.push(`About ${areaTurnoverPct.toFixed(1)}% of homes here sell each year`);
  }
  block.text = `${parts.join(". ")}.`;
  return block;
}

/** "17 days · down £25,000": days listed and the change from the first known price to the asking price. */
export function onMarketValue(facts: ListingFacts, story: Story | null): string | null {
  if (!story) return null;
  const parts: string[] = [];
  if (story.daysOnMarket !== undefined) parts.push(`${story.daysOnMarket} day${story.daysOnMarket === 1 ? "" : "s"}`);
  const known = [...story.changes.slice(0, 1), ...(story.firstSeen ? [story.firstSeen] : [])];
  if (known.length) {
    const first = known.reduce((a, b) => (b.date < a.date ? b : a));
    const latest = facts.askingPrice ?? story.changes.at(-1)?.price ?? first.price;
    const delta = latest - first.price;
    if (delta) parts.push(`${delta < 0 ? "down" : "up"} ${pounds(Math.abs(delta))}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

export function leaseFlag(years: number | null | undefined): { text: string; tone: Tone } | null {
  if (years === null || years === undefined || years >= SHORT_LEASE_YEARS) return null;
  return { text: `Lease has ${years} years left: under ${SHORT_LEASE_YEARS} makes extending it dearer and some lenders say no`, tone: "bad" };
}

const TENURE_WORDS: Record<string, string> = { freehold: "Freehold", leasehold: "Leasehold", "share-of-freehold": "Share of freehold" };

/** What the page says about the home itself. */
export function homeRows(facts: ListingFacts): Row[] {
  const rows: Row[] = [];
  if (TENURE_WORDS[facts.tenure]) rows.push({ label: "Tenure", value: TENURE_WORDS[facts.tenure] });
  const lease = facts.leaseYearsRemaining;
  if (lease !== null && lease !== undefined) {
    rows.push({ label: "Lease", value: `${lease} years left`, tone: lease < SHORT_LEASE_YEARS ? "bad" : "neutral" });
  }
  if (facts.epcRating) rows.push({ label: "EPC", value: `${facts.epcRating} (as listed)`, tone: "FG".includes(facts.epcRating) ? "bad" : "neutral" });
  if (facts.councilTaxBand) rows.push({ label: "Council tax", value: `Band ${facts.councilTaxBand}` });
  return rows;
}

export function costRows(facts: ListingFacts, costs: Costs | null): Row[] {
  if (facts.market === "rent") return facts.askingPrice ? [{ label: "Rent", value: `${pounds(facts.askingPrice)} a month` }] : [];
  if (!costs) return [];
  return [
    { label: "Each month", value: pounds(costs.monthly) },
    ...costs.parts.map((part) => ({ label: part.label, value: `${pounds(part.amount)} a month` })),
    ...costs.upfront.map((part) => ({ label: part.label, value: `${pounds(part.amount)} upfront` })),
  ];
}

/** "The money" in the summary: a month all in, the upfront money, council tax and the assumptions. */
export function moneyRows(facts: ListingFacts, costs: Costs | null): Row[] {
  if (facts.market !== "buy" || !costs) return [];
  const upfront = Object.fromEntries(costs.upfront.map((part) => [part.label, part.amount]));
  const tax = costs.parts.find((part) => part.label === "Council tax")?.amount;
  const band = facts.councilTaxBand;
  const a = costs.assumptions;
  const who = [a.firstTime ? "first-time buyer" : null, a.additionalHome ? "additional home" : null].filter((w): w is string => Boolean(w));
  return [
    { label: "A month", value: `${pounds(costs.monthly)} all in`, tone: "neutral" },
    { label: "Upfront", value: `${pounds(upfront.Deposit ?? 0)} deposit · ${pounds(upfront["Stamp duty"] ?? 0)} stamp duty`, tone: "neutral" },
    { label: "Council tax", value: tax ? `${pounds(tax)} a month (band ${band})` : band ? `Band ${band}` : "Band not listed: ask", tone: "neutral" },
    { label: "Assumes", value: [`${a.depositPct}% deposit`, `${a.ratePct}% over ${a.years} years`, ...who].join(" · "), tone: "neutral" },
  ];
}

/** What to ask the agent: the facts the page leaves out. */
export function askRows(facts: ListingFacts): Row[] {
  const asks: string[] = [];
  if (facts.market === "buy" && facts.tenure === "unknown") asks.push("Tenure");
  if (facts.tenure === "leasehold" || facts.tenure === "share-of-freehold") {
    if (facts.leaseYearsRemaining == null) asks.push("Years left on the lease");
    if (facts.serviceChargeYearly == null) asks.push("Service charge");
    if (facts.groundRentYearly == null) asks.push("Ground rent");
  }
  if (!facts.councilTaxBand) asks.push("Council tax band");
  if (!facts.epcRating) asks.push("EPC rating");
  return asks.map((ask) => ({ label: "Ask", value: ask }));
}

export interface Local extends Memory {
  buyer: BuyerAssumptions;
  /** YYYY-MM-DD on this device's calendar. */
  today: string;
}

const APPROXIMATE = "Approximate location: facts for the area around it.";

/** The server's card with the listing-only facts filled in: costs, price story, lease flag and the rows that use them. */
export function enrichCard(card: Card, facts: ListingFacts, local: Local): Card {
  if (card.status !== "ok") return card;
  const serverCosts = card.blocks.find((b): b is Costs => b.type === "costs") ?? null;
  const serverStory = card.blocks.find((b): b is Story => b.type === "priceStory") ?? null;
  const costs = costsBlock(facts, local.buyer, serverCosts);
  const story = priceStoryBlock(facts, local, local.today, serverStory?.areaTurnoverPct);
  const blocks = card.blocks.filter((b) => b.type !== "costs" && b.type !== "priceStory").map((b) => {
    if (b.type === "summary") return enrichSummary(b as Summary, facts, costs, story);
    if (b.type === "sections") return enrichSections(b as Sections, facts, costs, story);
    return b;
  });
  const added: CardBlock[] = [];
  if (story) added.push(story);
  if (costs) added.push(costs);
  const lease = leaseFlag(facts.leaseYearsRemaining);
  const flags = blocks.findIndex((b) => b.type === "flags");
  if (lease && flags >= 0) {
    const block = blocks[flags] as Extract<CardBlock, { type: "flags" }>;
    blocks[flags] = { ...block, items: [lease, ...(block.items ?? []).filter((item) => !item.text.startsWith("Lease has"))] };
  } else if (lease) added.push({ type: "flags", items: [lease] });
  if (facts.locationApproximate && !blocks.some((b) => b.type === "footnote" && b.text === APPROXIMATE)) {
    added.push({ type: "footnote", text: APPROXIMATE });
  }
  const actions = blocks.findIndex((b) => b.type === "actions");
  blocks.splice(actions >= 0 ? actions : blocks.length, 0, ...added);
  return { ...card, blocks };
}

function enrichSummary(block: Summary, facts: ListingFacts, costs: Costs | null, story: Story | null): Summary {
  const groups = block.groups.map((group) => ({ ...group, rows: [...(group.rows ?? [])] }));
  const market = onMarketValue(facts, story);
  let price = groups.find((group) => group.title === "The price");
  if (price) price.rows = price.rows.filter((row) => row.label !== "On the market");
  if (market) {
    if (!price) {
      price = { title: "The price", only: true, rows: [] };
      groups.splice(groups.findIndex((group) => group.title === "For your search") + 1, 0, price);
    }
    price.rows.push({ label: "On the market", value: market, tone: "neutral" });
  }
  const money = moneyRows(facts, costs);
  const at = groups.findIndex((group) => group.title === "The money");
  if (at >= 0) groups[at].rows = money;
  else if (money.length) {
    const after = groups.findIndex((group) => group.title === "The price");
    groups.splice(after >= 0 ? after + 1 : groups.findIndex((group) => group.title === "For your search") + 1, 0,
      { title: "The money", only: false, rows: money });
  }
  return { ...block, groups: groups.filter((group) => group.rows.length) };
}

function enrichSections(block: Sections, facts: ListingFacts, costs: Costs | null, story: Story | null): Sections {
  const columns = (block.columns ?? []).map((column) => ({ ...column, rows: [...(column.rows ?? [])] }));
  const column = (title: string, at: (cols: typeof columns) => number) => {
    let found = columns.find((c) => c.title === title);
    if (!found) {
      found = { title, rows: [] };
      columns.splice(Math.max(0, Math.min(at(columns), columns.length)), 0, found);
    }
    return found;
  };
  const home = column("This home", () => 0);
  const labels = new Set(home.rows.map((row) => row.label));
  home.rows.push(...homeRows(facts).filter((row) => !labels.has(row.label)));
  column("Costs", (cols) => cols.findIndex((c) => c.title === "This home") + 1).rows = costRows(facts, costs);
  const offer = column("Before you offer", (cols) => cols.length);
  const local: Row[] = [];
  if (story?.daysOnMarket !== undefined) local.push({ label: "On the market", value: `${story.daysOnMarket} days` });
  if (story?.changes.length) local.push({ label: "Price changes", value: String(story.changes.length) });
  local.push(...askRows(facts));
  const keep = offer.rows.filter((row) => !["On the market", "Price changes", "Ask"].includes(row.label));
  const lead = keep.filter((row) => row.label === "Asking price");
  offer.rows = [...lead, ...local, ...keep.filter((row) => row.label !== "Asking price")];
  return { ...block, columns: columns.filter((c) => c.rows.length) };
}

/** The results line's "12d on market" chip, counted here from the page's date; placed before the area's trend. */
export function withDaysChip(chips: Chip[] | null, listedOn: string | null | undefined, today: string): Chip[] | null {
  const days = daysOnMarket(listedOn, today);
  if (!chips || days === null || chips.some((chip) => chip.kind === "days")) return chips;
  const chip: Chip = { kind: "days", text: `${days}d on market`, band: null };
  const trend = chips.findIndex((c) => c.kind === "trend");
  return trend >= 0 ? [...chips.slice(0, trend), chip, ...chips.slice(trend)] : [...chips, chip];
}

export function pounds(value: number): string {
  return `£${Math.round(value).toLocaleString("en-GB")}`;
}

function day(iso: string): string {
  const [year, month, d] = iso.split("-").map(Number);
  const name = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1];
  return name ? `${d} ${name} ${year}` : iso;
}
