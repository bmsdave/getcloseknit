# AE-10 — Publish corrected and versioned achieved-sale transactions

**Priority:** P1 · **Effort:** L · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-02 — Turn the data catalogue into an enforceable source registry](02-reviewed-source-registry.md); [AE-04 — Activate and roll back coherent analytics releases](04-atomic-data-releases.md)

## Problem and intended outcome

Achieved sales are a defensible foundation for the research-backed area and property comparison use case. The repository already transforms supplied records, but real HMLR acquisition and update handling are not demonstrated as a completed release. The current property Sale model also lacks a publisher transaction identifier, which matters for corrections and linkage.

## Implementation scope

Build a dated PPD ingestion adapter preserving transaction IDs, record category, status changes, sale date, price, address parts, property type, new-build flag, and tenure. Apply additions, corrections, and deletions into a derived snapshot while preserving immutable raw releases. Document registration lag and scope exclusions. Review display and address reuse against the official conditions before exposing records.

## Acceptance and verification

First test repeat downloads, correction and deletion records, malformed money/date values, multiple sales of one address, and late registrations. A replay must generate the same normalized snapshot checksum. API and UI checks must distinguish achieved price from asking price and surface the publication period so the newest partial month is not presented as a complete market trend.

**Success evidence:** Transactions reconcile to the chosen source snapshot and corrections do not silently duplicate sales or disappear from provenance.

**Cleanup:** Replace hand-entered production sale records and append-only assumptions that cannot represent publisher corrections.

## Source files and context

- Main existing files: [acquisition.py](<../../../pipelines/area-analytics-ingest/area_analytics/acquisition.py>); [properties.py](<../../../pipelines/area-analytics-ingest/area_analytics/properties.py>); [schema.sql](<../../../deploy/schema.sql>); [test_properties.py](<../../../pipelines/area-analytics-ingest/tests/test_properties.py>).
- Research rationale: [R2](../03-EVIDENCE-REVIEW.md#r2), [R5](../03-EVIDENCE-REVIEW.md#r5), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [B-03 (paper/context): Chi et al. (2021): A new attribute-linked residential property price dataset for England and Wales, 2011–2019](https://journals.uclpress.co.uk/ucloe/plugins/isolinear/article/1332/version/2/); [C-05 (forum/context): New-build advertised price vs Land Registry sales — MSE Forum](https://forums.moneysavingexpert.com/discussion/4623925/new-build-advertised-price-vs-lender-valuation). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
