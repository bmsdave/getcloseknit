# Priorities and delivery plan

**Recommendation:** finish a small trustworthy real-data service, then prove that budget, commute, and explicit area comparisons help London households make a better shortlist. Treat the backlog as a sequenced investment portfolio, not 36 features promised for one release.

## Priority policy

- **P0 — release blockers or immediate learning:** correctness, source eligibility, reproducibility, privacy, usable real London, and validation of the product proposition. An attractive UI does not compensate for a failure here.
- **P1 — core decision value:** achieved prices, rental affordability, property evidence, commute, comparison, costs, diligence, and the output a household can act on. Implement after the relevant foundation is stable.
- **P2 — conditional expansion:** noise, amenities, planning, forecasts, and agent integration. These remain valuable options, but should not delay proof of the primary workflow.

Within a tier, choose work that directly changes a household decision, unlocks several other tasks, uses obtainable evidence, and can be validated cheaply. Evidence strength breaks ties: observed code defects and the agreed pilot outrank inferred demand from overseas studies. Do not manufacture a numerical ROI score without adoption, acquisition-cost, retention, or pricing data. Task numbers are reference IDs and a reading order, not a strict execution order; follow explicit dependencies.

Effort labels are rough active engineering estimates for a single contributor familiar with the stack: **S = 2–4 days, M = 5–10 days, L = 11–20 days**. They include focused implementation and acceptance, but exclude waiting for access, publisher fixes, recruitment, or procurement. L-sized tasks should be split into testable slices after inspecting actual source schemas. Do not sum these into a promised delivery date. No budget or staffing assumption was supplied.

## Delivery waves and exit decisions

| Wave | Scope | Exit evidence | Decision |
|---|---|---|---|
| Start now: foundations and discovery | AE-01, AE-02, AE-09, AE-34; reproduce AE-08 and draft its shared cases | Trustworthy test setup, source decisions, privacy boundary, user-study protocol, observed scorer regression | Continue only with a concrete eligible source path; use discovery to refine the next wave. |
| A: official crime pilot | AE-03 → AE-04 → AE-05 → AE-06 → AE-07; AE-08 implementation after release contract; AE-31 and AE-32 before release | Real London search/selection and a validated crime window, explicit missing layers, coherent release and rollback, correct matching, usable mobile journey | Complete the existing pilot acceptance. Do not claim the buyer/renter proposition is validated yet. |
| B: shortlist value | AE-10 → AE-11 → AE-12/AE-13 → AE-14; AE-15 → AE-16; AE-17; AE-18 → AE-27 | Achieved-price and rent screening, reliable property facts, real commute assumptions, evidence-backed side-by-side shortlist | Test whether users can explain a shortlist and understand missing/coarse evidence. Keep unvalidated estimates suppressed. |
| C: decision and diligence | AE-29 after identity/dossier work; AE-19 after candidates/preferences; AE-20; AE-21 → AE-22; AE-23; AE-28 → AE-30 | Enter a candidate, compare total cost, identify lease/school/environment unknowns, record visits, export a sourced brief | Expand only where observed decisions benefit. Pilot sources with limited coverage before London-wide claims. |
| D: targeted expansion | AE-24, AE-25, AE-26, AE-33, AE-36 | Source coverage and user-value evidence for the selected feature; horizon validation for forecasts | Ship individually on merit; stopping a feature after a failed experiment is a valid outcome. |
| Contract maintenance alongside waves | AE-35 whenever public shapes change | TypeScript, Swift, and Kotlin shared fixtures decode compatibly | Keep native compatibility without making full UI parity a prerequisite for web learning. |

Dependencies in task files are prerequisites for final acceptance, not prohibitions on preparing fixtures, schemas, or study materials early. AE-34 can start immediately; its findings should inform AE-16, AE-18, and AE-30. Implementations do not require the blocked supervised agent runtime unless that specific execution plan is chosen. This package authorizes no fleet dispatch, external messaging, paid data purchase, or publishing action.

