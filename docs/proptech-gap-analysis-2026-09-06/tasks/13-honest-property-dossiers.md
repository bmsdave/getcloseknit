# AE-13 — Show incomplete property histories and qualify inferred events

**Priority:** P1 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-10 — Publish corrected and versioned achieved-sale transactions](10-price-paid-ingestion.md); [AE-11 — Link transactions and EPC records without merging different homes](11-property-identity-epc.md)

## Problem and intended outcome

New uncommitted work already provides a property dossier, waterfall, peers, and timeline. It should be hardened, not re-created. The pack currently raises when a property has no certificate, and event rules infer refurbishment, extension, or tenure conversion from changed records. Those observations do not independently establish that building work or a legal conversion occurred.

## Implementation scope

Allow a useful dossier containing known transactions even when floor area or valuation is unavailable. Separate source observations from derived hypotheses and user-confirmed facts. Describe certificate changes directly, with dates and uncertainty, and expose contradictory or stale observations. Model optional valuation and peer sections consistently in the pack, contracts, API, and component state.

## Acceptance and verification

Write regressions for a sale-only property, a certificate-only property, conflicting EPC areas, and an apparent leasehold/freehold change. Assert that sale history survives missing valuation inputs and that a changed certificate does not become a confirmed renovation. In the browser open each incomplete shape, switch peer tabs, and verify no empty-array or missing-value crash.

**Success evidence:** Known property evidence remains accessible without fabricated completeness, and every event clearly states whether it is observed or inferred.

**Cleanup:** Remove mandatory-estimate assumptions and categorical event labels unsupported by the underlying records.

## Source files and context

- Main existing files: [property_pack.py](<../../../pipelines/area-analytics-ingest/area_analytics/property_pack.py>); [properties.py](<../../../pipelines/area-analytics-ingest/area_analytics/properties.py>); [property-panel.tsx](<../../../web/src/components/property-panel.tsx>); [property-timeline.tsx](<../../../web/src/components/property-timeline.tsx>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R3](../03-EVIDENCE-REVIEW.md#r3), [R5](../03-EVIDENCE-REVIEW.md#r5); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-02 (forum/context): "Regret of buying house" — Mumsnet (2023)](https://www.mumsnet.com/talk/property/4784740-regret-of-buying-house); [A-06 (forum/context): "FTB help - Reducing offer price after survey damp concerns" — MSE Forum](https://forums.moneysavingexpert.com/discussion/5973422/ftb-help-reducing-offer-price-after-survey-damp-concerns); [C-08 (paper/context): Energy-efficiency (EPC) green premium, London](https://www.mdpi.com/2073-445X/14/10/2053). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
