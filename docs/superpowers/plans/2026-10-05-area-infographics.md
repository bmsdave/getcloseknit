# Area panel as infographics: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** turn the area panel from text and tables into a tile dashboard and charts, with the same data.

**Architecture:**
- Task 1 builds a shared SVG chart kit, `web/src/components/charts/`, with its geometry in `web/src/lib/chart-geometry.ts` and its colour tokens in `globals.css`.
- Tasks 2–5 run in parallel, each in its own git worktree off the Task 1 commit. Each owns its own components and CSS file.
- I merge the tracks and run the final checks.

**Tech stack:** Next.js 16 (read `web/AGENTS.md`), React 19, plain SVG. Tests: `node:test` via `tsx --test`, and Playwright.

**Spec:** `docs/superpowers/specs/2026-10-05-area-infographics-design.md`

## Global constraints
- **Colours:** theme tokens only (`--chart-1`…`--chart-6`, `--chart-bad`, `--chart-good`, `--chart-neutral`, `--chart-track`, plus the existing `--ink`, `--muted`, `--chip`). No hex values in components.
- **Accessible charts:** every chart root is `role="img"` with an `aria-label` that carries the numbers. Colour is never the only signal.
- **Text:**
  - No visible paragraph in `.evidence-panel` over 25 words. Allowed exceptions are the empty-area state, errors, and `<details>` content.
  - Labels are at most 4 words.
  - Method, caveats and licences go in a HelpTip or the folded "Sources & method" line.
- **Missing data:** "unknown" text in place of a chart; never an empty chart, never 0.
- **Targets and styling:** 44px targets. No unstyled buttons (`e2e/unstyled-controls.spec.ts`).
- **Data:** no new data sources. The only API change is an additive `bearingDegrees` field on places items (Task 5).
- **Commits:** every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. E2E runs use `--workers=2` and the track's own `PLAYWRIGHT_TEST_PORT`.

## Review focus
1. **Tiny shares** (0.3%) must stay visible in a `StackedBar`/`Waffle` and labelled "under 1%". Covered in Task 1: `stackWidths` and `waffleCells` minimums.
2. **All-null profile** (an area with no metrics): every Overview tile reads "unknown", nothing breaks. Covered in Task 2 e2e.
3. **Night theme and dark mode:** chart tokens keep 3:1 contrast against `--panel`. Covered in Task 1 by extending `tests/colour-contrast.test.ts`.
4. **Long names in `DistanceRings`** (e.g. "Wembley Stadium") must not overflow the panel at 375px. Covered in Task 5 e2e: scrollWidth ≤ clientWidth.
5. **Keyboard:** Overview tiles are buttons that open the tab and move focus to it. Covered in Task 2 e2e.

---

### Task 1: Chart kit (me, before the parallel tracks)

**Files:**
- Create: `web/src/lib/chart-geometry.ts`, `web/src/components/charts/{scale-marker,segment-score,stacked-bar,waffle,ring-score,distance-rings,icon-count,bar-list,band-scale,chart-frame,index}.tsx`, `web/src/styles/charts.css`, `web/src/app/dev/charts/page.tsx` (calls `notFound()` in production)
- Modify: `web/src/app/globals.css` (chart tokens per theme), `web/src/app/layout.tsx` (one import)
- Test: `web/tests/chart-geometry.test.ts`, `web/tests/colour-contrast.test.ts` (tokens), `web/e2e/charts.spec.ts`

