# AE-27 — Persist and explicitly share reproducible shortlists

**Priority:** P1 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-09 — Verify privacy across profiles requests caches and sharing](09-private-search-state.md); [AE-18 — Add a side-by-side area shortlist comparison](18-area-comparison.md)

## Problem and intended outcome

Local profiles and explicit fragment sharing already exist, but a household decision also needs a recoverable list of candidate areas and properties. A link that silently recalculates against a newer release can change the recommendation and confuse people comparing notes. Extend the current local-first model rather than introducing accounts before demand is demonstrated.

## Implementation scope

Save named shortlists locally with stable candidate IDs, profile version, data mode, release reference, and optional private notes. Provide explicit share preview and a redacted default that excludes precise destinations and notes. On restore, distinguish the saved evidence snapshot from an opt-in refresh. Handle deleted or renamed candidates and an unavailable historical release without substituting a different place.

## Acceptance and verification

First test schema migration, denied storage, corrupted state, removed candidates, oversized fragments, and an expired release reference. Browser acceptance saves, reloads, shares, imports, and deletes a shortlist. Verify that sharing is an explicit action and that the recipient can see which assumptions were included. Tests must inspect payloads as well as the share-button caption.

**Success evidence:** A shortlist can be reopened and explained later without silent identity, profile, mode, or release changes.

**Cleanup:** Reuse profile serialization and remove redundant storage keys or legacy sharing formats after a tested migration.

## Source files and context

- Main existing files: [profile-state.ts](<../../../web/src/lib/profile-state.ts>); [map-state.ts](<../../../web/src/lib/map-state.ts>); [explorer-header.tsx](<../../../web/src/components/explorer-header.tsx>); [map-state.test.ts](<../../../web/tests/map-state.test.ts>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R3](../03-EVIDENCE-REVIEW.md#r3), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-04 (paper/context): Homebuyers and the representation of spatial markets by information providers (Dunning, Grayson, 2014)](https://eprints.whiterose.ac.uk/id/eprint/97036/); [A-11 (paper/context): Key Factors Influencing Purchase or Rent Decisions in Smart Real Estate Investments (Ullah, Sepasgozar, 2020)](https://www.mdpi.com/2071-1050/12/11/4382/). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
