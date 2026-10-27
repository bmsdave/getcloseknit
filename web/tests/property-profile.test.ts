import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AreaPricesCard, PriceBandStrip } from "../src/components/area-prices-card";
import { EPC_HOME_NOTE, HomePage } from "../src/components/home-page";
import { EnergyBands, FactsCard, PostcodeHomesView } from "../src/components/property-profile";

import {
  EPC_WITHHELD_COPY,
  councilTaxBandLabel,
  HOME_MAP_LAYERS,
  UNKNOWN,
  homeMapHref,
  factRows,
  isUprn,
  isWithheld,
  mapLinks,
  postcodeHomesPath,
  plainWords,
  bridgeSentence,
  changeSinceLastSaleLine,
  positionSentence,
  pounds,
  priceSpan,
  rangeSentence,
  repeatsType,
  signedPercent,
  type AreaPrices,
  type PostcodeHome,
  type PropertyFacts,
  type ProfileValuation,
  type Withheld,
} from "../src/lib/property-profile";
import { demoEpcAddresses, demoPostcodeHomes, demoPropertyProfile } from "../src/lib/property-profile-fixture";
import { fixtureAreaMarket } from "../src/lib/market-fixture";
import { demoStreetHome } from "../src/lib/street-home-fixture";

const EMPTY_FACTS: PropertyFacts = {
  propertyType: null, tenure: null, newBuildSale: null, epcPropertyType: null, builtForm: null,
  constructionAgeBand: null, floorAreaSquareMetres: null, habitableRooms: null, floorLevel: null,
  energyRating: null, potentialEnergyRating: null, energyCertificateDate: null,
};

test("paths and outbound map links", () => {
  assert.equal(postcodeHomesPath("SW1A 1AB"), "/postcode/SW1A-1AB/homes");
  const links = mapLinks({ lon: -0.1416, lat: 51.501 });
  assert.equal(links.maps, "https://www.google.com/maps/search/?api=1&query=51.501000,-0.141600");
  assert.equal(links.streetView, "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=51.501000,-0.141600");
  assert.equal(homeMapHref("uk:lsoa:E01000001", "crime"), "/?selected=uk%3Alsoa%3AE01000001&layer=crime");
  assert.deepEqual(HOME_MAP_LAYERS.map((layer) => layer.label), ["Price", "Crime", "Deprivation", "Income", "Social housing"]);
  assert.ok(isUprn("100023336956"));
  assert.ok(!isUprn("12a"));
});

test("money and percent wording keeps unknown distinct from zero", () => {
  assert.equal(signedPercent(4.53), "+4.5%");
  assert.equal(signedPercent(-2.1), "−2.1%");
  assert.equal(signedPercent(0), "0%");
  assert.equal(signedPercent(null), UNKNOWN);
  assert.equal(pounds(668000), "£668,000");
  assert.equal(pounds(-5000), "−£5,000");
  assert.equal(pounds(null), UNKNOWN);
});

test("built form is left out when it repeats the type; jargon reads plainly", () => {
  const terrace = factRows({ ...EMPTY_FACTS, propertyType: "Terraced", builtForm: "Mid-Terrace" });
  assert.equal(terrace.some((row) => row.label === "Built form"), false);
  const semi = factRows({ ...EMPTY_FACTS, propertyType: "Detached", builtForm: "Semi-Detached" });
  assert.equal(semi.find((row) => row.label === "Built form")?.value, "Semi-Detached");
  assert.ok(repeatsType("Semi-Detached", "Semi-detached"));
  assert.equal(plainWords("Comparisons use standard market sales only (Price Paid category A)."), "Comparisons use standard sales only.");
  assert.equal(plainWords("Floor areas come from the latest EPC."), "Floor areas come from the latest energy certificate.");
});

test("every missing fact reads Unknown, never 0", () => {
  for (const row of factRows(EMPTY_FACTS)) assert.equal(row.value, UNKNOWN, row.label);
  const house = factRows({ ...EMPTY_FACTS, epcPropertyType: "House", habitableRooms: 0 });
  assert.equal(house.find((row) => row.label === "Floor")?.value, "Whole house");
  assert.equal(house.find((row) => row.label === "Habitable rooms")?.value, "0");
});

