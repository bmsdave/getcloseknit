# AE-30 — Export a sourced household decision brief

**Priority:** P1 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-18 — Add a side-by-side area shortlist comparison](18-area-comparison.md); [AE-20 — Expose leasehold costs and unanswered diligence questions](20-leasehold-due-diligence.md); [AE-27 — Persist and explicitly share reproducible shortlists](27-saved-shortlists.md); [AE-28 — Turn missing evidence into a practical viewing checklist](28-viewing-and-area-checklist.md); [AE-29 — Let users add property candidates without a listings feed](29-user-property-candidates.md)

## Problem and intended outcome

The research frames the opportunity as pre-decision support rather than replacing the human work of negotiation and chain progression. The app already has evidence panels but lacks a durable, integrated account of why a household shortlisted a place and which questions remain. A compact sourced brief is a concrete output users can revisit or discuss.

## Implementation scope

Create a print-friendly and Markdown-exportable brief for selected areas and property candidates. Include stated needs, hard constraints, meaningful trade-offs, achieved versus entered asking prices, costs, data dates/carriers, source links, and unresolved viewing or lease questions. Make uncertainty visible. Preview and redact private destinations and notes before export; do not automatically send the brief to an agent or another person.

## Acceptance and verification

First test missing sections, unavailable comparisons, mixed releases, unsafe reference URLs, and redaction. Browser acceptance selects candidates, previews the brief, changes included private fields, and exports a readable result. Verify sources resolve to the supporting observation and the text never changes an uncertain estimate into a valuation or a pending question into a verified fact.

**Success evidence:** A household can explain its shortlist and next steps from one reproducible evidence-backed artifact.

**Cleanup:** Reuse the shared comparison model and formatting; remove duplicated export-only calculations or generic boilerplate.

## Source files and context

- Main existing files: [personal-match-panel.tsx](<../../../web/src/components/personal-match-panel.tsx>); [property-panel.tsx](<../../../web/src/components/property-panel.tsx>); [contracts.ts](<../../../web/src/lib/contracts.ts>); [explorer-header.tsx](<../../../web/src/components/explorer-header.tsx>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R3](../03-EVIDENCE-REVIEW.md#r3), [R4](../03-EVIDENCE-REVIEW.md#r4), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-11 (paper/context): Key Factors Influencing Purchase or Rent Decisions in Smart Real Estate Investments (Ullah, Sepasgozar, 2020)](https://www.mdpi.com/2071-1050/12/11/4382/); [A-06 (forum/context): "FTB help - Reducing offer price after survey damp concerns" — MSE Forum](https://forums.moneysavingexpert.com/discussion/5973422/ftb-help-reducing-offer-price-after-survey-damp-concerns); [B-05 (forum/context): "Online ESTATE AGENTS experience/recommendations" — Mumsnet](https://www.mumsnet.com/talk/property/4629387-online-estate-agents-experiencerecommendations). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
