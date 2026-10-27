import assert from "node:assert/strict";
import test from "node:test";

import { validateStyleMin, type FilterSpecification } from "@maplibre/maplibre-gl-style-spec";

import {
  SALE_CELL_LAYER,
  SALE_PIN_LAYER,
  SALE_TAP_PX,
  buildChips,
  buildFromChips,
  defaultSaleView,
  tenureChips,
  tenureFromChips,
  yearChipOptions,
  yearChips,
  yearsFromChips,
  saleAttribute,
  saleColour,
  saleFilter,
  saleLayers,
  salePinSelection,
  saleTapBox,
  saleStops,
  saleTooltipLines,
} from "../src/lib/map-sale-layers";

test("colour modes read the matching tile attribute", () => {
  assert.equal(saleAttribute({ colourBy: "price", years: 5 }), "price");
  assert.equal(saleAttribute({ colourBy: "growth", years: 10 }), "g10");
});

test("scales stretch the price ramp but keep it ascending", () => {
  for (const scale of ["cheaper", "default", "expensive"] as const) {
    const stops = saleStops({ colourBy: "price", years: 5, scale });
    assert.equal(stops.length, 6);
    assert.deepEqual(stops.map((stop) => stop.value), [...stops.map((stop) => stop.value)].sort((a, b) => a - b));
  }
  const cheaper = saleStops({ colourBy: "price", years: 5, scale: "cheaper" });
  const expensive = saleStops({ colourBy: "price", years: 5, scale: "expensive" });
  assert.ok(cheaper.at(-1)!.value < expensive.at(-1)!.value);
});

test("missing values paint grey instead of the cheapest colour", () => {
  const expression = saleColour({ colourBy: "price", years: 5, scale: "default" });
  assert.deepEqual(expression.slice(0, 3), ["case", ["==", ["get", "price"], null], "#b8b8b8"]);
});

test("filters combine years, types, new build, tenure and price", () => {
  const view = defaultSaleView(2026);
  const all = saleFilter(view.filters) as unknown[];
  assert.equal(all[0], "all");
  assert.equal(all.length, 4); // years from/to + types; nothing else by default
  assert.deepEqual(view.filters.types, ["D", "S", "T", "F"]);
  const narrow = saleFilter({
    ...view.filters, fromYear: 2020, types: ["F"], newBuild: "new", tenure: "L", minPrice: 300_000, maxPrice: 600_000,
  }) as unknown[];
  assert.deepEqual(narrow.slice(1), [
    [">=", ["get", "year"], 2020],
    ["<=", ["get", "year"], 2026],
    ["in", ["get", "type"], ["literal", ["F"]]],
    ["==", ["get", "new_build"], 1],
    ["==", ["get", "tenure"], "L"],
    [">=", ["get", "price"], 300_000],
    ["<=", ["get", "price"], 600_000],
  ]);
});

test("Show's chips (v4 Task 19): tenure and new build are two chips each over one filter value", () => {
  assert.deepEqual(tenureChips("any"), ["F", "L"]);
  assert.deepEqual(tenureChips("L"), ["L"]);
  assert.deepEqual(tenureChips("none"), []);
  assert.equal(tenureFromChips(["F", "L"]), "any");
  assert.equal(tenureFromChips(["F"]), "F");
  assert.equal(tenureFromChips([]), "none");
  assert.deepEqual(buildChips("any"), ["new", "existing"]);
  assert.equal(buildFromChips(["existing"]), "existing");
  assert.equal(buildFromChips([]), "none");
  // Both chips off: no pin passes, whatever else is chosen.
  const none = saleFilter({ ...defaultSaleView(2026).filters, tenure: "none" }) as unknown[];
  assert.deepEqual(none.at(-1), ["boolean", false]);
  // MapLibre takes it: ["==", 1, 0] read as the deprecated filter syntax inside an expression "all" and was refused.
  const style = {
    version: 8 as const,
    sources: { sales: { type: "vector" as const, tiles: ["http://x/{z}/{x}/{y}.pbf"] } },
    layers: [{ id: "pins", type: "symbol" as const, source: "sales", "source-layer": "sales", filter: none as FilterSpecification }],
  };
  assert.deepEqual(validateStyleMin(style), []);
});