## Launch scope and stop rules

A pilot launch should promise official area boundaries and covered recorded-crime evidence. It must disclose absent datasets. A useful home-moving beta should additionally demonstrate achieved-price/rent affordability, real commute screening, comparison, and a next-step checklist; selecting every P1 feature is not required before testing that journey.

Keep estimates unavailable if identity confidence, sample adequacy, or validation fails. Keep individual data families unpublished if their permitted use or geography reconciliation is unresolved. If user sessions show that additional metrics confuse rather than improve shortlist reasoning, simplify before adding more layers. If the user-entered-candidate workflow is sufficient, defer listing partnerships. If real commute delivery proves too costly, test a clearly labelled external route-check workflow before widening infrastructure scope; do not replace it with synthetic durations.

## Measures that determine whether to continue

The following are proposed measures, not current results or externally proven success thresholds. Establish a baseline in AE-34 and agree thresholds before the corresponding pilot.

| Outcome | Proposed measure | Interpretation |
|---|---|---|
| Trust | Share of participants who correctly explain achieved vs asking price, source carrier, and missing evidence | Misunderstanding blocks confident product claims even when task completion is high. |
| Decision usefulness | Participants who can explain a trade-off and identify a concrete next investigation | Prefer demonstrated reasoning over satisfaction with a visually attractive map. |
| Efficiency | Time and external tabs needed to reach a defensible shortlist, compared with participants’ usual process | A faster task is useful only if comprehension and evidence quality do not deteriorate. |
| Adoption | Voluntary return to a saved shortlist and use of the comparison/brief during an actual move | Treat stated intent separately from observed reuse. |
| Commercial potential | Explicit willingness to pay, requested output, and reasons for refusal | A small qualitative sample cannot establish conversion or a market size. |
| Data integrity | Missing joins, suppressed areas, stale releases, source disagreement, rollback success | Track by geography and property type; aggregate averages can hide exclusion. |
| Operations | Failed refreshes, evidence-request failures, readiness, and measured frame work | Preserve a last usable release and report genuine unavailable states. |

Use opt-in redacted telemetry already supported by the project; do not collect raw profiles to populate this table. Business-model hypotheses to test include a paid one-off decision brief or enhanced comparison. There is not enough evidence here to select a price, claim users will pay, or prioritize agent lead generation. Avoid a business model that biases recommendations before trust is established.

<a id="acceptance"></a>
## Common acceptance gate

Every implementation task follows project engineering rules (former monorepo) and the vision (former monorepo). Start each behavioural change with a focused test, observe the intended failure, implement the smallest change, then run the relevant suite. A regression must discriminate against the original defect. Controls are covered by operating them and asserting their effect. Remove superseded paths, tests, and dependencies in the same change; avoid duplicating existing algorithms.

For web changes, inspect the applicable [web instructions](../../web/AGENTS.md), then run `npm test`, `npm run typecheck`, `npm run build`, and the relevant Playwright journeys from `web`. Execute the relevant full suite once the touched files are stable. Browser-facing changes need interaction/rendering acceptance; unit tests do not replace it. Include clipboard/storage/network denial and missing evidence when relevant. Preserve the established ten-millisecond frame-work requirement with representative data.

For ingestion changes, start with the dependency-free pipeline command `python3 -m unittest discover -s tests -v` from `pipelines/area-analytics-ingest`, and use the package’s declared runtime/dependencies for any added adapters. Run API, database, and cross-platform checks appropriate to changed contracts. Use deterministic government-shaped fixtures in tests; test with local pipeline cache present and moved aside where behavior depends on it. Restore the cache safely after the check. Downloads stay outside Git. Record skipped checks and actual errors explicitly.

A task is accepted when its observable outcome, source eligibility, failure states, relevant tests, and cleanup are independently reviewed. A populated table, schema, route, or passing label-only test is insufficient. This documentation package itself is verified by word-count, dependency, local-link, and scope checks; no application behavior is changed here.
