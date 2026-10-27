# AE-34 — Validate the decision-support proposition with London households

**Priority:** P0 · **Effort:** S · **Status:** proposed; not implemented by this report.

**Dependencies:** None; can start immediately.

## Problem and intended outcome

The supplied research supports plausible user problems, but many behavioural claims come from non-UK studies or selected forum anecdotes. It does not establish London demand, willingness to pay, or that an extra score improves decisions. Product discovery should run alongside the data pilot before the whole feature backlog becomes a commitment.

## Implementation scope

Prepare a consent-based study with an initial eight to twelve London households split across buyers and renters, including unfamiliar-area movers and different commute or school needs. This is a qualitative discovery sample, not a prevalence survey. Observe their current workflow, then test a shortlist comparison and decision brief. Measure task completion, comprehension of uncertainty, time to a defensible shortlist, unresolved questions, and explicit interest in paying for the output.

## Acceptance and verification

Write the research protocol and success/stop rules before sessions. Distinguish existing portal capabilities from unique Close Knit value. Record contradictory findings, recruit beyond friends where feasible, and avoid claiming statistically significant conversion effects from this sample. Use the current fixture surface only with clear labels until real data is ready. Recruitment messages require a separately authorized communication action.

**Success evidence:** An evidence summary identifies which decision jobs users value, what they misunderstand, and which tasks should be advanced, narrowed, or stopped.

**Cleanup:** Remove unsupported marketing claims and defer proposed features that participants cannot connect to a useful decision.

## Source files and context

- Main existing files: [README.md](<../../../README.md>); [ROADMAP-personal-area-match.md](<../../../ROADMAP-personal-area-match.md>); [personal-match-panel.tsx](<../../../web/src/components/personal-match-panel.tsx>); [privacy.py](<../../../api/area_api/privacy.py>).
- Research rationale: [R1](../03-EVIDENCE-REVIEW.md#r1), [R3](../03-EVIDENCE-REVIEW.md#r3), [R4](../03-EVIDENCE-REVIEW.md#r4), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [A-02 (paper/context): Do long-distance moves discourage homeownership? Evidence from England (Ha, Hilber, Schöni, 2021)](http://eprints.lse.ac.uk/108928/1/Manuscript_for_JHE_forthcoming.pdf); [A-10 (paper/context): Does the Dream of Home Ownership Rest Upon Biased Beliefs? (Odermatt, Stutzer, 2022)](https://link.springer.com/article/10.1007/s10902-022-00571-w); [A-11 (paper/context): Key Factors Influencing Purchase or Rent Decisions in Smart Real Estate Investments (Ullah, Sepasgozar, 2020)](https://www.mdpi.com/2071-1050/12/11/4382/). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
