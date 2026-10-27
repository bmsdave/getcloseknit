# UK Property Intelligence Infrastructure — plan

## Goal

Reposition the product from "AI property map" to "Bloomberg/Stripe for UK
property intelligence": a machine-consumable API (+ MCP tools) serving
structured facts and derived analytics with evidence, where the map is one
client among others (ChatGPT/Astra-style agents, other startups, lenders,
conveyancers). Optimise for agent consumption (AEO) from day one: every
answer carries value, confidence, evidence, and sources so a foreign agent
can reason on top of it and explain it.

## Success Criteria

- All five killer signals (valuation/comparables, school-admission
  likelihood, planning/extension potential, commute accessibility,
  property/location risk) are callable over versioned REST and MCP, each
  response in the evidence-envelope shape, each backed by a validated
  release in the existing ceremony.
- The map consumes the same public API as any external agent (no private
  shortcuts); a foreign agent can reproduce anything the map shows.
- Stable property/area URLs serve structured HTML + JSON-LD with
  evidence citations; plugin/connector metadata is published for
  directory discovery.
- Bulk snapshots ship with manifests; usage is keyed and metered.

## Context And Current Facts

- Serving API today (`api/area_api/app.py`) is
  area-level only: `health`, `metrics`, `search`, `geometry`, `area`,
  `value-pack`, `matches`. No property-level endpoints, no versioning,
  no auth, no MCP.
- Validated data underneath: PostGIS release ceremony (`deploy/schema.sql`:
  `source_release` / `product_release` / `activate_product_release`,
  immutable history, sha256 + licence + caveats); crime live, price
  (Price Paid × EPC, rolling 12m £/m²) built.
- Pipeline (`pipelines/area-analytics-ingest/area_analytics/`) already
  owns deterministic transforms with 255 tests: `price_paid`,
  `valuation`, `property_history` / `property_identity` /
  `property_dossier`, `school_admissions` / `school_evidence` /
  `school_scoring`, `forecasting`, `flood_screening`, `scoring`,
  `peers`, plus `sources.py` acquisition catalogue with fixtures.
  Gaps: no journeys/transport module, no noise module, no planning
  module (`research/traveltime.md`, `research/noise-map.md`,
  `research/extrium.md` are research only).
- Web (`web`) has no JSON-LD, no stable
  property URLs, no per-listing pages.
- Repo gates that bind this work: `AGENTS.md` (TDD, typecheck is part of
  the gate, coverage ratchet via `scripts/check-coverage.sh`,
  10 ms frame budget, e2e for UI surfaces).

## Constraints And Non-goals

- UK only; England/Wales sources first (EPC, Price Paid, ONS).
- No listings aggregation and no buyer-agent browsing: portals and
  Astra own search; we own computation over owned/indexed data.
- No new UI beyond one thin property/area page per stable URL (the
  AEO surface) — the existing map stays the demo client.
- Derived signals only where evidence can be shown; a bare score with
  no citations is a non-goal (it is exactly what a foreign agent cannot
  use).
- Privacy: signals carry no personal data; consent-gated analytics
  stay as they are.

## Key Decisions

1. **MCP + REST, not MCP instead of REST.** MCP is the open standard
   agents already speak (Claude, ChatGPT, VS Code, Cursor all support
   it), and OpenAI publishes plugins as skills + MCP servers + optional
   UI with an explicit "build an MCP server" path. REST remains for
   bulk clients, webhooks, and non-agent integrators. Both bind to the
   same handlers and the same release pins, so the two surfaces cannot
   disagree.
2. **Evidence envelope is the product contract.** Every signal returns
   `{value, confidence, evidence[], sources[]}` (evidence = counts,
   precedents, addresses, decisions; sources = named releases with
   versions). Rejected alternative: bare scores — cheaper to serve,
   useless to an agent that must explain itself.
3. **Reuse the release ceremony for every new signal.** New datasets
   enter through `source_release`/`product_release` with manifests and
   validation records, exactly like crime and price. No sidecar stores.
4. **Signal order follows data readiness, not hype:** valuation →
   schools → commute → risk → planning. Planning/extension potential
   is the strongest moat and the biggest build (a spatial index of
   planning decisions); it goes last so earlier signals fund it.
5. **Buy commute computation, build the rest.** Travel-time routing is
   commodity (researched provider exists); the moat is admission
   probability, valuation vs comparables, and planning precedents.
6. **The map becomes a client late (Unit 8), not first:** the API
   serves agents first, then the map is re-pointed at the public surface
   to prove parity.

## Recommended Approach

Thin vertical slices per signal, each slice shippable: source →
release → REST → MCP tool → envelope test → docs/metadata. No
horizontal "platform first" phase; the existing FastAPI app,
PostGIS ceremony, and pipeline test suites carry the weight.

## Work Plan

