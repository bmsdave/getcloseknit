# Close Knit design system

Close Knit helps a household find the part of London that fits it. The design
says *close knit* literally: a clean, bright, slightly frosty world warmed by
multicolour yarn, like an embroidered picture book, but calm enough to make a
big decision in. **Agents and people changing the UI must follow this file.**

The visual reference is the Close Knit design system artifact (tokens,
components, live previews): https://claude.ai/artifact/ALA85T5SHJoxfQmk5gq6MZ.

## 0. One cloth, three stitches

Every surface is fabric; every crafted thing on it is a real stitch with one job.

| Stitch | Where | Code |
|---|---|---|
| **Satin stitch** | charts, legends, meters, steps, shares, layer swatches | `components/knit/satin.tsx` (`lib/satin.ts`) |
| **Stem stitch** | line charts, table and list dividers | `StemLine`, `StemDivider` |
| **Running stitch** | the primary button and the chosen tag only | CSS `::after` dashed in `--stitch` |
| **Plied yarn** | every icon and former emoji; map routes | `KnitIcon`, `Yarn` |
| **Dot** | places on the map, today on a line chart, the marker on a scale | `Dot`: a plain filled circle, thin `--surface` ring |

Real knitting (stockinette) is kept for the **logo** and hero moments only. It
is not used in data or controls: at interface sizes knit rows read as noise.

## 1. Principles

1. **Fabric first, then stitches.** A silhouette is always a solid, finished
   edge (a fill, a cord, a contour stitch). Stitches never form the outer edge,
   so the map or the page never shows between them. This is what separates
   embroidery from a sticker.
2. **Built from stitches, never a texture.** Everything crafted is drawn stitch
   by stitch; never a raster knit image or a repeating knit background.
3. **The map is real.** The basemap and area zones stay a true, readable map.
   Knitting appears only as objects on top of it (§6).
4. **Clean, not muddy.** Grounds are snow-white (day) or deep navy (night).
   Warmth comes from clear yarn colours. No olive, no pine green, no cream
   with mustard (that was the old site).
5. **Numbers stay words.** Every chart keeps its label and value as text. The
   knitting carries the feeling; the text carries the fact.
6. **One action per screen** gets the primary, stitched button.

## 2. Themes and tokens

Two token sets in `web/src/app/globals.css`, chosen by `web/src/lib/ui-themes.ts`:

- **Day** is on `:root`.
- **Night** applies on `html[data-ui-theme="night"]`. It also applies under
  `prefers-color-scheme: dark` while the reader keeps **System** (`auto`), the
  default.
- Readers pick in the ≡ menu's Theme row, a segmented pill **Auto | Day |
  Night** (on the map and every page). The ids stay `auto`/`day`/`night` in
  storage.
- The two Night blocks must stay identical, and a test enforces this.
- Never hard-code a UI colour. Use a token.

| Token | Day | Night | Use |
|---|---|---|---|
| `--paper` | `#f4f7fa` | `#16203a` | page ground |
| `--panel-solid` / `--surface` | `#ffffff` | `#1b2540` / `#1f2a47` | panels, cards, fields |
| `--chip` | `#eef2f7` | `#26324f` | quiet buttons, chips |
| `--map-control` / `--map-control-rim` | `#ffffff` / none | `#4a5c8f` / white at 62%, 2px | round map controls, lifted off the night map |
| `--ink` / `--muted` | `#22252c` / `#5b6270` | `#f4f7fa` / `#b8c3d6` | text |
| `--primary` / `--on-primary` | `#c0352c` / `#fff` | `#f6c445` / `#16203a` | the one action |
| `--stitch` / `--stitch-quiet` | `#fff` / `#c0352c` | `#16203a` / `#f6c445` | running stitches |
| `--accent` | `#f6c445` | `#f6c445` | highlight, focus halo on chips |
| `--focus` | `#2f5bd3` | `#7fb8f0` | focus outlines |
| `--wool` | `#dfe7f0` | `#3b4a70` | unworked felt: empty part of meters and steps |
| `--seg-on` | `#ffffff` | `#3b4a70` | the chosen thumb of a segmented pill on a `--chip` track (≡ menu: Map, Theme) |
| `--cuff` | `#c0352c` | `#2f5bd3` | rib and cuff bands |
| `--chart-1…6`, `--chart-good/bad/neutral` | see file | see file | chart marks, 3:1 on panel |
| `--pro` / `--con` | `#1f7a55` / `#a8620d` | `#5cc79a` / `#f2a35a` | area tags and tile dots: London's best / worst 10% (text stays `--ink` on their tint) |
| `--match-least` / `--on-match-least` / `--match-best` | `#b2182b` / `#fff` / `#2166ac` | same | My match only (per user): Bottom 10 pins, the popup's bottom-10% badge; the RdBu ends |

