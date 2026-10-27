# UX-03 — Add a fixture-leak regression

**Priority:** P0  
**Delivery wave:** Wave 1A  
**Execution lane:** trust  
**Parallel safety:** Sequential within this lane; start only from a revision containing every dependency.  
**Dependencies:** [UX-02 — Add a real-mode browser regression](02-add-a-real-mode-browser-regression.md)  
**Status:** proposed

## Product context

Close Knit must make Demo and Real data impossible to confuse. The audit proved that a URL requesting real data could render Westminster preview evidence because mode and release were not forwarded to the evidence request.

The intended web journey is **Discover → Set needs → Shortlist → Compare → Inspect → Decide**. This task is deliberately small so one agent can implement, verify, and hand it back without redesigning adjacent work. Its specific contribution is: Return a fixture-shaped payload to a real-mode request and assert that preview releases, preview area names, and fixture values are rejected in favor of an explicit unavailable state. After completion, users should experience the following observable result: A real-mode page never renders preview-* provenance or fixture identities, including after a late response.

Preserve the established warm neutral map, dark green controls, yellow accent, serif headings, explicit provenance, and honest unknown states. Visual polish must not hide missing evidence or imply property-level precision from area data.

## Current implementation

Map state and guarded request helpers already model mode, release, availability, aborts, and fixture rejection. CloseKnit passes these values to personal matching but not consistently to LayerPicker, EvidencePanel, or the global footer.

The audited baseline and evidence for this lane are linked below. Inspect the latest merged dependency revision before editing because source locations may move during earlier tasks. Treat the named files as entry points rather than permission to rewrite their surrounding modules. Confirm the current behavior in the browser or focused test before assuming the audit description still reproduces.

## Required implementation

Return a fixture-shaped payload to a real-mode request and assert that preview releases, preview area names, and fixture values are rejected in favor of an explicit unavailable state.

Implement one state transition and one source of truth for the behavior. Loading, empty, error, unavailable, offline, and stale-response states must remain explicit wherever they apply. Desktop and mobile must use the same domain state even when their presentation differs. Preserve existing URL, profile, shortlist, API, and evidence contracts unless this task explicitly names a presentation-only interface change.

Do not change matching mathematics, evidence values, API schemas, native clients, or unrelated map SDK code. Do not add a second legacy-compatible UI path. If the new behavior replaces markup, CSS, tests, or defaults, remove the replaced path in this task after the new test passes.

## Test-first procedure

1. Add or update the smallest focused test that expresses: A real-mode page never renders preview-* provenance or fixture identities, including after a late response.
2. Run it against the current implementation and record the expected failure. A caption-only assertion is insufficient when a control is involved; operate the control and assert its effect.
3. Implement the minimum behavior described above.
4. Run the focused command from the web directory: `npm run test:e2e -- e2e/explorer.spec.ts --project=desktop --workers=1`.
5. Run `npm test` and `npm run typecheck` before handoff. Run `npm run build` when component boundaries, Next.js behavior, or production bundling changed.
6. Do not update a screenshot merely to make a failure disappear. Inspect the rendered state first and accept a new baseline only in UX-71.

Tests must assert properties that hold with and without local generated data. Keep full logs on disk and summarize only the failing state, passing state, and relevant command.

## Acceptance criteria

- [ ] A real-mode page never renders preview-* provenance or fixture identities, including after a late response.
- [ ] The focused test was observed failing for the intended reason before implementation and passes afterward.
- [ ] The behavior works with keyboard and pointer input when it exposes a control.
- [ ] The affected state is readable at 1280×720 and 390×844; layout-focused tasks also cover 320×568 and 768×1024.
- [ ] Unknown, unavailable, loading, offline, and stale states remain honest and do not fall back silently.
- [ ] Existing profile, shortlist, shared-link, evidence, and API contracts remain compatible unless explicitly stated.
- [ ] Type checking passes and no test is skipped or weakened to conceal a regression.

## Ownership and integration

**Expected primary files:** [close-knit.tsx](<../../../web/src/components/close-knit.tsx>); [layer-picker.tsx](<../../../web/src/components/layer-picker.tsx>); [evidence-panel.tsx](<../../../web/src/components/evidence-panel.tsx>); [use-explorer-controller.ts](<../../../web/src/components/use-explorer-controller.ts>); [map-state.ts](<../../../web/src/lib/map-state.ts>).  
**Focused tests:** [explorer.spec.ts](<../../../web/e2e/explorer.spec.ts>); [api-contracts.spec.ts](<../../../web/e2e/api-contracts.spec.ts>).  
**Must merge first:** UX-02.  
**Direct downstream tasks:** UX-04.

Avoid native iOS and Android code, pipeline code, map SDK v1/v2 work, unrelated untracked files, lockfiles unless dependency changes are explicitly required, and files currently owned by another active lane. If the primary files changed in a dependency, adapt to the merged names and report that fact rather than restoring old structure. The known conflict risk is overlapping edits to the lane's components and global CSS; respect the serial order and rebase before beginning.

## Cleanup and handoff

Remove any expectation that treats fixture fallback as acceptable recovery.

Before handoff, inspect the diff for duplicated state, unreachable branches, stale selectors, comments that restate code, and functions exceeding repository structural limits. The handoff must be no more than 180 words and contain: changed behavior, files changed, the exact failing test observed first, final focused and broader command results, cleanup performed, commit identifier, remaining risk, and paths to any screenshots or logs. Do not claim full completion if browser verification was skipped.

## References

- [Close Knit UX audit](<../../ux-audit-2026-09-06/README.md>)
- [Relevant audit evidence](<../../ux-audit-2026-09-06/screenshots/10-real-mode-conflict-desktop.png>)
- [Close Knit FigJam audit board](https://www.figma.com/board/IXZ3o3iQvyYuyO3neIj0Hz)
- [Related prior Close Knit task](<../../proptech-gap-analysis-2026-09-06/tasks/07-real-demo-separation.md>)
- [Close Knit README](<../../../README.md>)
- [Web instructions](<../../../web/AGENTS.md>)
