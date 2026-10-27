# AE-26 — Pilot planning constraints and nearby applications with coverage

**Priority:** P2 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-02 — Turn the data catalogue into an enforceable source registry](02-reviewed-source-registry.md); [AE-03 — Publish official London statistical boundaries and hierarchy](03-official-london-geography.md); [AE-06 — Connect search and evidence to the production API](06-production-evidence-api.md)

## Problem and intended outcome

The supplied research found no national planning API, but current official documentation provides a Planning Data API. Its planning-application dataset also discloses limited authority and freshness information. The product opportunity is therefore a coverage-aware pilot, not an immediate scraper for every London borough.

## Implementation scope

Check the national service first for reusable constraints and application records relevant to selected pilot boroughs. Record source authority, dataset status, update date, decision versus proposal, and geographic coverage. Link the authoritative council register for confirmation. Add a borough-specific adapter only where a permitted stable interface fills a demonstrated gap. Keep planned development distinct from approved or completed construction.

## Acceptance and verification

First test duplicate references, withdrawn applications, missing borough coverage, stale national entries, and overlapping constraints. Browser acceptance opens a proposal, follows its source, and sees whether it is current or unverified. An empty search must say that no records were returned in the covered dataset, never that no development or constraints exist.

**Success evidence:** Users can discover an evidence-backed planning question near a candidate and understand the dataset’s authority and coverage.

**Cleanup:** Avoid blanket borough scraping and remove absolute no-planning-risk messages from empty-result handling.

## Source files and context

- Main existing files: [DATA-CATALOGUE.md](<../../../pipelines/area-analytics-ingest/DATA-CATALOGUE.md>); [acquisition.py](<../../../pipelines/area-analytics-ingest/area_analytics/acquisition.py>); [evidence-panel.tsx](<../../../web/src/components/evidence-panel.tsx>); [property-panel.tsx](<../../../web/src/components/property-panel.tsx>).
- Research rationale: [R2](../03-EVIDENCE-REVIEW.md#r2), [R3](../03-EVIDENCE-REVIEW.md#r3), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [C-07 (paper/context): Supply constraints as a price-level driver (England) — Hilber](http://researchonline.lse.ac.uk/58017/1/__lse.ac.uk_storage_LIBRARY_Secondary_libfile_shared_repository_Content_Hilber,%20C_Hilber_Impact_supply_constraints_2014_Hilber_Impact_supply_constraints_2014.pdf); [A-03 (forum/context): "First time buyer in London: Tooting/Mitcham v South Norwood?" — MSE Forum](https://forums.moneysavingexpert.com/discussion/6581673/first-time-buyer-in-london-tooting-mitcham-v-south-norwood). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