**Yarn box** (`--yarn-*`). These are fills for knitted things and markers,
never text:

| Yarn | Hex |
|---|---|
| cherry | `#e2453c` |
| sun | `#f6c445` |
| tangerine | `#f28b30` |
| sky | `#4aa3df` |
| cobalt | `#2f5bd3` |
| pink | `#f08bb0` |
| leaf | `#2f8f73` |

Cherry is *the thread*. White text never goes on `#e2453c` (4.1:1). Use
`--primary` (`#c0352c`, 5.5:1).

`web/tests/colour-contrast.test.ts` checks every theme:
- text at 4.5:1
- the primary label at 4.5:1
- stitches at 3:1
- chart marks at 3:1
- field lines at 3:1

**Map marker colours** (hex in the map code, the same in Day and Night; v4
Tasks 1c, 4, 20; checked against each other in CIELAB and under deuteranopia
and protanopia on boards V4-01c and V4-20, `web/tests/icon-atlas.test.ts`):

| Use | Colours |
|---|---|
| Ofsted cap top | Outstanding `#009e73`, Good `#0072b2`, Requires improvement `#b8860b`, Inadequate `#c0352c`, report card `#5b6270`, not inspected sun |
| Award plaques | Silver `#d5dbe3`, Gold `#c98a00`, Diamond `#5fb0e6`, Red Diamond `#e2453c`, Ruby `#9a1b4b` |
| School measure (Show › Schools › Results, colour by) | cap top light to dark `#c6dbef` `#6baed6` `#2171b5` `#08306b` (one-hue blues, no red–green); no value: a white top and the cap at 45% |
| Collisions | fatal cherry, serious tangerine, slight sun; heat ramp `#f2a33a` → `#f28b30` → `#e2453c` → `#9b1c1c` |
| Places (muted) | coffee `#9d744d`, food `#c57d82`, pubs `#946897`, shops `#235b6e`, sport & culture `#7292c1`, other `#62514d` |
| Recent sales | `#fbd1ef` `#d7b0cc` `#b391aa` `#917389` `#715669` `#574050` |
| Cycle lanes | sky `#4aa3df` dashes on cream `#fffaf3` |
| Show row swatches | places `--marker-place` (coffee), sales `--marker-sale` (`#917389`), My places `--ink`, cycle lanes sky, collisions `--danger` |

**Shape and spacing.** These tokens sit on `:root` and are the same in both themes.

- Radius: `--radius-sm` 6px (small chips, code), `--radius-md` 10px (fields,
  cards), `--radius-lg` 14px (panels, the tray) and `--radius-pill` 999px
  (pills, quiet buttons).
- Spacing: `--space-1` to `--space-8`, a 4px scale from 4px to 32px. Use it for
  gaps and single-value padding and margin.
- A value off the scale is a deliberate exception and stays literal. Phase one
  converted only exact matches, so nothing moved.

## 3. Type

One family: **Bricolage Grotesque** (OFL). It is self-hosted at
`web/src/app/fonts/` and exposed as `--font-sans` and `--font-display`.

- Headings: 700–800 weight, letter-spacing −0.02 to −0.04em.
- Wordmark: lowercase **close knit** at 800.
- Inputs: 16px.
- No Georgia, no serif, no second family.

**Type scale.** Sizes come from the `--fs-*` tokens on `:root` in
`globals.css`. They are in rem, so a reader's larger browser text size counts.

| Token | Size | Use |
|---|---|---|
| `--fs-2xs` | .75rem (12px) | the floor: eyebrows, captions, chart keys |
| `--fs-xs` | .8125rem (13px) | secondary lines, notes |
| `--fs-sm` | .875rem (14px) | compact body, chips |
| `--fs-md` | 1rem (16px) | body, inputs, small headings |
| `--fs-lg` | 1.125rem (18px) | card headings |
| `--fs-xl` | 1.375rem (22px) | section headings |
| `--fs-2xl` | 1.75rem (28px) | page headings, big figures |
| `--fs-3xl` | 2.25rem (36px) | hero figures |

