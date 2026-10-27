# Baseline failure classification (UX-66)

Live baseline on `306c592`, 2026-09-07, via `cd web &&
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/pw-browsers npm run baseline`
(equivalent: `npx playwright test --workers=1 --max-failures=12` with that env).

Verdict `existing-failures`: 144 discovered, 40 passed, 12 failed, early stop,
90 unrun. Each of the 12 failures below was confirmed in this run before
classifying; no failure is taken on trust from an earlier audit.

## Categories

- `product regression` — the product broke its own contract; fix the product.
- `intentional contract change` — the product changed deliberately and the test
  pins the old contract; update the test to the new contract.
- `brittle locator` — the test locates the wrong role or an ambiguous name
  while the rendered state is correct; repair the locator.
- `stale fixture` — the test pins outdated data, copy, or array shapes while
  the current response is the intended one; refresh the expectation.
- `environment/setup failure` — browsers, server, or machine fault, not app
  behavior. None of the 12 falls here: the server and browsers ran, 40 passed.

## Evidence

Regenerate run artifacts any time with the command above. Per-failure Playwright
traces and error snapshots land under the gitignored
`web/test-results/<slug>-desktop/` directories
(`trace.zip`, `error-context.md`); the full log, JSON report, and versioned
summary land under `web/test-results/baseline-ux-01/`
as `baseline.log`, `report.json`, and `summary.json`. Those directories are
deliberately not checked in. The evidence column therefore pairs each
regenerable artifact path with the checked-in spec file that pins the failed
expectation.

## Classification

