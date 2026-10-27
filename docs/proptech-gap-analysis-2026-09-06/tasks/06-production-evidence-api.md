# AE-06 — Connect search and evidence to the production API

**Priority:** P0 · **Effort:** L · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-03 — Publish official London statistical boundaries and hierarchy](03-official-london-geography.md); [AE-04 — Activate and roll back coherent analytics releases](04-atomic-data-releases.md); [AE-05 — Deliver the first validated recorded-crime release](05-recorded-crime-release.md)

## Problem and intended outcome

The FastAPI application currently exposes health and matching, while the Next.js search and other evidence routes return fixtures. A production database will not benefit users until the same area identities and release metadata travel through search, selection, histories, and value packs.

## Implementation scope

Implement the production endpoints required by the first pilot journey: metric catalogue, area search, area detail and hierarchy, monthly history, and metric value packs. Keep the existing /api/v1 contract compatible through additive fields and explicit unavailable responses. Decide one production routing boundary between Next.js and FastAPI, propagate request cancellation, and distinguish an unknown area from a missing release.

## Acceptance and verification

Write contract tests before implementation using a small real-shaped database fixture. Verify schema conformance, stable IDs, selected release consistency, malformed queries, pagination or bounded result limits, and unavailable data. In the browser, search a code outside the three demo areas, select it, change period, and reload the deep link against the production-mode fixture service.

**Success evidence:** An end-to-end request reads validated storage and exposes its source release without importing demo analytics into the response.

**Cleanup:** Replace fixture dependencies in production routes and remove obsolete duplicate endpoints after compatibility migration.

## Source files and context

- Main existing files: [app.py](<../../../api/area_api/app.py>); [repository.py](<../../../api/area_api/repository.py>); [openapi.yaml](<../../../contracts/openapi.yaml>); [route.ts](<../../../web/src/app/api/v1/search/route.ts>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R2](../03-EVIDENCE-REVIEW.md#r2), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-04 (paper/context): Homebuyers and the representation of spatial markets by information providers (Dunning, Grayson, 2014)](https://eprints.whiterose.ac.uk/id/eprint/97036/); [A-11 (paper/context): Key Factors Influencing Purchase or Rent Decisions in Smart Real Estate Investments (Ullah, Sepasgozar, 2020)](https://www.mdpi.com/2071-1050/12/11/4382/). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
