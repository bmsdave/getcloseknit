# AE-36 — Expose bounded evidence retrieval for assistant workflows

**Priority:** P2 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-06 — Connect search and evidence to the production API](06-production-evidence-api.md); [AE-09 — Verify privacy across profiles requests caches and sharing](09-private-search-state.md); [AE-18 — Add a side-by-side area shortlist comparison](18-area-comparison.md); [AE-30 — Export a sourced household decision brief](30-decision-brief.md)

## Problem and intended outcome

The project vision explicitly includes agents as a product interface, and a sourced area comparison is a useful assistant output. The production API first needs stable evidence endpoints; adding a conversational wrapper before that would simply make synthetic or incomplete conclusions easier to distribute.

## Implementation scope

After the web decision workflow is validated, define bounded read-only operations for area lookup, evidence retrieval, shortlist comparison, and decision-brief preparation. Reuse the public contract and existing provenance, mode, release, and missing-data semantics. Add explicit result limits and structured unavailable reasons. Treat user-supplied listing URLs and notes as data, and exclude background messaging, purchases, scraping, or profile persistence from the interface.

## Acceptance and verification

First test that a tool response includes supporting sources and cannot silently substitute fixture data. Exercise invalid IDs, excessive result requests, unsupported release versions, cancellation, and private-destination redaction. Evaluate assistant-generated answers against a small human-reviewed comparison set; claims must be traceable to returned evidence. Document remaining uncertainty rather than allowing prose to invent a missing value.

**Success evidence:** An assistant can produce the same defensible comparison as the web app using a small, reproducible evidence payload.

**Cleanup:** Reuse API and brief logic; remove duplicated agent-only analytics and avoid a separate data ingestion stack.

## Source files and context

- Main existing files: [openapi.yaml](<../../../contracts/openapi.yaml>); [app.py](<../../../api/area_api/app.py>); [privacy.py](<../../../api/area_api/privacy.py>); VISION.md (former monorepo).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R2](../03-EVIDENCE-REVIEW.md#r2), [R4](../03-EVIDENCE-REVIEW.md#r4), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-04 (paper/context): Homebuyers and the representation of spatial markets by information providers (Dunning, Grayson, 2014)](https://eprints.whiterose.ac.uk/id/eprint/97036/); [A-11 (paper/context): Key Factors Influencing Purchase or Rent Decisions in Smart Real Estate Investments (Ullah, Sepasgozar, 2020)](https://www.mdpi.com/2071-1050/12/11/4382/). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
