# Research interpretation and evidence review

**Reviewed:** 6 September 2026. Read [the supplied report](RESEARCH-SUPPLIED.md) as the primary research input. The follow-up [source catalogue](05-SOURCE-LINKS.md) now provides 91 user-supplied URLs mapped to the synthesis’s citation IDs. The original 92 worker notes and their full evidence assessments remain unavailable; the E-A01 analytic note has no matching supplied link. Identifiers such as `A-04` and `C-10` below can now be followed through that catalogue. Neither supplied URLs nor the report’s “fully confirms” grades are upgraded into independent full-text verification here.

The repository also has an [earlier UK analytics review](../../../../RESEARCH-uk-analytics.md) and individual competitor notes under [research](../../../../research/). Those are historical context, not current competitor verification. The task briefs now link relevant external research directly, alongside stable sections in this review and actual code files. The catalogue records ambiguities and distinguishes homepages, secondary summaries, and papers.

## Evidence levels used in the backlog

- **Direct code evidence:** current files inspected and, for budget-insensitive scoring, a small executed probe.
- **Official spot check:** an authoritative page retrieved during this assessment, with a narrowly supported conclusion below.
- **Supplied research:** findings as summarized by the user’s report, retaining study country, time, and its caveats.
- **Product hypothesis:** our inference about what to build or measure. Priority is a judgment, not an empirical effect size.

<a id="r1"></a>
## R1 — Search and household needs

