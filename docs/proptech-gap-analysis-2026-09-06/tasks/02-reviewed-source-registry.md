# AE-02 — Turn the data catalogue into an enforceable source registry

**Priority:** P0 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** None; can start immediately.

## Problem and intended outcome

The catalogue and manifest primitives exist, but a catalogue URL and a licence label do not prove that the downloaded object is an eligible production dataset. The supplied research also contains consequential simplifications about address licensing, planning access, and property identifiers. Fix this evidence boundary before expanding ingestion.

## Implementation scope

Create a reviewed record for each launch dataset with the exact distribution URL, publisher, access method, permitted product use, attribution, release cadence, geography vintage, and known exclusions. Distinguish a landing page from data bytes. Record HMLR address restrictions and lookup-specific terms, and the current EPC service entry point. Preserve unresolved terms as an explicit blocked status rather than assuming all public pages permit bulk reuse.

## Acceptance and verification

Write failing adapter tests for an HTML error page returned with HTTP 200, an unknown licence decision, wrong content type, and mismatched checksum. Require a government-shaped fixture and approved metadata before enabling each acquisition. Verify that tests never contact live publishers and that a blocked source cannot enter an active release.

**Success evidence:** Every enabled source has a reviewed distribution and permitted-use record; no production field depends on an unresolved source decision.

**Cleanup:** Replace duplicated source constants and vague blanket-open-data claims with the registry.

## Source files and context

- Main existing files: [DATA-CATALOGUE.md](<../../../pipelines/area-analytics-ingest/DATA-CATALOGUE.md>); [sources.py](<../../../pipelines/area-analytics-ingest/area_analytics/sources.py>); [acquisition.py](<../../../pipelines/area-analytics-ingest/area_analytics/acquisition.py>); [test_acquisition.py](<../../../pipelines/area-analytics-ingest/tests/test_acquisition.py>).
- Research rationale: [R2](../03-EVIDENCE-REVIEW.md#r2), [R5](../03-EVIDENCE-REVIEW.md#r5), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [B-03 (paper/context): Chi et al. (2021): A new attribute-linked residential property price dataset for England and Wales, 2011–2019](https://journals.uclpress.co.uk/ucloe/plugins/isolinear/article/1332/version/2/); [A-03 (paper/context): Housing Search in the Age of Big Data (Boeing et al., 2020)](https://arxiv.org/abs/2001.11585). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
