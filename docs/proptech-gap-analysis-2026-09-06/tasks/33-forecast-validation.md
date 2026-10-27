# AE-33 — Gate forecasts on horizon-specific out-of-sample evidence

**Priority:** P2 · **Effort:** L · **Status:** proposed; not implemented by this report.

**Dependencies:** [AE-04 — Activate and roll back coherent analytics releases](04-atomic-data-releases.md); [AE-12 — Deliver reliable area prices and comparable history](12-reliable-area-price-comparisons.md); [AE-14 — Make estimate ranges and price explanations empirically defensible](14-valuation-calibration.md)

## Problem and intended outcome

Forecasting already exists and suppresses some unsupported outcomes, so another forecast UI is not the gap. Inspection shows model selection based on one-step predictions and interval coverage computed from the residual set used to construct the band. That does not demonstrate calibrated uncertainty for each displayed longer horizon or a causal forecast of local regeneration.

## Implementation scope

Validate chronological monthly input without duplicates or gaps, then implement rolling-origin holdouts aligned with every offered horizon. Separate model selection, calibration, and final evaluation periods. Compare against no-change and appropriate seasonal baselines, retain source versions and revisions, and report error and coverage by carrier. Keep growth optional in matching and unavailable until its own evidence gate passes.

## Acceptance and verification

First test duplicated periods, missing months, leakage from future data, an apparently strong one-month model that fails a longer horizon, and under-covered intervals. Run deterministic fixtures and a reproducible dated backtest report. Browser acceptance displays the failed gate and removes unsupported growth contributions instead of substituting fixture forecasts. Do not import macro research coefficients as property-level predictions.

**Success evidence:** Forecasts are published only when the exact displayed horizon passes predeclared validation, with interpretable intervals and adequate evaluation samples.

**Cleanup:** Remove same-residual calibration claims and fixture-based real-mode growth; retain suppression and baseline logic that remains valid.

## Source files and context

- Main existing files: [forecasting.py](<../../../pipelines/area-analytics-ingest/area_analytics/forecasting.py>); [test_forecasting.py](<../../../pipelines/area-analytics-ingest/tests/test_forecasting.py>); [route.ts](<../../../web/src/app/api/v1/areas/[id]/price-forecast/route.ts>); [forecast.test.ts](<../../../web/tests/forecast.test.ts>).
- Research rationale: [R3](../03-EVIDENCE-REVIEW.md#r3), [R5](../03-EVIDENCE-REVIEW.md#r5), [R6](../03-EVIDENCE-REVIEW.md#r6); [complete supplied research](../RESEARCH-SUPPLIED.md).
- Direct research links (user-supplied context; not independently reverified): [E-01 (paper/context): Does Human-Algorithm Feedback Loop Lead to Error Propagation? Evidence from Zillow's Zestimate](https://questromworld.bu.edu/platformstrategy/wp-content/uploads/sites/49/2024/06/PlatStrat2024_paper_102.pdf); [C-09 (paper/context): Interest rates / user cost as the dominant macro driver of UK house prices — BoE](https://www.bankofengland.co.uk/-/media/boe/files/working-paper/2019/uk-house-prices-and-three-decades-of-decline-in-the-risk-free-real-interest-rate.pdf); [F-04 (competitor/context): Proportunity](https://proportunity.co/). See [citation mapping and source limitations](../05-SOURCE-LINKS.md).
- Product context: [gap assessment](../01-GAP-ASSESSMENT.md), [priority and delivery policy](../02-PRIORITIES-AND-DELIVERY.md), [existing product roadmap](<../../../ROADMAP-personal-area-match.md>).
- All implementation follows [the common acceptance gate](../02-PRIORITIES-AND-DELIVERY.md#acceptance). File links identify current entry points, not a requirement to place every change in those files. Preserve unrelated work and inspect the latest diff before implementation.
