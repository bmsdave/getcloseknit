# Area clarity — task list (2026-10-05)

Goal: a buyer understands an area at a glance; method text moves behind (?)
help and short /guide articles; the map shows where prices rise and fall.
One task at a time, each with its own tests and commit.

Agreed decisions:
- (?) opens a small popover: 1–3 plain sentences ("explain like I'm 5") + "Learn more" to a guide article.
- Articles are pages: /guide index + /guide/<topic>, replacing /methodology.
- Overview = typical home cost (size chips 1-bed 50 m², 2-bed 70 m², 3-bed 95 m²; 2-bed default; rough guide, not a valuation) + price trend + "Compared with London" scorecard.
- Article visuals: coded SVG diagrams in theme colours (assumed; not yet confirmed).

## Done
- [x] Invite link: no login dialog over the invite page (favicon 401).
- [x] Slate is the default interface theme.
- [x] Schools has its own evidence tab (was under Environment).
- [x] 14 browser-default buttons styled; e2e/unstyled-controls.spec.ts guards it.

## Wave 0 (shared contracts) — done
- [x] lib/price-change.ts, lib/guide-slugs.ts, lib/help-texts.ts, components/help-tip.tsx (+ styles/help.css)
- [x] AreaProfileResponse (contracts.ts), BFF /api/v1/areas/[id]/profile, lib/area-profile.ts hook

## Wave 1 (parallel tracks, one worktree each)
- [x] A. API /api/v1/areas/{id}/profile (api/**)
- [x] B. Overview: home cost chips, trend, "Compared with London" scorecard
- [x] C. /guide index + articles with SVG diagrams; /methodology redirects
- [x] D. Map "Change" scale with ▲/▼ arrows
- [x] E. Method/caveat paragraphs behind (?) in the other panels

## Wave 3 (area360 coverage, see area360-coverage.md)
- [x] F People (Census) · G market by type · H transport/parks/amenities · J civic · K property page · L area pages + rankings · M money tools — merged and mounted
- [x] I flood risk — merged, Environment tab in Real mode
- [x] N guide articles for the new topics · O property fixes (stock value bug, EPC docs, /methodology in real metric definitions)

## Wave 2
- [x] Merge all tracks, full suites (e2e 542 passed / 20 skipped / 0 failed), visual check on real data, rendering snapshots
- [ ] Deploy (needs a yes)

## Integration checklist (Wave 2, after all tracks merge)
- [x] Mount sections: People, Transport, market (Housing), civic (Overview), property links; preview page removed.
- [x] Links to /tools: header, Overview home cost, Property tab.
- [x] Guide topics requested by tracks (track N).
- [x] New tables reach production: they ride in the next db-snapshot.sh dump (schema + data) restored by db-restore.sh; migrations 015–020 are mounted for fresh databases. Flood (018) mounted.
- [x] Real-mode metric definitions point at /guide (track O, migration 021).
- [x] Re-capture rendering.spec.ts snapshots; full e2e run.
- [x] Snapshot ~/data/aework/release/close-knit-2026-10-05.dump (1.66 GB, sha256 969a5879…) with every new table.
- [ ] Follow-up: map centres on an area opened from a link (task chip).
- [ ] Follow-up: flood and connectivity badges in the Overview scorecard (area360 rows 4).