| # | Spec | Test title | Category | Observed failure signature | Evidence | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | e2e/api-contracts.spec.ts:3 | v1 endpoints expose versioned public contracts | intentional contract change | toMatchObject diff: expected englandPercentile 98, received null for price-per-square-metre on uk:lsoa:E01000001; the schema allows null and fixtures deliberately return null here | web/e2e/api-contracts.spec.ts; web/test-results/api-contracts-v1-endpoints-expose-versioned-public-contracts-desktop/trace.zip | UX-67 |
| 2 | e2e/api-contracts.spec.ts:94 | school and forecast evidence remain sourced and non-probabilistic | stale fixture | toMatchObject received 57 extra lines: the school array now carries more schools than the pinned single-entry shape, including closed Old Town Primary Preview (uk:school:100003); the extra entries stay sourced and non-probabilistic | web/e2e/api-contracts.spec.ts; web/test-results/api-contracts-school-and-f-5d368-urced-and-non-probabilistic-desktop/trace.zip | UX-67 |
| 3 | e2e/decision-brief.spec.ts:87 | selects candidates, previews a sourced brief, toggles private fields, and exports readable markdown | product regression | strict mode violation in the shared addKnownCandidate helper: getByLabel Price unit resolves to 2 elements, the Price units group and the Price unit select. That signature no longer reproduces after UX-61 unique accessible names; on origin/main this test fails at the stale release pin (spec:105). With the UX-67 pin fixed, the preview renders and the redaction assertion fails instead: the Open questions commute prompt names the precise destination while redacted, because viewing-checklist commute-trial text carries destination.label into openQuestionsSection, which takes no redaction input (needsSection redacts correctly). Pre-existing product behavior unmasked by the pin fix, kept failing per UX-67 scope | web/e2e/decision-brief.spec.ts; web/test-results/decision-brief-selects-can-8ae07-d-exports-readable-markdown-desktop/trace.zip | UX-73 |
| 4 | e2e/decision-brief.spec.ts:154 | an unavailable comparison is stated explicitly and an empty brief is refused | product regression | same helper, same strict mode violation on getByLabel Price unit resolving to 2 elements before any brief assertion runs. That signature no longer reproduces after UX-61 unique accessible names: this test passes on origin/main and with the UX-67 pins, so the row is kept as baseline history with no fix needed | web/e2e/decision-brief.spec.ts; web/test-results/decision-brief-an-unavaila-085fb-d-an-empty-brief-is-refused-desktop/trace.zip | UX-61 |
| 5 | e2e/explorer.spec.ts:202 | operates rent, a place, schools and explicit sharing | intentional contract change | hash stays empty against the expected profile v1 prefix after Share profile: the Review before sharing dialog is open and Confirm share is never operated, and nothing is shared until confirmed. Fixed by UX-68: the spec now operates the dialog (asserts empty hash, exercises Cancel share, then Confirm share), verifies the clipboard holds the same fragment URL, and round-trips the fragment back into the wizard Needs stage; passes on desktop | web/e2e/explorer.spec.ts; web/test-results/explorer-operates-directio-96329-hoices-and-explicit-sharing-desktop/trace.zip | UX-68 |
| 6 | e2e/explorer.spec.ts:237 | sharing a profile survives clipboard denial | intentional contract change | same unoperated confirmation boundary: hash stays empty after Share profile, so the clipboard-denial fallback is never reached. Fixed by UX-68: the spec now confirms through the dialog with clipboard denied, asserts the same fragment is set with no page errors, and reloads the fragment; passes on desktop | web/e2e/explorer.spec.ts; web/test-results/explorer-sharing-a-profile-survives-clipboard-denial-desktop/trace.zip | UX-68 |
| 7 | e2e/noise-context.spec.ts:20 | a corridor gap never renders as a quietness guarantee | stale fixture | expected copy not a quietness guarantee; rendered copy is outside the pilot road-noise boxes: noise exposure is unknown here, not quiet, which keeps the honest unknown meaning with new wording | web/e2e/noise-context.spec.ts; web/test-results/noise-context-a-corridor-g-e7719-rs-as-a-quietness-guarantee-desktop/trace.zip | UX-67 |
| 8 | e2e/official-geography.spec.ts:9 | official code search selects the area and keeps it on reload | brittle locator | 30 s timeout waiting for a button named Westminster, London while the failure snapshot shows the listbox rendered option SW1A 1AA Westminster, London with 1 areas found; results carry role option, never role button | web/e2e/official-geography.spec.ts; web/test-results/official-geography-officia-79381-area-and-keeps-it-on-reload-desktop/trace.zip | UX-14 |
| 9 | e2e/planning-context.spec.ts:45 | stale and unverified entries fail honestly, and empty searches name the covered dataset | stale fixture | expected reference 2026/0123/P; rendered results list 24/05110/FULL, 25/08711/FULL, and 26/01024/FULL, so the pinned reference no longer exists in the current dataset | web/e2e/planning-context.spec.ts; web/test-results/planning-context-stale-and-3b914-es-name-the-covered-dataset-desktop/trace.zip | UX-67 |
| 10 | e2e/rendering.spec.ts:9 | MapLibre worker loads analytics geometry | product regression | Map ready renders but window dot __closeKnitDiagnostics is undefined when reading sourceAreaCount, even with diagnostics set to 1 in the URL. Fixed by UX-69: the analytics refresh now re-issues after map load (single-shot mount refresh raced style load and never retried), navigation preserves the diagnostics flag it used to strip, and the spec polls null-safe with cold-start patience; passes on desktop | web/e2e/rendering.spec.ts; web/test-results/rendering-MapLibre-worker-loads-analytics-geometry-desktop/trace.zip | UX-69 |
| 11 | e2e/rendering.spec.ts:30 | style updates stay within the 10 ms p95 frame-work budget | product regression | same missing diagnostics object when reading measureStyleUpdate, so no p95 is ever measured; the budget assertion itself belongs to UX-70 and stays environment-sensitive once measurable. Fixed by UX-69: object installs on demand and the spec waits null-safe; measured p95 0.00ms on desktop, UX-70 re-verifies | web/e2e/rendering.spec.ts; web/test-results/rendering-style-updates-st-ddefe-10-ms-p95-frame-work-budget-desktop/trace.zip | UX-69 |
| 12 | e2e/rendering.spec.ts:86 | desktop overview is visually stable | product regression | waitForMapPaint fails reading renderedAreaCount off the same undefined diagnostics object, so the screenshot comparison is never reached; the visual baseline itself belongs to UX-71. UX-69 update: diagnostics now install and the paint gate passes, so the test reaches the screenshot and fails on the stale baseline (0.04 pixel ratio vs 0.015 allowed); baseline renewal stays with UX-71. Fixed by UX-71: all four inspected actuals show only intended programme changes (mode selector, area labels, evidence tabs, honest unknown states, provenance) with no volatile data, and baselines were renewed once; passes on desktop | web/e2e/rendering.spec.ts; web/test-results/rendering-desktop-overview-is-visually-stable-desktop/trace.zip | UX-71 |
