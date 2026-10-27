import type { Metadata } from "next";
import { preconnect, preload } from "react-dom";

import { ExplorerPage } from "@/components/explorer-page";
import { InlineScript } from "@/components/inline-script";
import { serverCoverage, serverCoversEngland, serverDefaults } from "@/lib/deployment";
import { INTRO_BOOT_SCRIPT } from "@/lib/intro-boot";
import { BASE_STYLE } from "@/lib/map-core";
import { mapPreloads } from "@/lib/map-preload";
import { PANEL_WIDTH_BOOT } from "@/lib/panel-width";
import { applyEnvDefaults, DEV_QUERY_PARAM, parseMapState, shouldFitSelectedArea } from "@/lib/map-state";
import { pageMetadata, siteDescription, siteOrigin, siteTitle, websiteJsonLd } from "@/lib/seo";

interface HomePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// One canonical "/" and the generic site card: a shared match (#profile, #shortlist) lives in the
// hash, which link previews never see, so a preview never carries anyone's search.
export async function generateMetadata(): Promise<Metadata> {
  const england = await serverCoversEngland();
  return pageMetadata({ title: siteTitle(england), description: siteDescription(england), path: "/" });
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const values = await searchParams;
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string") parameters.set(key, value);
  }
  // The link as given, before the deployment's defaults: its params win over the saved setup,
  // also on an in-app jump (a guide's "See this on the map"), while the address still shows the page before.
  const link = parameters.toString();
  // Real deployments open on the release the API is serving right now, so
  // the mode/release label never drifts from the evidence behind it.
  const defaults = await serverDefaults();
  applyEnvDefaults(parameters, { mode: defaults.mode, release: defaults.release });
  const initialState = parseMapState(parameters);
  // The first view's requests start with the HTML, not after the scripts (lib/map-preload.ts, perf/layer-load).
  const preloads = mapPreloads(initialState, {
    linkedPeriod: typeof values.period === "string", layers: defaults.served?.layers ?? null, coverage: await serverCoverage(),
  });
  for (const href of preloads) {
    preload(href, { as: "fetch", crossOrigin: "anonymous" });
  }
  // The basemap's style, and its host (tiles, sprites, glyphs) connected while the scripts load.
  if (/^https?:\/\//.test(BASE_STYLE)) preconnect(new URL(BASE_STYLE).origin, { crossOrigin: "anonymous" });
  preload(BASE_STYLE, { as: "fetch", crossOrigin: "anonymous" });
  // ?dev=1 shows the data mode switch and release ids; nobody else needs them.
  const dev = parameters.get(DEV_QUERY_PARAM) === "1";
  const origin = await siteOrigin();
  const england = await serverCoversEngland();
  return (
    <>
      {origin && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: websiteJsonLd(origin, england) }} />}
      {/* Before the explorer's markup: hides the server-rendered intro card before it paints when it is not wanted. */}
      <InlineScript html={INTRO_BOOT_SCRIPT} />
      {/* And the side panel at the width this browser left it (lib/panel-width.ts), so it never jumps. */}
      <InlineScript html={PANEL_WIDTH_BOOT} />
      <ExplorerPage initialState={initialState} link={link} fitSelected={shouldFitSelectedArea(parameters)} dev={dev} />
    </>
  );
}
