# Wave 3 track rules (area360 coverage: tracks F–M)

Read first: `docs/area-clarity-2026-10/area360-coverage.md` (your rows) and
`~/.claude/plans/fancy-herding-flame.md` (Wave 0 contracts).
Several tracks run at the same time in separate worktrees, so the rules
below exist to keep merges clean.

## Ownership
- **New files are yours.**
  - API: `api/area_api/<topic>.py`
  - Pipeline: `pipelines/area-analytics-ingest/area_analytics/<topic>*`
  - Migration: `deploy/migrations/<your number>-<topic>.sql`
  - Web types and logic: `web/src/lib/<topic>*.ts`. Your contract types go here, never in `contracts.ts`.
  - Web: `web/src/components/<topic>*.tsx`, `web/src/styles/<topic>.css`, and new routes under `web/src/app/**`.
- **Shared files: append only, in small hunks.**
  - `api/area_api/app.py`: route registration only.
  - `contracts/openapi.yaml`: new paths only.
  - `web/src/app/layout.tsx`: one CSS import.
  - `web/src/lib/help-texts.ts`: new ids only.
  - `DATA-LICENCES.md` and `~/data/MANIFEST.tsv`: one block or row per new source.
- **Do not edit:** `evidence-panel.tsx`, `area-map.tsx`, the Overview, `guide-slugs.ts`, `contracts.ts`, `globals.css`.
  - Export a section component instead and say in your handoff where it mounts (tab and position). I mount it during the merge.
  - New guide topics: list them in the handoff.

## Migration numbers
F 012 · G 013 · H 014 · I 015 · J 016 · K 017 · M 018. L has no migration.

## Data
- Sources live in `~/data`; ETL work dirs go in `~/data/aework/<topic>`.
- Download only from official or open sources:
  - ONS / Nomis
  - Environment Agency
  - Bank of England
  - Democracy Club / UK Parliament
  - VOA / gov.uk
  - TfL
  - OpenStreetMap (already downloaded: `~/data/osm/greater-london-latest.osm.pbf`)
- For each download, record its licence and attribution.
- Real DB: Docker container `ae-pgold`, port 5434 (`docker start ae-pgold`; URL `postgresql://close_knit@127.0.0.1:5434/close_knit`).
  - Only create and fill your own new tables.
  - Never alter or delete existing tables or release rows.
- Demo mode must keep working: the BFF route falls back to small fixtures when `CLOSE_KNIT_API_URL` is unset.
- Missing data shows "unknown", never 0.

## UI and copy
- Our own wording and layout, never area360's text, branding or rating rules.
- Plain words a newcomer understands. Method detail goes behind `<HelpTip>`.
- Every button styled (`e2e/unstyled-controls.spec.ts`), with 44px targets.
- Check the result at 1280×720 and 375×812.

## Tests
- API: `cd api && uv run --extra test --with pytest python -m pytest -q`
- Web: `cd web && npm ci --prefer-offline && npm test && npm run typecheck`.
- E2E: `PLAYWRIGHT_TEST_PORT=<your port> npx playwright test <your specs>`.
- Ports: F 4311 · G 4312 · H 4313 · I 4314 · J 4315 · K 4316 · L 4317 · M 4318.

## Finish
- Commit on your branch. The message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Handoff in at most 180 words:
  - branch and commit
  - what changed
  - actual test results
  - where components mount
  - new guide topics
  - downloads made, with licences
  - open issues