**Interfaces (produced):**
```ts
type ChartTone = "c1"|"c2"|"c3"|"c4"|"c5"|"c6"|"bad"|"good"|"neutral";
// chart-geometry.ts
scalePosition(value: number, min: number, max: number): number            // clamped 0..1
stackWidths(values: number[], minVisible?: number /*=1.5*/): number[]      // percent, sums to 100, non-zero ≥ minVisible
waffleCells(share: number): number                                         // 0..100; any share > 0 gives ≥ 1
segmentFill(score: number | null): number                                  // 0..10, rounded
ringPoint(distance: number, bearingDeg: number, maxDistance: number, radius: number): { x: number; y: number }
formatShare(share: number): string                                         // "under 1%" | "12%"
// components (all export from charts/index.tsx)
ScaleMarker({ position, marker?, range?, low, high, label }: { position: number|null; marker?: number|null; range?: [number, number]; low: string; high: string; label: string })
SegmentScore({ score, tone, label }: { score: number|null; tone: "worse-high"|"better-high"|"neutral"; label: string })
StackedBar({ parts, label, compact? }: { parts: { id: string; label: string; value: number; tone: ChartTone }[]; label: string; compact?: boolean })
Waffle({ share, label }: { share: number|null; label: string })
RingScore({ score, max = 10, label, size = 56 }: { score: number|null; max?: number; label: string; size?: number })
DistanceRings({ points, rings = [500, 1000, 1500], label }: { points: { id: string; label: string; distanceMetres: number; bearingDegrees: number; tone: ChartTone }[]; rings?: number[]; label: string })
IconCount({ groups, label }: { groups: { id: string; label: string; count: number; icon: string /*tabler-like name drawn as simple SVG*/ }[]; label: string })
BarList({ rows, label }: { rows: { id: string; label: string; value: number; display: string; marker?: number|null }[]; label: string })
BandScale({ bands, current, potential?, label }: { bands: { id: string; label: string; tone: ChartTone }[]; current: string|null; potential?: string|null; label: string })
ChartFrame({ title, help?, unknown?, table?, sources?, children }: { title: string; help?: HelpId; unknown?: string|null; table?: React.ReactNode; sources?: React.ReactNode; children: React.ReactNode })  // "Show as table" toggle when table is given; sources is a folded <details> "Sources & method"
```
Also produced: `web/e2e/text-density.ts` with `longParagraphs(page): Promise<string[]>`. It returns the visible `.evidence-panel p` with more than 25 words, outside `details` and `[data-allow-prose]`.

- [ ] **Step 1: write the failing tests** in `tests/chart-geometry.test.ts`:
  - `scalePosition(5, 0, 10) === 0.5`, clamped at both ends
  - `stackWidths([86, 11, 2, 1])` sums to 100 and every entry is ≥ 1.5
  - `stackWidths([100, 0])` gives `[100, 0]`
  - `waffleCells(0.003) === 1`, `waffleCells(0.649) === 65`, `waffleCells(0) === 0`
  - `segmentFill(9) === 9`, `segmentFill(null) === 0`
  - `ringPoint(1500, 90, 1500, 100)` is `{x: 100, y: 0}` within 1e-9 (east), and bearing 0 points up (y < 0)
  - `formatShare(0.004) === "under 1%"`
- [ ] **Step 2:** `cd web && npx tsx --test tests/chart-geometry.test.ts` fails with module not found.
- [ ] **Step 3:** implement `chart-geometry.ts`. Add the tokens to `globals.css`, with values for each theme including Night, and a test in `colour-contrast.test.ts` that every `--chart-*` has ≥ 3:1 against `--panel` in every theme. Implement the components with CSS in `styles/charts.css`. `/dev/charts` renders every component with real-looking data and its unknown state.
- [ ] **Step 4:** add `e2e/charts.spec.ts`:
  - `/dev/charts` has ≥ 10 `[role=img]`, each with a non-empty `aria-label`
  - "Show as table" toggles a `<table>`
  - no horizontal scroll at 375px
  - unstyled-controls check on the page

  Then run `npm test`, `npm run typecheck`, and `PLAYWRIGHT_TEST_PORT=4288 npx playwright test e2e/charts.spec.ts --workers=2`. All must pass.
- [ ] **Step 5:** commit "Web: chart kit for the infographic area panel".

### Task 2: Overview tile dashboard (track 1)

**Files:**
- Create: `web/src/components/overview-tiles.tsx`, `web/src/components/overview-badges.tsx`, `web/src/styles/overview-tiles.css`
- Modify:
  - `web/src/components/evidence-panel.tsx`: only `OverviewSection` and the Overview `SectionPanel` block.
  - `web/src/components/overview-home-cost.tsx`: the formula becomes one caption.
  - `web/src/components/overview-scorecard.tsx`: replaced by the tiles; remove it if unused.
  - `web/src/components/civic-section.tsx`: compact card variant `compact` prop.
