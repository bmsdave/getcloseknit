# AE-14 — Make estimate ranges and price explanations empirically defensible

**Priority:** P1 · **Effort:** L · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-11 — Link transactions and EPC records without merging different homes](11-property-identity-epc.md); [AE-12 — Deliver reliable area prices and comparable history](12-reliable-area-price-comparisons.md); [AE-13 — Show incomplete property histories and qualify inferred events](13-honest-property-dossiers.md)

## Problem and intended outcome

An estimate range and median-based waterfall already exist. The band is supplied through age-since-sale thresholds, and a sequence of reference medians is not a causal attribution model. The research’s coefficients come from different periods and methods; inserting them as universal London weights would add false precision and increase anchoring risk.

## Implementation scope

Keep achieved transactions prominent. Label reference-group steps as descriptive comparisons and explain their ordering, sample overlap, and omitted drivers. Evaluate estimate errors on held-out later sales with spatial leakage controls, separated by tenure, property type, price band, and evidence density. Distinguish a heuristic sensitivity band from a calibrated prediction interval and suppress estimates when validation is insufficient.

## Acceptance and verification

First test a sparse peer group, overlapping groups, reordered steps, and an uncalibrated band. Check arithmetic separately from statistical validity. Backtest coverage at the stated interval level on data not used to select the band; report both sample size and error distribution. Browser acceptance must expose the source sample and uncertainty before treating the estimate as a precise price.

**Success evidence:** Every displayed interval has a documented interpretation and validation basis; unsupported estimates stay unavailable rather than receiving literature-derived precision.

**Cleanup:** Remove causal-sounding premium labels, misleading confidence wording, and unvalidated age-only confidence claims.

## Source files and context

- Main existing files: [decompose.py](<../../../pipelines/area-analytics-ingest/area_analytics/decompose.py>); [peers.py](<../../../pipelines/area-analytics-ingest/area_analytics/peers.py>); [properties.py](<../../../pipelines/area-analytics-ingest/area_analytics/properties.py>); [price-waterfall.tsx](<../../../web/src/components/price-waterfall.tsx>).
- Research rationale: [R3](../03-EVIDENCE-REVIEW.md#r3), [R5](../03-EVIDENCE-REVIEW.md#r5), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [C-01 (paper/context): Hedonic price model, Greater London: which attribute groups explain prices](https://www.mdpi.com/2349196); [C-10 (paper/context): Hedonic size/bedroom and postcode-district premiums, Central London — Bracke](http://eprints.lse.ac.uk/49723/1/sercdp0127.pdf); [E-01 (paper/context): Does Human-Algorithm Feedback Loop Lead to Error Propagation? Evidence from Zillow's Zestimate](https://questromworld.bu.edu/platformstrategy/wp-content/uploads/sites/49/2024/06/PlatStrat2024_paper_102.pdf); [F-18 (competitor/context): Zestimate vs Redfin Estimate — Inman (2017)](https://www.inman.com/2017/02/02/zestimate-vs-redfin-estimate-home-valuations-use-list-prices-er-useful/). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
