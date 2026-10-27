import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import type { NextConfig } from "next";

const basemapStyle = process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/positron";

/** Origin of the basemap (style, sprites, glyphs and tiles), if it is remote. */
function basemapOrigin(): string {
  try {
    return new URL(basemapStyle).origin;
  } catch {
    return ""; // relative fixture style: same origin
  }
}

// Production only: the dev server needs eval for fast refresh. MapLibre needs
// blob: workers and inline styles; Next's bootstrap scripts are inline.
function contentSecurityPolicy(): string {
  const tiles = basemapOrigin();
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    // Postcode-page photos are Wikimedia Commons thumbnails (Geograph images are only linked).
    `img-src 'self' data: blob: https://thumb.wikimedia.org https://upload.wikimedia.org ${tiles}`.trim(),
    "font-src 'self' data:",
    `connect-src 'self' ${tiles} https://api.postcodes.io`.replace(/\s+/g, " "),
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// Names this build's service-worker cache (components/pwa-registration.tsx,
// public/sw.js): a deploy gets a fresh cache and the old one is dropped.
// Pinned in the environment so build workers that reload this file agree.
const buildId = process.env.CLOSE_KNIT_BUILD_ID ||= new Date().toISOString().replace(/\D/g, "").slice(0, 14);
// MapLibre's worker lives under its version (scripts/copy-maplibre-worker.mjs, lib/map-core.ts): served immutable.
const maplibreVersion: string = JSON.parse(readFileSync(createRequire(import.meta.url).resolve("maplibre-gl/package.json"), "utf8")).version;
// The area tiles' protocol for MapLibre's workers sits beside it, named by the pmtiles version (same script).
const pmtilesVersion: string = JSON.parse(readFileSync(createRequire(import.meta.url).resolve("pmtiles/package.json"), "utf8")).version;

const config: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: buildId, NEXT_PUBLIC_MAPLIBRE_VERSION: maplibreVersion, NEXT_PUBLIC_PMTILES_VERSION: pmtilesVersion },
  poweredByHeader: false,
  // Self-contained server bundle for the container image (web/Dockerfile).
  output: "standalone",
  // The code is open source: shipping .map files costs nothing at runtime (browsers fetch them only
  // with devtools open) and lets profiles and error stacks from production be read.
  productionBrowserSourceMaps: true,
  // /methodology became the /guide articles. The fragment survives the
  // redirect; /guide sends old anchors (#crime, #real-data…) to an article.
  // v3 Fix 17: pages folded into others keep their old links (308). /explore* are
  // route handlers (app/explore), since they map each lens to its map layer.
  async redirects() {
    return [
      { source: "/methodology", destination: "/guide", permanent: true },
      { source: "/claude", destination: "/agents", permanent: true },
      { source: "/glossary", destination: "/guide/glossary", permanent: true },
      { source: "/teams", destination: "/about#teams", permanent: true },
      // Boroughs side by side are one sortable table, opened sorted by the old ranking's figure.
      { source: "/rankings/borough-price", destination: "/area/london?sort=price", permanent: true },
      { source: "/rankings/borough-crime", destination: "/area/london?sort=crime", permanent: true },
      { source: "/rankings/borough-places-for-families", destination: "/area/london?sort=families", permanent: true },
      { source: "/rankings/borough-nightlife", destination: "/area/london?sort=going-out", permanent: true },
      { source: "/rankings/borough-income", destination: "/area/london?sort=income", permanent: true },
    ];
  },
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    return [{
      // Pages render per request, so Next marks them no-store, which keeps them out of the browser's
      // back/forward cache. They hold nothing personal (a search lives in the URL hash and storage):
      // "private, no-cache" still revalidates every load and keeps shared caches out. API routes set
      // their own (personal answers stay no-store); Next sets the static assets'. Only pages: link-preview
      // cards (opengraph-image, publicly cacheable: lib/og-card.tsx) and any path with an extension
      // (robots.txt, sitemap.xml, manifest.webmanifest, icon.svg, sw.js, public/ files) keep their own.
      source: "/((?!api/|_next/|.*opengraph-image|.*\\.\\w+$).*)",
      headers: [{ key: "Cache-Control", value: "private, no-cache" }],
    }, {
      // MapLibre's worker, one folder per version (scripts/copy-maplibre-worker.mjs): never revalidated, so a
      // returning visitor's map starts without two round trips for it (perf/layer-load, phase C).
      source: "/maplibre/:version/:file",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    }, {
      // The area tiles' archives, named by a hash of their bytes (deploy/tools/area_pmtiles.py): in production Caddy
      // serves them with this header; a local build serves them from public/tiles the same way.
      source: "/tiles/:file",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    }, {
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy() },
        { key: "X-Frame-Options", value: "DENY" },
        // Origin isolation: no cross-origin window keeps a handle on ours (links out already use noopener).
        // The MCP widgets are served by the API (/mcp), not here, so their embedding is unaffected.
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(), usb=()" },
      ],
    }];
  },
};

export default config;
