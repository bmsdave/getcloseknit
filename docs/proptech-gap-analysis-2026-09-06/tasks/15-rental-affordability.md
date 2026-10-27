# AE-15 — Replace rental affordability fixtures with appropriately coarse evidence

**Priority:** P1 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-02 — Turn the data catalogue into an enforceable source registry](02-reviewed-source-registry.md); [AE-04 — Activate and roll back coherent analytics releases](04-atomic-data-releases.md); [AE-08 — Make production matches respond to budget and destinations](08-profile-aware-production-matching.md)

## Problem and intended outcome

The product already supports a rent market mode, but its preview affordability uses fixed area rents and derives a borough identifier through string substitution. Renters need quick budget screening, while the planned official evidence is borough-level and may not represent current advertised stock or every bedroom breakdown.

## Implementation scope

Acquire the relevant ONS private-rent publication and verify its actual geographic and bedroom dimensions before defining the release. Preserve source period, statistic type, and publication precision. Resolve LSOA-to-borough relationships from official geography, never identifier substitution. Keep observed aggregate rent separate from user-entered asking rent and calculate rental affordability using monthly units consistently.

## Acceptance and verification

Write failing tests for missing bedroom cells, unsupported LSOA detail, monthly-versus-annual units, and invalid parent IDs. Prove that identical borough evidence does not masquerade as independent neighbourhood estimates. In the browser switch buy/rent, change bedroom and budget inputs, and inspect the carrier warning. Missing evidence must not inherit a purchase-price score.

**Success evidence:** Renters receive useful coarse affordability screening with an explicit explanation of what official averages can and cannot say about available listings.

**Cleanup:** Remove preview rent constants from real mode and replace synthetic geography-ID conversion with the hierarchy lookup.

## Source files and context

- Main existing files: [sources.py](<../../../pipelines/area-analytics-ingest/area_analytics/sources.py>); [matching.ts](<../../../web/src/lib/matching.ts>); [matching.py](<../../../api/area_api/matching.py>); [preference-panel.tsx](<../../../web/src/components/preference-panel.tsx>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R2](../03-EVIDENCE-REVIEW.md#r2), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-02 (paper/context): Do long-distance moves discourage homeownership? Evidence from England (Ha, Hilber, Schöni, 2021)](http://eprints.lse.ac.uk/108928/1/Manuscript_for_JHE_forthcoming.pdf); [A-03 (paper/context): Housing Search in the Age of Big Data (Boeing et al., 2020)](https://arxiv.org/abs/2001.11585); [A-08 (forum/context): "Would you view a rental property that's out of budget?" — Mumsnet (2024)](https://www.mumsnet.com/talk/property/5086568-would-you-view-a-rental-property-thats-out-of-budget). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
