# AE-12 — Deliver reliable area prices and comparable history

**Priority:** P1 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-10 — Publish corrected and versioned achieved-sale transactions](10-price-paid-ingestion.md); [AE-11 — Link transactions and EPC records without merging different homes](11-property-identity-epc.md)

## Problem and intended outcome

The repository already has rolling price-per-square-metre calculations, a twenty-sale carrier fallback, percentiles, and inflation adjustments. The high-value gap is connecting these methods to validated transactions while making sample composition and geography obvious. A polished chart with sparse or unmatched observations can otherwise imply street-level certainty that the evidence does not support.

## Implementation scope

Produce area price releases from eligible sale/EPC joins using the existing LSOA-to-MSOA-to-borough policy. Preserve distinct counts for all sales, matched-floor-area sales, exclusions, and the actual carrier. Offer consistent £/m² and £/sqft presentation with tested conversion. Keep nominal, CPIH-adjusted, and local-market-adjusted history separate, and show property-type/new-build composition where supported.

## Acceptance and verification

First test thin samples, a missing EPC subgroup, changing transaction mix, missing inflation periods, and coarser carrier fallbacks. Verify borough measures from underlying observations rather than averages of smaller-area medians. Browser acceptance changes period and unit, opens the sample explanation, and checks that absent national coverage suppresses England percentile claims.

**Success evidence:** Users can identify what sold, how many eligible observations support the number, and the geography and adjustment behind each comparison.

**Cleanup:** Reuse existing analytics; remove duplicate price formulas and hard-coded transaction explanations from unrelated metrics.

## Source files and context

- Main existing files: [analytics.py](<../../../pipelines/area-analytics-ingest/area_analytics/analytics.py>); [property_history.py](<../../../pipelines/area-analytics-ingest/area_analytics/property_history.py>); [price-history.ts](<../../../web/src/lib/price-history.ts>); [evidence-panel.tsx](<../../../web/src/components/evidence-panel.tsx>).
- Research rationale: [R2](../03-EVIDENCE-REVIEW.md#r2), [R5](../03-EVIDENCE-REVIEW.md#r5), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [C-01 (paper/context): Hedonic price model, Greater London: which attribute groups explain prices](https://www.mdpi.com/2349196); [C-10 (paper/context): Hedonic size/bedroom and postcode-district premiums, Central London — Bracke](http://eprints.lse.ac.uk/49723/1/sercdp0127.pdf). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
