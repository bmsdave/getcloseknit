# AE-19 — Compare total housing costs with editable assumptions

**Priority:** P1 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-15 — Replace rental affordability fixtures with appropriately coarse evidence](15-rental-affordability.md); [AE-16 — Capture real household needs and explain trade-offs](16-preferences-and-tradeoffs.md); [AE-29 — Let users add property candidates without a listings feed](29-user-property-candidates.md)

## Problem and intended outcome

Asking price or monthly rent alone does not capture the housing-cost regrets described in the research. The current affordability profile does not provide a complete household cost worksheet. London buyers also face property-specific recurring costs that open area datasets cannot reliably supply.

## Implementation scope

Add an optional scenario worksheet covering purchase funding assumptions, user-entered interest and term, service charge, ground rent, maintenance allowance, council tax, utilities, moving costs, and rental upfront costs. Show which values are official, entered, estimated, or unknown. Version any tax or statutory calculation by effective date and jurisdiction after checking primary guidance. Treat this as a comparison tool, not mortgage approval or a promise of investment returns.

## Acceptance and verification

First test zero interest, missing mandatory inputs, changed rates, different tenures, and monthly/annual conversion. Unknown service charges must remain unknown rather than defaulting to zero. Browser acceptance changes a recurring cost and observes the total and remaining budget change. Validate a few worked examples independently and show assumptions in any exported comparison.

**Success evidence:** Users can see how plausible cost changes affect their own budget and identify which missing facts could reverse a decision.

**Cleanup:** Reuse affordability inputs and remove duplicate budget arithmetic; avoid storing a second independent household profile.

## Source files and context

- Main existing files: [preference-panel.tsx](<../../../web/src/components/preference-panel.tsx>); [property-panel.tsx](<../../../web/src/components/property-panel.tsx>); [contracts.ts](<../../../web/src/lib/contracts.ts>); [matching.test.ts](<../../../web/tests/matching.test.ts>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R3](../03-EVIDENCE-REVIEW.md#r3), [R5](../03-EVIDENCE-REVIEW.md#r5); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-11 (paper/context): Key Factors Influencing Purchase or Rent Decisions in Smart Real Estate Investments (Ullah, Sepasgozar, 2020)](https://www.mdpi.com/2071-1050/12/11/4382/); [C-09 (paper/context): Interest rates / user cost as the dominant macro driver of UK house prices — BoE](https://www.bankofengland.co.uk/-/media/boe/files/working-paper/2019/uk-house-prices-and-three-decades-of-decline-in-the-risk-free-real-interest-rate.pdf); [B-04 (paper/context): Bakker & Datta: Tenant Fees Act — regulating letting-agent fees](https://cep.lse.ac.uk/pubs/download/dp2019.pdf). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
