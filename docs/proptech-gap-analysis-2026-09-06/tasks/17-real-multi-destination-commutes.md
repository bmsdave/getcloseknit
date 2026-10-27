# AE-17 — Deliver real multi-destination commute screening

**Priority:** P1 · **Effort:** L · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-02 — Turn the data catalogue into an enforceable source registry](02-reviewed-source-registry.md); [AE-03 — Publish official London statistical boundaries and hierarchy](03-official-london-geography.md); [AE-04 — Activate and roll back coherent analytics releases](04-atomic-data-releases.md); [AE-08 — Make production matches respond to budget and destinations](08-profile-aware-production-matching.md)

## Problem and intended outcome

Commute appears repeatedly in the London research and is already represented by destination models, routing primitives, and journey UI. Production journey durations are still described as fixtures. Reliable multi-destination screening is more valuable to the launch proposition than adding another decorative map layer.

## Implementation scope

Connect a versioned street network and permitted timetable feeds to coarse area-origin matrices, retaining arrival band, travel mode, transfer/walking components, network date, and destination approximation. Combine active household destinations using the documented weights and hard maximums. Label approximate area-origin results clearly and reserve precise address routing for a separate, explicitly requested journey. Expose unavailable or disconnected routes rather than a guessed duration.

## Acceptance and verification

First test network version changes, unreachable destinations, weekend/service-band differences, zero-weight destinations, and an exceeded maximum commute. Use fixed network fixtures in automated tests. Browser acceptance edits a destination and arrival band, then checks changed eligibility and displayed route assumptions. Verify cancellation and cache reuse without persisting precise destinations in logs.

**Success evidence:** Commute-based shortlist decisions can be reproduced from the network release and profile, with no synthetic durations in real mode.

**Cleanup:** Remove preview journey formulas from production selection and duplicate route computations on unchanged inputs.

## Source files and context

- Main existing files: [routing.py](<../../../api/area_api/routing.py>); [README.md](<../../../deploy/routing/README.md>); [journeys.ts](<../../../web/src/lib/journeys.ts>); [journeys.test.ts](<../../../web/tests/journeys.test.ts>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R2](../03-EVIDENCE-REVIEW.md#r2), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-03 (forum/context): "First time buyer in London: Tooting/Mitcham v South Norwood?" — MSE Forum](https://forums.moneysavingexpert.com/discussion/6581673/first-time-buyer-in-london-tooting-mitcham-v-south-norwood); [C-06 (paper/context): Rail access uplift: Jubilee Line Extension / DLR (London)](http://eprints.lse.ac.uk/19989/1/Valuing_Rail_Access_Using_Transport_Innovations.pdf); [F-10 (competitor/context): Immowelt](https://www.immowelt.de/). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