test("Show's year chips: Earlier and the last five years, all on by default", () => {
  assert.deepEqual(yearChipOptions(2026).map((option) => option.label), ["Earlier", "2022", "2023", "2024", "2025", "2026"]);
  assert.deepEqual(yearChips(null, 2026), ["earlier", "2022", "2023", "2024", "2025", "2026"]);
  assert.equal(yearsFromChips(["earlier", "2022", "2023", "2024", "2025", "2026"], 2026), null);
  assert.deepEqual(yearsFromChips(["2025", "2026"], 2026), [2025, 2026]);
  const earlier = yearsFromChips(["earlier"], 2026)!;
  assert.equal(earlier[0], 1995);
  assert.equal(earlier.at(-1), 2021);
  assert.deepEqual(yearChips([...earlier, 2026], 2026), ["earlier", "2026"]);
  assert.deepEqual(yearsFromChips([], 2026), []);
  const filter = saleFilter({ ...defaultSaleView(2026).filters, years: [2025, 2026] }) as unknown[];
  assert.deepEqual(filter[4], ["in", ["get", "year"], ["literal", [2025, 2026]]]);
});

test("cells and pins split at zoom 15 and only pins are filtered", () => {
  const [cells, pins] = saleLayers(defaultSaleView(2026));
  assert.equal(cells.id, SALE_CELL_LAYER);
  assert.equal(cells.maxzoom, 15);
  assert.equal((cells as { filter?: unknown }).filter, undefined);
  assert.equal(pins.id, SALE_PIN_LAYER);
  assert.equal(pins.minzoom, 15);
  assert.ok((pins as { filter?: unknown }).filter);
});

test("a pin tooltip shows the sale, the one before and its caveats", () => {
  const lines = saleTooltipLines(SALE_PIN_LAYER, {
    price: 612_500, date: "2025-03-14", type: "T", tenure: "F", new_build: 0, ppm: 7_210,
    previous_price: 410_000, previous_date: "2015-06-01", growth: 4.1, value: 640_000,
    g5: 12.300000190734863, category: "B", precision: "postcode",
  }, { years: 5 });
  assert.equal(lines[0], "£612,500 · Mar 2025");
  assert.equal(lines[1], "Terraced · freehold");
  assert.ok(lines.includes("Before: £410,000 · Jun 2015 (+4.1%/yr)"));
  assert.ok(!lines.some((line) => /640|restated|today/i.test(line)), "an old tile's value is never shown");
  assert.ok(!lines.some((line) => /7,210|£[\d,]+\/m²/.test(line)), "an old tile's per-sale £/m² is never shown");
  assert.ok(lines.includes("Area £/m² +12.3% over 5y"));
  assert.ok(lines.some((line) => line.startsWith("Non-standard sale")));
  assert.ok(lines.includes("Placed at its postcode centre"));
});

test("a cell tooltip summarises and invites zooming in", () => {
  const lines = saleTooltipLines(SALE_CELL_LAYER, { n: 12, price: 450_000, ppm: 6_000 }, { years: 5 });
  assert.equal(lines[0], "12 homes sold in the last five years");
  assert.equal(lines.at(-1), "Zoom in for individual sales");
});

test("a pin selects its address, UPRN and area", () => {
  assert.deepEqual(
    salePinSelection({ id: "uk:addr:abc123", uprn: "100023336956", area: "uk:lsoa:E01000001" }),
    { addressId: "uk:addr:abc123", uprn: "100023336956", area: "uk:lsoa:E01000001" },
  );
  assert.deepEqual(salePinSelection({ id: "uk:addr:abc123" }), { addressId: "uk:addr:abc123", uprn: null, area: null });
  assert.equal(salePinSelection({ id: "not-an-address" }), null);
});

test("a sale pin takes a 44 px tap while it is drawn at its own size", () => {
  assert.ok(SALE_TAP_PX >= 44);
  assert.deepEqual(saleTapBox({ x: 100, y: 50 }), [[78, 28], [122, 72]]);
  // The drawn square is unchanged: 0.8 at z15 to 1.6 at z18 of the 10 px square, under the tap box at every zoom.
  const pin = saleLayers(defaultSaleView(2026)).find((layer) => layer.id === SALE_PIN_LAYER);
  assert.deepEqual((pin as { layout: Record<string, unknown> }).layout["icon-size"], ["interpolate", ["linear"], ["zoom"], 15, 0.8, 18, 1.6]);
  assert.ok(10 * 1.6 < SALE_TAP_PX);
});
