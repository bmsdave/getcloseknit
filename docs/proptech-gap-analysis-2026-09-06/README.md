# Close Knit: research gaps and prioritized tasks

**6 September 2026 · 36 detailed implementation briefs · London-first · documentation only**

The strongest next step is to turn the existing preview into a trustworthy real-data decision service, then connect budget, commute, achieved prices, and area comparison into a useful household shortlist. Much of the UI already exists; completing its evidence and production behavior has higher value than adding more screens.

## Reports

1. [Gap assessment](01-GAP-ASSESSMENT.md): what exists, what is missing, concrete code findings, and what to defer.
2. [Priorities and delivery](02-PRIORITIES-AND-DELIVERY.md): P0/P1/P2 policy, dependency waves, effort assumptions, success measures, and acceptance gates.
3. [Evidence review](03-EVIDENCE-REVIEW.md): research interpretation, official-source corrections, unavailable evidence, and open questions.
4. [Verification record](04-VERIFICATION.md): actual document checks and the executed production-scoring probe.
5. [Supplied research](RESEARCH-SUPPLIED.md): preserved synthesis, including its own limitations.
6. [Research source catalogue](05-SOURCE-LINKS.md): 91 supplied URLs mapped to citation IDs, source-type cautions, and the missing E-A01 reference. The [original link attachment](RESEARCH-LINKS-SUPPLIED.md) is also preserved.

Read the reports before starting a task. Every task contains more than 100 words of substantive problem/scope/acceptance detail, dependencies, success evidence, cleanup, main existing source-file links, and research/context links, including relevant direct external sources from the follow-up bibliography. File paths are relative for repository portability. Some linked implementation files are pre-existing uncommitted work in the assessed checkout; the verification record identifies that portability limitation.

Start with AE-01, AE-02, AE-09, and AE-34, prepare the AE-08 regression, and complete the agreed official-boundaries/crime pilot. Release also requires AE-31 and AE-32. Then prioritize price/rent evidence, real commute screening, and comparison. Task IDs are references, not a strict execution sequence; P0 tasks later in the list remain launch blockers.

<a id="tasks"></a>
## Task index

