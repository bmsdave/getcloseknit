# AE-22 — Show admissions evidence without promising a school place

**Priority:** P1 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-21 — Connect school discovery to dated official observations](21-school-evidence.md)

## Problem and intended outcome

Families can regret choosing an area without understanding school access. Proximity and inspection observations do not establish admission eligibility, and the repository already has admission-evidence primitives that should guide implementation. Published cutoffs can vary by year and priority category, so a simple catchment circle can be misleading.

## Implementation scope

Complete a bounded pilot using a small set of London admission authorities with reusable official publications. Preserve academic year, sibling or other priority rules where published, measured-distance method, priority-area geometry, and source URL. Display historical cutoffs as observations with gaps. Permit a user to shortlist schools and record questions without collecting unnecessary details about children.

## Acceptance and verification

First test conflicting rules, multiple priority groups, missing recent years, and a property just within a historical distance. It must not receive a guaranteed-place claim. Browser tests switch academic year or school, open the authority guidance, and explain why a distance alone is insufficient. Keep unsupported probability estimates unavailable and report pilot-authority coverage.

**Success evidence:** A family can distinguish a nearby school from evidenced historical access and know which current admissions rules to verify.

**Cleanup:** Remove inferred catchment circles and unsupported admission percentages if any are introduced by fixture assumptions.

## Source files and context

- Main existing files: [school_admissions.py](<../../../pipelines/area-analytics-ingest/area_analytics/school_admissions.py>); [test_school_admissions.py](<../../../pipelines/area-analytics-ingest/tests/test_school_admissions.py>); [contracts.ts](<../../../web/src/lib/contracts.ts>); [personal-match-panel.tsx](<../../../web/src/components/personal-match-panel.tsx>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R3](../03-EVIDENCE-REVIEW.md#r3), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [C-03 (paper/context): School quality / catchment premium on UK house prices — DfE](https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/600623/House_prices_and_schools.pdf); [C-04 (forum/context): Buying into a school catchment area deliberately — MSE Forum](https://forums.moneysavingexpert.com/discussion/5065901/buying-home-in-school-catchment-area-then-move-out-3-years-later). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
