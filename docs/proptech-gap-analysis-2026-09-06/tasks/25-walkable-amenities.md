# AE-25 — Measure useful access to parks and everyday amenities

**Priority:** P2 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-02 — Turn the data catalogue into an enforceable source registry](02-reviewed-source-registry.md); [AE-03 — Publish official London statistical boundaries and hierarchy](03-official-london-geography.md); [AE-17 — Deliver real multi-destination commute screening](17-real-multi-destination-commutes.md)

## Problem and intended outcome

Green space, independent shops, and everyday convenience appear in the research, while existing personal matching concentrates on other factors. Raw venue counts and broad neighbourhood stereotypes are weak substitutes for the places a household can actually reach. This task adds one bounded lifestyle signal using the existing adapter and routing patterns.

## Implementation scope

Start with accessible park entrances and a small set of user-selected everyday amenity categories. Calculate walk-network access where the network supports it, keep source category and update date, and document completeness limitations. Distinguish park area from a reachable public entrance and an amenity from confirmed opening hours. Let users explicitly choose categories rather than imposing a universal lifestyle score.

## Acceptance and verification

First test parks separated by a railway or river, private entrances, duplicate venues, and missing network links. A browser journey changes the chosen category or walking limit and observes the result. Review a small London sample manually and report coverage problems; do not extrapolate a reviewed sample into a guarantee for every venue.

**Success evidence:** The feature helps users identify reachable places aligned with their stated routine and exposes when the source is incomplete.

**Cleanup:** Remove duplicate geodesic-distance shortcuts where walk-network access replaces them; keep raw source records reusable.

## Source files and context

- Main existing files: [sources.py](<../../../pipelines/area-analytics-ingest/area_analytics/sources.py>); [utilities.py](<../../../pipelines/area-analytics-ingest/area_analytics/utilities.py>); [routing.py](<../../../api/area_api/routing.py>); [preference-panel.tsx](<../../../web/src/components/preference-panel.tsx>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R3](../03-EVIDENCE-REVIEW.md#r3), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-06 (paper/context): A Unified Framework for Measuring Preferences for Schools and Neighborhoods (Bayer, Ferreira, McMillan, 2007)](http://ideas.repec.org/a/ucp/jpolec/v115y2007i4p588-638.html); [A-07 (paper/context): Factors That Influence Residents' Satisfaction with Neighborhoods (Hur, Morrow-Jones, 2008)](https://phys.org/news/2008-10-social-problems-dominate-neighborhoods-unsatisfied.html); [A-04 (forum/context): "First time buyer - feeling overwhelmed" — Mumsnet](https://www.mumsnet.com/talk/property/4830003-first-time-buyer-feeling-overwhelmed). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