- **Unit 1 — API contract + versioning.** Freeze the evidence envelope
  (JSON schema + contract tests); version the public surface
  (`/v2`, v1 stays for the map until cutover); API keys + per-key
  metering skeleton; rate limits and caching headers. Reuse: current
  FastAPI app, `_map_errors` shape, `assertPreferenceProfile`-style
  validators.
- **Unit 2 — MCP server.** One MCP server exposing the area endpoints
  as tools (`search_areas`, `get_area_evidence`, `rank_matches`),
  bound to the same handlers/validators as REST; tool metadata written
  for discovery (names, descriptions, parameter schemas); OpenAI
  plugin packaging + submission checklist. No new analytics.
- **Unit 3 — Valuation/comparables (property-level).** Expose
  `valuation` + `property_history`/`property_identity` by UPRN and by
  normalised address: fair-value estimate + confidence,
  adjusted comparables with per-comparable deltas, asking-vs-value
  gap. Needs: property-resolution endpoint (address → UPRN candidates
  with scores), CPIH-adjusted series (already in pipeline).
- **Unit 4 — School-admission likelihood.** Productise
  `school_admissions`/`school_evidence`/`school_scoring` per address +
  child age: per-school probability, distance/catchment evidence,
  cutoff history. Needs: admissions-cutoff dataset release through
  the ceremony.
- **Unit 5 — Commute accessibility.** New `journeys` pipeline module
  on the researched routing provider with response caching keyed by
  (origin area, destination, arrival window); expose per-address and
  per-area commute evidence. Buy, don't build, the router.
- **Unit 6 — Property/location risk.** Productise `flood_screening`;
  add noise (researched sources) and EPC-derived risks behind the
  same envelope; each risk cites its dataset version.
- **Unit 7 — Planning/extension potential.** New dataset + pipeline
  module: ingest planning applications/decisions, spatial index,
  precedent computation (`rear_extension_probability` from N
  comparable decisions within radius, listed/conservation-area flags).
  Largest unit; split into 7a ingest-index first, 7b probabilities second.
- **Unit 8 — AEO web surface.** One stable URL per property/area with
  server-rendered structured HTML, JSON-LD `RealEstateListing` with
  `Offer`/address markup from the schema.org vocabulary,
  evidence citations linking the release/methodology pages, sitemap.
  Map re-pointed at the public API; parity check agent-vs-map.
- **Unit 9 — Bulk/data API + commercial skeleton.** Versioned bulk
  snapshots with manifests, keyed access, usage metering, directory
  submissions (OpenAI plugin directory + MCP registries as they
  stabilise).

Dependencies: 1 → 2; 1 → 3…7 (independent of each other, in listed
order by default); 8 after 3 (needs a property page subject); 9 after
1 + first signals live.

## Validation Plan

- Units 1–2: contract tests for the envelope (mirroring
  `match-contract` style); `python -m unittest discover` for API and
  pipeline suites; live drill: third-party agent flow replayed by
  hand (search → evidence → rank) against the review stack and
  diffed field-by-field with REST responses.
- Units 3–7: per-signal fixture suites in the pipeline (committed
  fake-address fixtures only, per the acquisition convention);
  release-gate checks (quarantine counts, match rates, sane bands)
  recorded in each validation record; API-level evidence-shape
  tests.
- Unit 8: e2e spec for the property page (renders, JSON-LD parses,
  citations resolve); `npm run typecheck`; rendering-budget spec
  stays green.
- Unit 9: manifest round-trip test (snapshot → fresh DB → identical
  answers); metering smoke test.
- Repo gates throughout: `npm run typecheck`, coverage ratchet,
  no new `allow` suppressions for structural limits.

## Risks / Rollback

- **Planning data cost/coverage.** Council portals are fragmented;
  licensing a commercial planning feed may be required — spike in
  Unit 7a with a go/no-go gate before the index build.
- **Agent-driven load.** Tool responses must be cacheable and cheap;
  per-key rate limits + response caching ship in Unit 1, before any
  directory listing.
- **Directory review requirements** (OpenAI plugin review, registry
  policies) can delay Unit 9 listings — REST + direct MCP distribution
  work without directories, so launch does not block on approval.
- **UPRN coverage gaps** (new builds, conversions): resolution
  endpoint always returns candidates with scores, never a forced
  single match; low-confidence resolutions are labelled, not hidden.
- **Rollback:** releases are immutable and activatable; a bad signal
  release rolls back via `rollback_product_release()` with no code
  deploy. API versioning keeps v1 serving while v2 iterates.

## Open Questions

None blocking. Commercial terms (price points, free tier, SLA) are
deliberately deferred to Unit 9; any reasonable metered-key default
lets Units 1–8 proceed unchanged.

## Sources

- https://modelcontextprotocol.io/docs/getting-started/intro
- https://developers.openai.com/plugins
- https://schema.org/RealEstateListing