- Nothing renders below 12px. Chart SVG text, drawn in the chart's own units,
  may sit at 11px but no lower. `tests/css-type-floor.test.ts` scans every
  stylesheet under `web/src/`. The 390px check in
  `e2e/interactive-targets.spec.ts` measures what actually renders.
- Display headings may stay fluid with `clamp()`, with their bounds in rem.
- Outside `globals.css`, write a token with its fallback, for example
  `var(--fs-xs, .8125rem)`.
- **One page width** (v4 Task 16): every page off the map takes `--page-width`
  (`min(1120px, 100% - 48px)`, `styles/page-shell.css`) for its header, content and
  footer, so nothing moves between pages and cards span it. Long prose (guide
  articles, privacy, terms, about) adds `.page-prose`: a 720px measure, left-aligned
  inside the same width. The map is full-bleed.

## 4. Logo

The logo is the knitted house, `<KnitLogo>`: a colour-work house with a cherry
roof, a sunshine storey, a sky ground floor, a door and windows. It sits on
`--wool`.

- At night the windows light up, through `--logo-window`.
- The static icon is `web/public/icon.svg`. Regenerate it with
  `npx tsx scripts/knit-icon.tsx`; never edit it by hand.
- Pair the logo with the lowercase wordmark. Don't recolour it, don't outline
  it, and don't flatten it into a plain house shape.
- One lockup everywhere (`<BrandLockup>`, v4 Task 37): the house on `--wool` at 36px
  beside the wordmark at `--fs-lg`, on the map's bar and every page's header alike;
  only phones of 360px and under drop the wordmark, on every page.

## 5. Components (`web/src/components/knit/`)

| Component | What it is | Use |
|---|---|---|
| `SatinBlock` | one satin-stitched block: felt base in the yarn's shade, close slanted threads, contour stitch | the unit of every chart |
| `SatinBar` | a 0–1 meter: satin fill on a `--wool` track | scores, "why it fits" |
| `SatinSteps` | n blocks, k stitched | ratings, bands, risk levels |
| `SatinRamp` | one block per class, 3px gaps, optional `--ink` marker | map legends, scales on tiles |
| `SatinStacked` | shares as blocks, stitch direction alternating | tenure, age, mix |
| `StemLine` / `StemDivider` | stem stitch along a path / across a row | line charts, tables |
| `Dot` | a plain filled circle with a thin `--surface` ring (see §6) | places, line ends, scale values |
| `KnitIcon` | a plied-yarn icon from `lib/thread-icons.ts` | every UI icon |
| `Yarn` | one plied strand along a path | routes, cords, tails |
| `KnitLogo` | the knitted house | brand mark |

Rules:

- **Charts are satin.** Blocks are 12–16px tall, so threads read as stitches.
  The text label and value always sit beside them, aligned in a grid.
- **Legends are separate blocks** with 3px gaps, like a card of embroidery
  threads. Never a gradient strip, never rows of knitting.
- **Time series** are stem stitch exactly through the data points, ending in a
  small dot at today. No jitter, no moved points.
- **Tables** keep plain text cells; rows are divided by `StemDivider`.
- **Icons are plied yarn** (`KnitIcon`): round caps, generous parts, no hairline
  details. **No system emoji anywhere**: commute modes, hearts, checks,
  crosses, ratings and ▲▼ are icons (`tube`, `bicycle`, `walk`, `car`,
  `heart`, `check`, `cross`, `star`, `rise`, `fall`, `dot`…). Plain arrows
  inside prose may stay as text.
- Colours may be hex or `var(--token)`; CSS variables are shaded with
  `color-mix`, so the same stitching follows Day and Night.
- Decorative stitching is `aria-hidden`; meaningful stitching has a `title`
  and visible text beside it.

### Prices in this area today (property page)

A home's page never states what that home is worth (owner decision
2026-10-11). The card `AreaPricesCard` (`components/area-prices-card.tsx`)
describes the area:

- **Lead**, one sentence with sample and dates: "Terraced houses here: most
  sell for £680k–£820k (middle half of 41 sales since 2023, adjusted to
  Oct 2026)", then which area was used (LSOA, MSOA or borough).
- **Band strip** (`PriceBandStrip`): six blocks, bottom 10% to top 10%, prices
  as text at each boundary. The middle half is satin in `--yarn-sky`, the band
  of this home's last sale satin in `--yarn-cobalt` (v4 Task 45: never alarm
  red), the tails plain `--wool` felt. No marker for the home, no texture.
