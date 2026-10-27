# Interview and refinement

## Questions, in order (skip what the user already said)

1. "Are you buying or renting?" and "What's the most you can spend — and what would feel comfortable?"
   - Buying: total price in £. Renting: £ per month.
2. "How many bedrooms do you need?"
3. "Where do you need to get to regularly, and how long is OK?" — resolve each place with
   `search_places`. For a workplace near a station, put that station (or 1–2 stations on the same
   line near home candidates) in `near_stations`. `find_areas` does not compute commute times;
   say so if the user cares a lot and suggest they check door-to-door times for the finalists.
4. "What matters most? For example: feeling safe, being close to a station, good value, quiet
   streets, good schools, green space."
5. "Anything that rules an area out?"

Stop asking once you have budget, bedrooms and at least one priority — run `find_areas` and let
the shortlist drive the rest.

## Understanding places

People name places loosely: "KX", "Kings X", "TCR", "Liverpool St", "E&C", "ally pally",
"Shepherds Bush", "the Google office at King's Cross". Never make the user repeat a place in an
official spelling.

- Pass what they said to `search_places` first: it ignores case, apostrophes, "&"/"and",
  "St"/"Saint", plural *s* and words like "station" or "tube", and knows common codes and
  nicknames (KX, TCR, LST, LBG, CHX, E&C, CW, HBI, ally pally…).
- Still nothing? Expand it yourself and try again: spell out the abbreviation, drop the
  employer or building ("Google KX" → "King's Cross"), try the nearest station, the
  neighbourhood or the postcode district.
- Several matches (e.g. "King's Cross St Pancras" underground and "London King's Cross" rail)
  are the same place: pick the first and move on. Ask only when the candidates are far apart
  ("Bank" vs "Embankment").
- Confirm in passing, not as a question: "King's Cross St Pancras — got it."

## Their places

Ask early: "Where do you go regularly — work, a gym, school, friends? And do you need a park or
cafés nearby?" Each answer becomes a place in `find_areas.places`: pin specific places (resolve
them with `search_places` and pass latitude/longitude), use `category` for "any park / café /
supermarket / GP". Set `max_minutes` from their words ("10 minutes' walk", "under half an hour
by tube"), `importance` from how much they care, and `must` only for real deal-breakers. Minutes
are straight-line estimates until door-to-door routes arrive — say "about".

## Words → parameters

| User says | Change |
|---|---|
| safe, low crime, I'll walk home late | `crime` importance 4–5 |
| near the tube/station, no car | `station-access` importance 4–5, or `near_stations` with `max_walk_minutes` 10–15 |
| good value, my money goes further | `market-level` importance 3–5 |
| near my work at X / on line Y | `near_stations` (≤ 3 stations + boroughs in total) |
| only in borough X | `boroughs` |
| too expensive | lower `max_budget` *or* add `market-level`; keep `include_over_budget` false |
| I could stretch | `include_over_budget` true and say which areas are over |
| not that one / hated it | add its id to `exclude_area_ids` |
| like X but cheaper / somewhere else | `find_similar_areas(area_id=X, cheaper=true)` |
| want quieter, not on a main road, not under the flight path | `noise` importance 3–5 (share of homes at 55 dB+ from road, rail, aircraft) |
| no rough streets, graffiti, people hanging around | `disorder` importance 3–4 (anti-social behaviour, damage, public order: not thefts) |
| low energy bills, warm home | `epc-share` importance 2–3 (share of homes rated EPC A–C) |
| want a freehold, no service charge | `leasehold-share` importance 2–4, direction lower; mostly leasehold → check years left and service charge |
| good schools | a place with `top_school` (add `school_rank_by: "progress8"` for "schools that add the most", secondaries only), and compare `schools` in `get_area_overview` |
| wheelchair, buggy, can't do stairs | a place with `category: "step_free_station"` and `max_minutes` 10 |
| more cafés than takeaways, lively high street, near gyms, quiet nights | a custom criterion: `list_custom_presets` / `evaluate_custom_criterion`, then `find_areas(custom=[…])` |

Importance: 5 essential, 4 very important, 3 important, 2 nice, 1 tie-breaker. Keep 2–4
priorities; more than that flattens the ranking.

## After each run

Say in one or two sentences what changed ("Dropped Merton as you asked; Ealing 019F moved up
because you raised station access"). Then ask a single question that moves things on.
