# Close Knit gap assessment

**Assessment date:** 6 September 2026. **Scope:** London-first home-moving decision support; current working tree at repository HEAD `961c16f`, including visible uncommitted property-dossier work. This is a research-to-code assessment, not a production certification or visual UX audit.

Close Knit’s largest gap is the distance between its implemented preview experience and a reproducible real-data decision service. The app already has many of the surfaces recommended in the research. The strongest next investment is making those surfaces answer real household questions accurately, then connecting them into a shortlist, comparison, and investigation workflow.

## What to preserve

The [product README](../../README.md) describes MapLibre, web-first delivery, explicit preview labels, evidence-carrier geography, source-linked evidence, local profiles, and a cross-platform API boundary. These are valuable choices. The vision (former monorepo) favors deleting redundant code and separating the product from the rendering SDK. The [personal-area-match roadmap](../../ROADMAP-personal-area-match.md) is the relevant existing product plan. This package adds a research-led delivery backlog; it does not redefine the SDK v2 contract (former monorepo).

Do not rebuild MapLibre or begin a global renderer project to close London product gaps. Do not reimplement matching, price history, school scoring, or dossiers as if they were absent. Finish the existing supervised data pilot (archived, removed), retaining its separate agent-execution restrictions if that pilot mechanism is used. Its status report (archived, removed) describes a blocked agent-route preflight and unstarted real-data tasks as of 3 September; it is historical status, not a fresh execution result. The product work can be specified here without launching that fleet or changing its authorization.

## Capability and gap matrix

“Implemented primitive” means code was inspected; it does not mean deployed, validated with official data, or accepted in a browser. “No implementation found” is bounded to the inspected project and pipeline files.

| Capability | Current evidence | Gap and user consequence | Recommended work |
|---|---|---|---|
| Real area coverage | [README](../../README.md), [geometry tests](../../web/tests/geometry.test.ts), [Martin configuration](../../deploy/martin.yaml) | Three documented synthetic polygons cannot support a London-wide shortlist. | AE-03, AE-06, AE-07 |
| Data provenance and publication | [acquisition](../../pipelines/area-analytics-ingest/area_analytics/acquisition.py), [schema](../../deploy/schema.sql) | Manifest and immutability primitives exist; eligibility, coherent activation, and operational readiness need completion. | AE-02, AE-04, AE-32 |
| Production API | [FastAPI app](../../api/area_api/app.py), [search route](../../web/src/app/api/v1/search/route.ts) | Production app exposes health and matches; web search explicitly imports fixtures. A real database is not yet a complete product journey. | AE-06, AE-07 |
| Personal match | [Python scorer](../../api/area_api/matching.py), [web scorer](../../web/src/lib/matching.ts) | Production calculation consumes stored utilities and ignores budget/destinations; fixture behavior is more personalized. | AE-08, AE-16 |
| Recorded crime | pilot plan (archived, removed), [evidence panel](../../web/src/components/evidence-panel.tsx) | Existing layer lacks a demonstrated official release with force/month coverage and correct denominator. | AE-05 |
| Achieved prices | [analytics](../../pipelines/area-analytics-ingest/area_analytics/analytics.py), [history](../../pipelines/area-analytics-ingest/area_analytics/property_history.py) | Transformations exist; acquisition, corrections, eligibility, and live delivery remain the key gaps. | AE-10, AE-12 |
| Property identity and EPC | [property spine](../../pipelines/area-analytics-ingest/area_analytics/properties.py), [database](../../deploy/schema.sql) | Address-derived IDs and UPRN-oriented storage need reconciliation; ambiguous flat joins can misattribute facts. | AE-11 |
| Property dossier | [pack builder](../../pipelines/area-analytics-ingest/area_analytics/property_pack.py), [panel](../../web/src/components/property-panel.tsx) | Uncommitted implementation already exists; missing EPC currently aborts dossier assembly, while derived events can overstate certainty. | AE-13 |
| Estimates and explanations | [decomposition](../../pipelines/area-analytics-ingest/area_analytics/decompose.py), [waterfall](../../web/src/components/price-waterfall.tsx) | Descriptive medians and age-based bands do not establish causal premiums or calibrated prediction intervals. | AE-14 |
| Renting | [match fixtures](../../web/src/lib/matching.ts), [catalogue](../../pipelines/area-analytics-ingest/DATA-CATALOGUE.md) | Mode exists, but genuine borough-level rent evidence is not wired in; synthetic parent-ID substitution is unsuitable for production. | AE-15 |
| Household preferences | [preference panel](../../web/src/components/preference-panel.tsx), [profile contract](../../web/src/lib/contracts.ts) | Weights and limits exist; clearer must-haves, compromise explanations, and a review of socioeconomic proxies are needed. | AE-16 |
| Commute | [routing](../../api/area_api/routing.py), [journeys](../../web/src/lib/journeys.ts) | Models and primitives exist; production timetable/network results remain unverified. | AE-17 |
| Compare and remember | [match panel](../../web/src/components/personal-match-panel.tsx), [local profile state](../../web/src/lib/profile-state.ts) | Local profiles and sharing exist; no completed multi-area saved comparison was found in inspected files. | AE-18, AE-27 |
| Total costs and lease diligence | [property contracts](../../web/src/lib/contracts.ts), [property panel](../../web/src/components/property-panel.tsx) | Tenure is present; verified lease terms, recurring charges, and an explicit uncertainty worksheet are not established. | AE-19, AE-20 |
| Schools and admissions | [school scoring](../../pipelines/area-analytics-ingest/area_analytics/school_scoring.py), [admissions](../../pipelines/area-analytics-ingest/area_analytics/school_admissions.py) | Good suppression/model foundations; official acquisition, current records, and bounded authority coverage need delivery. | AE-21, AE-22 |
| Environment and local change | [source catalogue](../../pipelines/area-analytics-ingest/DATA-CATALOGUE.md) | Noise and amenities are anticipated; no completed real flood/noise/amenity/planning product release is claimed. | AE-23–AE-26 |
| Viewing and decision output | [evidence panel](../../web/src/components/evidence-panel.tsx), [property panel](../../web/src/components/property-panel.tsx) | Analytics need a bridge to user-entered candidates, visits, unanswered questions, and a durable brief. | AE-28–AE-30 |
| Trust and usability gates | [Playwright config](../../web/playwright.config.ts), [privacy](../../api/area_api/privacy.py), [accessibility tests](../../web/e2e/accessibility.spec.ts) | Server reuse risks wrong-build checks; official London scale and new privacy paths need acceptance. | AE-01, AE-09, AE-31 |
| Forecasts | [forecasting](../../pipelines/area-analytics-ingest/area_analytics/forecasting.py) | Existing backtesting uses one-step model selection; longer-horizon calibration and independent interval evaluation are not demonstrated. | AE-33 |
| Demand and business value | [supplied research](RESEARCH-SUPPLIED.md), [existing product plan](../../ROADMAP-personal-area-match.md) | No measured London product-market fit, willingness to pay, or decision-quality improvement was supplied. | AE-34 |
| Native and agent consumers | [OpenAPI](../../contracts/openapi.yaml), [Swift](../../ios/Sources/CloseKnitCore/Contracts.swift), [Kotlin](../../android/core/src/main/kotlin/org/closeknit/london/Contracts.kt) | Native scaffolding exists; contract drift needs prevention. Agent evidence access should follow a stable useful API. | AE-35, AE-36 |

