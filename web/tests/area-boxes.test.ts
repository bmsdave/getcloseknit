import assert from "node:assert/strict";
import test from "node:test";

import { areaBox, clearBoxCache, knownAreaBox, paintBoxes } from "../src/lib/area-boxes";
import type { ValuePackEntry } from "../src/lib/contracts";
import { londonPiece, type ViewPiece } from "../src/lib/map-coverage";

const AREAS: Record<string, [string, number, number, number, number][]> = {
  E12000007: [["uk:lsoa:E01000001", -0.2, 51.5, -0.19, 51.51], ["uk:lsoa:E01000002", -0.1, 51.4, -0.09, 51.41]],
  E07000207: [["uk:lsoa:E01030000", -0.4, 51.3, -0.39, 51.31]],
};

function stubFetch(): string[] {
  const calls: string[] = [];
  (globalThis as Record<string, unknown>).fetch = async (url: unknown) => {
    calls.push(String(url));
    const chunk = new URL(String(url), "https://example.test").searchParams.get("chunk") ?? "";
    return Response.json({ schemaVersion: "area-boxes.v1", carrier: "lsoa", areas: AREAS[chunk] ?? [] });
  };
  return calls;
}

const value = (id: string) => ({ geographyId: id, carrier: "lsoa" }) as ValuePackEntry;
const surrey: ViewPiece = { chunk: "E07000207", carrier: "lsoa", rolledUp: false };

test("a paint's boxes come in its pack's order, each with its piece's region; one request per piece and release", async () => {
  clearBoxCache();
  const calls = stubFetch();
  const regionOf = (chunk: string | null) => (chunk === "E07000207" ? "E12000008" : chunk);
  const values = [value("uk:lsoa:E01030000"), value("uk:lsoa:E01000002"), value("uk:lsoa:E01000001")];
  const boxes = await paintBoxes(values, [londonPiece("lsoa"), surrey], "real", "live", "rel-1", regionOf);
  assert.deepEqual(boxes.map((box) => [box.id, box.region]),
    [["uk:lsoa:E01030000", "E12000008"], ["uk:lsoa:E01000002", "E12000007"], ["uk:lsoa:E01000001", "E12000007"]]);
  assert.deepEqual(boxes[1].bbox, [-0.1, 51.4, -0.09, 51.41]);
  await paintBoxes(values.slice(1), [londonPiece("lsoa")], "real", "live", "rel-1", regionOf);
  assert.deepEqual(calls, [
    "/api/v1/areas/boxes?carrier=lsoa&chunk=E12000007&v=rel-1&release=live",
    "/api/v1/areas/boxes?carrier=lsoa&chunk=E07000207&v=rel-1&release=live",
  ]);
  await paintBoxes(values.slice(1), [londonPiece("lsoa")], "real", "next", "rel-2");
  assert.equal(calls.length, 3, "a new release is a new URL");
  assert.deepEqual(knownAreaBox("uk:lsoa:E01000001"), [-0.2, 51.5, -0.19, 51.51]);
  clearBoxCache();
});

test("an area outside the pieces fails the paint, unless the pack carries more than them (a ready-made criterion)", async () => {
  clearBoxCache();
  stubFetch();
  const values = [value("uk:lsoa:E01000001"), value("uk:lsoa:E01030000")];
  await assert.rejects(paintBoxes(values, [londonPiece("lsoa")], "real", "live"), /area box missing for uk:lsoa:E01030000/);
  const partial = await paintBoxes(values, [londonPiece("lsoa")], "real", "live", null, () => null, true);
  assert.deepEqual(partial.map((box) => box.id), ["uk:lsoa:E01000001"]);
  clearBoxCache();
});

test("demo data's boxes are its fixtures', with no request; one area's box for a wider area's fit", async () => {
  clearBoxCache();
  const calls = stubFetch();
  const boxes = await paintBoxes([value("uk:lsoa:E01000001")], null, "demo");
  assert.equal(boxes.length, 1);
  const [west, south, east, north] = boxes[0].bbox;
  assert.ok(west < east && south < north && west > -1 && east < 1, boxes[0].bbox.join());
  assert.ok(await areaBox("uk:lad:E09000001", "demo"));
  assert.deepEqual(calls, []);
  assert.deepEqual(await areaBox("uk:lsoa:E01030000", "real", "live", [surrey]), [-0.4, 51.3, -0.39, 51.31]);
  clearBoxCache();
});
