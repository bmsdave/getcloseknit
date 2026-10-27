# AE-08 — Make production matches respond to budget and destinations

**Priority:** P0 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-01 — Establish a trustworthy product verification gate](01-reliable-browser-ci.md); [AE-04 — Activate and roll back coherent analytics releases](04-atomic-data-releases.md)

## Problem and intended outcome

A direct probe of the production scorer returned the same affordability score, 60, for budgets of £300k–£400k and £600k–£700k against a £500k observation. The web fixture matcher computes profile-specific affordability and commute utilities, but the production path consumes stored utilities. This undermines the core promise of personal matching.

## Implementation scope

Separate reusable raw area evidence from profile-dependent affordability and commute calculations. Define shared input/output examples for market, budget, active destinations, directions, limits, missing evidence, and zero weights. Strengthen request validation for malformed factor entries and unsupported IDs. Use deterministic ranking and retain source/carrier metadata; do not reverse an already personalized affordability utility a second time.

## Acceptance and verification

Write a failing regression where changing only budget changes eligibility or utility, then another where changing an active destination changes commute results. Compare Python and TypeScript outputs on shared contract fixtures, including missing constrained factors and tied scores. A browser test must move budget and destination controls and assert changed results, rather than checking their labels.

**Success evidence:** All supported profile controls affect the intended production outcome and shared examples produce equivalent scores across implementations.

**Cleanup:** Remove stored profile-specific utility shortcuts and redundant scoring branches once shared behavior is proven.

## Source files and context

- Main existing files: [matching.py](<../../../api/area_api/matching.py>); [repository.py](<../../../api/area_api/repository.py>); [test_matching.py](<../../../api/tests/test_matching.py>); [matching.ts](<../../../web/src/lib/matching.ts>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R3](../03-EVIDENCE-REVIEW.md#r3), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-04 (paper/context): Homebuyers and the representation of spatial markets by information providers (Dunning, Grayson, 2014)](https://eprints.whiterose.ac.uk/id/eprint/97036/); [A-03 (forum/context): "First time buyer in London: Tooting/Mitcham v South Norwood?" — MSE Forum](https://forums.moneysavingexpert.com/discussion/6581673/first-time-buyer-in-london-tooting-mitcham-v-south-norwood). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