- Test: `web/tests/overview-tiles.test.ts`, `web/e2e/overview-section.spec.ts` (update), `web/e2e/overview-tiles.spec.ts`

**Interfaces:**
- Consumes: the Task 1 kit; `useAreaProfile` (`lib/area-profile.ts`); `useAreaFlood` (`lib/flood-risk.ts`); the places loader in `lib/places.ts`; `priceChange` (`lib/price-change.ts`).
- Produces: `headlineBadges(profile, change): { id: string; text: string; tone: "good"|"bad"|"neutral" }[]` (max 3) and `OverviewTiles({ profile, flood, places, timeline, onOpen }: {...; onOpen: (section: EvidenceSection) => void })`.

- [ ] **Step 1: failing unit tests:**
  - `headlineBadges` returns at most 3 badges and leaves out unknown topics
  - price percentile 56 gives "About average for London"
  - change +1.5 gives "▲ 1.5% in a year"
  - crime percentile 86 gives the bad-tone badge "Crime higher than most"
- [ ] **Step 2: implement:**
  - The 8 tiles follow spec §2 (price vs London `ScaleMarker`, trend `Sparkline`, crime and income `SegmentScore`, flood `StackedBar compact`, getting around `RingScore` plus the nearest station name, noise `Waffle`, schools `IconCount`).
  - Each tile is a `<button>` that calls `onOpen` and moves focus to the opened tab.
  - The summary paragraph moves into `<details>` "Read as text".
  - Civic uses the compact card: ward and MP names, Band D as a big number, plus a mini `BarList` of bands A–H.
- [ ] **Step 3: e2e:**
  - At 1280×720 all 8 tiles are visible without scrolling.
  - On mobile, the first 4 tiles are visible after scrolling the sheet to the tiles.
  - Each tile opens its tab.
  - An all-null profile (route-mock `/profile` with `metrics: []`, `schools: null`, `noise: null`) shows "unknown" on every tile.
  - `longParagraphs(page)` is `[]` on Overview.
  - Update the existing overview specs to the new structure.
- [ ] **Step 4:** run `npm test`, `npm run typecheck` and the Overview, evidence and unstyled specs with port 4401. Commit.

### Task 3: Housing and Property (track 2)

**Files:**
- Modify:
  - `web/src/components/market-section.tsx`
  - `web/src/components/property-profile.tsx`
  - `web/src/components/evidence-panel.tsx`: only `HousingSection`, `PriceSampleExplanation`, `PropertySection` and `PropertyPanel`
- Create: `web/src/styles/housing-charts.css`
- Test: `web/e2e/market.spec.ts`, `web/e2e/property-profile.spec.ts`, `web/e2e/property-section.spec.ts` (updates)

**Interfaces:** consumes the Task 1 kit and the existing `AreaMarketResponse` and property profile types.

- [ ] **Step 1: Housing:**
  - Market summary as 3 tiles: median price, sales in 12 months, and the middle-50% range as a `ScaleMarker` `range`.
  - By type as a `BarList` of medians with sales counts; keep the box plot.
  - Recent sales: show 5 rows, "Show all" for the rest.
  - Caveats and source go into `ChartFrame.sources`.
- [ ] **Step 2: Property** (the tab and `/property/[uprn]`):
  - Value card with last sale → restated value as two points on a line with % change.
  - EPC current and potential as `BandScale` A–G.
  - Facts as an icon grid.
  - "Estimate, not a valuation" stays visible as one line.
- [ ] **Step 3: e2e:**
  - Housing and Property each show a `[role=img]` without scrolling at 1280×720.
  - `longParagraphs` is `[]`.
  - The table toggle works for market by type.
  - Update the old assertions.
- [ ] **Step 4:** run `npm test`, typecheck and the specs with port 4402. Commit.

