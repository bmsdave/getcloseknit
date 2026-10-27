#!/usr/bin/env node
// Screenshots the map's colours on two running sites (PARITY_BEFORE, PARITY_AFTER: e.g. the GeoJSON shapes and the
// area tiles) for the same views and layers, and reports how many pixels differ per pair (perf/layer-load/README.md,
// "Area tiles"). Transit and labels stay as the site draws them; both sites must serve the same data.
//   PARITY_BEFORE=http://127.0.0.1:4181 PARITY_AFTER=http://127.0.0.1:4180 PARITY_OUT=/tmp/parity node scripts/map-parity.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "@playwright/test";

const before = process.env.PARITY_BEFORE ?? "http://127.0.0.1:4181";
const after = process.env.PARITY_AFTER ?? "http://127.0.0.1:4180";
const out = process.env.PARITY_OUT ?? "test-results/map-parity";
const VIEWS = {
  "london-z11": [51.5074, -0.1278, 11], "london-z9.6": [51.5074, -0.1278, 9.6], "home-counties-z8.5": [51.65, -0.55, 8.5],
  "england-z6": [52.9, -1.5, 6], "england-z7.5": [52.9, -1.5, 7.5], "manchester-z11": [53.4808, -2.2426, 11],
};
const LAYERS = (process.env.PARITY_LAYERS ?? "typical-price,crime,census-accommodation-flat,custom:good-coffee").split(",");
const only = process.env.PARITY_VIEWS?.split(",");

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chromium" });
const report = [];

async function shoot(base, view, layer) {
  const [lat, lng, zoom] = VIEWS[view];
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${base}/?${new URLSearchParams({ layer, lat: String(lat), lng: String(lng), zoom: String(zoom), diagnostics: "1" })}`);
  await page.waitForFunction(() => document.querySelector(".map-stage")?.getAttribute("data-painting") === "false"
    && window.__closeKnitMap?.loaded() && window.__closeKnitMap.areTilesLoaded(), null, { timeout: 90_000 });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.__closeKnitMap?.loaded() && window.__closeKnitMap.areTilesLoaded(), null, { timeout: 30_000 });
  const pixels = await page.evaluate(async () => {
    const map = window.__closeKnitMap;
    await new Promise((resolve) => { map.once("render", resolve); map.triggerRepaint(); });
    const canvas = map.getCanvas();
    const copy = document.createElement("canvas");
    [copy.width, copy.height] = [canvas.width, canvas.height];
    copy.getContext("2d").drawImage(canvas, 0, 0);
    return copy.toDataURL("image/png");
  });
  const rendered = await page.evaluate(() => window.__closeKnitDiagnostics?.renderedAreaCount() ?? null);
  await page.close();
  return { png: Buffer.from(pixels.split(",")[1], "base64"), rendered, dataUrl: pixels };
}

async function differs(a, b) {
  const page = await browser.newPage();
  const result = await page.evaluate(async ([left, right]) => {
    const load = (src) => new Promise((resolve) => { const image = new Image(); image.onload = () => resolve(image); image.src = src; });
    const [x, y] = await Promise.all([load(left), load(right)]);
    const draw = (image) => {
      const canvas = document.createElement("canvas");
      [canvas.width, canvas.height] = [image.width, image.height];
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    };
    const [p, q] = [draw(x), draw(y)];
    let changed = 0;
    for (let index = 0; index < p.length; index += 4) {
      const delta = Math.abs(p[index] - q[index]) + Math.abs(p[index + 1] - q[index + 1]) + Math.abs(p[index + 2] - q[index + 2]);
      if (delta > 30) changed += 1;
    }
    return { changed, total: p.length / 4 };
  }, [a, b]);
  await page.close();
  return result;
}

for (const view of Object.keys(VIEWS)) {
  if (only && !only.includes(view)) continue;
  for (const layer of LAYERS) {
    const name = `${view}-${layer.replace(/[^a-z0-9.-]/gi, "_")}`;
    try {
      const [left, right] = [await shoot(before, view, layer), await shoot(after, view, layer)];
      writeFileSync(join(out, `${name}-before.png`), left.png);
      writeFileSync(join(out, `${name}-after.png`), right.png);
      const diff = await differs(left.dataUrl, right.dataUrl);
      const row = { view, layer, changedPct: Math.round((diff.changed / diff.total) * 1000) / 10, renderedBefore: left.rendered, renderedAfter: right.rendered };
      report.push(row);
      console.log(JSON.stringify(row));
    } catch (error) {
      console.log(JSON.stringify({ view, layer, error: String(error).slice(0, 200) }));
    }
  }
}
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
await browser.close();
