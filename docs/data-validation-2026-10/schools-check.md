# Schools cross-check (checked 2026-10-01)

Sources: Ofsted provider pages (reports.ofsted.gov.uk), Locrating free view (directory page, postcode "best schools" list, map info panel), DfE Compare School Performance (CSP; 2024/25 KS4 **final**, published April 2026).
Our data: `ofsted_latest_inspections_31Aug2026.csv` + KS4 2024/25 **provisional** (`etl_schools.py`).

Legend: OK = match, **MISMATCH** / **GAP** = differs / we show nothing.

| URN | School | Ours | Ofsted site (latest) | Locrating | DfE CSP 2024/25 | Verdict / likely reason |
|---|---|---|---|---|---|---|
| 145724 | Ada Lovelace CofE High (sec) | Outstanding; A8 64.3; 5+ E&M 77.7% | Outstanding, graded 11 Jan 2023 | Outstanding; A8 64.4; 77.7% | A8 64.4; 77.7% | Ofsted OK. **A8 MISMATCH 64.3 vs 64.4**: provisional vs final |
| 101941 | Ellen Wilkinson School for Girls (sec) | no Ofsted; A8 56.5; 65.3% | Outstanding (graded Jun 2019); ungraded 14 Jan 2025 | Outstanding; A8 56.5; 65.3% | A8 56.5; 65.3% | **GAP Ofsted**: last graded inspection was before the current framework (OEIF), so the OEIF column in the CSV is empty; ungraded 2025 outcome "Improved significantly". KS4 OK |
| 101912 | Montpelier Primary | Good | Good, 14 Nov 2023 | Good | n/a | OK |
| 137569 | Holy Family Catholic Primary | Outstanding | Outstanding, 15 May 2024 | Outstanding | n/a | OK |
| 101876 | West Acton Primary | Good | Good, 22 Feb 2023 | Good | n/a | OK |
| 136445 | Christ the Saviour CofE Primary | Good | Good, 14 Nov 2023 | Good | n/a | OK |
| 131842 | Hugh Myddelton Primary | none | Outstanding (graded Jun 2017); ungraded 24 Jan 2024 | Outstanding | n/a | **GAP**: pre-OEIF grade kept by an ungraded inspection ("School remains Outstanding") |
| 100415 | Moreland Primary | none | Good (graded Mar 2016); ungraded 8 Jul 2025 | Good | n/a | **GAP**: pre-OEIF grade; ungraded outcome "Standards maintained" |
| 100447 | St Peter & St Paul Catholic Primary | Good | Good, 27 Jun 2023 | Good | n/a | OK |
| 100407 | Hanover Primary | Good | Good, 9 Jul 2024 | Good | n/a | OK |
| 100438 | St John Evangelist Catholic Primary | none | Good (graded Oct 2014); ungraded 23 Apr 2024 | Good | n/a | **GAP**: pre-OEIF grade; ungraded "School remains Good" |
| 143020 | City of London Primary Academy, Islington | Outstanding | Outstanding (graded 5 Nov 2019); ungraded 18 Mar 2025 | Outstanding | n/a | OK. Our date reflects 2019 graded; newer ungraded visit not shown |
| 136564 | Whitehorse Manor Infant | Good | Good, 5 Mar 2024 | Good | n/a | OK |
| 136565 | Whitehorse Manor Junior | Report card: all 6 areas "Expected standard" | Report card 2 Jun 2026: all 6 Expected, safeguarding met, no overall grade | "No Ofsted rating", Locrating rating Good; report card shown (all Expected, safeguarding Met) | n/a | OK. We don't show "Safeguarding: met" |
| 101849 | BRIT School (sec, 14-19) | no Ofsted; A8 50.0; 53.8% | Graded 19 Nov 2024: QoE, B&A, PD, L&M, sixth form all Outstanding; no overall (post-Sep 2024) | "No Ofsted rating", Locrating rating Outstanding; A8 50.1; 54.3% | A8 50.1; 54.3% | **GAP Ofsted**: CSV has overall "Not judged". The four key judgements aren't loaded (only QoE=1 is in the CSV). **KS4 MISMATCH** 50.0/53.8 vs 50.1/54.3: provisional vs final |
| 142379 | The Crescent Primary | Good | Good, 16 Jul 2024 | Good | n/a | OK |
| 136566 | Ecclesbourne Primary | Good | Good, 16 May 2023 | Good | n/a | OK |
| 140840 | Broadmead Primary | Good | Good, 1 Nov 2023 | Good | n/a | OK |

## Summary
- Ofsted: 12/18 match. 5 gaps where we show no grade, but Ofsted and Locrating both do:
  - 4 schools (101941, 131842, 100415, 100438): the last graded inspection was before Sept 2019 and has since been confirmed by an ungraded inspection. The CSV only has OEIF columns plus "Ungraded inspection overall outcome" (e.g. "School remains Good"), and `observations()` ignores the second.
  - BRIT (101849): graded inspection after Sept 2024, so there is no overall grade. Its sub-judgements aren't loaded.
- KS4: Ellen Wilkinson matches. Ada Lovelace (A8 off by 0.1) and BRIT (A8 off by 0.1, 5+ E&M off by 0.5 pt) differ because we load **provisional** data (Oct 2025) and the final data (April 2026) is now on CSP and Locrating. Swap in the final 2024/25 KS4 file.
- Link bug: `REPORT_URL = ".../provider/21/{urn}"` returns 404 for secondaries, whose pages are `/provider/23/` (145724, 101941, 101849). Better to use `https://reports.ofsted.gov.uk/oxedu_providers/full/(urn)/{urn}`, or choose the category by phase.

## What Locrating's free view shows that we don't
- **KS2 (2024/25) for primaries**: % meeting expected standard in reading/writing/maths (e.g. Montpelier 87%, Hugh Myddelton 89%, St Peter & St Paul 88%, Christ the Saviour 82%, Holy Family 80%, City of London PA 80%, Ecclesbourne 75%, Whitehorse Jr 69%, Hanover 67%, Broadmead 63%, Moreland 61%, Crescent 55%, West Acton 54%, St John Evangelist 35%). Also the higher-standard %, reading/maths scaled scores, subject breakdown and GPS, with LA and England comparators.
- KS4 extras: % with 5+ GCSEs at 9-4, % entering EBacc, EBacc APS, national rank; A-level results tab (paywalled).
- Full inspection history with category judgements, a "Locrating rating" derived from post-2024 sub-judgements, and Ofsted Parent View % happy.
- Pupil numbers, workforce (teachers), financial reserves, strengths and weaknesses, feeder/destination school counts.
- **Catchment area shading, last distance offered, % oversubscribed**: shown as panels, but the values are members-only (locked).
