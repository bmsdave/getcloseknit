# AE-03 — Publish official London statistical boundaries and hierarchy

**Priority:** P0 · **Effort:** L · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-01 — Establish a trustworthy product verification gate](01-reliable-browser-ci.md); [AE-02 — Turn the data catalogue into an enforceable source registry](02-reviewed-source-registry.md)

## Problem and intended outcome

The app documents three synthetic preview polygons. A London area-search product cannot answer an unfamiliar-neighbourhood question until its selectable places cover real London. The existing LSOA, MSOA, and borough carrier contract is a useful foundation and should remain the analytics model.

## Implementation scope

Complete the official-geography pilot using a dated 2021 boundary distribution and compatible lookup tables. Preserve official codes, multipolygons, parent relationships, and source attribution. Load PostGIS and serve Martin tiles using stable feature identifiers. Keep buildings and roads as map context. Support search by official code and published name without inventing neighbourhood boundaries from postcode labels.

## Acceptance and verification

Begin with failing fixtures for missing parents, duplicate codes, islands, invalid polygons, and incompatible geography vintages. Reconcile coverage against the chosen official London lookup, rather than a developer-machine feature count. In a browser, select a multipart area, navigate to its parent, search its code, and reload the link while retaining selection.

**Success evidence:** Every expected London unit is present or explicitly quarantined with a reason, and published geometry identifiers agree across search, tiles, and evidence.

**Cleanup:** Remove synthetic polygons from real-data delivery while retaining their clearly named demo fixture role.

## Source files and context

- Main existing files: [schema.sql](<../../../deploy/schema.sql>); [martin.yaml](<../../../deploy/martin.yaml>); [geometry.test.ts](<../../../web/tests/geometry.test.ts>); [value_pack.py](<../../../pipelines/area-analytics-ingest/area_analytics/value_pack.py>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R2](../03-EVIDENCE-REVIEW.md#r2); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-02 (paper/context): Do long-distance moves discourage homeownership? Evidence from England (Ha, Hilber, Schöni, 2021)](http://eprints.lse.ac.uk/108928/1/Manuscript_for_JHE_forthcoming.pdf); [A-04 (paper/context): Homebuyers and the representation of spatial markets by information providers (Dunning, Grayson, 2014)](https://eprints.whiterose.ac.uk/id/eprint/97036/). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