Task IDs are linked in the [complete index](README.md#tasks).

## Confirmed issue: the production score does not react to budget

A read-only probe imported `build_match_pack` from the existing API, supplied a £500,000 affordability observation with stored utility 60, and changed only target/maximum budget:

| Profile | Observed production score |
|---|---:|
| Target £300,000; maximum £400,000 | 60 |
| Target £600,000; maximum £700,000 | 60 |

The [repository query](../../api/area_api/repository.py) selects factors from the profile but not market, budgets, or destinations. The [web fixture matcher](../../web/src/lib/matching.ts) calculates affordability and commute from those inputs. This is direct evidence of a behavior gap in the inspected scorer, not a claim about an independently tested deployed server. AE-08 requires failing regression tests before correction. This documentation task does not modify the scorer.

## What the research changes in our priorities

The research’s useful hypothesis is that unfamiliar-area decisions are underserved by listing-first search. It supports a London proposition centered on budget, commute, evidence quality, and explicit compromises. The most defensible product promise is: **help a household shortlist places, compare the trade-offs, and know what to investigate next**. This is an inference to test with users, not a proven competitive moat.

Promote comparison, total costs, user-entered candidates, and a decision brief above investment forecasts and new presentation surfaces. In the supplied report, some of these appear as nice-to-have features. For this product, they connect existing analytics to a finished household decision and deserve earlier testing. Keep crime-first as the agreed engineering pilot; do not mistake a crime-only launch for validation of the full home-search proposition.

Retain socioeconomic datasets as accurately described context where appropriate, while reviewing whether existing default ranking directions imply unsupported conclusions about neighbours or suitability. The research explicitly points to preference heterogeneity and unobserved neighbourhood quality. It does not justify a universal desirability score, guarantees about schools or safety, or applying historic hedonic coefficients to every home.

## What to defer

- Full portal/listing aggregation, asking-price history, and automated days-on-market claims until a permitted partner feed exists. Start with user-entered observations.
- Agent replacement, offer submission, mortgage broking, buyer vetting, and chain progression. These introduce a different operational product and are not required for pre-decision value.
- A new global renderer, international launch, and a complete native UI expansion. Preserve the long-term vision through contracts and data boundaries.
- Confident house-price forecasts or automated “up-and-coming” recommendations before independent backtesting and user-value evidence.
- Neighbour-level reputation data and scraped competitor ratings. The inspected source policy already excludes competitor ratings; recorded area evidence is not a basis for personal claims.

## Limits of this assessment

The complete supplied synthesis was read and copied into this project. A follow-up [source catalogue](05-SOURCE-LINKS.md) now supplies 91 direct URLs. The claimed 92 underlying worker research files remain unavailable, with no supplied link for E-A01. Their support grades remain the author’s grades, not independently reproduced verification. These references improve traceability; they do not by themselves establish new findings or change the recommended priorities. Official-source spot checks correct a few material claims in [the evidence review](03-EVIDENCE-REVIEW.md); this is not a full replication of every cited paper or competitor feature.

No production deployment, live database import, browser session, or full application test suite was run for this documentation-only change. Existing uncommitted files were read as current work and left unchanged. Proposed thresholds and effort estimates are planning choices, not measured project outcomes.
