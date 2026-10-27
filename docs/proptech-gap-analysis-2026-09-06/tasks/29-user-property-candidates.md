# AE-29 — Let users add property candidates without a listings feed

**Priority:** P1 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-09 — Verify privacy across profiles requests caches and sharing](09-private-search-state.md); [AE-11 — Link transactions and EPC records without merging different homes](11-property-identity-epc.md); [AE-13 — Show incomplete property histories and qualify inferred events](13-honest-property-dossiers.md)

## Problem and intended outcome

Close Knit can deliver value alongside portals without owning their listings. The research identifies asking-price history and photos as gated, while the current property dossier is driven by known fixture IDs. Users need a way to connect an interesting property to area evidence even when no licensed listing feed exists.

## Implementation scope

Add a local candidate form for a reference URL, address selection, user-entered asking price or rent, bedrooms, floor area, and notes. Mark every entered field as unverified and preserve its observation date. Link to known official transactions only after identity resolution, and show conflicts between user data and official evidence. Do not fetch listing photos, copy descriptions, or infer days on market from an arbitrary saved date.

## Acceptance and verification

First test an unknown address, ambiguous flat, invalid price units, conflicting EPC area, malformed URL, and duplicate candidate. Browser acceptance adds and edits a candidate, opens official history when available, and keeps the entered asking amount distinct from achieved prices. A failed match must preserve the user’s candidate instead of silently linking another property.

**Success evidence:** A user can compare a real candidate with area evidence using their own supplied information without requiring portal integration.

**Cleanup:** Avoid a new crawler or listing database and reuse the existing property and local-shortlist models.

## Source files and context

- Main existing files: [property-panel.tsx](<../../../web/src/components/property-panel.tsx>); [contracts.ts](<../../../web/src/lib/contracts.ts>); [profile-state.ts](<../../../web/src/lib/profile-state.ts>); [route.ts](<../../../web/src/app/api/v1/properties/[id]/route.ts>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R2](../03-EVIDENCE-REVIEW.md#r2), [R4](../03-EVIDENCE-REVIEW.md#r4), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-04 (paper/context): Homebuyers and the representation of spatial markets by information providers (Dunning, Grayson, 2014)](https://eprints.whiterose.ac.uk/id/eprint/97036/); [B-03 (forum/context): "Putting our house up for sale – local agent coming round today" — MSE Forum](https://forums.moneysavingexpert.com/discussion/5026909/putting-our-house-up-for-sale-local-agent-coming-round-today); [F-17 (competitor/context): "Zoopla accuracy" — Mumsnet](https://www.mumsnet.com/talk/property/4414013-zoopla-accuracy). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
