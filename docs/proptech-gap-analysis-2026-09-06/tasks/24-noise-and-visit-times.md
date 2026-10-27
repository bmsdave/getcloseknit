# AE-24 — Add noise context and prompts for repeat area visits

**Priority:** P2 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-02 — Turn the data catalogue into an enforceable source registry](02-reviewed-source-registry.md); [AE-03 — Publish official London statistical boundaries and hierarchy](03-official-london-geography.md); [AE-06 — Connect search and evidence to the production API](06-production-evidence-api.md)

## Problem and intended outcome

The research’s strongest neighbour and nuisance examples are anecdotes, not a representative map of problem households. The current source catalogue anticipates environmental noise but no completed real noise release is claimed. The useful product response combines official environmental exposure with practical prompts to inspect a place at different times.

## Implementation scope

Pilot a reviewed road or rail noise dataset, retaining measurement/model type, units, source date, spatial resolution, and time period. Keep aircraft exposure separate when added later. Offer optional visit prompts for evening, weekend, and event-day conditions based on the user’s concerns. Allow private notes about observed conditions without publishing allegations or identifying neighbours.

## Acceptance and verification

First test incompatible noise units, gaps between mapped corridors, and unavailable coverage. Browser acceptance changes the source view and records two visits at different times. Ensure an absence of mapped noise does not render as a quietness guarantee. Evaluate whether users can distinguish strategic modelled exposure from a live sound measurement.

**Success evidence:** Users identify a concrete visit or investigation prompted by the evidence, without mistaking environmental maps for comprehensive neighbour intelligence.

**Cleanup:** Remove speculative nuisance scores and reuse the shared checklist/notes model rather than a parallel reporting system.

## Source files and context

- Main existing files: [DATA-CATALOGUE.md](<../../../pipelines/area-analytics-ingest/DATA-CATALOGUE.md>); [evidence-panel.tsx](<../../../web/src/components/evidence-panel.tsx>); [contracts.ts](<../../../web/src/lib/contracts.ts>); [personal-match-panel.tsx](<../../../web/src/components/personal-match-panel.tsx>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R3](../03-EVIDENCE-REVIEW.md#r3), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-07 (paper/context): Factors That Influence Residents' Satisfaction with Neighborhoods (Hur, Morrow-Jones, 2008)](https://phys.org/news/2008-10-social-problems-dominate-neighborhoods-unsatisfied.html); [A-03 (forum/context): "First time buyer in London: Tooting/Mitcham v South Norwood?" — MSE Forum](https://forums.moneysavingexpert.com/discussion/6581673/first-time-buyer-in-london-tooting-mitcham-v-south-norwood); [A-10 (forum/context): "Have you ever regretted a house purchase?" — Mumsnet (2023)](https://www.mumsnet.com/talk/property/4955820-have-you-ever-regretted-a-house-purchase). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
