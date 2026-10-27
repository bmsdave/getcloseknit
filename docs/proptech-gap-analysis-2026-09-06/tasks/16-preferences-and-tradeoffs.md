# AE-16 — Capture real household needs and explain trade-offs

**Priority:** P1 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-08 — Make production matches respond to budget and destinations](08-profile-aware-production-matching.md); [AE-15 — Replace rental affordability fixtures with appropriately coarse evidence](15-rental-affordability.md)

## Problem and intended outcome

The existing nine-factor match is a strong starting point, but the research points to heterogeneous needs, fuzzy preferences, and regret from unnoticed compromises. Income, deprivation, and social-renting statistics are contextual evidence; this report does not infer that they are valid measures of an individual household’s safety, neighbours, or suitability.

## Implementation scope

Extend onboarding to distinguish must-haves, target ranges, and negotiable preferences for buy and rent. Show why an area is excluded and offer explicit user-controlled relaxation without silently crossing a hard limit. Review default factor directions and weights so socioeconomic context does not quietly substitute for directly requested amenities, commute, or costs. Preserve descriptive layers and document any proposed change to existing scoring defaults.

## Acceptance and verification

Write tests before changing profile semantics for conflicting constraints, zero weights, unknown constrained evidence, and relaxing exactly one limit. Browser tests must operate the controls and explain a newly included area. Include user examples where more than one reasonable shortlist exists, and verify the UI describes personal fit rather than an objective best neighbourhood.

**Success evidence:** A household can state its constraints, understand each compromise, and reverse a relaxation while seeing the original evidence.

**Cleanup:** Remove redundant profile fields and implicit proxy-based defaults that the product review does not retain.

## Source files and context

- Main existing files: [preference-panel.tsx](<../../../web/src/components/preference-panel.tsx>); [personal-match-panel.tsx](<../../../web/src/components/personal-match-panel.tsx>); [contracts.ts](<../../../web/src/lib/contracts.ts>); [matching.py](<../../../api/area_api/matching.py>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R3](../03-EVIDENCE-REVIEW.md#r3), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-04 (paper/context): Homebuyers and the representation of spatial markets by information providers (Dunning, Grayson, 2014)](https://eprints.whiterose.ac.uk/id/eprint/97036/); [A-09 (paper/context): How to move home from a stress-resistance theoretical perspective (Phipps, 2018)](https://www.inderscience.com/info/inarticle.php?artid=94805); [A-10 (paper/context): Does the Dream of Home Ownership Rest Upon Biased Beliefs? (Odermatt, Stutzer, 2022)](https://link.springer.com/article/10.1007/s10902-022-00571-w). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
