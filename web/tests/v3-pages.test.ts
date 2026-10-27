import assert from "node:assert/strict";
import test from "node:test";

import config from "../next.config";
import { CUSTOM_PRESETS } from "../src/lib/custom-presets";
import { exploreRedirect } from "../src/lib/explore-redirect";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { areasBriefHref, decodeSharedShortlist } from "../src/lib/saved-shortlists";

// v3 Fix 16: /explore and /explore/<lens> were a copy of the Layers menu: they open the map on the lens.
test("old /explore links open the map coloured by their lens", () => {
  // Layers v5: Kebab shops vs cafés (the first featured lens) merged into Cafés › Coffee vs kebab, Fewer bars into Nightlife.
  const merged: Record<string, string> = { "kebab-cafe": "good-coffee-kebab", "quiet-nights": "nightlife" };
  assert.equal(exploreRedirect(null), "/?layer=custom:good-coffee-kebab");
  for (const preset of CUSTOM_PRESETS) {
    const id = preset.criterion.id;
    if (id === "universities") continue; // Layers v5 PR 3: a Student areas link (below), not a criterion's
    assert.equal(exploreRedirect(preset.slug), `/?layer=custom:${merged[id] ?? id}`, preset.slug);
  }
  assert.equal(exploreRedirect("kebab-shops-vs-cafes"), "/?layer=custom:good-coffee-kebab");
  assert.equal(exploreRedirect("fewer-bars-pubs-and-clubs"), "/?layer=custom:nightlife");
  // Layers v5 PR 3: Universities and colleges became Student areas.
  assert.equal(exploreRedirect("universities-and-colleges"), "/?layer=student-share");
  // Dropped from the menu (PRESET_EXCLUSIONS): the link still paints the lens, its card in the panel.
  for (const slug of ["sandwich-chains-vs-bakery-chains", "bakeries-vs-betting-shops", "coworking-spaces-libraries-and-cafes"]) {
    assert.match(exploreRedirect(slug), /^\/\?layer=custom:[a-z-]+$/, slug);
  }
  // An old id is still an alias of its lens; anything else opens the map.
  assert.equal(exploreRedirect("kebab-cafe"), "/?layer=custom:good-coffee-kebab");
  assert.equal(exploreRedirect("universities"), "/?layer=student-share");
  assert.equal(exploreRedirect("no-such-lens"), "/");
});

// v3 Fix 17: pages folded into others keep their old links as permanent (308) redirects.
test("folded pages redirect permanently to the page that holds them", async () => {
  const redirects = await config.redirects!();
  const to = (source: string) => redirects.find((entry) => entry.source === source);
  for (const [source, destination] of [
    ["/claude", "/agents"], ["/glossary", "/guide/glossary"], ["/teams", "/about#teams"],
    ["/rankings/borough-crime", "/area/london?sort=crime"], ["/rankings/borough-price", "/area/london?sort=price"],
    ["/rankings/borough-nightlife", "/area/london?sort=going-out"], ["/rankings/borough-places-for-families", "/area/london?sort=families"],
    ["/rankings/borough-income", "/area/london?sort=income"],
  ] as const) {
    assert.equal(to(source)?.destination, destination, source);
    assert.equal(to(source)?.permanent, true, source);
  }
  // Deprivation ranks again (owner decision 2026-10-17): its rankings are pages, not redirects.
  for (const slug of ["most-deprived", "least-deprived"]) assert.equal(to(`/rankings/${slug}`), undefined, slug);
  // So do income and social renting (owner decision 2026-10-18).
  for (const slug of ["highest-income", "lowest-income", "most-social-renting", "least-social-renting"]) assert.equal(to(`/rankings/${slug}`), undefined, slug);
});

// v3 Fix 22: Compare › Brief is the one way to a brief from the map.
test("Compare › Brief links the brief for the areas side by side and this browser's search", () => {
  const href = areasBriefHref({
    candidates: ["uk:lsoa:E01000002", "uk:lsoa:E01000003"], candidateNames: { "uk:lsoa:E01000002": "Highbury" },
    profile: DEFAULT_PROFILE, mode: "demo", release: "demo",
  });
  assert.match(href ?? "", /^\/brief#shortlist=v1\./);
  const decoded = decodeSharedShortlist(href!.slice("/brief".length));
  assert.ok(decoded.ok);
  assert.deepEqual(decoded.ok && decoded.share.candidates, ["uk:lsoa:E01000002", "uk:lsoa:E01000003"]);
  assert.equal(areasBriefHref({ candidates: [], candidateNames: {}, profile: DEFAULT_PROFILE, mode: "demo", release: "demo" }), null);
});