- **Position**, a coarse band only: "When this home sold in May 2015, its price
  was in the top 10% of terraced sales in this area that year." Then the
  **bridge**, about the area, in a cherry-ruled note: "Today, the top 10% of
  terraced sales here are above £850k."
- **Footer**: "About this area's sales, not a valuation of this home. It can't
  see condition or improvements.", a HelpTip and the guide link.
- Under 5 sales: only "Not enough sales of this type nearby to show a range."
- Never write "worth", "would be around", "value", "valuation" or "estimate"
  about a home; tests guard the wording.

"Recorded sales" follows, each sale with its HM Land Registry record link.

## 6. Map rules

- **The basemap is real** (OpenFreeMap / OSM). It is only recoloured per
  theme in `web/src/lib/map-basemap-theme.ts`: clean light land and pale water
  by day, navy by night. Streets, labels and buildings stay readable.
- **Landmarks to find your way by eye** (`lib/map-landmarks.ts`): water and
  green space from the basemap's own layers, flat colour, no texture.
  - **Water** is a calm blue (day `#bcdcf2`, night `#13355f`) with a slightly
    darker edge from zoom 12 and canals as a line from 11. The river is named
    by the basemap's water labels, in the water's blue.
  - **Green space** (parks, commons, heaths, gardens, cemeteries, woods,
    nature reserves) is a clean, fresh green (day `#c4e7ce`, night `#1d4645`),
    never olive or pine, with a soft edge from zoom 13 (by Night a fresher
    `#3f8f78`). Protected areas
    (conservation areas, the World Heritage Site) are not painted green.
  - Both lie **under** the area colour as ground and **over** it as a veil in
    the same colour: water at 90% (no one lives on the Thames), parks at about
    40% by Day and 30% by Night (a stronger dark veil turned warm colours
    muddy brown, v4 Task 29), so the area's colour still reads through a park
    and the data keeps first place. Both sit under the streets, over the
    buildings.
  - **Big parks are named** in italic green with a halo, from
    `public/park-labels.json` (`scripts/park-labels.mjs`, OSM via Nominatim):
    six landmark parks from the opening zoom 11, others over 1 km² from 12,
    the rest from 13. Park names sit over the basemap's labels, under the
    stations' and the areas'.
- **Zones stay zones, under the streets.** Areas (LSOA/MSOA) are translucent
  fills coloured by the active layer. My match (per user only, never on
  public pages) paints every scored area in 7 bands by its percentile among
  the scored areas, RdBu `#b2182b #ef8a62 #fddbc7 #f2f2f2 #d1e5f0 #67a9cf
  #2166ac` (least like your search → best match; `lib/match-map.ts`,
  `contracts/style-contract.json`), the same by Day and Night. An area that
  fails a Must is grey under a light hatch, never red. Drawn zones are a thin
  dashed outline with a 6% tint in the theme's ink. The selected zone gets an
  outline.
  - The fill sits **over the basemap's buildings and under its roads**
    (`veilAnchor`), so streets and labels stay readable over the colour and
    the buildings take their area's colour; under opaque buildings the colour
    showed only in courtyards at street zoom.
  - It keeps full strength to zoom 12, then steps back to a tint (40%) by
    street zoom 15 (`zoomFillScale`, v4 Task 29: at 60% from zoom 17 only,
    street zoom drowned in solid colour). Fades never stack: the strongest of
    the zoom step-back, a colour square's translucency and places on top wins
    (`areaFillFade`).
  - **Price's street blocks** (zoom 12–15) follow the same step-back: 85% at
    zoom 12, a 40% tint by street zoom 15 (`blockFillOpacity`), each block
    edged in its own colour (`BLOCK_OUTLINE_LAYER`, thicker on hover). At 85%
    a small area opened on a phone (below zoom 15) drowned in solid red.
  - **Default map colours are colour-blind safe** (v4 Task 43): blue (good)
    to red (bad) where a layer has a better end, YlGnBu on neutral layers
    (`lib/palettes.ts`, first in ≡ › Map › Colours). The red–green "Traffic
    light" stays a choice; a visitor who chose it keeps it.
  - **By Night** road-number shields are hidden (their white plates cannot
    be recoloured), road names stay.
  - **A colour square ("A vs B") is 4 × 4.** Each side has one evenly spaced
    shade per count range (below London's median, then from the median, the
    upper quartile and the top tenth), so one more place is at most one shade;
    the key draws exactly the 16 cells the map can paint.
  - **Roads step back over the colour** (`ROAD_REVEAL` in
    `map-basemap-theme.ts`). Across the city (zoom 11) only motorways (70%)
    and trunk roads (55%) draw; primary roads join by zoom 13 (70%);
    secondary roads and local streets stay a faint trace (25% and 12% at 13)
    and come back fully at street zoom 16. Road names are untouched.
  - **3D buildings are a light relief** at 40% (`BUILDING_EXTRUSION_OPACITY`),
    so a pitched view keeps the area's colour through them.