| Task | Outcome | Priority | Effort | Depends on |
|---|---|---|---|---|
| [AE-01](tasks/01-reliable-browser-ci.md) | Establish a trustworthy product verification gate | P0 | M | — |
| [AE-02](tasks/02-reviewed-source-registry.md) | Turn the data catalogue into an enforceable source registry | P0 | M | — |
| [AE-03](tasks/03-official-london-geography.md) | Publish official London statistical boundaries and hierarchy | P0 | L | AE-01, AE-02 |
| [AE-04](tasks/04-atomic-data-releases.md) | Activate and roll back coherent analytics releases | P0 | M | AE-02, AE-03 |
| [AE-05](tasks/05-recorded-crime-release.md) | Deliver the first validated recorded-crime release | P0 | L | AE-03, AE-04 |
| [AE-06](tasks/06-production-evidence-api.md) | Connect search and evidence to the production API | P0 | L | AE-03, AE-04, AE-05 |
| [AE-07](tasks/07-real-demo-separation.md) | Make Real data and Demo modes impossible to confuse | P0 | M | AE-06 |
| [AE-08](tasks/08-profile-aware-production-matching.md) | Make production matches respond to budget and destinations | P0 | M | AE-01, AE-04 |
| [AE-09](tasks/09-private-search-state.md) | Verify privacy across profiles requests caches and sharing | P0 | M | AE-01 |
| [AE-10](tasks/10-price-paid-ingestion.md) | Publish corrected and versioned achieved-sale transactions | P1 | L | AE-02, AE-04 |
| [AE-11](tasks/11-property-identity-epc.md) | Link transactions and EPC records without merging different homes | P1 | L | AE-02, AE-10 |
| [AE-12](tasks/12-reliable-area-price-comparisons.md) | Deliver reliable area prices and comparable history | P1 | M | AE-10, AE-11 |
| [AE-13](tasks/13-honest-property-dossiers.md) | Show incomplete property histories and qualify inferred events | P1 | M | AE-10, AE-11 |
| [AE-14](tasks/14-valuation-calibration.md) | Make estimate ranges and price explanations empirically defensible | P1 | L | AE-11, AE-12, AE-13 |
| [AE-15](tasks/15-rental-affordability.md) | Replace rental affordability fixtures with appropriately coarse evidence | P1 | M | AE-02, AE-04, AE-08 |
| [AE-16](tasks/16-preferences-and-tradeoffs.md) | Capture real household needs and explain trade-offs | P1 | M | AE-08, AE-15 |
| [AE-17](tasks/17-real-multi-destination-commutes.md) | Deliver real multi-destination commute screening | P1 | L | AE-02, AE-03, AE-04, AE-08 |
| [AE-18](tasks/18-area-comparison.md) | Add a side-by-side area shortlist comparison | P1 | M | AE-06, AE-08, AE-12, AE-15 |
| [AE-19](tasks/19-total-housing-cost.md) | Compare total housing costs with editable assumptions | P1 | M | AE-15, AE-16, AE-29 |
| [AE-20](tasks/20-leasehold-due-diligence.md) | Expose leasehold costs and unanswered diligence questions | P1 | M | AE-13, AE-29 |
| [AE-21](tasks/21-school-evidence.md) | Connect school discovery to dated official observations | P1 | L | AE-02, AE-03, AE-04, AE-06 |
| [AE-22](tasks/22-school-admissions.md) | Show admissions evidence without promising a school place | P1 | M | AE-21 |
| [AE-23](tasks/23-flood-screening.md) | Add source-specific flood screening for candidate places | P1 | M | AE-02, AE-03, AE-04, AE-06 |
| [AE-24](tasks/24-noise-and-visit-times.md) | Add noise context and prompts for repeat area visits | P2 | M | AE-02, AE-03, AE-06 |
| [AE-25](tasks/25-walkable-amenities.md) | Measure useful access to parks and everyday amenities | P2 | M | AE-02, AE-03, AE-17 |
| [AE-26](tasks/26-planning-context.md) | Pilot planning constraints and nearby applications with coverage | P2 | M | AE-02, AE-03, AE-06 |
| [AE-27](tasks/27-saved-shortlists.md) | Persist and explicitly share reproducible shortlists | P1 | M | AE-09, AE-18 |
| [AE-28](tasks/28-viewing-and-area-checklist.md) | Turn missing evidence into a practical viewing checklist | P1 | M | AE-09, AE-13, AE-27 |
| [AE-29](tasks/29-user-property-candidates.md) | Let users add property candidates without a listings feed | P1 | M | AE-09, AE-11, AE-13 |
| [AE-30](tasks/30-decision-brief.md) | Export a sourced household decision brief | P1 | M | AE-18, AE-20, AE-27, AE-28, AE-29 |
| [AE-31](tasks/31-london-scale-accessibility-performance.md) | Keep real London usable on mobile and without the map | P0 | M | AE-01, AE-03, AE-06 |
| [AE-32](tasks/32-data-health-and-corrections.md) | Expose data freshness failures and a correction workflow | P0 | M | AE-02, AE-04, AE-06 |
| [AE-33](tasks/33-forecast-validation.md) | Gate forecasts on horizon-specific out-of-sample evidence | P2 | L | AE-04, AE-12, AE-14 |
| [AE-34](tasks/34-london-user-validation.md) | Validate the decision-support proposition with London households | P0 | S | — |
| [AE-35](tasks/35-cross-platform-contracts.md) | Keep native clients compatible with the real-data contract | P1 | M | AE-06, AE-07, AE-13 |
| [AE-36](tasks/36-agent-readable-evidence.md) | Expose bounded evidence retrieval for assistant workflows | P2 | M | AE-06, AE-09, AE-18, AE-30 |

All tasks are proposed work. This package changes no application behavior and makes no deployment, merge, or full-suite pass claim. The existing pilot (archived, removed) and [product roadmap](../../ROADMAP-personal-area-match.md) remain the implementation context.
