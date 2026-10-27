# AE-04 — Activate and roll back coherent analytics releases

**Priority:** P0 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-02 — Turn the data catalogue into an enforceable source registry](02-reviewed-source-registry.md); [AE-03 — Publish official London statistical boundaries and hierarchy](03-official-london-geography.md)

## Problem and intended outcome

The schema already rejects mutation of source releases, but the production evidence query selects the latest row independently for each factor. Immutable source rows alone do not establish a coherent product snapshot. A partially loaded update could therefore mix evidence periods or leave the UI and scoring on different release sets.

## Implementation scope

Add an explicit validated product-release manifest that names the permitted source versions, geography, transformation versions, and generated assets. Make activation transactional and retain a last-known-good pointer for rollback. Pin all reads in one response to that release, including tiles and value packs. Allow sources with different cadences only when the manifest intentionally documents that combination.

## Acceptance and verification

Write failing integration tests for interrupted imports, failed validation, concurrent activation, and a reader spanning an update. Assert that a reader receives the old complete release or the new complete release, never a mixture. Demonstrate rollback without editing historical source rows and verify release identifiers survive a shared-link reload.

**Success evidence:** A release can be rebuilt, activated, and rolled back with an auditable validation record and no partially published evidence.

**Cleanup:** Replace independent latest-row selection where it bypasses release membership; avoid a second parallel publication mechanism.

## Source files and context

- Main existing files: [schema.sql](<../../../deploy/schema.sql>); [test_schema.py](<../../../deploy/tests/test_schema.py>); [repository.py](<../../../api/area_api/repository.py>); [value_pack.py](<../../../pipelines/area-analytics-ingest/area_analytics/value_pack.py>).
- Research rationale: [R2](../03-EVIDENCE-REVIEW.md#r2), [R3](../03-EVIDENCE-REVIEW.md#r3); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [B-03 (paper/context): Chi et al. (2021): A new attribute-linked residential property price dataset for England and Wales, 2011–2019](https://journals.uclpress.co.uk/ucloe/plugins/isolinear/article/1332/version/2/); [A-11 (paper/context): Key Factors Influencing Purchase or Rent Decisions in Smart Real Estate Investments (Ullah, Sepasgozar, 2020)](https://www.mdpi.com/2071-1050/12/11/4382/). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
