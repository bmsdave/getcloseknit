# AE-05 — Deliver the first validated recorded-crime release

**Priority:** P0 · **Effort:** L · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-03 — Publish official London statistical boundaries and hierarchy](03-official-london-geography.md); [AE-04 — Activate and roll back coherent analytics releases](04-atomic-data-releases.md)

## Problem and intended outcome

Crime is both an existing layer and the agreed first real-data pilot. The research suggests safety matters to area choice, but it does not justify turning police records into a prediction about an individual street or household. This task closes the existing delivery gap without introducing a new neighbourhood score.

## Implementation scope

Ingest the latest validated consecutive twelve-month window common to Metropolitan Police and City of London Police, with compatible population denominators. Preserve the published LSOA association, monthly categories, denominator year, force coverage, and separate anti-social behaviour. Keep British Transport Police exclusion visible. Aggregate borough rates from summed counts and populations and suppress unsupported England comparisons.

## Acceptance and verification

First test missing months, zero populations, conflicting duplicates, blank crime identifiers, incompatible geography, and unavailable forces. Distinct blank-ID records must survive deduplication. Browser acceptance changes the month/category, inspects counts and rates, and opens coverage explanations. A missing force-month must produce unavailable evidence, never a zero-rate neighbourhood.

**Success evidence:** The released window is reproducible and every published rate has a denominator, source date, and explicit coverage policy.

**Cleanup:** Remove preview crime values and generic transaction-sample warnings from the real crime path.

## Source files and context

- Main existing files: SUPERVISED-DATA-PILOT.md (archived, removed); [schema.sql](<../../../deploy/schema.sql>); [analytics.py](<../../../pipelines/area-analytics-ingest/area_analytics/analytics.py>); [evidence-panel.tsx](<../../../web/src/components/evidence-panel.tsx>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R2](../03-EVIDENCE-REVIEW.md#r2), [R3](../03-EVIDENCE-REVIEW.md#r3); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-07 (paper/context): Factors That Influence Residents' Satisfaction with Neighborhoods (Hur, Morrow-Jones, 2008)](https://phys.org/news/2008-10-social-problems-dominate-neighborhoods-unsatisfied.html); [A-10 (forum/context): "Have you ever regretted a house purchase?" — Mumsnet (2023)](https://www.mumsnet.com/talk/property/4955820-have-you-ever-regretted-a-house-purchase). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