test("the council tax band shows only when it is not withheld and a band exists", () => {
  assert.equal(councilTaxBandLabel("D", []), "Band D");
  assert.equal(councilTaxBandLabel("D", undefined), "Band D");
  assert.equal(councilTaxBandLabel("D", ["councilTaxBand"]), null);
  assert.equal(councilTaxBandLabel(null, []), null);
  assert.equal(councilTaxBandLabel(undefined, []), null);
  const label = (rows: { label: string }[]) => rows.some((row) => row.label === "Council tax band");
  assert.equal(label(factRows({ ...EMPTY_FACTS, councilTaxBand: "D" }, [])), true);
  assert.equal(label(factRows({ ...EMPTY_FACTS, councilTaxBand: "D" }, ["epc"])), true);
  assert.equal(label(factRows({ ...EMPTY_FACTS, councilTaxBand: "D" }, ["councilTaxBand"])), false);
  assert.equal(label(factRows({ ...EMPTY_FACTS, councilTaxBand: null }, [])), false);
  assert.equal(label(factRows(EMPTY_FACTS, [])), false);
  const card = (withheld: never[] | ["councilTaxBand"]) =>
    renderToStaticMarkup(createElement(FactsCard, { facts: { ...EMPTY_FACTS, councilTaxBand: "D" }, withheld }));
  assert.match(card([]), /Council tax band/);
  assert.doesNotMatch(card(["councilTaxBand"]), /Council tax band/);
});

test("demo fixtures tell one story with the demo address history", () => {
  const profile = demoPropertyProfile("100000000001")?.profile;
  assert.ok(profile);
  assert.equal(profile.areaPrices.position?.saleDate, profile.sales.at(-1)?.date);
  assert.ok(!("estimate" in profile), "no per-home estimate in the profile");
  assert.match(profile.disclaimer, /not a valuation of this home/);
  const homes = demoPostcodeHomes("SW1A 1AB");
  assert.ok(homes?.homes.some((home) => home.uprn === profile.uprn));
  assert.equal(demoPostcodeHomes("E1 1AA"), null);
  assert.equal(demoPropertyProfile("1"), null);
});

test("energy bands show current and potential, or Unknown without a certificate", () => {
  const html = renderToStaticMarkup(createElement(EnergyBands, { current: "C", potential: "B", date: "2022-08-19" }));
  assert.match(html, /aria-label="Energy rating: C now, B potential"/);
  assert.match(html, /Certificate 19 Aug 2022/);
  const none = renderToStaticMarkup(createElement(EnergyBands, { current: null, potential: null, date: null }));
  assert.match(none, /data-unknown="">Unknown/);
  assert.doesNotMatch(none, /role="img"|Certificate/);
});

const PRICES: AreaPrices = {
  propertyType: "Terraced", minimumSales: 5,
  range: { level: "lsoa", areaId: "uk:lsoa:E01000001", areaName: "Hackney 012A", sales: 41, since: "2023-01", adjustedTo: "2026-10",
    p10: 590_000, p25: 680_000, p50: 745_000, p75: 820_000, p90: 850_000 },
  position: { saleDate: "2015-05-20", year: 2015, band: "top-10", bandWords: "top 10%", yearSales: 14, today: { from: 850_000, to: null } },
  note: null,
  disclaimer: "About this area's sales, not a valuation of this home. It can't see condition or improvements.",
};

test("area prices read as the brief's sentences, about the area", () => {
  assert.equal(rangeSentence(PRICES), "Terraced houses here: most sell for £680k–£820k (middle half of 41 sales since 2023, adjusted to Oct 2026)");
  assert.equal(positionSentence(PRICES), "When this home sold in May 2015, its price was in the top 10% of terraced sales in this area that year.");
  assert.equal(bridgeSentence(PRICES), "Today, the top 10% of terraced sales here are above £850k.");
  const middle = { ...PRICES, position: { ...PRICES.position!, band: "top-quarter" as const, bandWords: "top quarter", today: { from: 820_000, to: 850_000 } } };
  assert.equal(bridgeSentence(middle), "Today, the top quarter of terraced sales here are £820k–£850k.");
  assert.equal(priceSpan(null, 590_000), "below £590k");
  assert.equal(priceSpan(1_250_000, 1_500_000), "£1.25m–£1.5m");
});