- **A street map underneath, at half the density.** The area colour stays the
  subject, so everything else is about half as dense as a street map:
  - **Rail network in yarn** (`lib/map-transit.ts`, TfL open data via
    `scripts/tfl-network.mjs` → `public/tfl-network.json`):
    - **Lines** are plied yarn in each line's own TfL colour (shadow, body,
      ply twist a shade darker, a lit sheen). This covers every Tube, Elizabeth,
      DLR, Overground and Tram line. The Northern line turns light at night.
      They sit over the fill and under labels.
    - **The network recedes when zoomed out** (`TRANSIT_REVEAL`): lines are
      faint across the city (15% at zoom 9, 25% at the opening zoom 11) and
      come to full strength at street level (15.5), so they never outshout
      the area colour. Stations ride the same curve 1.6 times as strong
      (`STATION_REVEAL`: 40% at 11, 96% at 13, full at 15.5), so a small
      marker stays findable at the opening zoom without being loud. Overlapping routes and branches are
      merged into single runs (`mergeParts`), so faint track never doubles up.
    - **Stations** are neutral ring markers (`lib/map-station-marker.ts`): a
      white centre (night: the panel navy) in a ring of the line's colour; at
      an interchange the ring splits into equal segments, one per line, in
      each line's TfL colour. Drawn on a canvas at the screen's pixel ratio,
      cached per line combination, a size up at interchanges and growing with
      zoom. Interchanges are named from 12.5, every station from 13.5.
    - **One rule across the whole city.** Every station is eligible at every
      zoom, and markers are thinned only where they would collide (interchanges
      first), so the outskirts never look emptier than they are.
    - Marker and name are one symbol, and the name shows only where it fits.
    - The TfL source is never recoloured by the basemap theme.
    - Never draw the roundel (a TfL trademark); the marker lives in one
      module so a licensed roundel could replace it later.
  - **Places** (cafés, food, pubs, shops, sport and culture) are on by
    default from zoom 14. They are thinned by importance with wide spacing
    and named from zoom 15. Their badges are **embroidered patches**: a felt
    disc in the group's colour, a running-stitch ring and the icon in white
    plied yarn (`lib/map-yarn-images.ts`). Places are background, schools are
    primary: the groups take their own **muted palette** (see Map marker
    colours), never an Ofsted, collision, station, tree or cycle colour. Their types are chosen in one
    place, Show › Local places, as tick-boxes keyed by
    those same badges; no chips float on the map. **Chain shops** (a shop with a brand, like the Co-op) are left
    out: they read as advertising. A click finds the nearest badge within 10 px
    (a 41–46 px target), a finger within a 44 px box; a school cap under the
    finger wins (one hit-test for every tap and hover, `lib/map-pick.ts`:
    hover peeks, a tap opens the object's card in the sheet, and a point
    object over an area never selects the area). Its HTML markers (your
    places, saved ♡, ranking pins) join it with `registerPickMarker`, never a
    handler or a native `title` of their own. Lines (cycle lanes, green
    streets) and stations only peek. The cursor is a pointer over what a tap
    opens, the default over a peek, a crosshair while a place is put down or a
    zone drawn.
  - **House numbers** from zoom 17 (`lib/map-basemap-extras.ts`). They are
    added as the style loads, because a vector tile parses only the source
    layers in use when it arrives.
