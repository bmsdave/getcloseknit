# AE-18 — Add a side-by-side area shortlist comparison

**Priority:** P1 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-06 — Connect search and evidence to the production API](06-production-evidence-api.md); [AE-08 — Make production matches respond to budget and destinations](08-profile-aware-production-matching.md); [AE-12 — Deliver reliable area prices and comparable history](12-reliable-area-price-comparisons.md); [AE-15 — Replace rental affordability fixtures with appropriately coarse evidence](15-rental-affordability.md)

## Problem and intended outcome

Existing area evidence and personal scores help inspect one candidate, but the research’s central decision is choosing between unfamiliar places with different compromises. A saved comparison of a small shortlist is a more direct expression of that job than another all-London ranking visualization.

## Implementation scope

Build a comparison for two to four selected areas using the same release and profile. Show raw costs, commute, selected factors, carrier, dates, completeness, and unmet constraints in aligned rows. Explain material differences without double-counting the same borough evidence as multiple independent signals. Let users remove an area, change one preference, and see which conclusions change. Use an accessible table or cards on mobile.

## Acceptance and verification

First test mixed source carriers, missing factors, tied scores, excluded areas, and a release mismatch. Browser tests add and remove candidates, change a weight, and verify that comparisons update coherently. An unavailable value must remain unknown rather than rank better than an observed negative value. Keep a readable non-map path for keyboard users.

**Success evidence:** A user can explain at least one meaningful trade-off between finalists using evidence, rather than relying on the composite score alone.

**Cleanup:** Reuse shared evidence formatting and remove repeated one-area metric markup from the comparison implementation.

## Source files and context

- Main existing files: [personal-match-panel.tsx](<../../../web/src/components/personal-match-panel.tsx>); [evidence-panel.tsx](<../../../web/src/components/evidence-panel.tsx>); [map-state.ts](<../../../web/src/lib/map-state.ts>); [contracts.ts](<../../../web/src/lib/contracts.ts>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R3](../03-EVIDENCE-REVIEW.md#r3), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-04 (paper/context): Homebuyers and the representation of spatial markets by information providers (Dunning, Grayson, 2014)](https://eprints.whiterose.ac.uk/id/eprint/97036/); [A-11 (paper/context): Key Factors Influencing Purchase or Rent Decisions in Smart Real Estate Investments (Ullah, Sepasgozar, 2020)](https://www.mdpi.com/2071-1050/12/11/4382/); [F-04 (competitor/context): Proportunity](https://proportunity.co/). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
