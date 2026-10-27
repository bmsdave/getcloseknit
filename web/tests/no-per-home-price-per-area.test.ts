/**
 * Guard: while the EPC licence is pending, no single home's price per m² is
 * published or shown. Property tiles carry no `sppm`, sale pins no per-sale
 * £/m², and no recorded sale is listed with a £/m². Area-level £/m² (an LSOA,
 * a street block or a cell of three or more homes) stays.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PostcodeSalesChart } from "../src/components/postcode-sales-chart";
import { HomePage } from "../src/components/home-page";
import { PostcodeHomesView } from "../src/components/property-profile";
import { SalesPanel } from "../src/components/sales-panel";
import { tooltipLines } from "../src/lib/map-property-layers";
import { SALE_PIN_LAYER, defaultSaleView, saleTooltipLines } from "../src/lib/map-sale-layers";
import { demoPostcodeHomes, demoPropertyProfile } from "../src/lib/property-profile-fixture";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
/** A figure per square metre: "£4,630/m²", "£10,556 per m²". */
const FIGURE_PER_AREA = /£[\d,.]+k?\s*(\/|per )\s*m²/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx|js|json)$/.test(name) ? [path] : [];
  });
}

test("no web source reads a home's sold £/m² from a tile or a sale", () => {
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /\bsppm\b/, `${file} reads the property tile's per-home sppm`);
    // A recorded sale's £/m² may be read only in a file that checks `isWithheld(…, "pricePerSqm")` (a flag, not a cut).
    if (/\b(sale|transaction|lastSale|txn)\??\.pricePerSquareMetre\b/.test(text)) {
      assert.match(text, /isWithheld\([^)]*"pricePerSqm"\)/, `${file} reads a recorded sale's £/m² without checking it is not withheld`);
    }
  }
});

test("map tooltips never state a home's or a sale's £/m²", () => {
  for (const layer of ["parcel-fill", "dwelling-point"]) {
    const lines = tooltipLines(layer, { sppm: 4633, latest_sale: "2019-05-01", dwellings: 1, band: 4 }, "/m²");
    assert.deepEqual(lines, ["Dwelling", "Sold 2019", "Top quarter of similar homes sold here that year"]);
  }
  const pin = saleTooltipLines(SALE_PIN_LAYER, { price: 612_500, date: "2025-03-14", type: "T", ppm: 7_210 }, { years: 5 });
  assert.ok(!pin.some((line) => FIGURE_PER_AREA.test(line)), pin.join(" | "));
});

test("the sales panel offers no £/m² or value-today colouring", () => {
  const html = renderToStaticMarkup(createElement(SalesPanel, {
    view: { ...defaultSaleView(2026), on: true }, latestYear: 2026, zoom: 15, onChange: () => {},
  }));
  assert.match(html, /Sold price/);
  // Only the area index is per m² ("growth is the change of its area's £/m² index"); no option colours pins by it.
  assert.doesNotMatch(html, />£\/m²<|Value today/);
});

test("recorded sales are listed and charted without a £/m²", () => {
  const { profile } = demoPropertyProfile("100000000001")!;
  const homes = demoPostcodeHomes(profile.postcode ?? "")!;
  assert.ok(profile.sales.some((sale) => sale.floorAreaSquareMetres !== null), "the fixture has a sale with a floor area");
  for (const html of [
    renderToStaticMarkup(createElement(HomePage, { home: { kind: "uprn", profile }, mode: "demo", release: "test" })),
    renderToStaticMarkup(createElement(PostcodeHomesView, { ...homes, mode: "demo" })),
    renderToStaticMarkup(createElement(PostcodeSalesChart, {
      postcode: "N1 0AA", lines: [],
      sales: [{ addressId: "uk:addr:1", date: "2022-11-03", time: 2022.8, price: 570_000, kind: "flat" }],
    })),
  ]) {
    assert.doesNotMatch(html, FIGURE_PER_AREA);
    assert.doesNotMatch(html, /£ per m²|Price per m²/);
  }
});
