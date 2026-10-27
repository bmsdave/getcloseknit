# AE-23 — Add source-specific flood screening for candidate places

**Priority:** P1 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-02 — Turn the data catalogue into an enforceable source registry](02-reviewed-source-registry.md); [AE-03 — Publish official London statistical boundaries and hierarchy](03-official-london-geography.md); [AE-04 — Activate and roll back coherent analytics releases](04-atomic-data-releases.md); [AE-06 — Connect search and evidence to the production API](06-production-evidence-api.md)

## Problem and intended outcome

Flood is a research-recommended due-diligence signal absent from the existing five metric families. It can materially change the questions a user asks about a candidate property. However, area summaries, planning flood zones, surface-water models, and a property-specific insurance assessment represent different evidence and must not collapse into one risk label.

## Implementation scope

Choose one reviewed Environment Agency dataset for a bounded first release and record its purpose, scenario, resolution, publication date, and coverage. Define whether the app reports polygon intersection or area exposure. Add other flood mechanisms only as separately named observations. Link the relevant official check service and retain missing coverage distinctly from no mapped exposure.

## Acceptance and verification

First test a location on a boundary, overlapping flood mechanisms, an out-of-coverage location, and a coarse area containing only a small exposed section. Browser acceptance opens the source legend and compares two candidates without implying every building in an LSOA shares the same risk. Validate spatial joins against a small reviewed reference sample.

**Success evidence:** Users can recognize mapped exposure, its limitations, and the next property-specific check, with no unsupported insurance-cost prediction.

**Cleanup:** Reuse evidence and provenance components; remove any single generic flood-score abstraction that hides incompatible source meanings.

## Source files and context

- Main existing files: [sources.py](<../../../pipelines/area-analytics-ingest/area_analytics/sources.py>); [DATA-CATALOGUE.md](<../../../pipelines/area-analytics-ingest/DATA-CATALOGUE.md>); [evidence-panel.tsx](<../../../web/src/components/evidence-panel.tsx>); [contracts.ts](<../../../web/src/lib/contracts.ts>).
- Research rationale: [R2](../03-EVIDENCE-REVIEW.md#r2), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-11 (paper/context): Key Factors Influencing Purchase or Rent Decisions in Smart Real Estate Investments (Ullah, Sepasgozar, 2020)](https://www.mdpi.com/2071-1050/12/11/4382/); [A-10 (forum/context): "Have you ever regretted a house purchase?" — Mumsnet (2023)](https://www.mumsnet.com/talk/property/4955820-have-you-ever-regretted-a-house-purchase). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
