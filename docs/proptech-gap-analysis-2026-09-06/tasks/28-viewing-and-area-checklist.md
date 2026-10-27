# AE-28 — Turn missing evidence into a practical viewing checklist

**Priority:** P1 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-09 — Verify privacy across profiles requests caches and sharing](09-private-search-state.md); [AE-13 — Show incomplete property histories and qualify inferred events](13-honest-property-dossiers.md); [AE-27 — Persist and explicitly share reproducible shortlists](27-saved-shortlists.md)

## Problem and intended outcome

The research describes expensive scattered viewings, hidden defects, and area regret despite an initially satisfactory visit. Analytics cannot confirm neighbour behaviour, structural condition, or how a place feels at night. The valuable gap is helping users investigate unanswered questions rather than suggesting the map resolves them.

## Implementation scope

Generate a concise checklist from explicit user priorities and missing facts: commute trial, evening visit, noise observation, room layout, survey questions, lease documents, and total-cost unknowns. Let users add private observations and distinguish unvisited, checked, and unresolved states. Group planned viewings geographically, with optional route links, but do not book or contact agents automatically.

## Acceptance and verification

First test that missing lease or floor-area evidence creates a relevant question, while an unrelated concern is not added without context. Browser acceptance records a visit, changes a status, adds a note, and restores it after reload. Ensure checklist completion never labels a property surveyed, safe, or legally verified merely because the user ticked a box.

**Success evidence:** Users leave a comparison with a short actionable investigation plan and can track which material unknowns remain.

**Cleanup:** Reuse shortlist notes and remove repeated generic advice blocks when contextual questions replace them.

## Source files and context

- Main existing files: [property-panel.tsx](<../../../web/src/components/property-panel.tsx>); [evidence-panel.tsx](<../../../web/src/components/evidence-panel.tsx>); [profile-state.ts](<../../../web/src/lib/profile-state.ts>); [explorer.spec.ts](<../../../web/e2e/explorer.spec.ts>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R3](../03-EVIDENCE-REVIEW.md#r3), [R4](../03-EVIDENCE-REVIEW.md#r4); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-04 (forum/context): "First time buyer - feeling overwhelmed" — Mumsnet](https://www.mumsnet.com/talk/property/4830003-first-time-buyer-feeling-overwhelmed); [A-06 (forum/context): "FTB help - Reducing offer price after survey damp concerns" — MSE Forum](https://forums.moneysavingexpert.com/discussion/5973422/ftb-help-reducing-offer-price-after-survey-damp-concerns); [A-10 (forum/context): "Have you ever regretted a house purchase?" — Mumsnet (2023)](https://www.mumsnet.com/talk/property/4955820-have-you-ever-regretted-a-house-purchase). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
