/**
 * Writes public/icon.svg (favicon, PWA icon) from the same knitted house as
 * <KnitLogo> (DESIGN.md › Logo), with fixed Day colours so it renders anywhere.
 *   npx tsx scripts/knit-icon.tsx
 */
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { KnitFabric } from "../src/components/knit";
import { pixels } from "../src/lib/knit";

const HOUSE = [
  "...............",
  ".......R.......",
  "......RRR......",
  ".....RRRRR.....",
  "....RRRRRRR....",
  "...RRRRRRRRR...",
  "..RRRRRRRRRRR..",
  "...SSSSSSSSS...",
  "...SWSSSSSWS...",
  "...SSSSSSSSS...",
  "...PPPPDPPPP...",
  "...PWPPDPPWP...",
  "...PPPPDPPPP...",
  "GGGGGGGGGGGGGGG",
];
const grid = pixels(HOUSE, { ".": "#eef3f8", R: "#e2453c", S: "#f6c445", P: "#4aa3df", W: "#ffffff", D: "#22252c", G: "#2f5bd3" });
const fabric = renderToStaticMarkup(<KnitFabric grid={grid} stitchW={12} stitchH={9.5} seed={6} />)
  .replace("<svg ", '<svg x="4" y="4" width="120" height="120" ');
const icon = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 128 128">` +
  `<clipPath id="tile"><rect width="128" height="128" rx="28"/></clipPath>` +
  `<g clip-path="url(#tile)"><rect width="128" height="128" fill="#eef3f8"/>${fabric}</g></svg>\n`;
writeFileSync(new URL("../public/icon.svg", import.meta.url), icon);
console.log(`icon.svg ${icon.length} bytes`);