test("too few sales: no range, no position, only the note", () => {
  const none = { ...PRICES, range: null, position: null, note: "Not enough sales of this type nearby to show a range." };
  assert.equal(rangeSentence(none), null);
  assert.equal(positionSentence(none), null);
  assert.equal(bridgeSentence(none), null);
  const html = renderToStaticMarkup(createElement(AreaPricesCard, { prices: none }));
  assert.match(html, /data-testid="area-prices-none">Not enough sales of this type nearby to show a range\./);
  assert.doesNotMatch(html, /area-prices-chart|area-prices-position|area-prices-bridge|£/);
  assert.match(html, /About this area&#x27;s sales, not a valuation of this home\. It can&#x27;t see condition or improvements\./);
});

test("the band strip highlights the position's band, else the middle half, with no home marker", () => {
  const html = renderToStaticMarkup(createElement(PriceBandStrip, { range: PRICES.range!, highlight: "top-10" }));
  assert.match(html, /data-highlight="top-10"/);
  assert.match(html, /aria-label="Prices today: bottom 10% below £590k, bottom quarter £590k–£680k, lower middle £680k–£745k, upper middle £745k–£820k, top quarter £820k–£850k, top 10% above £850k"/);
  assert.doesNotMatch(html, /class="dot"|marker/);
  assert.match(renderToStaticMarkup(createElement(PriceBandStrip, { range: PRICES.range!, highlight: null })), /data-highlight="middle-half"/);
});

// Guard: user-facing property output never states what one home is worth. A negation is allowed.
// "Now ~£1.14m · Medium confidence" was the map home card's restated value before 11 Oct 2026.
const FORBIDDEN = /estimated price|\bworth\b|valuation of this home|would be around|\bnow ~|\b(?:high|medium|low) confidence\b/i;
const NEGATION = /not a valuation( of (this|any) home)?/gi;

function assertNoHomeFigure(text: string, where: string) {
  const match = FORBIDDEN.exec(text.replace(NEGATION, ""));
  assert.equal(match, null, `${where}: "${match?.[0]}"`);
}

test("the street-level home renders blocks 1–5 with its fallbacks and no figure for the home", () => {
  const street = demoStreetHome("W5 1LR", "120-meadvale-road");
  assert.ok(street && "label" in street);
  const market = fixtureAreaMarket("uk:lsoa:E01000001");
  const render = (otherHomes: PostcodeHome[] | null) => renderToStaticMarkup(createElement(HomePage, {
    home: { kind: "street", street, areaMarket: market ? { market, name: "Westminster preview" } : null, otherHomes },
    mode: "demo", release: "test",
  }));
  const html = render(demoPostcodeHomes("W5 1LR")!.homes);
  assertNoHomeFigure(html, "street home page");
  const order = ["home-header", "home-price", "home-facts", "home-sales", "home-other-homes"].map((id) => html.indexOf(`data-testid="${id}"`));
  assert.ok(order.every((at, index) => at > 0 && (index === 0 || at > order[index - 1])), `block order ${order}`);
  assert.match(html, /No recorded sale; postcode likely W5 1LR/);
  assert.match(html, /data-testid="area-price-ranges"/);
  assert.match(html, /116 Meadvale Road/);
  assert.match(html, /href="\/\?selected=uk%3Alsoa%3AE01000001&amp;layer=price-per-square-metre"/);
  // No record of the home: no size or energy rows at all, whether or not `epc` is withheld.
  for (const withheld of [street.withheld, [...street.withheld, "epc" as const]]) {
    const facts = renderToStaticMarkup(createElement(HomePage, {
      home: { kind: "street", street: { ...street, withheld }, areaMarket: null, otherHomes: [] }, mode: "demo", release: "test",
    }));
    const block = facts.slice(facts.indexOf('data-testid="home-facts"'), facts.indexOf('data-testid="home-sales"'));
    assert.match(block, /<dt>Type<\/dt>/);
    assert.doesNotMatch(block, /Size and energy|Not shown per home yet|Floor area|Habitable rooms|Energy rating|Built<\/dt>/);
  }
  // A failed postcode-homes fetch is not "no other homes".
  const failed = render(null);
  assert.match(failed, /List unavailable/);
  assert.doesNotMatch(failed, /No other recorded homes/);
  // No street point: the outbound links wait for the area's centre.
  const pointless = renderToStaticMarkup(createElement(HomePage, {
    home: { kind: "street", street: { ...street, point: null }, areaMarket: null, otherHomes: [] }, mode: "demo", release: "test",
  }));
  assert.match(pointless, /Map links need a street point/);
  assert.doesNotMatch(pointless, /google-maps-link/);
});

test("guard: property, postcode and fixture output carry no per-home estimate wording", () => {
  for (const uprn of ["100000000001", "100000000012"]) {
    const profile = demoPropertyProfile(uprn)!.profile;
    assertNoHomeFigure(JSON.stringify(profile), `profile ${uprn}`);
    assertNoHomeFigure(renderToStaticMarkup(createElement(HomePage, { home: { kind: "uprn", profile }, mode: "demo", release: "test" })), `page ${uprn}`);
  }
  const homes = demoPostcodeHomes("SW1A 1AB")!;
  assertNoHomeFigure(JSON.stringify(homes), "postcode homes");
  assertNoHomeFigure(renderToStaticMarkup(createElement(PostcodeHomesView, { postcode: homes.postcode, homes: homes.homes, disclaimer: homes.disclaimer, mode: "demo" })), "postcode page");
  assert.throws(() => assertNoHomeFigure("Estimated price ~£668k", "sample"));
  assert.throws(() => assertNoHomeFigure("It would be around £700k", "sample"));
  assert.throws(() => assertNoHomeFigure("Last sold £1,218,640 · Dec 2023 · Now ~£1.14m", "sample"));
  assert.throws(() => assertNoHomeFigure("Now ~£1.14m · Medium confidence", "sample"));
  assertNoHomeFigure("About this area's sales, not a valuation of this home.", "negation");
});

test("isWithheld: an old payload without the list withholds nothing", () => {
  assert.equal(isWithheld(undefined, "epc"), false);
  assert.equal(isWithheld([], "epc"), false);
  assert.equal(isWithheld(["epc"], "epc"), true);
  assert.equal(isWithheld(["valuation"], "epc"), false);
});

test("facts card: withheld epc shows the fallback copy, not Unknown rows", () => {
  const base = demoPropertyProfile("100000000001")!.profile;
  const withheld = renderToStaticMarkup(createElement(HomePage, { home: { kind: "uprn", profile: { ...base, withheld: ["epc"] } }, mode: "demo", release: "test" }));
  assert.ok(withheld.includes(EPC_WITHHELD_COPY));
  assert.equal(EPC_WITHHELD_COPY, "Not shown per home yet");
  assert.match(withheld, /Tenure/);
  assert.doesNotMatch(withheld, /Habitable rooms/);
  assert.doesNotMatch(withheld, /property-energy/, "no energy bands while epc is withheld");
  const nulls = { ...base, withheld: [] as never[], facts: { ...base.facts, habitableRooms: null } };
  const shown = renderToStaticMarkup(createElement(HomePage, { home: { kind: "uprn", profile: nulls }, mode: "demo", release: "test" }));
  assert.ok(!shown.includes(EPC_WITHHELD_COPY), "fallbacks come from withheld, never from nulls");
  assert.match(shown, /Habitable rooms/);
  assert.match(shown, /property-energy/);
  const old = renderToStaticMarkup(createElement(HomePage, { home: { kind: "uprn", profile: { ...base, withheld: undefined } }, mode: "demo", release: "test" }));
  assert.match(old, /property-energy/, "an old payload without the list withholds nothing");
});

test("sales card: £/m² column only when pricePerSqm is not withheld", () => {
  const base = demoPropertyProfile("100000000001")!.profile;
  const sales = base.sales.map((sale) => ({ ...sale, pricePerSquareMetre: 12_345 }));
  const render = (withheld: Withheld[] | undefined) =>
    renderToStaticMarkup(createElement(HomePage, { home: { kind: "uprn", profile: { ...base, sales, withheld } }, mode: "demo", release: "test" }));
  assert.doesNotMatch(render(["pricePerSqm"]), /£\/m²|12,345/);
  const on = render([]);
  assert.match(on, /<th>£\/m²<\/th>/);
  assert.match(on, /£12,345/);
  assert.match(render(undefined), /<th>£\/m²<\/th>/);
});

test("other homes and the postcode list: withheld epc shows the fallback, not Unknown", () => {
  const homes = demoPostcodeHomes("SW1A 1AB")!;
  const off = renderToStaticMarkup(createElement(PostcodeHomesView, { postcode: homes.postcode, homes: homes.homes, disclaimer: homes.disclaimer, mode: "demo", withheld: ["epc"] }));
  assert.ok(off.includes(EPC_WITHHELD_COPY));
  assert.doesNotMatch(off, /<th>Floor area<\/th>|<th>Energy<\/th>|<dt>Floor area<\/dt>|<dt>Energy<\/dt>|floor area, energy rating/);
  const on = renderToStaticMarkup(createElement(PostcodeHomesView, { postcode: homes.postcode, homes: homes.homes, disclaimer: homes.disclaimer, mode: "demo", withheld: [] }));
  assert.ok(!on.includes(EPC_WITHHELD_COPY));
  for (const html of [on, renderToStaticMarkup(createElement(PostcodeHomesView, { postcode: homes.postcode, homes: homes.homes, disclaimer: homes.disclaimer, mode: "demo" }))]) {
    assert.match(html, /<th>Floor area<\/th>/);
    assert.match(html, /<th>Energy<\/th>/);
  }
});

test("change since the last sale: the home's own prices, the borough's same type, never a figure today", () => {
  assert.equal(changeSinceLastSaleLine({ home: 4.4, borough: 3.1, since: 2006, until: 2022 }, "Flat or maisonette"),
    "+4.4% a year between its 2006 and 2022 sales · borough flats +3.1%");
  assert.equal(changeSinceLastSaleLine({ home: -1.2, borough: null, since: 2006, until: 2016 }, "Terraced"),
    "−1.2% a year between its 2006 and 2016 sales");
  // A single sale: the borough's change since it, never a figure for the home.
  const single = changeSinceLastSaleLine({ home: null, borough: 2.3, since: 2016, until: 2026 }, "Semi-detached");
  assert.equal(single, "Borough semi-detached +2.3% a year since 2016");
  assert.doesNotMatch(single!, /home|its /);
  assert.equal(changeSinceLastSaleLine({ home: 3, borough: 2, since: 2016, until: 2020 }, null),
    "+3% a year between its 2016 and 2020 sales · borough +2%");
  assert.equal(changeSinceLastSaleLine(null, "Terraced"), null);
  const base = demoPropertyProfile("100000000001")!.profile;
  const html = renderToStaticMarkup(createElement(HomePage, { home: { kind: "uprn", profile: {
    ...base, salesSummary: { changeSinceLastSale: { home: 7.0, borough: 7.2, since: 2006, until: 2022 } } } }, mode: "demo", release: "test" }));
  assert.match(html, /data-testid="sales-change"[^>]*>\+7% a year between its 2006 and 2022 sales · borough flats \+7.2%</);
  const old = renderToStaticMarkup(createElement(HomePage, { home: { kind: "uprn", profile: { ...base, salesSummary: undefined } }, mode: "demo", release: "test" }));
  assert.doesNotMatch(old, /sales-change/);
});

test("price block: the model estimate only when valuation is not withheld", () => {
  const base = demoPropertyProfile("100000000001")!.profile;
  const valuation: ProfileValuation = { value: 625_000, low: 585_000, high: 665_000, method: "indexed-sale",
    vsLocalMedianPerSqm: null, vsLocalTypeMedian: 4.2 };
  const render = (withheld: Withheld[], value: ProfileValuation | null) => renderToStaticMarkup(createElement(HomePage, {
    home: { kind: "uprn", profile: { ...base, withheld, valuation: value } }, mode: "demo", release: "test" }));
  const off = render(["valuation"], valuation);
  assert.doesNotMatch(off, /home-valuation|625,000|model estimate/, "withheld: today's area prices only");
  assert.match(off, /data-testid="area-prices"/);
  const on = render([], valuation);
  assert.match(on, /data-testid="home-valuation"/);
  assert.match(on, /An indicative model estimate, not a valuation/);
  assert.match(on, /£625,000/);
  assert.match(on, /£585,000–£665,000/);
  assert.match(on, /\+4.2% vs local flats median/);
  assert.doesNotMatch(on, /£\/m² vs/, "no £/m² comparison without a floor area");
  assert.doesNotMatch(on, /data-testid="area-prices"/, "the area prices are the fallback");
  assert.match(on, /data-testid="asking-price-input"/, "the asking-price check stays");
  assertNoHomeFigure(on, "valuation card");
  const perSqm = render([], { ...valuation, method: "floor-area", vsLocalMedianPerSqm: -3.1 });
  assert.match(perSqm, /£\/m² −3.1% vs local median/);
  const noPerSqm = render([], { ...valuation, method: "floor-area", vsLocalMedianPerSqm: null });
  assert.doesNotMatch(noPerSqm, /£\/m² vs/, "floor-area without an indexable sale: the £/m² row is left out");
  assert.match(noPerSqm, /\+4.2% vs local flats median/);
  assert.match(render([], null), /data-testid="home-valuation"[\s\S]*Not available/, "on with no inputs: Not available, not the fallback");
  const before = { ...base, withheld: [] as Withheld[] };
  delete before.valuation;
  const old = renderToStaticMarkup(createElement(HomePage, { home: { kind: "uprn", profile: before }, mode: "demo", release: "test" }));
  assert.match(old, /data-testid="area-prices"/, "a payload without the valuation key keeps the area ranges");
  assert.doesNotMatch(old, /home-valuation/);
});

/** Runs `body` with CLOSE_KNIT_EPC_ADDRESSES set (or unset), restoring the environment after. */
function withEpcAddresses(value: string | undefined, body: () => void) {
  const saved = { flag: process.env.CLOSE_KNIT_EPC_ADDRESSES, access: process.env.CLOSE_KNIT_ACCESS };
  const set = (name: string, next: string | undefined) => {
    if (next === undefined) delete process.env[name];
    else process.env[name] = next;
  };
  set("CLOSE_KNIT_EPC_ADDRESSES", value);
  set("CLOSE_KNIT_ACCESS", undefined);
  try {
    body();
  } finally {
    set("CLOSE_KNIT_EPC_ADDRESSES", saved.flag);
    set("CLOSE_KNIT_ACCESS", saved.access);
  }
}

test("the EPC-addresses flag follows the API: 1 on, 0 off, unset on only in a private preview", () => {
  assert.equal(demoEpcAddresses({}), false);
  assert.equal(demoEpcAddresses({ CLOSE_KNIT_EPC_ADDRESSES: "1" }), true);
  assert.equal(demoEpcAddresses({ CLOSE_KNIT_ACCESS: "private" }), true);
  assert.equal(demoEpcAddresses({ CLOSE_KNIT_ACCESS: "private", CLOSE_KNIT_EPC_ADDRESSES: "0" }), false);
  assert.equal(demoEpcAddresses({ CLOSE_KNIT_ACCESS: "public" }), false);
});

test("flag off: no EPC-only home in the demo list or as a page, and epcAddresses is withheld", () => {
  withEpcAddresses(undefined, () => {
    const homes = demoPostcodeHomes("SW1A 1AB")!;
    assert.ok(homes.withheld?.includes("epcAddresses"));
    assert.ok(!homes.homes.some((home) => home.addressSource === "epc"));
    assert.equal(demoPropertyProfile("100000000014"), null);
    assert.ok(!demoPropertyProfile("100000000001")!.profile.otherHomes.some((home) => home.uprn === "100000000014"));
  });
});

test("flag on: the postcode list renders the EPC-only home with no sale and a link to its page", () => {
  withEpcAddresses("1", () => {
    const homes = demoPostcodeHomes("SW1A 1AB")!;
    assert.ok(!homes.withheld?.includes("epcAddresses"));
    const epcHome = homes.homes.find((home) => home.addressSource === "epc");
    assert.ok(epcHome && epcHome.addressId === null && epcHome.lastSale === null);
    const html = renderToStaticMarkup(createElement(PostcodeHomesView, {
      postcode: homes.postcode, homes: homes.homes, disclaimer: homes.disclaimer, mode: "demo", withheld: homes.withheld,
    }));
    assert.match(html, /4 homes/);
    assert.match(html, /<a href="\/property\/100000000014">Flat 4, 14 Sample Street<\/a>/);
    const row = html.slice(html.indexOf("Flat 4, 14 Sample Street"));
    assert.match(row.slice(0, row.indexOf("</tr>")), /None recorded/);
    assertNoHomeFigure(html, "postcode page with an EPC-only home");
  });
});

test("flag on: the EPC-only home's page shows its certificate facts, no sale, and says where the address is from", () => {
  withEpcAddresses("1", () => {
    const profile = demoPropertyProfile("100000000014")!.profile;
    assert.equal(profile.addressSource, "epc");
    const html = renderToStaticMarkup(createElement(HomePage, { home: { kind: "uprn", profile }, mode: "demo", release: "test" }));
    assert.match(html, /<h1>Flat 4, 14 Sample Street/);
    assert.match(html, new RegExp(EPC_HOME_NOTE.replace(".", "\\.")));
    assert.match(html, /data-testid="epc-home-note"/);
    assert.match(html, /aria-label="Energy rating: D now, C potential"/);
    assert.match(html, /10 Sample Street/, "its neighbours are listed");
    assertNoHomeFigure(html, "EPC-only home page");
    const recorded = demoPropertyProfile("100000000001")!.profile;
    assert.ok(recorded.otherHomes.some((home) => home.uprn === "100000000014"));
    const recordedHtml = renderToStaticMarkup(createElement(HomePage, { home: { kind: "uprn", profile: recorded }, mode: "demo", release: "test" }));
    assert.doesNotMatch(recordedHtml, /data-testid="epc-home-note"/);
  });
});
