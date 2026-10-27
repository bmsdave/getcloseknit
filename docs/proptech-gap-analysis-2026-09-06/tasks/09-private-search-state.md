# AE-09 — Verify privacy across profiles requests caches and sharing

**Priority:** P0 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-01 — Establish a trustworthy product verification gate](01-reliable-browser-ci.md)

## Problem and intended outcome

Local profiles and redacted opt-in analytics already exist. Budget, home-search intent, and precise commute destinations become more sensitive when real-data requests, saved comparisons, and exports are added. The current privacy design should become a verified boundary across those paths rather than being rebuilt as an account system.

## Implementation scope

Trace profile data through API requests, application logs, reverse-proxy configuration, browser storage, service-worker caches, and sharing. Keep exact destinations transient on the server, exclude personalized responses from shared caches, and retain analytics only after explicit opt-in using the existing redaction shape. Provide local erase/reset behavior and a visible preview of sensitive fields before explicit sharing.

## Acceptance and verification

First create tests with canary destination coordinates and unusual budgets, then assert they are absent from logs, telemetry events, public URLs, and cached responses. Exercise opt-in, opt-out, erase, denied local storage, and explicit share in the browser. Demonstrate that a normal map open neither transmits a raw profile unnecessarily nor creates a public profile URL.

**Success evidence:** Canary private values appear only in the authorized transient request or explicitly approved share payload.

**Cleanup:** Remove redundant telemetry collection and stale profile copies; preserve the existing local-first design.

## Source files and context

- Main existing files: [privacy.py](<../../../api/area_api/privacy.py>); [test_privacy.py](<../../../api/tests/test_privacy.py>); [profile-state.ts](<../../../web/src/lib/profile-state.ts>); [map-state.ts](<../../../web/src/lib/map-state.ts>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R3](../03-EVIDENCE-REVIEW.md#r3); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-03 (paper/context): Housing Search in the Age of Big Data (Boeing et al., 2020)](https://arxiv.org/abs/2001.11585); [A-11 (paper/context): Key Factors Influencing Purchase or Rent Decisions in Smart Real Estate Investments (Ullah, Sepasgozar, 2020)](https://www.mdpi.com/2071-1050/12/11/4382/). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
