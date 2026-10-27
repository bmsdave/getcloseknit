import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  type AreaBrief, type BriefRequest, type PriceContext, binsInBudget, briefApiPath, budgetLabel, budgetSentence,
  decodeBrief, distanceKm, encodeBrief, filterSchools, formatPrice, homeLabel, matchedNote, ringFor,
} from "../src/lib/brief-model";

// api/area_api/share_links.py encodes the same fixtures; both sides must agree byte for byte.
const fixture = JSON.parse(readFileSync(new URL("../../contracts/fixtures/agent-share-links.json", import.meta.url), "utf8")) as {
  briefs: { name: string; brief: BriefRequest; fragment: string }[];
};

for (const item of fixture.briefs) {
  test(`brief link ${item.name} round-trips`, () => {
    assert.equal(encodeBrief(item.brief), item.fragment);
    assert.deepEqual(decodeBrief(item.fragment), item.brief);
  });
}

test("malformed or hostile brief fragments decode to null", () => {
  assert.equal(decodeBrief("#profile=v1.abc"), null);
  assert.equal(decodeBrief("#brief=v1.not-base64!!"), null);
  const bad = (brief: Partial<BriefRequest>) => encodeBriefRaw({ ...fixture.briefs[0].brief, ...brief });
  assert.equal(decodeBrief(bad({ areas: ["uk:lad:E09000007"] })), null);
  assert.equal(decodeBrief(bad({ areas: Array(13).fill(0).map((_, i) => `uk:lsoa:E010000${String(i).padStart(2, "0")}`) })), null);
  assert.equal(decodeBrief(bad({ budget: [900000, 800000] })), null);
  assert.equal(decodeBrief(bad({ criteria: ["vibes" as never] })), null);
});

function encodeBriefRaw(brief: BriefRequest): string {
  const packed = { a: brief.areas, b: brief.budget, m: brief.market, r: brief.bedrooms, t: brief.propertyType, c: brief.criteria,
    d: brief.destinations.map((d) => [d.label, d.latitude, d.longitude]) };
  return "#brief=v1." + Buffer.from(JSON.stringify(packed)).toString("base64url");
}

test("the API path carries only areas, budget and the home wanted", () => {
  const path = briefApiPath(fixture.briefs[0].brief);
  assert.equal(path, "/api/v1/brief?areas=uk%3Alsoa%3AE01004447%2Cuk%3Alsoa%3AE01000951%2Cuk%3Alsoa%3AE01001234&bedrooms=3&market=buy&propertyType=house&budgetMin=800000&budgetMax=900000");
  assert.ok(!path.includes("King"));
});

const context: PriceContext = {
  available: true, sales: 51, windowMonths: 36, minimumSample: 10, matched: "size-and-type", floorBand: [80, 110], above: 0,
  median: 730000, p25: 640000, p75: 790000, budgetMinPercentile: 86, budgetMaxPercentile: 98,
  bins: [{ from: 400000, to: 500000, count: 3 }, { from: 700000, to: 800000, count: 24 }, { from: 800000, to: 900000, count: 7 }, { from: 900000, to: 1000000, count: 1 }],
};

test("the budget sentence places the budget among similar sales", () => {
  assert.equal(budgetSentence(context, "3-bed house"),
    "Your budget is comfortably above most recent sales of 3-bed houses here: it reaches 86–98% of them (median £730k).");
  assert.match(budgetSentence({ ...context, matched: "size" }, "3-bed house"), /sales of homes of 80–110 m² \(any type\) here/);
  assert.match(budgetSentence({ ...context, matched: "type" }, "3-bed house"), /sales of houses of any size here/);
  assert.match(budgetSentence({ ...context, matched: "all" }, "3-bed house"), /homes of any size and type/);
  assert.match(budgetSentence({ ...context, budgetMaxPercentile: 30, budgetMinPercentile: 30 }, "flat"), /below the middle of/);
  assert.match(budgetSentence({ ...context, budgetMinPercentile: 30, budgetMaxPercentile: 58 }, "flat"), /around the middle of/);
  assert.match(budgetSentence({ ...context, budgetMinPercentile: 55, budgetMaxPercentile: 70 }, "flat"), /above the middle of/);
  assert.equal(budgetSentence({ available: false, sales: 4, minimumSample: 10 }, "home"),
    "Too few comparable sales here (4 of the 10 needed) to place your budget.");
  assert.match(budgetSentence({ available: false, reason: "no rental evidence" }, "flat"), /published per borough/);
});

test("formatting and labels", () => {
  assert.equal(formatPrice(730000), "£730k");
  assert.equal(formatPrice(1250000), "£1.25m");
  assert.equal(formatPrice(1100000), "£1.1m");
  assert.equal(formatPrice(2000000), "£2m");
  assert.equal(budgetLabel([800000, 900000], "buy"), "£800k–£900k");
  assert.equal(budgetLabel([null, 2500], "rent"), "up to £2,500 a month");
  assert.equal(homeLabel(3, "house"), "3-bed house");
  assert.equal(homeLabel(0, "flat"), "studio");
  assert.match(matchedNote(context) ?? "", /80–110 m²/);
});

test("budget band highlights overlapping bins", () => {
  assert.deepEqual(binsInBudget(context.bins, [800000, 900000]), [false, false, true, false]);
  assert.deepEqual(binsInBudget(context.bins, [null, null]), [false, false, false, false]);
});

test("schools filter by phase, grade and area; ring is per area", () => {
  const school = (urn: string, phase: string, tier: "outstanding" | "good", near: string[]) => ({
    urn, name: urn, phase, latitude: 0, longitude: 0, distanceMetres: 1, attainment8: null, selectivity: null,
    grade: { tier, label: tier, year: null }, nearAreas: near });
  const schools = [school("a", "Primary", "outstanding", ["x"]), school("b", "Secondary", "good", ["x", "y"])];
  assert.deepEqual(filterSchools(schools, { phase: "secondary", topOnly: false }).map((s) => s.urn), ["b"]);
  assert.deepEqual(filterSchools(schools, { phase: "all", topOnly: true }).map((s) => s.urn), ["a"]);
  assert.deepEqual(filterSchools(schools, { phase: "all", topOnly: false }, "y").map((s) => s.urn), ["b"]);
  const brief = { ring: [{ geographyId: "r1", ringOf: ["x"] }, { geographyId: "r2", ringOf: ["y"] }] } as unknown as AreaBrief;
  assert.deepEqual(ringFor(brief, "x").map((r) => r.geographyId), ["r1"]);
});

test("straight-line distance for getting around", () => {
  assert.equal(Math.round(distanceKm([-0.1416, 51.501], { label: "KX", latitude: 51.530609, longitude: -0.123949 }) * 10) / 10, 3.5);
});
