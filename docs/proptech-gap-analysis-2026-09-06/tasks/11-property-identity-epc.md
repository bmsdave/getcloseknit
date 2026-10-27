# AE-11 — Link transactions and EPC records without merging different homes

**Priority:** P1 · **Effort:** L · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-02 — Turn the data catalogue into an enforceable source registry](02-reviewed-source-registry.md); [AE-10 — Publish corrected and versioned achieved-sale transactions](10-price-paid-ingestion.md)

## Problem and intended outcome

The current property spine constructs identifiers from normalized postcode and address, while database property storage uses a UPRN-oriented shape. Flats, punctuation variants, address changes, and multiple certificates make silent identity errors expensive. The official new HMLR lookup offers transaction-ID-to-UPRN links, but its availability does not prove complete historical coverage.

## Implementation scope

Add a typed identity record that preserves publisher IDs, optional verified UPRN, normalized-address aliases, match method, confidence, and unresolved conflicts. Prefer validated identifiers where available and retain cautious address matching as a documented fallback. Acquire domestic EPC records from the current service with certificate dates, floor area, points, rating, and replacement status. Never treat EPC habitable-room count as bedrooms.

## Acceptance and verification

Write failing fixtures for two flats sharing a building address, ambiguous matches, changed postcodes, superseded certificates, absent UPRNs, and missing floor area. Measure match precision on a reviewed sample and publish coverage by property type and geography; do not adopt the research’s 79% linkage as a target guaranteed by this dataset. Test stable deep links through identity migration.

**Success evidence:** Every joined field exposes its identity basis, and ambiguous records remain separate or unavailable rather than confidently wrong.

**Cleanup:** Remove conflicting property-ID assumptions and implicit room-to-bedroom conversions if encountered.

## Source files and context

- Main existing files: [properties.py](<../../../pipelines/area-analytics-ingest/area_analytics/properties.py>); [property_pack.py](<../../../pipelines/area-analytics-ingest/area_analytics/property_pack.py>); [schema.sql](<../../../deploy/schema.sql>); [contracts.ts](<../../../web/src/lib/contracts.ts>).
- Research rationale: [R2](../03-EVIDENCE-REVIEW.md#r2), [R5](../03-EVIDENCE-REVIEW.md#r5), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [B-03 (paper/context): Chi et al. (2021): A new attribute-linked residential property price dataset for England and Wales, 2011–2019](https://journals.uclpress.co.uk/ucloe/plugins/isolinear/article/1332/version/2/); [C-08 (paper/context): Energy-efficiency (EPC) green premium, London](https://www.mdpi.com/2073-445X/14/10/2053). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
