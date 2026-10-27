# London Close Knit

London Close Knit is a map-first, Apache-2.0-licensed home-moving analytics product.
It uses MapLibre rather than the frozen custom Rust/Wasm renderer.

## Current vertical slice

- `web/`: working Next.js and MapLibre GL JS PWA with five analytic layers,
  search, selection, shareable state, source-linked evidence, price timeline,
  property history, a nine-factor personal match, school/forecast/commute tabs,
  local profiles, explicit fragment sharing, deterministic APIs, responsive
  bottom sheet, and 3D buildings.
- `api/`: self-hosted production API boundary and privacy/routing primitives;
  Next.js remains the deterministic fixture façade for web tests.
- `contracts/`: stable OpenAPI and cross-platform MapLibre style contracts.
- `deploy/`: PostGIS, API and web development/production shape.
- `ios/`: Swift models, API client, tests, and SwiftUI MapLibre Native view.
- `android/`: Kotlin models, tests, and Compose MapLibre Native view.

The web UI currently labels its three committed polygons and metric values as
preview fixtures. They exercise behavior without presenting invented numbers as
official London statistics. Production data is emitted by
`pipelines/area-analytics-ingest/` only after dated source manifests and
adapters are reviewed.

Analytics geometry follows the evidence carrier, not arbitrary map zoom bands:
the initial ranking unit is the 2021 LSOA, with an explicit fallback to MSOA or
borough where evidence is too sparse or published only at a coarser level.
London is the comparison and overview extent. Streets and neutral building
footprints remain basemap context; an address can expose known transaction and
EPC history, but area evidence is never repeated at street or house precision.

The current map values, journey durations, schools, and forecasts remain
clearly labelled preview fixtures. The database and pipeline define the
immutable release, school, routing-matrix, forecast, and redacted opt-in
analytics storage required before replacing those fixtures with official data.

## Validation status

The decision-support proposition is unvalidated: London demand, willingness
to pay, and whether an extra score helps a household shortlist are not
established by the non-UK studies and anecdotes behind the current screens.
The pre-registered consent-based study with 8–12 London households is in
[docs/london-user-validation-protocol.md](docs/london-user-validation-protocol.md).
Until its evidence summary lands, rankings, comparisons, and briefs stay
labelled discovery surfaces, and no demand or payment claim is made.

## Design

The knitted design system (day/night tokens, logo, knitted components, map
rules) is in [DESIGN.md](DESIGN.md). Every UI change follows it.

## Web

```sh
cd web
npm ci
npm test
npm run typecheck
npm run build
npm run test:e2e
```

The default basemap is OpenFreeMap. Browser tests inject the local deterministic
style endpoint and never require external tiles.

## Licensing boundary

This directory is licensed under Apache-2.0 by the adjacent `LICENSE` and
`NOTICE`. That licence does not make a repository-wide grant and it does not
cover data: OSM remains ODbL and each analytics release carries its source
licence and attribution separately — see `DATA-LICENCES.md`.

## Data licences & privacy

- `DATA-LICENCES.md` lists every source, its licence, what it is used for and
  the attribution a deployment must show (INSPIRE statement verbatim).
- Per-home figures are public records (HM Land Registry) matched to a UPRN via
  EPC (matching only — no certificate fields are served; guarded by
  `api/tests/test_minimisation.py`).
- `/privacy` is the privacy notice; the legitimate-interests assessment and the
  ICO registration checklist live in `docs/legal/`.
- Owners/occupiers can hide a home: `POST /api/v1/corrections` with
  `kind: privacy-objection` (uprn or addressId + e-mail), confirmed through an
  e-mailed link; confirmed homes vanish from search, history, property reads
  and tiles. `python -m area_api.objections list|revoke <id>|activate <id>|purge`
  administers requests; requests never confirmed are deleted after 30 days
  (on each new request, or by `purge`, e.g. from a daily cron). Notifications: `CLOSE_KNIT_CORRECTIONS_WEBHOOK`
  and/or `CLOSE_KNIT_SMTP_*` (both optional; the confirmation e-mail needs SMTP).
- Public endpoints are rate limited (`CLOSE_KNIT_RATE_LIMIT`, default
  120/minute per client; tiles 600/minute; `/health` exempt).
