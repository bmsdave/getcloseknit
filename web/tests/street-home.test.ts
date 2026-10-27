import assert from "node:assert/strict";
import test from "node:test";

import { houseSlug, streetHomeNote, streetHomePath } from "../src/lib/street-home";
import { loadStreetHome } from "../src/lib/street-home-server";
import { demoStreetHome } from "../src/lib/street-home-fixture";

test("the house slug and the street-level path", () => {
  assert.equal(houseSlug("120 Meadvale Road"), "120-meadvale-road");
  assert.equal(houseSlug(" 12a  St John's Road "), "12a-st-johns-road");
  assert.equal(houseSlug("7 King’s Avenue, London"), "7-kings-avenue-london");
  // A letter suffix stays part of the number: 12A is never 12's or 12B's page.
  assert.equal(houseSlug("12A High Street"), "12a-high-street");
  assert.equal(streetHomePath("W5 1LR", "120 Meadvale Road"), "/property/at/W5-1LR/120-meadvale-road");
});

test("the note under the title says why this postcode", () => {
  const home = { label: "120 Meadvale Road", postcode: "W5 1LR", likelyPostcode: "W5 1LR", neighbours: [116, 124] };
  assert.equal(streetHomeNote(home), "No recorded sale; postcode likely W5 1LR (numbers 116 and 124 either side)");
  assert.equal(streetHomeNote({ ...home, neighbours: [116] }), "No recorded sale; other homes at number 116 are in W5 1LR");
  const caution = "No recorded sale here. We can't confirm the postcode from neighbouring homes; check it before relying on it.";
  assert.equal(streetHomeNote({ ...home, likelyPostcode: null, neighbours: [] }), caution);
  assert.equal(streetHomeNote({ ...home, likelyPostcode: "W5 1LS" }), caution);
  assert.doesNotMatch(caution, /more than one postcode/);
});

test("the demo fixture knows Meadvale Road, W5 1LR, from 116 to 124, and nothing else", () => {
  const home = demoStreetHome("W5-1LR", "120-meadvale-road");
  assert.ok(home && "label" in home);
  assert.deepEqual([home.label, home.postcode, home.neighbours, home.areaId], ["120 Meadvale Road", "W5 1LR", [116, 124], "uk:lsoa:E01000001"]);
  assert.equal(demoStreetHome("w5 1lr", "120-meadvale-road")?.hasOwnProperty("label"), true);
  // Any number in the street's range is the street-level page (as a hidden home's number is).
  const across = demoStreetHome("W5-1LR", "121-meadvale-road");
  assert.ok(across && "label" in across);
  assert.deepEqual([across.label, across.likelyPostcode, across.neighbours], ["121 Meadvale Road", null, []]);
  const lettered = demoStreetHome("W5-1LR", "118a-meadvale-road");
  assert.ok(lettered && "label" in lettered);
  assert.equal(lettered.label, "118a Meadvale Road");
  // Outside it, not found.
  assert.equal(demoStreetHome("W5-1LR", "999-meadvale-road"), null);
  assert.equal(demoStreetHome("W5-1LR", "114-meadvale-road"), null);
  assert.equal(demoStreetHome("SW1A-1AB", "120-meadvale-road"), null);
  // A recorded home with no UPRN goes to the postcode page.
  assert.deepEqual(demoStreetHome("W5-1LR", "116-meadvale-road"), { postcodePage: true });
  // A number that is a recorded demo home answers with its UPRN, as the API does.
  assert.deepEqual(demoStreetHome("SW1A-1AB", "10-sample-street"), { uprn: "100000000001" });
});

test("loadStreetHome maps the API status: 404 and 400 are no home, a body (home, uprn or postcode page) passes through, an outage is unavailable", async () => {
  const original = { fetch: globalThis.fetch, url: process.env.CLOSE_KNIT_API_URL };
  process.env.CLOSE_KNIT_API_URL = "http://api.test";
  const requested: string[] = [];
  const answer = (status: number, body?: unknown) => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(body === undefined ? null : JSON.stringify(body), { status });
    }) as typeof fetch;
  };
  try {
    answer(404);
    assert.equal(await loadStreetHome("real", "W5 1LR", "999-meadvale-road"), null);
    assert.equal(requested[0], "http://api.test/api/v1/homes/at/W5-1LR/999-meadvale-road");
    answer(400);
    assert.equal(await loadStreetHome("real", "W5 1LR", "x"), null);
    answer(200, { uprn: "100000000001" });
    assert.deepEqual(await loadStreetHome("real", "W5 1LR", "10-sample-street"), { uprn: "100000000001" });
    answer(200, { postcodePage: true });
    assert.deepEqual(await loadStreetHome("real", "W5 1LR", "116-meadvale-road"), { postcodePage: true });
    const home = { label: "120 Meadvale Road", postcode: "W5 1LR", likelyPostcode: "W5 1LR", neighbours: [116, 124], areaId: "uk:lsoa:E01001209", point: null, withheld: [] };
    answer(200, home);
    assert.deepEqual(await loadStreetHome("real", "W5 1LR", "120-meadvale-road"), home);
    // An outage or a busy API is a "didn't load" page, never a 500 (2026-10-25: a cold lookup past the 2.5 s wait).
    answer(500);
    assert.deepEqual(await loadStreetHome("real", "W5 1LR", "120-meadvale-road"), { unavailable: 500 });
    answer(429);
    assert.deepEqual(await loadStreetHome("real", "W5 1LR", "120-meadvale-road"), { unavailable: 429 });
    globalThis.fetch = (async () => { throw new DOMException("timed out", "TimeoutError"); }) as typeof fetch;
    assert.deepEqual(await loadStreetHome("real", "W5 1LR", "120-meadvale-road"), { unavailable: 503 });
  } finally {
    globalThis.fetch = original.fetch;
    if (original.url === undefined) delete process.env.CLOSE_KNIT_API_URL;
    else process.env.CLOSE_KNIT_API_URL = original.url;
  }
});