- **Knitted objects only on top:**
  - Your places (work, school, gym, family…) are **ink teardrop pins of one
    size** (24 × 30, `myPlacePinMarkup` in `lib/place-yarn.ts`, v4 Task 20):
    `#22252c` with a white edge and the type's glyph in white plied yarn
    (work briefcase, school cap, gym barbell, family, other heart), the name in
    a pill beside it. No cherry, sun or tangerine dots: those read as
    collisions or school caps. Never use pin size for a score. A tap opens
    its card: Rename, Move (the next tap puts it there), Remove, Commute
    from here (My match).
  - **Routes are yarn**: layered lines (shadow, outline, body, ply dashes).
    Transit is cherry, cycle sky (as the cycle lanes), car cobalt. Walking legs
    are a running stitch. Route geometry is never altered.
  - **Schools** (Show › Schools, `lib/school-icons.ts`, v4 Task 1c): the sun
    mortarboard, 36 px at every zoom with every detail (v4.6: the letter and
    the plaque number render at 12 px or more; the 63 px image is the tap
    area), one visual channel per
    fact: Ofsted is the top's colour only, phase a letter on the band (P, S,
    PS), funding the body (state sun, private ink with a white top), London
    rank an award plaque with its tier number (Top 25% Silver, 10% Gold, 5%
    Diamond, 3% Red Diamond, 1% Ruby; none below; 23 px, up and out past the
    top's right corner; ink numbers on Silver, Gold and Diamond, white on Red
    Diamond and Ruby, each ≥ 4:1). Caps never shrink; ones
    that would overlap fold into the best of them with a white "+N" pill (a
    mini cap before the number; a tap zooms in). The exact London place is in
    the popup only. The same top colours mark Ofsted on the school page and
    the area's school rows (Task 47).
  - **Road collisions** (Show, `lib/map-collisions.ts`, v4 Tasks 4 and 5):
    zoomed out one warm heat map (transparent → amber → red → deep red, at
    most 0.75 opacity), casualties weighted by severity (fatal 10, serious 3,
    slight 1); from street zoom one burst per casualty filled with its
    severity colour, the road user drawn in white (walking, bike, motorbike,
    car), severity also by size and outline (fatal 24 px dark outline, serious
    20, slight 16 with a white edge and a thin dark rim, so a sun burst still
    parts from the snow map). While the heat shows, the area colour steps back
    to 35%: warm heat over a warm area class cannot be told apart. Tangerine is
    for collisions only.
  - **Cycle lanes** are sky dashes on a cream casing (v4 Task 20); the dash
    tells them from the Victoria line's solid sky.
  - **Recent sales** are 10 px rounded squares (a house footprint) on the
    one-hue plum ramp, never the red–green ramp, outlined ink by Day and snow
    white by Night (the deep plums on navy are under 2:1).
  - **Street trees** (Show, `lib/map-street-trees.ts`) are leaf dots from
    street zoom (15), as wide as the canopy the owner recorded; a hollow dot
    has no size recorded; a count below. **Green streets** (Layers › Nature)
    colours road links grey (no street tree) to deep green (12+ per 100 m)
    and leaves the areas clear. **Canopy** (Layers › Nature) shades 10 m
    cells leaf green from the satellite, four strengths, the areas clear.
    Day and Night have their own greens.
  - **Home** is the small knitted house.
- **Typical price today** is an area layer: LSOAs coloured by the median sale
  price adjusted to today, on the price ramp (YlGnBu) in five steps. Its
  views in the Layers card switch the type (All, Flat, Terraced, Semi,
  Detached), with a HelpTip in its colour key; each type is its own published metric. Areas under
  5 sales are grey. **Homes at house zoom** (from 15, on the £/m² layer): a
  sold home (a dwelling, or a parcel of one home) is filled with its last
  sale's coarse band, bottom 10% to top 10% against same-type sales in its
  area that year (property tile `band`, migration 044), in the palette's six
  price colours (`paletteRamp`, cheap is good), keyed as "Sold homes: where
  the last sale sat among similar homes sold here that year". Never a
  percentile or a figure, and never a home's or a sale's £/m² (none is
  published while the EPC licence is pending): sale pins are coloured by
  price paid or their area's growth only. Any other home is a clear outline over the area
  fill. Outlines and rings are a faint `--ink` of the theme (Day `#22252c`,
  Night `#f4f7fa`, `NEUTRAL_LINE`); cobalt only marks hover and the chosen
  home. A parcel wider than one home's plot (several homes on it, or a
  land title over 2,500 m²: some cover a whole estate) never fills on hover or
  choice; it keeps a faint outline, and the chosen home is a cobalt ring at the
  home itself. Street blocks (12 to 15) take the median of three or more homes and
  are clear without one. The area fill keeps its strength under blocks and
  homes, and steps back to a fifth only under sale pins
  (`areaFadedUnderHouses`).
- Map attribution (© OpenFreeMap © OpenStreetMap contributors, Powered by
  TfL Open Data) stays visible.

