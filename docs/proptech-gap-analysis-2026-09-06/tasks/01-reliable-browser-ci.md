# AE-01 — Establish a trustworthy product verification gate

**Priority:** P0 · **Effort:** M · **Status:** proposed; not implemented by this report.

**Dependencies:** None; can start immediately.

## Problem and intended outcome

The existing Playwright configuration reuses any server already answering on port 4180. That can validate a stale preview instead of the candidate build. The approved pilot already identifies CI repair as its first dependency. Real-data changes need reproducible acceptance before a green result can be used to authorize a release.

## Implementation scope

Finish the pilot CI task using isolated test ports, deterministic local map assets, the browsers actually selected by the configuration, and platform-appropriate screenshot baselines. Exercise clipboard denial and server startup failure. Inspect current workflow changes before editing because this checkout contains unrelated uncommitted work. Keep the scope inside Close Knit and its relevant workflow steps.

## Acceptance and verification

First demonstrate a failing test that detects an incorrect reused server or mishandled clipboard denial. Then run web unit tests, typecheck, build, and Chromium/WebKit journeys in a clean Linux checkout. Operate search, selection, sharing, and the mobile sheet. Repeat the data-dependent checks with the pipeline cache present and absent; neither case may require government network access.

**Success evidence:** An independent clean-checkout run identifies the tested build and produces reproducible results. Record actual failures and separate frozen-SDK failures from the product gate.

**Cleanup:** Remove accidental server reuse and obsolete screenshot assumptions; preserve useful deterministic fixtures.

## Source files and context

- Main existing files: [playwright.config.ts](<../../../web/playwright.config.ts>); [explorer.spec.ts](<../../../web/e2e/explorer.spec.ts>); [rendering.spec.ts](<../../../web/e2e/rendering.spec.ts>). (The GitHub Actions workflow that ran these was removed; the account does not pay for Actions.)
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R3](../03-EVIDENCE-REVIEW.md#r3); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-11 (paper/context): Key Factors Influencing Purchase or Rent Decisions in Smart Real Estate Investments (Ullah, Sepasgozar, 2020)](https://www.mdpi.com/2071-1050/12/11/4382/); [A-04 (paper/context): Homebuyers and the representation of spatial markets by information providers (Dunning, Grayson, 2014)](https://eprints.whiterose.ac.uk/id/eprint/97036/). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