**Supplied source links:** [A-02 — Do long-distance moves discourage homeownership? Evidence from England (Ha, Hilber, Schöni, 2021)](05-SOURCE-LINKS.md#paper-a-02); [A-04 — Homebuyers and the representation of spatial markets by information providers (Dunning, Grayson, 2014)](05-SOURCE-LINKS.md#paper-a-04); [A-09 — How to move home from a stress-resistance theoretical perspective (Phipps, 2018)](05-SOURCE-LINKS.md#paper-a-09); [A-11 — Key Factors Influencing Purchase or Rent Decisions in Smart Real Estate Investments (Ullah, Sepasgozar, 2020)](05-SOURCE-LINKS.md#paper-a-11); [A-03 — "First time buyer in London: Tooting/Mitcham v South Norwood?" — MSE Forum](05-SOURCE-LINKS.md#thread-a-03); [A-04 — "First time buyer - feeling overwhelmed" — Mumsnet](05-SOURCE-LINKS.md#thread-a-04).

**Research context:** supplied Q1 and Q3; papers A-02, A-04, A-09, A-11; London threads A-03 and A-04. The useful pattern is an iterative search between areas and individual homes, with budget and commute repeatedly appearing in London accounts. Long-distance movers face an information disadvantage. Renter urgency is plausible, but the reported applicant counts and negotiation practices are anecdotes rather than representative current London statistics.

**Product implication:** prioritize real area coverage, personal constraints, commute screening, comparisons, and saved candidate context. Validate buying and renting separately. Do not use the synthesis to claim a known average search duration or exact number of viewings saved; it explicitly reports that robust funnel timeframe data was not found.

**Existing context:** [personal-area-match plan](../../ROADMAP-personal-area-match.md), [preference panel](../../web/src/components/preference-panel.tsx), [journey model](../../web/src/lib/journeys.ts). **Representative tasks:** AE-03, AE-08, AE-15–AE-18, AE-27–AE-30, AE-34.

<a id="r2"></a>
## R2 — Obtainable data and reliable publication

**Supplied source links:** [B-03 — Chi et al. (2021): A new attribute-linked residential property price dataset for England and Wales, 2011–2019](05-SOURCE-LINKS.md#paper-b-03).

**Research context:** supplied Q2 and Q6. Open transaction, environmental, police, and education sources offer a useful starting point, but availability, licence, actual schema, and coverage are separate questions. The cited B-03 linkage study supports feasibility; its reported 79% match rate is not an acceptance threshold for our own data. Portal data and university-only access must not be assumed reusable commercially.

**Official corrections and confirmations:**

| Topic | What this assessment found | Consequence |
|---|---|---|
| HMLR identifiers | The new dataset links PPD **transaction unique identifiers to UPRNs**, not UPRNs to title numbers. Relationships are only available where the source can establish a link. [Official lookup](https://www.gov.uk/government/statistical-data-sets/transaction-unique-identifier-and-uprn-look-up-table-dataset). | Prefer verified joins; retain unresolved records and measure coverage. |
| PPD licence and lag | PPD has OGL terms, but address data has additional permitted-use conditions and lookup datasets have their own conditions. The latest month is subject to later updates. [Official downloads and conditions](https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads). | Review the intended address use, retain attribution, support corrections, and disclose registration lag. |
| EPC access | The old guidance URL redirected to the new service. Its landing page describes CSV and API access and requires GOV.UK One Login for bulk downloads. It also points to licensing restrictions and notes replaced/expired certificates. [Current EPC service](https://get-energy-performance-data.communities.gov.uk/). | Recheck adapter endpoints and terms; do not assume the historic interface or complete valid certificates. |
| Planning API | An official API exists, including a planning-application query. Its specification remains in development and authorities are not currently required to supply application data to it. [Planning Data documentation](https://www.planning.data.gov.uk/docs). | Replace “no national API exists” with “coverage and authority must be verified.” |
| Planning coverage | The retrieved application catalogue reports no data providers, a September 2025 collection date, and MHCLG-created data pending authoritative replacements. [Application dataset](https://www.planning.data.gov.uk/dataset/planning-application). | A successful query cannot be treated as complete, current coverage of a London borough. |
| Crime source risks | Official downloads and the publisher’s issue history are available. [Downloads](https://data.police.uk/data/), [changelog](https://data.police.uk/changelog/). | Follow the existing pilot’s force/month coverage checks before choosing a release; this assessment did not acquire a complete twelve-month dataset. |

**Unresolved in this assessment:** complete TfL feed/PTAL reuse terms, GIAS download schema and licence details, exact coverage of every environmental source, and a permitted production portal feed. Direct retrieval of the TfL open-data and GIAS downloads pages returned errors. The task backlog includes explicit source review rather than pretending those checks passed.

**Existing context:** [catalogue](../../pipelines/area-analytics-ingest/DATA-CATALOGUE.md), [acquisition](../../pipelines/area-analytics-ingest/area_analytics/acquisition.py), pilot data rules (archived, removed). **Representative tasks:** AE-02–AE-07, AE-10–AE-12, AE-15, AE-21–AE-26, AE-32.

<a id="r3"></a>
## R3 — Decision quality and regret

**Supplied source links:** [A-05 — The role of emotion in a housing purchase (Andrew, Larceneux, 2019)](05-SOURCE-LINKS.md#paper-a-05); [A-10 — Does the Dream of Home Ownership Rest Upon Biased Beliefs? (Odermatt, Stutzer, 2022)](05-SOURCE-LINKS.md#paper-a-10); [A-11 — Key Factors Influencing Purchase or Rent Decisions in Smart Real Estate Investments (Ullah, Sepasgozar, 2020)](05-SOURCE-LINKS.md#paper-a-11); [A-10 — "Have you ever regretted a house purchase?" — Mumsnet (2023)](05-SOURCE-LINKS.md#thread-a-10).

**Research context:** supplied Q3; A-05 covers French off-plan buyers, A-10 German longitudinal satisfaction, A-11 synthesizes regret literature and cites US surveys. These are useful explanations of information gaps and expectation errors. The quoted regret percentages are not measured London prevalence. Neighbour nuisance and failed surveys in threads identify questions worth asking, but cannot establish incidence or identify which households or streets are problematic.

**Product implication:** make uncertainty, evidence completeness, hard limits, recurring costs, and unresolved questions visible. Help users inspect places and compare alternatives. Treat the quality of a decision as a testable outcome, rather than claiming a particular score reduces regret. Do not present deprivation, local income, or tenure composition as direct measures of individual people’s behaviour.

**Existing context:** [matching logic](../../api/area_api/matching.py), [evidence panel](../../web/src/components/evidence-panel.tsx), [privacy primitives](../../api/area_api/privacy.py). **Representative tasks:** AE-08, AE-09, AE-13, AE-14, AE-16, AE-18–AE-20, AE-27–AE-30, AE-34.

<a id="r4"></a>
## R4 — Agent roles and transaction boundaries

**Supplied source links:** [B-01 — Levitt & Syverson (2005): Market Distortions When Agents Are Better Informed](05-SOURCE-LINKS.md#paper-b-01); [B-02 — Gedikli et al. (2026): Online real estate agencies and their impact on the housing market](05-SOURCE-LINKS.md#paper-b-02); [B-04 — Bakker & Datta: Tenant Fees Act — regulating letting-agent fees](05-SOURCE-LINKS.md#paper-b-04); [B-05 — Gilbukh & Goldsmith-Pinkham (2024): Heterogeneous Real Estate Agents and the Housing Cycle](05-SOURCE-LINKS.md#paper-b-05).

**Research context:** supplied Q4; B-01–B-05 and related threads. The synthesis distinguishes open-data analysis from portal membership and the operational work of negotiation, buyer vetting, and chain progression. Historical fee samples, overseas evidence, and selected complaints do not prove that an app can replace current London agents or reproduce their operational value at lower cost.

**Product implication:** support the work before a transaction: candidate context, comparable evidence, unanswered questions, and a shareable brief. User-entered asking prices are a practical bridge to portals. Do not promise current days-on-market or asking-price changes without an authorized source and observation history.

**Material correction:** the report’s statement that the Tenant Fees Act capped tenant payments at £50 is too broad. The £50/reasonable-cost provision relates to a tenant-requested tenancy change; the guidance separately describes permitted payments and deposit rules. [Official statutory guidance](https://www.gov.uk/government/publications/tenant-fees-act-amended-by-the-renters-rights-act-2025/tenant-fees-act-2019-statutory-guidance-for-enforcement-authorities). Any rent-cost feature must verify current effective rules rather than reuse that summary as a universal cap.

**Existing context:** [property panel](../../web/src/components/property-panel.tsx), [public API contract](../../contracts/openapi.yaml). **Representative tasks:** AE-19, AE-20, AE-28–AE-30, AE-34, AE-36.

<a id="r5"></a>
## R5 — Price evidence and model limitations

**Supplied source links:** [C-01 — Hedonic price model, Greater London: which attribute groups explain prices](05-SOURCE-LINKS.md#paper-c-01); [C-04 — Leasehold discount & lease-length decay (England & Wales)](05-SOURCE-LINKS.md#paper-c-04); [C-08 — Energy-efficiency (EPC) green premium, London](05-SOURCE-LINKS.md#paper-c-08); [C-09 — Interest rates / user cost as the dominant macro driver of UK house prices — BoE](05-SOURCE-LINKS.md#paper-c-09); [C-10 — Hedonic size/bedroom and postcode-district premiums, Central London — Bracke](05-SOURCE-LINKS.md#paper-c-10); [E-01 — Does Human-Algorithm Feedback Loop Lead to Error Propagation? Evidence from Zillow's Zestimate](05-SOURCE-LINKS.md#paper-e-01).

**Research context:** supplied Q5 and Q6; C-01–C-10, B-03, E-01. Location, floor area, tenure/lease conditions, energy performance, and access appear in different hedonic or causal studies. Their reported coefficients come from different samples, years, units, and identification strategies. A formula pasted from them is not a fitted and validated contemporary London valuation model. Macro counterfactuals and causal interventions are not interchangeable with cross-sectional property attributes.

**Product implication:** lead with achieved-sale evidence and comparable samples; retain missing floor area; distinguish asking prices, adjusted historic prices, descriptive peer comparisons, and estimates. Validate ranges empirically before calling them calibrated. Show new-build/property-type composition rather than interpreting differences between raw medians as premiums. Do not infer bedrooms from EPC rooms or refurbishment from an unexplained certificate change.

**Leasehold correction:** an eighty-year historical price pattern is not a substitute for current legal commencement checks or the individual lease. Current government material describes valuation changes and further steps needed to bring them into force. [Government leasehold explainer](https://www.gov.uk/government/consultations/leasehold-enfranchisement-valuation-rates/plain-english-explainer-extending-your-lease-or-buying-your-freehold-its-getting-cheaper-and-easier). Do not encode the supplied research’s threshold as permanent law or a ready-made discount schedule.

**Code-specific concern:** [forecasting](../../pipelines/area-analytics-ingest/area_analytics/forecasting.py) computes one-step selection errors and uses its residual set when reporting interval coverage; [property assembly](../../pipelines/area-analytics-ingest/area_analytics/property_pack.py) takes a supplied confidence-band schedule. These are reasons for dedicated validation work, not a claim that every output has been numerically tested and disproven.

**Existing context:** [decomposition](../../pipelines/area-analytics-ingest/area_analytics/decompose.py), [peer groups](../../pipelines/area-analytics-ingest/area_analytics/peers.py), [property history](../../pipelines/area-analytics-ingest/area_analytics/property_history.py). **Representative tasks:** AE-10–AE-14, AE-19, AE-20, AE-33.

<a id="r6"></a>
## R6 — Competitive positioning and what to build

**Supplied source links:** [F-01 — Rightmove](05-SOURCE-LINKS.md#f-01); [F-02 — Zoopla](05-SOURCE-LINKS.md#f-02); [F-04 — Proportunity](05-SOURCE-LINKS.md#f-04); [F-10 — Immowelt](05-SOURCE-LINKS.md#f-10); [F-11 — Zillow](05-SOURCE-LINKS.md#f-11); [F-12 — Redfin](05-SOURCE-LINKS.md#f-12); [F-17 — "Zoopla accuracy" — Mumsnet](05-SOURCE-LINKS.md#f-17); [F-18 — Zestimate vs Redfin Estimate — Inman (2017)](05-SOURCE-LINKS.md#f-18).

**Research context:** supplied Q6 and country comparisons; F-01–F-16. The competitive matrix is a useful hypothesis map, but the underlying app notes remain unavailable; competitor homepage links are now supplied, but current features were not independently re-audited. Avoid claiming that no competitor offers a feature or that a proposed gap is a durable moat.

**Product implication:** position Close Knit around a coherent workflow: unfamiliar areas → personal constraints → evidence-based shortlist → candidates → next investigations. Its potential distinction is the connection between these steps with transparent sources, not the existence of another price estimate or isolated area page. Promote cross-area comparison and total costs because they complete that workflow. Defer full listing coverage and predictive investment positioning.

The product already includes important building blocks in [the README](../../README.md). Earlier [Crystal Roof notes](../../../../research/crystalroof.md), [Housemetric notes](../../../../research/housemetric.md), and [TravelTime notes](../../../../research/traveltime.md) provide additional local context, with freshness limitations. Compare our workflow against participants’ actual alternatives in AE-34 before selecting messaging or monetization.

**Representative tasks:** AE-15–AE-18, AE-23–AE-30, AE-34–AE-36.

## Unanswered research questions to carry forward

1. Which London segment values this most: first-time buyers, renters relocating, families, or households balancing multiple workplaces?
2. Which three facts actually change an area shortlist, and which metrics distract or duplicate existing portals?
3. Can participants correctly distinguish coarse area statistics, a known property fact, and a modelled estimate?
4. Does the comparison/brief save effort or merely move existing research into a different interface?
5. What would people pay for, and at what point in their search? No pricing evidence was supplied.
6. How uneven are real identity linkage and evidence coverage across flats, houses, price bands, and London geographies?
7. Which official data products can be maintained sustainably under their current terms, cadence, and access method?

Answer these through source validation and bounded user research, not by adding more speculative ranking factors.