### England map: the map at any zoom (board #10, approved 2026-10-27)

Six rules for the map from all of England down to a street (canvas board
"Карта на любом зуме", `Map-any-zoom.dc.html`):

1. **Zoom ladder: LAD → MSOA → LSOA.** All of England below zoom 6.5 is its
   296 LADs; 6.5 to 9 MSOAs; LSOAs from 9 (`LAD_ZOOM`, `WIDE_ZOOM` in
   `lib/map-coverage.ts`). Every level is built from LSOAs (each wider area
   is the median of its areas), so each nests exactly in the one above. The
   kind on screen keeps its colours until the next kind's land on loaded
   tiles: no blank frame at a level's edge. The scale is worked out again on
   the new level (the level is part of the scale's anchor). The map's
   `maxZoom` is explicit (18) and the fill's step-back from 12 to 15 is by
   zoom in the style, never after a gesture.
2. **Borders: hairlines for the level, ink for the LADs.** A line layer on
   the same tiles as the fill (`lib/area-edges.ts`), so a border is the edge
   the colour is drawn with. The level painted has hairlines in the ground's
   colour (white by Day, navy by Night) at 55%: an MSOA 0.75 px, an LSOA
   0.5 px and 0.75 from 12, stepping back with the fill to street zoom 15.
   The LADs are a thin ink line at 35% over them: 0.5 px while they are the
   level, 1 px over MSOAs and LSOAs, 1.5 px from 12. Lines sit over the fill
   and under streets and labels. The selected area is its own feature-state
   outline on the same tiles.
3. **No data: one grey.** Inside a layer's coverage an area without a value
   is grey `#d1d5d3` at 90% (Night `#3d4862`), whatever the reason (few
   sales, suppressed, no source there); the reason is in the area's card,
   never on the map (`lib/no-data.ts`). A hatch means only "fails a Must"
   (My match). The legend shows a "No data" square while such an area is in
   view.
4. **Colour scale: In view.** A layer with a ramp is coloured by the 9
   quantiles of the areas in view at every level (owner decision 24.10,
   `lib/view-scale.ts`). The breaks hold until the zoom moves 0.5 or the
   centre 30% of the view; a level change always works them out again.
   Fewer than 20 valued areas in view: the ranks of their region (one region
   in view) or England's (several). Region and England are the reader's
   choice in Colour range and stay until Reset. Cards, schools and "of
   <region>" words always rank within the region; the legend always names
   its base.
5. **Labels on the same ladder.** England's nine regions below 6.5 (17 px,
   bold, ordinary case); LADs in spaced capitals (12 px) from 6.5 to 11.5;
   postcode districts 11.5 to 14; the basemap's names after that
   (`lib/map-area-labels.ts`, region points from `/api/v1/labels`). Labels
   of one tier never overlap: the smaller yields by rank. London's TfL and
   park names stay London's.
6. **Partial coverage ("London only").** A layer whose data covers part of
   the map has no fill outside it: that is "the source does not reach
   there", not "no data". The legend says "London only" (or the coverage's
   name) after the layer's name while it is chosen, and with none of its
   areas in view a map message "<Layer>: London only · Show London" brings
   London into view (`components/coverage-notice.tsx`). Coverage comes from
   the metric catalog (`metric_coverage`), never a hand-written list.

If the places the site serves (`/api/v1/scope`) do not load, one line over
every page says so with Try again (`components/scope-context.tsx`), rather
than passing London's words off as the map's.

Still to build from the board (they need region shapes or levels in one
tile file, step 7 of `docs/architecture/global-geography.md`): a 0.5-zoom
cross-fade between levels from one tile source, the region's ink line
(1.5–2.5 px at 60%), the coverage's dashed ink outline (55%), and tiles near
lossless to zoom 14.

## 7. Buttons and controls

- **Primary** (one per screen): `--primary` fill, `--on-primary` label, and a
  dashed **running stitch** in `--stitch` sewn 4px inside the edge. No cord,
  no knitted patch.
- **Chosen tag / pressed chip**: the same: primary fill with the running
  stitch. Only what is chosen carries a stitch.
- **Secondary buttons, menu rows, map controls, unselected tags** are calm: a
  soft `--chip` fill, a yarn icon, no border, no stitch. The round map
  controls take `--map-control` (white by Day; by Night a navy lifted off the
  basemap with a light `--map-control-rim`, so they never vanish on the night
  map, v4 Task 29).
