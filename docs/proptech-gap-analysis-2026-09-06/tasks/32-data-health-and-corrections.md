# AE-32 — Expose data freshness failures and a correction workflow

**Priority:** P0 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-02 — Turn the data catalogue into an enforceable source registry](02-reviewed-source-registry.md); [AE-04 — Activate and roll back coherent analytics releases](04-atomic-data-releases.md); [AE-06 — Connect search and evidence to the production API](06-production-evidence-api.md)

## Problem and intended outcome

The current health endpoint reports a static OK response, which does not establish that a usable validated release is loaded. A trustworthy data product must detect stale or incomplete evidence and let maintainers diagnose a user-visible discrepancy. This is a release requirement, not a reason to collect detailed user profiles.

## Implementation scope

Add readiness checks tied to the active release, required data assets, and coverage status. Produce structured run summaries with source versions, rejected-row counts, expected cadence, last successful publication, and rollback reference. Expose metric-specific freshness and unavailable reasons in the evidence panel. Provide a minimal correction report containing the observation/release ID and optional user description, with clear distinction between publisher errors and transformation errors.

## Acceptance and verification

First test an empty database, a stale source, a missing tile asset, a failed refresh, and a quarantined bad join. Verify failed publication retains the last usable release and that errors produce one diagnosable code across API and logs. Browser acceptance opens a freshness warning and prepares a correction report without including the raw search profile or destinations.

**Success evidence:** Maintainers can trace a disputed number to its source and transformation, while users see accurate availability rather than a misleading healthy badge.

**Cleanup:** Replace static-only readiness and generic data-error messages; reuse provenance instead of building parallel diagnostic identifiers.

## Source files and context

- Main existing files: [app.py](<../../../api/area_api/app.py>); [repository.py](<../../../api/area_api/repository.py>); [schema.sql](<../../../deploy/schema.sql>); [evidence-panel.tsx](<../../../web/src/components/evidence-panel.tsx>).
- Research rationale: [R2](../03-EVIDENCE-REVIEW.md#r2), [R3](../03-EVIDENCE-REVIEW.md#r3), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-03 (paper/context): Housing Search in the Age of Big Data (Boeing et al., 2020)](https://arxiv.org/abs/2001.11585); [B-03 (paper/context): Chi et al. (2021): A new attribute-linked residential property price dataset for England and Wales, 2011–2019](https://journals.uclpress.co.uk/ucloe/plugins/isolinear/article/1332/version/2/). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