### Task 4: People and Schools (track 3)

**Files:**
- Modify: `web/src/components/people-section.tsx`, `web/src/components/area-schools.tsx`
- Create: `web/src/styles/people-schools-charts.css`
- Test: `web/e2e/people-section.spec.ts`, `web/e2e/school-evidence.spec.ts` (updates), `web/tests/people-profile.test.ts` (if helpers move)

- [ ] **Step 1: People:**
  - Residents and density as two big numbers.
  - Each topic as a `StackedBar`: top 5 plus "Other", with a legend.
  - "Show all" opens the existing bars, which become a `BarList` with London markers.
- [ ] **Step 2: Schools:**
  - An `IconCount` header with primary and secondary counts.
  - Cards: name, a rating badge, a distance bar (`ScaleMarker` over 0–1.5 km) and a phase icon.
  - Filters and search stay.
- [ ] **Step 3: e2e:**
  - People and Schools each show a `[role=img]` above the fold at 1280×720.
  - `longParagraphs` is `[]`.
  - "Show all" still works.
  - The existing assertions are updated.
- [ ] **Step 4:** run `npm test`, typecheck and the specs with port 4403. Commit.

### Task 5: Environment, Transport and Planning (track 4)

**Files:**
- Modify:
  - `api/area_api/places.py`: add `bearingDegrees` for stations, parks and amenity nearest items, via `degrees(ST_Azimuth(origin, location))` rounded to an integer.
  - `contracts/openapi.yaml`: description text only.
  - `web/src/lib/places.ts`: an optional `bearingDegrees?: number`.
  - `web/src/components/places-section.tsx`
  - `web/src/components/flood-risk.tsx`
  - `web/src/components/area-noise.tsx`
  - `web/src/components/planning-context.tsx`
- Create: `web/src/styles/environment-transport-charts.css`
- Test: `api/tests` (bearing for a known pair of points; e.g. due east is 90 ± 1), `web/e2e/places-section.spec.ts`, `web/e2e/flood-risk.spec.ts`, `web/e2e/noise-context.spec.ts`, `web/e2e/planning-context.spec.ts` (updates)

- [ ] **Step 1: API:** a failing test for the bearing, then implement it. Missing location gives a missing field. Run `cd api && uv run --extra test --with pytest python -m pytest -q`.
- [ ] **Step 2: Transport:**
  - `RingScore` with the nearest-station card.
  - `DistanceRings` of stations, coloured by mode. When `bearingDegrees` is absent, spread the points and add the caption "distance only".
  - The station table goes behind `ChartFrame.table`.
  - Amenities as `IconCount` plus the nearest named.
- [ ] **Step 3: Environment:**
  - Flood as two `StackedBar`s (rivers and sea; surface water) with legend bands. The address band uses `BandScale`. The EA licence goes into `sources`.
  - Noise as a `Waffle` for homes at 55 dB+, with London's share as a caption, and a `ScaleMarker` for the median road dB (40–80).
- [ ] **Step 4: Planning:** a timeline strip of applications by status; record details still open on click.
- [ ] **Step 5: e2e:**
  - Each of the three tabs shows a `[role=img]` without scrolling at 1280×720.
  - `longParagraphs` is `[]`.
  - At 375px with long station names: no horizontal scroll.
  - Update the existing assertions.
- [ ] **Step 6:** run `npm test`, typecheck and the specs with port 4404. Commit.

### Task 6: Merge and verify (me)
- [ ] Merge tracks 1–4. Resolve append-only conflicts (`layout.tsx`, `help-texts.ts`, `globals.css`) by keeping both sides.
- [ ] Add `e2e/text-density.spec.ts`: for every evidence tab at 1280×720 and on mobile, `longParagraphs` is `[]` and at least one `[role=img]` is in the viewport.
- [ ] Run `npm test`, typecheck, the API tests and the full Playwright suite with `--workers=2`. Re-capture the rendering snapshots.
- [ ] Take real-data screenshots (Brent 026D, desktop and phone, Slate and Night). Send them to the user. Deploy on a yes.