- **Tags** are clean pills with a yarn icon in their own yarn colour. Never a
  knitted or satin patch behind text.
- **Disabled**: `--chip` fill and muted text, never a translucent primary.
- **The phone sheet** is plain: a `--panel` fill, a 20px top radius, the
  dock's soft shadow and a neutral 40×4px grab handle. No cord, no stitch.
  Only the grabber, its head and the peek line drag it; its text is for
  reading and copying (a mouse selects it, a finger scrolls it, and a pull
  down from the top of the text moves the sheet). With nothing chosen it is
  only its peek bar (the prompt), so the map's centre stays the map's.
- **Map controls stay apart from the area**, as in Google or Apple Maps
  (`components/map-layers.tsx`): a stack of **round 44px buttons** on the
  right, icons only (names in the accessible name and tooltip): **My match**
  (the primary fill and stitch, sparkle; it opens My match's list, no wizard; it steps back to a calm chip while
  another primary is on screen: the first-visit card's labelled "Find my area", the area panel's "Open full area
  page" or the compare tray, v4 Task 36),
  **Layers** (what colours the map: the period and "Colour the map by") and
  **Show** (map pin: Local places, Schools, Recent sales, Stations, My
  places, Cycle lanes, Road collisions, Street trees as tick-boxes keyed by
  their yarn dot; drawing an area is My match › Where, v4 Task 8). Below them **my location**, with + and − on a desktop only (a phone
  pinches). Desktop: the stack top-right beside the dock, my location and
  zoom bottom-right; phones: one column bottom-right above the sheet. Map
  settings (2D/3D, Colours) live only in ≡ › Map. The **legend chip**
  (bottom-left; on phones above the sheet's peek) is the satin scale and a
  small "?" (layer, period, how to read it, London typical, source), a
  "No data" square only while a grey area is in view (§6, England map) and
  "London only" after the layer's name on a layer of partial coverage.
  Above it, the **colour range**
  (`legend-range.tsx`): satin bars of the values in view, two ink handles for
  the ramp's low and high value, In view | region | England on a rank layer,
  and Reset; inline on a desktop, opened by a tap on the chip on a phone (the
  layer pill opens Layers there). Layers or Show opens one card: a popover
  beside the stack on desktop, a modal bottom sheet on phones. The dock and
  the phone sheet hold the area only, and opening a card never moves them.
- Targets are at least 44px. Focus is a visible `--focus` outline. Stitches
  are decoration; shape, fill and text carry the meaning. `e2e/target-size.ts`
  fails anything under 24px (WCAG 2.5.8) and warns under 44px. A checkbox or
  radio counts through its `<label>`, and a link inside running text is exempt.
- **Fields** use `.knit-field` (`knit-ui.css`): 44px tall, a 1px
  `--field-line` border (3:1 on the surface), `--radius-md`, 16px text and a 3px
  `--focus` outline. New inputs take the class; older ones join its selector.
- **Tick-boxes and radios** are never the browser's own (`knit-ui.css`, v4 Task 31): a 20px box (a
  circle for a radio) with a 2px `--field-line` on the surface; chosen is `--ink` with an `--on-ink`
  tick, or an ink dot in a surface ring. A group of radios sits in a `fieldset` with a `legend`.
- **A bare `<button>`** (no class) is a calm `--chip` pill, never a grey outset face.
- **Prices** are text fields (`MoneyInput`, `inputmode=numeric`) that show "525,000" and read
  "£525,000", "525k" or "0.5m"; never `type=number` (the wheel and spinners change the figure).

## 8. Voice

Short and warm, never cute in data, errors or legal text. Every number names
its source and date. Preview fixtures are labelled as previews.

## 9. Checklist for any UI change

1. Colours come from tokens. A new token goes in both the Day and Night
   blocks (and the auto-dark copy), then into this file.
2. `cd web && npm test && npx tsc --noEmit` pass, including
   `colour-contrast` and `knit` tests.
3. Look at the change in **both themes** (toggle in the top-bar menu, or set
   `prefers-color-scheme`).
4. Charts are satin with their values as text; icons are plied yarn; only the
   primary action and the chosen tag carry a running stitch; silhouettes are
   solid with no gaps between stitches. The map stays real.
5. Visual baselines (`web/e2e/*-snapshots`) are updated only on purpose,
   with `npx playwright test --update-snapshots`.

The exploration that led here (10 directions, prototypes, the Python knit
renderer) is in `design/`.
