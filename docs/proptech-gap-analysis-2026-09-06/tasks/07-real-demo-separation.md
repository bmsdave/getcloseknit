# AE-07 — Make Real data and Demo modes impossible to confuse

**Priority:** P0 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-06 — Connect search and evidence to the production API](06-production-evidence-api.md)

## Problem and intended outcome

The README appropriately labels preview evidence, but a real-data rollout introduces mixed-availability risks: users could open a real crime layer and switch to a synthetic price or school value without recognizing the change. The approved pilot already requires separate modes; make that contract enforceable across every entry point.

## Implementation scope

Add the data mode and release selection to validated map state, navigation, API routing, and explicit sharing. In Real data mode show unavailable states for unpublished layers, matching factors, schools, journeys, and forecasts. Preserve Demo as a useful test and exploration surface with persistent labels. Handle legacy links through a documented default and reject conflicting mode/release combinations.

## Acceptance and verification

Write failing tests for opening a real deep link, switching to an unavailable layer, restoring saved state, and losing the API connection. Operate each transition in desktop and mobile browsers. Assert real requests never return fixture numbers and that stale responses from a prior mode cannot overwrite the current selection.

**Success evidence:** Every analytic value has an unambiguous mode, and unsupported real features stay unavailable throughout navigation and sharing.

**Cleanup:** Remove implicit fallback from failed production requests to preview fixtures and duplicate mode flags.

## Source files and context

- Main existing files: [map-state.ts](<../../../web/src/lib/map-state.ts>); [use-explorer-controller.ts](<../../../web/src/components/use-explorer-controller.ts>); [layer-picker.tsx](<../../../web/src/components/layer-picker.tsx>); [fixtures.ts](<../../../web/src/lib/fixtures.ts>).
- Research rationale: [R2](../03-EVIDENCE-REVIEW.md#r2), [R3](../03-EVIDENCE-REVIEW.md#r3), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-03 (paper/context): Housing Search in the Age of Big Data (Boeing et al., 2020)](https://arxiv.org/abs/2001.11585); [A-11 (paper/context): Key Factors Influencing Purchase or Rent Decisions in Smart Real Estate Investments (Ullah, Sepasgozar, 2020)](https://www.mdpi.com/2071-1050/12/11/4382/). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
