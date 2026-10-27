# Close Knit web UX remediation task pack

This pack translates the [6 September 2026 UX audit](../ux-audit-2026-09-06/README.md) and [FigJam board](https://www.figma.com/board/IXZ3o3iQvyYuyO3neIj0Hz) into 74 small, agent-ready tasks. Scope is the Close Knit web product only. The accepted journey is **Discover → Set needs → Shortlist → Compare → Inspect → Decide**.

The release goal is a trustworthy product in which Real mode never renders preview evidence, search commits cleanly, preference setup works from 320px upward, comparison remains readable for two to four areas, evidence progresses from summary to detail, and the complete verification gate passes.

## Operating rules

Read [AGENT-INSTRUCTIONS.md](AGENT-INSTRUCTIONS.md) before assigning work and [EXECUTION-WAVES.md](EXECUTION-WAVES.md) before running tasks concurrently. Each agent starts from a clean worktree containing all dependencies, watches the focused test fail first, implements only its task, removes the replaced path, and returns a bounded evidence handoff. The orchestrator reviews and merges in dependency order.

## Priorities

- **P0:** data trust, search correctness, broken responsive layouts, baseline classification, and the release gate.
- **P1:** staged preferences, evidence architecture, comparison, and map context.
- **P2:** copy, semantics, targets, focus, contrast, reduced motion, and zoom.

## Task index

- [UX-01 — Create an isolated implementation worktree](tasks/01-isolated-implementation-worktree.md) · P0 · Wave 0 · baseline
- [UX-02 — Add a real-mode browser regression](tasks/02-add-a-real-mode-browser-regression.md) · P0 · Wave 1A · trust
- [UX-03 — Add a fixture-leak regression](tasks/03-add-a-fixture-leak-regression.md) · P0 · Wave 1A · trust
- [UX-04 — Require data-mode inputs in LayerPicker](tasks/04-require-data-mode-inputs-in-layerpicker.md) · P0 · Wave 1A · trust
- [UX-05 — Wire the controller into the layer picker](tasks/05-wire-the-controller-into-the-layer-picker.md) · P0 · Wave 1A · trust
- [UX-06 — Add a visible mode selector](tasks/06-add-a-visible-mode-selector.md) · P0 · Wave 1A · trust
- [UX-07 — Require mode and release in EvidencePanel](tasks/07-require-mode-and-release-in-evidencepanel.md) · P0 · Wave 1A · trust
- [UX-08 — Use the guarded evidence request path](tasks/08-use-the-guarded-evidence-request-path.md) · P0 · Wave 1A · trust
- [UX-09 — Reject unavailable real layers before fetching](tasks/09-reject-unavailable-real-layers-before-fetching.md) · P0 · Wave 1A · trust
- [UX-10 — Guard mode switches during requests](tasks/10-guard-mode-switches-during-requests.md) · P0 · Wave 1A · trust
- [UX-11 — Make global data labels dynamic](tasks/11-make-global-data-labels-dynamic.md) · P0 · Wave 1A · trust
- [UX-12 — Verify saved and shared state](tasks/12-verify-saved-and-shared-state.md) · P0 · Wave 1A · trust
- [UX-13 — Add a data-trust test matrix](tasks/13-add-a-data-trust-test-matrix.md) · P0 · Wave 1A · trust
- [UX-14 — Introduce committed search state](tasks/14-introduce-committed-search-state.md) · P0 · Wave 1B · search
- [UX-15 — Close results after selection](tasks/15-close-results-after-selection.md) · P0 · Wave 1B · search
- [UX-16 — Add complete dismissal behaviour](tasks/16-add-complete-dismissal-behaviour.md) · P0 · Wave 1B · search
- [UX-17 — Handle late search responses](tasks/17-handle-late-search-responses.md) · P0 · Wave 1B · search
- [UX-18 — Repair preference field layout](tasks/18-repair-preference-field-layout.md) · P0 · Wave 1C · preferences-layout
- [UX-19 — Repair comparison overflow](tasks/19-repair-comparison-overflow.md) · P0 · Wave 1C · comparison-layout
- [UX-20 — Remove the mobile control collision](tasks/20-remove-the-mobile-control-collision.md) · P0 · Wave 1C · map-layout
- [UX-21 — Create the preference wizard shell](tasks/21-create-the-preference-wizard-shell.md) · P1 · Wave 2 · preferences
- [UX-22 — Build the Needs stage](tasks/22-build-the-needs-stage.md) · P1 · Wave 2 · preferences
- [UX-23 — Validate Needs before continuing](tasks/23-validate-needs-before-continuing.md) · P1 · Wave 2 · preferences
- [UX-24 — Build the Priorities stage](tasks/24-build-the-priorities-stage.md) · P1 · Wave 2 · preferences
- [UX-25 — Explain hard limits](tasks/25-explain-hard-limits.md) · P1 · Wave 2 · preferences
- [UX-26 — Build the optional Refine stage](tasks/26-build-the-optional-refine-stage.md) · P1 · Wave 2 · preferences
- [UX-27 — Build the Review stage](tasks/27-build-the-review-stage.md) · P1 · Wave 2 · preferences
- [UX-28 — Preserve progress on Back and Close](tasks/28-preserve-progress-on-back-and-close.md) · P1 · Wave 2 · preferences
- [UX-29 — Keep profile compatibility](tasks/29-keep-profile-compatibility.md) · P1 · Wave 2 · preferences
- [UX-30 — Move profile deletion out of the primary flow](tasks/30-move-profile-deletion-out-of-the-primary-flow.md) · P1 · Wave 2 · preferences
- [UX-31 — Remove total-cost controls from onboarding](tasks/31-remove-total-cost-controls-from-onboarding.md) · P1 · Wave 2 · preferences
- [UX-32 — Remove leasehold checks from onboarding](tasks/32-remove-leasehold-checks-from-onboarding.md) · P1 · Wave 2 · preferences
- [UX-33 — Test the complete wizard](tasks/33-test-the-complete-wizard.md) · P1 · Wave 2 · preferences
- [UX-34 — Add evidence navigation](tasks/34-add-evidence-navigation.md) · P1 · Wave 3 · evidence
- [UX-35 — Build the Overview section](tasks/35-build-the-overview-section.md) · P1 · Wave 3 · evidence
- [UX-36 — Move housing evidence](tasks/36-move-housing-evidence.md) · P1 · Wave 3 · evidence
- [UX-37 — Move environmental evidence](tasks/37-move-environmental-evidence.md) · P1 · Wave 3 · evidence
- [UX-38 — Move planning evidence](tasks/38-move-planning-evidence.md) · P1 · Wave 3 · evidence
- [UX-39 — Create the Property section](tasks/39-create-the-property-section.md) · P1 · Wave 3 · evidence
- [UX-40 — Relocate property diligence](tasks/40-relocate-property-diligence.md) · P1 · Wave 3 · evidence
- [UX-41 — Separate area and property language](tasks/41-separate-area-and-property-language.md) · P1 · Wave 3 · evidence
- [UX-42 — Improve empty evidence states](tasks/42-improve-empty-evidence-states.md) · P1 · Wave 3 · evidence
- [UX-43 — Make evidence close and reopen predictable](tasks/43-make-evidence-close-and-reopen-predictable.md) · P1 · Wave 3 · evidence
- [UX-44 — Test evidence disclosure](tasks/44-test-evidence-disclosure.md) · P1 · Wave 3 · evidence
- [UX-45 — Move Compare into result cards](tasks/45-move-compare-into-result-cards.md) · P1 · Wave 4 · comparison
- [UX-46 — Add a comparison tray](tasks/46-add-a-comparison-tray.md) · P1 · Wave 4 · comparison
- [UX-47 — Enforce selection bounds](tasks/47-enforce-selection-bounds.md) · P1 · Wave 4 · comparison
- [UX-48 — Create the comparison dialog](tasks/48-create-the-comparison-dialog.md) · P1 · Wave 4 · comparison
- [UX-49 — Build the desktop comparison table](tasks/49-build-the-desktop-comparison-table.md) · P1 · Wave 4 · comparison
- [UX-50 — Build mobile comparison cards](tasks/50-build-mobile-comparison-cards.md) · P1 · Wave 4 · comparison
- [UX-51 — Preserve unknown evidence](tasks/51-preserve-unknown-evidence.md) · P1 · Wave 4 · comparison
- [UX-52 — Keep comparison reactive](tasks/52-keep-comparison-reactive.md) · P1 · Wave 4 · comparison
- [UX-53 — Preserve decision outputs](tasks/53-preserve-decision-outputs.md) · P1 · Wave 4 · comparison
- [UX-54 — Test two three and four areas](tasks/54-test-two-three-and-four-areas.md) · P1 · Wave 4 · comparison
- [UX-55 — Emphasize the selected geography](tasks/55-emphasize-the-selected-geography.md) · P1 · Wave 5 · map
- [UX-56 — Add area labels to deterministic map data](tasks/56-add-area-labels-to-deterministic-map-data.md) · P1 · Wave 5 · map
- [UX-57 — Document map colour meaning in the UI](tasks/57-document-map-colour-meaning-in-the-ui.md) · P1 · Wave 5 · map
- [UX-58 — Keep the active mobile layer visible](tasks/58-keep-the-active-mobile-layer-visible.md) · P1 · Wave 5 · map
- [UX-59 — Add a layer overflow affordance](tasks/59-add-a-layer-overflow-affordance.md) · P1 · Wave 5 · map
- [UX-60 — Centralize ordinal formatting](tasks/60-centralize-ordinal-formatting.md) · P2 · Wave 5 · accessibility
- [UX-61 — Remove ambiguous accessible names](tasks/61-remove-ambiguous-accessible-names.md) · P2 · Wave 5 · accessibility
- [UX-62 — Normalize interactive targets](tasks/62-normalize-interactive-targets.md) · P2 · Wave 5 · accessibility
- [UX-63 — Check focus order and dialog behaviour](tasks/63-check-focus-order-and-dialog-behaviour.md) · P2 · Wave 5 · accessibility
- [UX-64 — Check colour contrast](tasks/64-check-colour-contrast.md) · P2 · Wave 5 · accessibility
- [UX-65 — Check reduced motion and zoom](tasks/65-check-reduced-motion-and-zoom.md) · P2 · Wave 5 · accessibility
- [UX-66 — Classify all 12 browser-suite failures](tasks/66-classify-all-12-browser-suite-failures.md) · P0 · Wave 0 · baseline
- [UX-67 — Update stale contract fixtures](tasks/67-update-stale-contract-fixtures.md) · P0 · Wave 6 · stabilization
- [UX-68 — Repair profile-sharing coverage](tasks/68-repair-profile-sharing-coverage.md) · P0 · Wave 6 · stabilization
- [UX-69 — Restore rendering diagnostics on demand](tasks/69-restore-rendering-diagnostics-on-demand.md) · P0 · Wave 6 · stabilization
- [UX-70 — Retain the ten millisecond frame budget](tasks/70-retain-the-ten-millisecond-frame-budget.md) · P0 · Wave 6 · stabilization
- [UX-71 — Update visual baselines once](tasks/71-update-visual-baselines-once.md) · P0 · Wave 6 · stabilization
- [UX-72 — Delete replaced UI paths](tasks/72-delete-replaced-ui-paths.md) · P0 · Wave 6 · stabilization
- [UX-73 — Run the complete gate](tasks/73-run-the-complete-gate.md) · P0 · Wave 6 · stabilization
- [UX-74 — Repeat the full audited journey manually](tasks/74-repeat-audited-journey.md) · P0 · Wave 6 · stabilization

## Success evidence

Completion requires all 74 tasks to be merged, the full Playwright suite to run without an early-stop option, unit/API/typecheck/build/coverage gates to pass, the 10ms p95 rendering budget to hold, and the audited desktop/mobile journey to be repeated manually. See [VALIDATION.md](VALIDATION.md) for task-pack validation and UX-73/UX-74 for product release evidence.
