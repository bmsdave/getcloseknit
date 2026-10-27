# UX-67 — Update stale contract fixtures

**Priority:** P0  
**Delivery wave:** Wave 6  
**Execution lane:** stabilization  
**Parallel safety:** May start in its named lane when all dependencies are merged; do not run beside another task claiming the same primary files.  
**Dependencies:** [UX-13 — Add a data-trust test matrix](13-add-a-data-trust-test-matrix.md); [UX-17 — Handle late search responses](17-handle-late-search-responses.md); [UX-20 — Remove the mobile control collision](20-remove-the-mobile-control-collision.md); [UX-33 — Test the complete wizard](33-test-the-complete-wizard.md); [UX-44 — Test evidence disclosure](44-test-evidence-disclosure.md); [UX-54 — Test two three and four areas](54-test-two-three-and-four-areas.md); [UX-59 — Add a layer overflow affordance](59-add-a-layer-overflow-affordance.md); [UX-65 — Check reduced motion and zoom](65-check-reduced-motion-and-zoom.md); [UX-66 — Classify all 12 browser-suite failures](66-classify-all-12-browser-suite-failures.md)  
**Status:** proposed

## Product context

Release confidence requires a green, meaningful gate after the UX changes. The audit run stopped at twelve failures: some reflected real regressions, while others were stale fixtures, copy assertions, or ambiguous locators.

The intended web journey is **Discover → Set needs → Shortlist → Compare → Inspect → Decide**. This task is deliberately small so one agent can implement, verify, and hand it back without redesigning adjacent work. Its specific contribution is: Update school, planning, percentile, and copy expectations only where the classified current contract is intentional and documented; keep true regressions failing. After completion, users should experience the following observable result: Previously stale assertions pass without weakening semantic checks or hiding missing data.

Preserve the established warm neutral map, dark green controls, yellow accent, serif headings, explicit provenance, and honest unknown states. Visual polish must not hide missing evidence or imply property-level precision from area data.

## Current implementation

The project has unit, API, typecheck, build, browser, coverage, and frame-budget gates. Rendering tests currently expect an unavailable diagnostics object, and snapshots describe the old layouts.

The audited baseline and evidence for this lane are linked below. Inspect the latest merged dependency revision before editing because source locations may move during earlier tasks. Treat the named files as entry points rather than permission to rewrite their surrounding modules. Confirm the current behavior in the browser or focused test before assuming the audit description still reproduces.

## Required implementation

Update school, planning, percentile, and copy expectations only where the classified current contract is intentional and documented; keep true regressions failing.

Implement one state transition and one source of truth for the behavior. Loading, empty, error, unavailable, offline, and stale-response states must remain explicit wherever they apply. Desktop and mobile must use the same domain state even when their presentation differs. Preserve existing URL, profile, shortlist, API, and evidence contracts unless this task explicitly names a presentation-only interface change.

Do not change matching mathematics, evidence values, API schemas, native clients, or unrelated map SDK code. Do not add a second legacy-compatible UI path. If the new behavior replaces markup, CSS, tests, or defaults, remove the replaced path in this task after the new test passes.

## Test-first procedure

1. Add or update the smallest focused test that expresses: Previously stale assertions pass without weakening semantic checks or hiding missing data.
2. Run it against the current implementation and record the expected failure. A caption-only assertion is insufficient when a control is involved; operate the control and assert its effect.
3. Implement the minimum behavior described above.
4. Run the focused command from the web directory: `npm run test:e2e -- --workers=1`.
5. Run `npm test` and `npm run typecheck` before handoff. Run `npm run build` when component boundaries, Next.js behavior, or production bundling changed.
6. Do not update a screenshot merely to make a failure disappear. Inspect the rendered state first and accept a new baseline only in UX-71.

Tests must assert properties that hold with and without local generated data. Keep full logs on disk and summarize only the failing state, passing state, and relevant command.

## Acceptance criteria

- [ ] Previously stale assertions pass without weakening semantic checks or hiding missing data.
- [ ] The focused test was observed failing for the intended reason before implementation and passes afterward.
- [ ] The behavior works with keyboard and pointer input when it exposes a control.
- [ ] The affected state is readable at 1280×720 and 390×844; layout-focused tasks also cover 320×568 and 768×1024.
- [ ] Unknown, unavailable, loading, offline, and stale states remain honest and do not fall back silently.
- [ ] Existing profile, shortlist, shared-link, evidence, and API contracts remain compatible unless explicitly stated.
- [ ] Type checking passes and no test is skipped or weakened to conceal a regression.

## Ownership and integration

**Expected primary files:** [e2e](<../../../web/e2e>); [playwright.config.ts](<../../../web/playwright.config.ts>); [area-map.tsx](<../../../web/src/components/area-map.tsx>); [globals.css](<../../../web/src/app/globals.css>).  
**Focused tests:** [api-contracts.spec.ts](<../../../web/e2e/api-contracts.spec.ts>); [rendering.spec.ts](<../../../web/e2e/rendering.spec.ts>); [explorer.spec.ts](<../../../web/e2e/explorer.spec.ts>).  
**Must merge first:** UX-13, UX-17, UX-20, UX-33, UX-44, UX-54, UX-59, UX-65, UX-66.  
**Direct downstream tasks:** UX-68.

Avoid native iOS and Android code, pipeline code, map SDK v1/v2 work, unrelated untracked files, lockfiles unless dependency changes are explicitly required, and files currently owned by another active lane. If the primary files changed in a dependency, adapt to the merged names and report that fact rather than restoring old structure. The known conflict risk is overlapping edits to the lane's components and global CSS; respect the serial order and rebase before beginning.

## Cleanup and handoff

Remove obsolete fixture literals and brittle whole-array assumptions.

Before handoff, inspect the diff for duplicated state, unreachable branches, stale selectors, comments that restate code, and functions exceeding repository structural limits. The handoff must be no more than 180 words and contain: changed behavior, files changed, the exact failing test observed first, final focused and broader command results, cleanup performed, commit identifier, remaining risk, and paths to any screenshots or logs. Do not claim full completion if browser verification was skipped.

## References

- [Close Knit UX audit](<../../ux-audit-2026-09-06/README.md>)
- [Relevant audit evidence](<../../ux-audit-2026-09-06/README.md>)
- [Close Knit FigJam audit board](https://www.figma.com/board/IXZ3o3iQvyYuyO3neIj0Hz)
- [Related prior Close Knit task](<../../proptech-gap-analysis-2026-09-06/tasks/01-reliable-browser-ci.md>)
- [Close Knit README](<../../../README.md>)
- [Web instructions](<../../../web/AGENTS.md>)
