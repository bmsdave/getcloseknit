# UX-52 — Keep comparison reactive

**Priority:** P1  
**Delivery wave:** Wave 4  
**Execution lane:** comparison  
**Parallel safety:** Sequential within this lane; start only from a revision containing every dependency.  
**Dependencies:** [UX-51 — Preserve unknown evidence](51-preserve-unknown-evidence.md)  
**Status:** proposed

## Product context

After shortlisting, users need a dedicated comparison surface that explains trade-offs between two to four finalists. The current data model is useful, but selection feedback and presentation obscure the decision.

The intended web journey is **Discover → Set needs → Shortlist → Compare → Inspect → Decide**. This task is deliberately small so one agent can implement, verify, and hand it back without redesigning adjacent work. Its specific contribution is: Recompute rows and conclusions when an area is removed or a preference changes, without closing the dialog or losing scroll/focus context. After completion, users should experience the following observable result: Changed weights update only affected conclusions and stale results do not flash.

Preserve the established warm neutral map, dark green controls, yellow accent, serif headings, explicit provenance, and honest unknown states. Visual polish must not hide missing evidence or imply property-level precision from area data.

## Current implementation

PersonalMatchPanel renders ranked cards, detached Compare rows, and the comparison panel in the same narrow scroll. The comparison library already preserves releases, unknowns, scores, and conclusions.

The audited baseline and evidence for this lane are linked below. Inspect the latest merged dependency revision before editing because source locations may move during earlier tasks. Treat the named files as entry points rather than permission to rewrite their surrounding modules. Confirm the current behavior in the browser or focused test before assuming the audit description still reproduces.

## Required implementation

Recompute rows and conclusions when an area is removed or a preference changes, without closing the dialog or losing scroll/focus context.

Implement one state transition and one source of truth for the behavior. Loading, empty, error, unavailable, offline, and stale-response states must remain explicit wherever they apply. Desktop and mobile must use the same domain state even when their presentation differs. Preserve existing URL, profile, shortlist, API, and evidence contracts unless this task explicitly names a presentation-only interface change.

Do not change matching mathematics, evidence values, API schemas, native clients, or unrelated map SDK code. Do not add a second legacy-compatible UI path. If the new behavior replaces markup, CSS, tests, or defaults, remove the replaced path in this task after the new test passes.

## Test-first procedure

1. Add or update the smallest focused test that expresses: Changed weights update only affected conclusions and stale results do not flash.
2. Run it against the current implementation and record the expected failure. A caption-only assertion is insufficient when a control is involved; operate the control and assert its effect.
3. Implement the minimum behavior described above.
4. Run the focused command from the web directory: `npm run test:e2e -- e2e/explorer.spec.ts e2e/decision-brief.spec.ts e2e/shortlists.spec.ts --workers=1`.
5. Run `npm test` and `npm run typecheck` before handoff. Run `npm run build` when component boundaries, Next.js behavior, or production bundling changed.
6. Do not update a screenshot merely to make a failure disappear. Inspect the rendered state first and accept a new baseline only in UX-71.

Tests must assert properties that hold with and without local generated data. Keep full logs on disk and summarize only the failing state, passing state, and relevant command.

## Acceptance criteria

- [ ] Changed weights update only affected conclusions and stale results do not flash.
- [ ] The focused test was observed failing for the intended reason before implementation and passes afterward.
- [ ] The behavior works with keyboard and pointer input when it exposes a control.
- [ ] The affected state is readable at 1280×720 and 390×844; layout-focused tasks also cover 320×568 and 768×1024.
- [ ] Unknown, unavailable, loading, offline, and stale states remain honest and do not fall back silently.
- [ ] Existing profile, shortlist, shared-link, evidence, and API contracts remain compatible unless explicitly stated.
- [ ] Type checking passes and no test is skipped or weakened to conceal a regression.

## Ownership and integration

**Expected primary files:** [personal-match-panel.tsx](<../../../web/src/components/personal-match-panel.tsx>); [area-comparison.tsx](<../../../web/src/components/area-comparison.tsx>); [area-comparison.ts](<../../../web/src/lib/area-comparison.ts>); [globals.css](<../../../web/src/app/globals.css>).  
**Focused tests:** [explorer.spec.ts](<../../../web/e2e/explorer.spec.ts>); [decision-brief.spec.ts](<../../../web/e2e/decision-brief.spec.ts>); [shortlists.spec.ts](<../../../web/e2e/shortlists.spec.ts>).  
**Must merge first:** UX-51.  
**Direct downstream tasks:** UX-53.

Avoid native iOS and Android code, pipeline code, map SDK v1/v2 work, unrelated untracked files, lockfiles unless dependency changes are explicitly required, and files currently owned by another active lane. If the primary files changed in a dependency, adapt to the merged names and report that fact rather than restoring old structure. The known conflict risk is overlapping edits to the lane's components and global CSS; respect the serial order and rebase before beginning.

## Cleanup and handoff

Remove cached comparison state that duplicates derivable profile data.

Before handoff, inspect the diff for duplicated state, unreachable branches, stale selectors, comments that restate code, and functions exceeding repository structural limits. The handoff must be no more than 180 words and contain: changed behavior, files changed, the exact failing test observed first, final focused and broader command results, cleanup performed, commit identifier, remaining risk, and paths to any screenshots or logs. Do not claim full completion if browser verification was skipped.

## References

- [Close Knit UX audit](<../../ux-audit-2026-09-06/README.md>)
- [Relevant audit evidence](<../../ux-audit-2026-09-06/screenshots/05-area-comparison-desktop.png>)
- [Close Knit FigJam audit board](https://www.figma.com/board/IXZ3o3iQvyYuyO3neIj0Hz)
- [Related prior Close Knit task](<../../proptech-gap-analysis-2026-09-06/tasks/18-area-comparison.md>)
- [Close Knit README](<../../../README.md>)
- [Web instructions](<../../../web/AGENTS.md>)
