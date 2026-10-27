# AE-31 — Keep real London usable on mobile and without the map

**Priority:** P0 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-01 — Establish a trustworthy product verification gate](01-reliable-browser-ci.md); [AE-03 — Publish official London statistical boundaries and hierarchy](03-official-london-geography.md); [AE-06 — Connect search and evidence to the production API](06-production-evidence-api.md)

## Problem and intended outcome

The current synthetic geometry is too small to establish performance at real London scale. The project requires frame work within ten milliseconds and browser interaction as part of acceptance. Real-data delivery also needs a keyboard and readable-list route through search, selection, and comparison when the map is unavailable or hard to use.

## Implementation scope

Use representative deterministic London-scale geometry and value packs to exercise feature-state updates, selection, zoom, and mobile sheets. Batch expensive updates outside camera cadence, preserve cancellation, and keep diagnostics opt-in. Ensure focus order, announcements, touch targets, contrast, reduced-motion behavior, and a non-map evidence path remain usable. Add resilience for a failed basemap or WebGL context.

## Acceptance and verification

First establish failing performance or interaction cases with the representative fixture, then fix only measured bottlenecks. Operate keyboard search, selection, close/reopen sheet, layer switching, and comparison under mobile dimensions. Run the established frame-work gate and record its environment and percentile; do not claim every user device reaches an unmeasured rate. Verify the page still exposes evidence when the map fails.

**Success evidence:** The release passes the project performance gate and its critical search-to-evidence journey remains accessible without pointer-only map interaction.

**Cleanup:** Remove repeated per-frame analytics work, redundant geometry copies, and obsolete inaccessible control paths.

## Source files and context

- Main existing files: [area-map.tsx](<../../../web/src/components/area-map.tsx>); [rendering.spec.ts](<../../../web/e2e/rendering.spec.ts>); [accessibility.spec.ts](<../../../web/e2e/accessibility.spec.ts>); [close-knit.tsx](<../../../web/src/components/close-knit.tsx>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R3](../03-EVIDENCE-REVIEW.md#r3), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-04 (paper/context): Homebuyers and the representation of spatial markets by information providers (Dunning, Grayson, 2014)](https://eprints.whiterose.ac.uk/id/eprint/97036/); [A-11 (paper/context): Key Factors Influencing Purchase or Rent Decisions in Smart Real Estate Investments (Ullah, Sepasgozar, 2020)](https://www.mdpi.com/2071-1050/12/11/4382/). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
