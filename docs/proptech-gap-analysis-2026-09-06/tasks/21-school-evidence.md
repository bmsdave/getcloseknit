# AE-21 — Connect school discovery to dated official observations

**Priority:** P1 · **Effort:** L · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-02 — Turn the data catalogue into an enforceable source registry](02-reviewed-source-registry.md); [AE-03 — Publish official London statistical boundaries and hierarchy](03-official-london-geography.md); [AE-04 — Activate and roll back coherent analytics releases](04-atomic-data-releases.md); [AE-06 — Connect search and evidence to the production API](06-production-evidence-api.md)

## Problem and intended outcome

School discovery, scoring models, and storage already exist, but the README still identifies schools as preview fixtures. The supplied research’s recommendation to show a single Ofsted grade or top-decile flag is too coarse for the project’s newer source-specific model. Preserve the existing distinction between current facets and legacy overall judgements.

## Implementation scope

Acquire a reviewed school directory and compatible dated performance and inspection observations keyed by URN. Track closures, renamings, predecessor/successor entities, school phase, cohort size, publication year, and missing observations. Offer parent-selected priorities without presenting a universal school quality score. Keep distances separate from admission eligibility and link the actual publisher record supporting each observation.

## Acceptance and verification

First test closed schools, a changed URN relationship, a missing cohort, legacy versus current inspection shapes, and a small suppressed sample. Browser acceptance searches a school, selects a phase, inspects dates, and adds it to a shortlist. Validate source licences and current schemas during acquisition; this review could not retrieve the GIAS download page directly.

**Success evidence:** Every visible school fact is tied to a dated source and the current entity, while unavailable or incomparable evidence stays explicit.

**Cleanup:** Replace real-mode school fixtures and obsolete single-grade assumptions while reusing existing school modules.

## Source files and context

- Main existing files: [school_scoring.py](<../../../pipelines/area-analytics-ingest/area_analytics/school_scoring.py>); [route.ts](<../../../web/src/app/api/v1/schools/route.ts>); [contracts.ts](<../../../web/src/lib/contracts.ts>); [schema.sql](<../../../deploy/schema.sql>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R2](../03-EVIDENCE-REVIEW.md#r2), [R3](../03-EVIDENCE-REVIEW.md#r3), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [C-03 (paper/context): School quality / catchment premium on UK house prices — DfE](https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/600623/House_prices_and_schools.pdf); [A-11 (paper/context): Key Factors Influencing Purchase or Rent Decisions in Smart Real Estate Investments (Ullah, Sepasgozar, 2020)](https://www.mdpi.com/2071-1050/12/11/4382/). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
