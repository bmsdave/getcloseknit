import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OwnershipBlock } from "../src/components/ownership";
import { type AreaOwnershipResponse, ownershipPath, ownershipRows, per100, readAreaOwnership } from "../src/lib/area-ownership";
import { MAP_TOPIC_GROUPS, findTopic } from "../src/lib/map-topics";

const LOADED: AreaOwnershipResponse = {
  schemaVersion: "area-ownership.v1", productReleaseId: "r1", dataMode: "release", confidence: "high",
  value: {
    available: true, homes: 800, unmatched: null, words: "High company ownership",
    company: { titles: 120, share: 0.15, regionPercentile: 92, regionShare: 0.041 },
    overseas: { titles: 30, share: 0.0375, regionPercentile: 97, regionShare: 0.006 },
    notes: ["15 company titles per 100 homes (London 4)"], sourceVersions: ["src-hmlr-ownership-2026-10-abc"],
  },
  evidence: [],
  sources: [{ sourceId: "hmlr-ccod-ocod", sourceName: "HM Land Registry CCOD and OCOD", release: "src-hmlr-ownership-2026-10-abc",
    sourceUrl: "https://use-land-property-data.service.gov.uk/datasets", licence: "HMLR",
    attribution: "Contains HM Land Registry data © Crown copyright and database right 2026." }],
  caveats: ["Counts land titles, not homes: one title can hold a whole block, and a home can sit on more than one title."],
};
const OFF: AreaOwnershipResponse = { ...LOADED, confidence: "none", value: { available: false, reason: "flag-off" }, sources: [], caveats: [] };

const render = (ownership: AreaOwnershipResponse | null) => renderToStaticMarkup(createElement(OwnershipBlock, { ownership }));

test("ownership payloads are recognised and rows read per 100 homes against London", () => {
  assert.equal(readAreaOwnership(LOADED), LOADED);
  assert.equal(readAreaOwnership({ schemaVersion: "area-home.v1" }), null);
  assert.equal(ownershipPath("uk:lsoa:E01004736"), "/api/v1/areas/uk%3Alsoa%3AE01004736/ownership");
  const rows = ownershipRows(LOADED);
  assert.deepEqual(rows.map((row) => [row.label, row.value, row.marker, row.display]), [
    ["UK companies", 15, 4.1, "15 per 100 homes"],
    ["Overseas", 3.75, 0.6, "4 per 100 homes"],
  ]);
  assert.deepEqual(ownershipRows(OFF), []);
  assert.equal(per100(0.004), "0.4");
  assert.equal(per100(0.21), "21");
});

test("the block shows the words, bars against London and the percentile; nothing while the flag is off", () => {
  const html = render(LOADED);
  assert.match(html, /data-testid="ownership"/);
  assert.match(html, /High company ownership/);
  assert.match(html, /UK companies/);
  assert.match(html, /More than 92% of London areas/);
  assert.equal(render(OFF), "");
  assert.equal(render(null), "");
});

test("both ownership layers are map items in Homes & area and work as range criteria", () => {
  const homes = MAP_TOPIC_GROUPS.find((group) => group.id === "homes-area")!;
  const item = homes.items.find((entry) => entry.label === "Company owners")!;
  assert.equal(item.layer, "ownership-company-share");
  assert.deepEqual(item.views?.map((view) => view.layer), ["ownership-company-share", "ownership-overseas-share"]);
  assert.equal(findTopic("ownership-overseas-share")?.id, "ownership-company-share");
});
