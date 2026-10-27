# AE-20 — Expose leasehold costs and unanswered diligence questions

**Priority:** P1 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-13 — Show incomplete property histories and qualify inferred events](13-honest-property-dossiers.md); [AE-29 — Let users add property candidates without a listings feed](29-user-property-candidates.md)

## Problem and intended outcome

The research identifies lease length, management delays, and ownership costs as important London issues. The current transaction model records freehold or leasehold but does not establish remaining term, actual lease clauses, service-charge history, or building-safety documentation. A tenure flag must not imply those questions have been answered.

## Implementation scope

Add user-entered or document-referenced fields for lease expiry/as-of date, service charges, ground rent, major-works notices, and unresolved management questions. Keep source, observation date, and verification status for each. Link users to current official guidance and an independent professional where the fact requires legal interpretation. Treat historical lease-discount research as context, not an automatic valuation deduction or a permanently valid eighty-year rule.

## Acceptance and verification

First test an unknown term, conflicting dates, an expired observation, and a property that has a transaction tenure but no lease evidence. Browser checks add a question, attach a reference URL, mark it answered, and show it in the decision brief. Recheck legal effective dates before shipping any numerical threshold; a missing fact must never receive a reassuring default.

**Success evidence:** A buyer can identify unanswered high-impact leasehold questions before relying on a shortlist or cost comparison.

**Cleanup:** Remove categorical conversion claims and stale legal thresholds from presentation if present; preserve factual transaction tenure.

## Source files and context

- Main existing files: [property-panel.tsx](<../../../web/src/components/property-panel.tsx>); [contracts.ts](<../../../web/src/lib/contracts.ts>); [properties.py](<../../../pipelines/area-analytics-ingest/area_analytics/properties.py>); [property-timeline.tsx](<../../../web/src/components/property-timeline.tsx>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R2](../03-EVIDENCE-REVIEW.md#r2), [R3](../03-EVIDENCE-REVIEW.md#r3), [R5](../03-EVIDENCE-REVIEW.md#r5); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [C-04 (paper/context): Leasehold discount & lease-length decay (England & Wales)](https://www.aeaweb.org/conference/2015/retrieve.php?pdfid=8899&tk=B4ytKQNa); [A-05 (forum/context): "Atrocious Management Company first time buyer PLEASE HELP" — MSE Forum](https://forums.moneysavingexpert.com/discussion/6551007/atrocious-management-company-first-time-buyer-please-help); [C-01 (forum/context): Leasehold nearing 80 years, absent freeholder — MSE Forum](https://forums.moneysavingexpert.com/discussion/6521128/leasehold-nearing-80-years-remaining-with-possible-absent-freeholder). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
