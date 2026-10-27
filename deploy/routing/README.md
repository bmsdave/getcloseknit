# Routing release boundary

Routing is a separately versioned deployment because an answer is meaningful
only with its OSM extract, timetable snapshot, service date, and engine build.
Production never runs a router: it serves rows from Postgres
(`route_network_release`, `commute_hub`, `travel_time_matrix`, migration 024).

## Offline commute build (ETL machine)

Inputs (TfL open data terms accepted 2026-10-06; "Powered by TfL Open Data"):

1. `journey-planner-timetables.zip` (TransXChange: Underground, DLR, trams,
   river, buses) converted to GTFS with `transx2gtfs`, then
   `gtfs_clean.py` drops the few stops NaPTAN has no coordinates for
   (filled from TfL StopPoints when cached).
2. `tfl_rail_frequencies.py`: Overground lines and the Elizabeth line are not
   in that feed, so a frequency approximation is built from the Unified API
   route sequences (line speed + dwell, fixed weekday headway). Labelled as an
   approximation in the source release caveats. National Rail (Rail Data
   Marketplace registration) replaces it when the operator registers.
   Until it does, the API flags National Rail-only areas (commute.national_rail_only):
   get_commute reports confidence "low" with a caveat naming the station, and find_areas
   scores them as unknown rather than excluded under must place limits.
3. Geofabrik Greater London OSM extract (ODbL) for walking and cycling.

Engine: R5 through `r5py 1.1.7` in `deploy/routing/r5/` (Java 21 image
`close-knit-r5:1.1.7`). `commute_r5.py matrix` computes every LSOA
(a point inside each area) to each hub in `hubs.csv` (32 stations)
for transit (weekday departures 08:00-09:00, p10/p50/p90), walking and
cycling, capped at 120 minutes. `deploy/tools/etl_commute.py load` validates
(every LSOA × hub × mode present, minutes in range, King's Cross sanity
bounds) and stages a product release with the timetable and OSM source
releases. Pinned places within 1.5 km of a hub are scored through it (hub
minutes + the walk from the hub); other places remain straight-line estimates.

### Cycling and driving: several views, then a check

- Cycling: `cycle_observed.py` reads weekday-morning Santander Cycles journeys
  (classic bikes, dock pairs of 2 km+, 250k trips) and routes each dock pair
  with OSRM's bicycle profile: riders reach ~16 km/h on the street route, and
  OSRM's own times are 1.37x theirs. The cycling time is OSRM's divided by that
  ratio; on a TfL Journey Planner sample it was not fitted to, it agreed on 98%
  of pairs (median ratio 1.00). R5 with main roads allowed (`--cycle-lts 4`) at
  the observed speed is the second engine and the other end of the range.
- Driving is OSRM's free-flow route with its first and last 5 km at DfT's
  observed 2025 average speed on local 'A' roads (CGN0503d) in the start and
  hub boroughs, scaled to the weekday morning peak (CGN0503a); the middle of a
  long drive (trunk roads, motorways) keeps its free-flow speed. R5's free-flow car time is a cross-check.
  Parking, the congestion charge and ULEZ are not part of the time; driving is
  shown, not scored.
- `combine_matrix.py` writes the release matrix and an agreement report;
  `tfl_crosscheck.py` compares a random sample with TfL Journey Planner
  (agreement = within max(5 min, 20%)); answers are a check, never loaded.

OpenTripPlanner (pinned `2.9.0`) is reserved for per-route itineraries; it is
not used to construct matrices. Neither engine receives live disruption feeds.
The TfL Unified API is a check, not a source: sampled route agreement at
release time and, with `CLOSE_KNIT_TFL_APP_KEY`, live line status.

Cache identity includes destination hub, arrival band, mode, service date and
`route_network_release.id`. Exact user coordinates exist only in the request
(`POST /api/v1/commute`, `no-store`) and are never logged.

## Fixed screening fixtures (AE-17)

Automated tests do not touch the network: `api/area_api/routing.py` and
`web/src/lib/journeys.ts` carry the same fixed coarse matrix, so Python and
TypeScript stay equivalent where behaviour overlaps.

- Network releases: `street-network-2026-09-rtm` (current) and
  `street-network-2026-08-rtm` (previous). A version change moves durations;
  an unknown version is unreachable, never guessed.
- Timetable dates: `2026-09-03` (Thursday, weekday band) and `2026-09-06`
  (Sunday, weekend band). Transit differs by band; walk/cycle are band-free.
- Origins are coarse area cells (`uk:lsoa:E01000001`, `uk:lsoa:E01000002`);
  destinations snap to coarse cells and arrival times floor to a 15-minute
  band. Every result is labelled `area-origin` approximate with its arrival
  band, mode, transfer/walking components, network date, and destination
  cell. Precise address routing is a separate, explicitly requested journey.
- Active destinations combine by documented weight; zero-weight destinations
  are ignored and named. A leg whose median exceeds its target sets
  `exceedsTarget`; any exceeded or unreachable leg makes the area ineligible.
  Per-leg utility uses the same `200 - minutes/target*100` clamp as
  production matching, so screening and scoring cannot drift apart.
- Cache identity is the full matrix key (origin cell, destination cell,
  arrival band, mode, service band, network release): unchanged inputs never
  recompute. Screening accepts a cancellation hook. Logs go through
  `redact_for_log`/`redactForLog`, which keep only coarse cells, bands,
  modes, and statuses — never labels or exact coordinates.
