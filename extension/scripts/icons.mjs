// Renders icons/icon.svg (a copy of web/public/icon.svg) to the PNG sizes the stores need.
// Uses the web app's Playwright (npm ci in web/ first): node scripts/icons.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../../web/package.json"));
const { chromium } = require("playwright");
const svg = readFileSync(join(here, "../icons/icon.svg"), "utf8");
const browser = await chromium.launch();
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
  await page.screenshot({ path: join(here, `../icons/icon-${size}.png`), omitBackground: true });
  await page.close();
}
await browser.close();
