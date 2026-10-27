# Personalisation spec ("Tailor")

Builds on `spec.md`. **The order never changes. Only the overview header and a few local facts do.**

## 1. Topic order: `lib/topic-order.ts`

`TOPIC_ORDER = price, getting-around, safety, schools, environment, people-homes, living-costs, my-criteria`

- Spec §1 order (buyers rank price, then transport, then safety). Visible change: on the map, Getting around moves above Safety.
- Everyday life, Food & drink and Going out are nearby places, and the area card shows those inside Getting around. They map to `getting-around` and come straight after it.
- Homes & area and People map to `people-homes`. My criteria stays last and only appears on the map.
- When a screen has no section for a topic, it skips that topic and never reorders the rest. The map still has no Schools or Environment group; that is out of scope here.

**Consumers** (`sortByTopic`): `map-topics.ts` GROUPS, `area-brief.ts` AREA_CARDS + `area-full-page.tsx`, `evidence-sections.ts`, `overview-tiles.tsx` TILE_IDS, `evidence-panel.tsx` BRIEF_TILES, `area-pages.ts` RANKING_GROUPS, and `match-brief.ts` `tradeoffsFor` (topic order, status shown as a tag).

Phone and desktop share components, so the order matches.

## 2. Profile: extend `PreferenceProfile`

Add these optional fields; `null` means default:

```ts
household?: "solo" | "sharers" | "kids-under5" | "kids-primary"
          | "kids-secondary" | "kids-mixed" | "55plus" | null;
lifestyle?: ("parks"|"gym"|"cafes"|"bars"|"quiet"|"gp"|"shops")[]; // ≤3
```

These existing fields are reused:
- `market`
- `places[]` (a pinned place with its mode)
- `school.phases`, written from `household`: Under 5 or Primary gives primary, Secondary gives secondary, Mixed gives both

**Wizard** (`tailor-wizard.tsx`): 4 steps, one tap each, every step can be skipped, and Done is always visible.
1. **Who's moving?** Me or couple / Sharing / Kids under 5 / Kids at primary / Kids at secondary / Kids, mixed ages / 55+ or downsizing
2. **Buy or rent?** Prefilled from `market`.
3. **Where do you go most?** Optional pin, using the existing place picker.
4. **Up to 3 things you'd use weekly.** Suggested (unticked, inference): GP for 55+, Parks for kids, Cafés for sharers.

**Where it is edited:** a "Tailor" chip on the overview header, which reads like "For: kids at primary · gym" once set. It opens a small profile card with the answers, Edit and Reset to default. The Your basics stage shows the same summary.

## 3. Rules

**Overview tiles:** 7 tiles, plus the optional Market activity tile.
- Slots 1–4 never change: Price, Getting around, Safety, Schools.
- Slots 5–7 default to Green space, Quiet and Flood. Picked lifestyle tiles fill them first and defaults fill what is left. The 3 tiles then render in topic order.
- Flood is never dropped when the EA band is medium or high.
- A tile that matches the profile gets a same-size **"For you"** marker (icon plus text).

| Profile | Local change only | Data (gaps in bold) |
|---|---|---|
| Kids under 5 / primary | Schools: best primary ≤1 km (default); section opens on Primary | slice B |
| Kids secondary | Schools: best secondary's London rank; opens on Secondary | **`bestSecondaryLondonPercentile`** (slice B) |
| Kids mixed | Primary rating, secondary name as fact | both |
| Others / skipped | Default, no marker | — |
| Rent | Price fact: typical rent, else "sold prices" | **rent source unconfirmed** |
| Pinned place | Getting around: "N min to {place}" | `get_commute` |
| parks / quiet | Marker on Green space / Quiet | spec §2 ("No rating" until B) |
| gym | "Gyms & pools within 10 min walk: N" | **`gyms`, `pools` in `AMENITY_GROUPS`** (places.py:38) |
| cafes | "Cafés & restaurants …: N" | `food` + **`cafes` group** |
| bars | "Pubs & bars …: N" | `pubs.countWithinWalk` (800 m) + **OSM `bar`** |
| gp | "Nearest GP: X m" (no minutes) | `gps` nearest |
| shops | "Food shops …: N" | `groceries.countWithinWalk` |

The Getting around nearby-places list marks picked groups, never reorders them. Sections, tabs, chips and the map are never personalised.

## 4. Ratings

Counts are raw, labelled "on OpenStreetMap", and show "No rating" until a London distribution exists (later: per-LSOA percentiles from `custom_criteria.py`).

## 5. Privacy

- The new fields live in the existing localStorage profile (`close-knit.preference-profile.v1`). There is no server profile.
- The v2 share encoder is unchanged, so links carry no household or lifestyle data. Only `school.phases` is shared, as it is today.
- `product_event` never records answers. At most it logs `tailor_saved` with a step count, and the existing opt-out applies.

## 6. Slices

These follow area-card slices A (Rating), C (Overview) and D (Structure). Each slice uses its own files.

| Slice | Files | Acceptance |
|---|---|---|
| **T. Order** | new `lib/topic-order.ts` and its test, plus the §1 consumers | Each consumer's order is a subsequence of `TOPIC_ORDER`. Existing e2e tests pass. Starts after C and D, because it touches their files. |
| **P. Profile** | `contracts.ts`, `profile-state.ts` | Old profiles parse. Lifestyle is capped at 3. The v2 share round-trip is unchanged. |
| **W. Wizard and card** | new `tailor-wizard.tsx`, `tailor-card.tsx`, `tailor.css` | Skipping everything gives the default. Every step takes one tap. Keyboard works and axe passes. |
| **O. Slots** | new `lib/overview-slots.ts` and its test, plus one prop in `overview-tiles.tsx` | A unit table maps profile to 7 tile ids. Slots 1–4 never change. Medium or high flood is kept. e2e: changing household changes the Schools fact, and the tab order stays the same. |
| **S. Amenities** | `places.py`, `lib/places.ts` | Adds gyms, pools, cafés and bars. API count tests pass. |
| **X. Secondary** | inside slice B | The field is nullable and runs 0–100. |

Before merge: `npm run lint`, `tsc`, unit tests, then e2e once.

**Open questions for the PO:** whether household data can go in share links, where rent comes from, and whether Flood should keep a fixed slot.
