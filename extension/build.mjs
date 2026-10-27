// Builds the extension into dist/ (load it unpacked, or zip it for the stores).
//   node build.mjs          → talks to https://getcloseknit.com
//   node build.mjs --dev    → talks to the local site (CLOSE_KNIT_EXTENSION_SITE, default http://127.0.0.1:4190)
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes("--dev");
const site = (dev ? process.env.CLOSE_KNIT_EXTENSION_SITE || "http://127.0.0.1:4190" : "https://getcloseknit.com").replace(/\/+$/, "");
const out = join(here, "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "popup"), { recursive: true });

await build({
  entryPoints: {
    background: join(here, "src/background.ts"),
    portal: join(here, "src/content/portal.ts"),
    results: join(here, "src/content/results.ts"),
    closeknit: join(here, "src/content/closeknit.ts"),
    "popup/popup": join(here, "src/popup/popup.ts"),
    "options/options": join(here, "src/options/options.ts"),
    "sidepanel/sidepanel": join(here, "src/sidepanel/sidepanel.ts"),
  },
  outdir: out,
  bundle: true,
  format: "iife",
  target: ["chrome120", "safari17", "firefox128"],
  define: { API_BASE: JSON.stringify(site) },
  minify: !dev,
  sourcemap: dev ? "inline" : false,
  legalComments: "none",
});

const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8").replaceAll("__SITE__", site));
if (dev) manifest.name += " (dev)";
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));

for (const file of ["popup/popup.html", "popup/popup.css", "options/options.html", "options/options.css", "sidepanel/sidepanel.html"]) {
  cpSync(join(here, "src", file), join(out, file));
}
cpSync(join(here, "icons"), join(out, "icons"), { recursive: true });
mkdirSync(join(out, "fonts"), { recursive: true });
for (const file of ["BricolageGrotesque-latin.woff2", "OFL.txt"]) {
  cpSync(join(here, "../web/src/app/fonts", file), join(out, "fonts", file));
}
console.log(`built ${out} for ${site}`);
