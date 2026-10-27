# AE-35 — Keep native clients compatible with the real-data contract

**Priority:** P1 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-06 — Connect search and evidence to the production API](06-production-evidence-api.md); [AE-07 — Make Real data and Demo modes impossible to confuse](07-real-demo-separation.md); [AE-13 — Show incomplete property histories and qualify inferred events](13-honest-property-dossiers.md)

## Problem and intended outcome

The vision includes Web, iOS, Android, and agents. Existing Swift and Kotlin models provide a head start, but real/demo mode, release provenance, missing evidence, and the new uncommitted property dossier can drift across clients. Full native feature expansion is not required to prevent contract breakage.

## Implementation scope

Define shared golden response fixtures for real and demo areas, suppressed metrics, fallback carriers, property-only history, and unknown optional fields. Update OpenAPI and native decoders through a deliberate versioning policy. Preserve property identity semantics and ensure a missing valuation is not decoded as zero. Limit native UI work to the minimum needed to label mode, carrier, and unavailable evidence correctly.

## Acceptance and verification

First run decoding tests that fail on the new fixtures, then update each client and rerun the relevant Swift, Kotlin, and TypeScript suites. Exercise malformed responses and compatibility with existing /api/v1 clients. If a platform runtime is unavailable, record that check as skipped rather than claiming parity. Browser-facing contract changes still need their own interaction verification.

**Success evidence:** The supported clients interpret identical evidence and uncertainty consistently, without demanding a complete native redesign before web learning.

**Cleanup:** Remove duplicate undocumented wire shapes and retired property-history paths after a tested migration.

## Source files and context

- Main existing files: [openapi.yaml](<../../../contracts/openapi.yaml>); [Contracts.swift](<../../../ios/Sources/CloseKnitCore/Contracts.swift>); [Contracts.kt](<../../../android/core/src/main/kotlin/org/closeknit/london/Contracts.kt>); [contracts.ts](<../../../web/src/lib/contracts.ts>).
- Research rationale: [R2](../03-EVIDENCE-REVIEW.md#r2), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-03 (paper/context): Housing Search in the Age of Big Data (Boeing et al., 2020)](https://arxiv.org/abs/2001.11585); [B-03 (paper/context): Chi et al. (2021): A new attribute-linked residential property price dataset for England and Wales, 2011–2019](https://journals.uclpress.co.uk/ucloe/plugins/isolinear/article/1332/version/2/). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
