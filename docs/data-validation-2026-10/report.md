# Data validation against public sources (1 October 2026)

Our Real release was compared against the public sites the team uses to
choose an area, in a browser, read-only. Each difference is classed as
**justified** (a different definition, period or population), **fixed** (our
error, corrected in this change set) or **open** (still to do).

**Releases compared:**
- crime `src-police-uk-crime-12m-2025-09-2026-08-r2`
- £/m² `src-hmlr-pp-category-a-2026-06`
- sales `src-hmlr-pp-sales-2026-07`
- schools `src-ofsted-latest-inspections-2026-08` and `src-dfe-ks4-2024-25-provisional`
- noise `src-defra-noise-round4-2022`

**Sample areas:** Ealing (W5), Waltham Forest (E17), Wandsworth (SW11),
Islington (N1), Westminster (W1), Tower Hamlets (E14), Croydon (CR0),
Barnet (EN5). The external figures were collected on 1 October 2026; the
raw tables are in `benchmarks.md` and `schools-check.md` next to this file.

## Summary

| Area of data | Verdict | What changed |
|---|---|---|
| Crime rate | **Fixed** (3 bugs), then justified | The headline counted anti-social behaviour (+26% offences). It was a monthly rate, about 12× below every public figure. The personal match ranked the *highest*-crime areas first. Now it is offences in the last 12 months per 1,000 residents, excluding ASB. LSOAs that police.uk's snap points leave empty fall back to their MSOA. |
| Crime vs crimerate.co.uk | Justified | London reconciles: our 904,551 offences (May 2025–Apr 2026) ÷ crimerate's 82 per 1,000 implies an ~11.0 M daytime-population base, against 9.09 M residents. crimerate's borough figures are typical postcode-walk-area scores, so they are not borough totals. |
| Crime vs police.uk | Justified | police.uk neighbourhood totals include ASB (≈20–30% of the listed counts). Ours exclude it, as ONS recorded-crime statistics do. |
| £/m² index | **Fixed**, then justified | Category B sales (repossessions, buy-to-let, company sales) were 14% of the latest window and type "Other" was mixed in. The index is now category A only, as UKHPI is. Borough medians moved −0.3% to +5.7% (mean +1.8%). |
| £/m² vs housemetric | Justified | District medians over the last two years are within −1.9% to +6.2% of housemetric's (ours slightly higher on average). Sale counts reconcile with their ~22-month window. |
| Prices vs UKHPI | Justified | Our arithmetic mean prices run 9–65% above UKHPI's mix-adjusted, geometric-mean "average price", with the gap largest in Westminster's skewed market. The direction of the annual change agrees in 6 of 8 boroughs by median £/m² (5 of 8 by median price). |
| Stock value | **Fixed** | A home's value is now restated from its last *standard* sale, never from a repossession or a company bulk sale. 1,236,138 homes are valued. |
| Labels in Real mode | **Fixed** | Legends, periods, descriptions and caveats came from preview fixtures. Fallback LSOAs read "LSOA" although they show a larger area's median. |
| Fixtures in Real mode | **Fixed** | Noise, flood, planning, commute and the property dossier showed preview data. Real mode now shows real data or says what is missing. |
| Sold prices (housemetric-style map) | New | Every London sale since 1995, one pin per home, with filters, value today and 1–20 year growth. See "Sold-price map" below. |
| Schools vs locrating / Ofsted / DfE | See "Schools" below | Ofsted grades and GCSE results are loaded. KS2 and catchments are open. |
| Noise vs extrium / noise-map.com | Justified / open | Ours is Defra Round 4 (2022). extrium shows Round 3 (2017), which uses different modelling. Aircraft noise is not loaded (open). |
| Demographics, walkability, commute, gyms, pubs | Open (not in product) | See "Gaps" below. |

## Crime

### Bugs fixed

1. **Anti-social behaviour was in the headline.** `deploy/tools/ziprange.py`
   counted every row into the headline count. In the latest year ASB was
   233,782 incidents on top of 891,463 offences. The crime category filter
   then scaled this ASB-inclusive rate by category shares that excluded ASB.
2. **The rate was monthly.** Public sources quote offences per 1,000 a year.
   Ours read about 12× lower. Each published month now shows the 12 months
   to that month, so the 12 published periods need 23 months of data.
3. **Lower crime scored worst in the personal match.** Stored crime
   utilities were the complement of the contract, so "lower crime" put the
   highest-crime LSOAs at the top. A one-off SQL inversion in
   `etl_price.py` was the cause.
   - Before: rank 1 had 134 offences per 1,000 per month.
   - After: rank 1 has 0–8 per 1,000 per year, and the last rank has 4,459.
4. **Snap-point gaps showed as zero crime.** police.uk moves each crime to an
   anonymous snap point. 18 LSOAs contain no snap point, so they showed zero
   crime and ranked "safest". Where an LSOA has under 10% of the offences its
   MSOA's rate predicts, it now shows the MSOA rate, marked *fallback*.

### Comparison (12 months to April 2026, offences excluding ASB)

| Borough | Ours, offences | Ours, per 1,000 residents | crimerate.co.uk rate | crimerate rate × its daytime population |
|---|---|---|---|---|
| Ealing | 32,224 | 83.5 | 78 | 23,871 |
| Waltham Forest | 22,965 | 82.1 | 80 | 17,312 |
| Wandsworth | 26,576 | 78.7 | 67 | 16,492 |
| Islington | 31,261 | 140.2 | 91 | 24,213 |
| Westminster | 77,496 | 369.0 | 125 | 85,061 |
| Tower Hamlets | 36,963 | 111.4 | 69 | 25,464 |
| Croydon | 33,813 | 82.6 | 76 | 23,600 |
| Barnet | 28,695 | 70.8 | 66 | 20,766 |
| **London** | **904,551** | **99.5** | **82** | — |

**Why the numbers differ (justified):**
- **Denominator.** crimerate divides by the 2011 Census daytime ("workday")
  population; we divide by ONS mid-2024 residents. The London figures
  reconcile on that basis: 904,551 ÷ 82 per 1,000 implies a base of about
  11.0 M people.
- **Borough figures are not totals.** crimerate's borough numbers are
  typical scores for the area within a 5–15-minute walk of each postcode.
  Multiplying them by population does not give the borough's crime count,
  which is why that column runs 29–61% below our counts outside Westminster.
- **Rankings agree.** Westminster is highest on both, Islington and Tower
  Hamlets are high, and Barnet and Wandsworth are among the lowest.
- **Central London reads high per resident.** Our caveats say so; a
  daytime-population view would be a separate product decision.

**police.uk (justified):** neighbourhood pages list totals that include ASB.
For example, Ealing Broadway in August 2026 showed 224 crimes, of which 43
were ASB. Neighbourhoods are wards, not our LSOA/MSOA/borough geography, so
only the definition was compared.

## Prices

### Fixes

- **£/m² index.** It now uses standard market sales only: Price Paid
  category A, property types D/S/T/F, floor area 15–1,000 m², price at least
  £20,000, and £500–£40,000 per m². This is the definition UKHPI uses for
  category, and the same sanity gates the stock value already applied.
  - Observed LSOAs (at least 20 sales in 12 months) fell from 1,015 to 611.
    The other LSOAs show their MSOA or borough median, and now say so.
- **Stock value.** A home's restated value comes from its last category-A
  sale. Street-block medians were recomputed.

### housemetric.co.uk: median £/m², last two years

| District | housemetric (all sales) | Ours (all sales with floor area) | Δ | Ours (category A) |
|---|---|---|---|---|
| W5 | 7,410 | 7,783 | +5.0% | 7,895 |
| E17 | 7,360 | 7,500 | +1.9% | 7,628 |
| SW11 | 9,350 | 9,634 | +3.0% | 9,631 |
| N1 | 9,920 | 10,234 | +3.2% | 10,327 |
| E14 | 7,240 | 7,102 | −1.9% | 7,442 |
| CR0 | 4,710 | 4,733 | +0.5% | 4,821 |
| EN5 | 6,370 | 6,460 | +1.4% | 6,534 |
| W1K | 22,320 | 23,715 | +6.2% | 25,000 |
| W1U | 15,100 | 15,500 | +2.6% | 15,938 |

**Why they differ (justified, all within ±6.2%):**
- **Window.** housemetric's two years run to its 22 September 2026 update;
  ours run August 2024 to July 2026. Its sale counts are 87–93% of our
  all-sale counts, as a ~22-month window predicts, so our extract is
  complete.
- **Floor area.** Both use EPC floor area, but the two sites match sales to
  certificates differently. We use each home's latest EPC.
- **Our match rate (open, minor).** 80–86% of recent sales get a floor
  area. Improving the address-to-EPC match would add sales to the median,
  but would not change the level materially.

### HM Land Registry UKHPI: July 2026

| Borough | UKHPI average | UKHPI annual | Our mean (category A, 12 months to Jul 2026) | Our median price YoY | Our median £/m² YoY |
|---|---|---|---|---|---|
| Ealing | £585,216 | +0.8% | £638,478 | −1.6% | −2.4% |
| Waltham Forest | £529,102 | +2.8% | £582,256 | +2.6% | +2.5% |
| Wandsworth | £686,076 | −5.5% | £799,493 | −3.5% | −0.8% |
| Islington | £674,592 | −4.9% | £832,639 | −0.6% | +0.6% |
| Westminster | £876,788 | −20.7% | £1,443,213 | −13.5% | −8.5% |
| Tower Hamlets | £447,796 | −14.4% | £541,834 | −10.5% | −11.1% |
| Croydon | £390,041 | −3.4% | £460,264 | +1.2% | −0.3% |
| Barnet | £600,560 | −4.9% | £729,659 | +2.6% | −3.9% |

**Why they differ (justified):**
- **Price levels.** UKHPI's "average price" is a mix-adjusted hedonic index
  level built on a geometric mean. An arithmetic mean of transactions is
  always higher, most of all where a few very expensive sales skew the
  market (Westminster +65%).
- **Annual change.**
  - UKHPI compares one month with the same month a year earlier, with
    mix adjustment.
  - Ours compares two 12-month windows, so it is smoother and lags.
  - Direction agrees for the falling markets: Westminster, Tower Hamlets and
    Wandsworth.
  - Mixed results are within a few points of zero.
- The product publishes medians per m², not mean prices. This table checks
  the underlying sales, not a published metric.

### accuval, area360, Time Out

- **accuval:** the site did not load in the browser.
- **area360:** blocked by a Cloudflare bot check. We did not try to bypass it.
- **Time Out:** its first-time-buyer map shows the share of homes *for sale*
  under a £315k budget (reallymoving listings). That is asking prices, which
  we do not hold. Our affordability factor uses achieved prices.

## Sold-price map (new)

This works like housemetric's map: one pin per home, coloured by
- sold price,
- £/m²,
- value today (a restated sale, not a valuation), or
- area growth over 1/3/5/10/20 years,

with a Cheaper / Default / Expensive colour scale. The filters are years
sold, property type, new build, tenure and price. Zoom 11–14 shows median
dots, and each dot needs at least three homes. Clicking a pin opens the
home's sale history and the hide-my-home route.

| Check | Result |
|---|---|
| Sales loaded | 3,980,279 (1995 to July 2026); 258,427 are category B, shown with a label |
| Homes with a pin | 2,083,356; 1,305,243 at a UPRN point, the rest at their postcode centre (drawn fainter) |
| Privacy | With an active objection the home's pin disappears from its tile; with the objection rolled back it returns (`deploy/tests/test_sales_schema.py`, plus a live check) |
| Tile size | Zoom 11 about 200 KB. Zoom 15 at most about 340 KB uncompressed (dense central London). Pins start at zoom 15 because zoom-14 tiles reached 1.2 MB. |

## Schools

We checked 18 schools near Ealing W5, Islington N1 and Croydon CR0 against
Ofsted's report pages, locrating's free view and DfE's school performance
service (`schools-check.md`).

| Finding | Verdict | Change |
|---|---|---|
| 12 of 18 Ofsted grades matched | OK | — |
| 4 schools showed no grade although Ofsted lists one: last graded before 2019 and later confirmed by an ungraded inspection ("School remains Good") | **Fixed** | The ungraded inspection outcome is now loaded and shown with its date. |
| 1 school graded in November 2024 with no overall grade (from September 2024 Ofsted gives judgements only) showed nothing | **Fixed** | The previous framework's judgements (quality of education, behaviour, personal development, leadership) are shown when there is no overall grade, each labelled as not comparable with report cards. |
| Links to Ofsted reports were 404 for secondaries | **Fixed** | Links now use Ofsted's own per-school link from the source file. |
| KS4 Attainment 8 / grade 5+ differ by 0.1–0.5 points for 2 schools | Justified, open | We load the provisional release (October 2025). DfE and locrating show the final figures (2026). Load the revised school-level file when it is published as a download. |
| locrating shows KS2 results for primaries, the full inspection history, parent survey, staffing and finance; catchments sit behind membership | Open | KS2 school results are not loaded (the school-level download was not available); the rest is out of scope. |

**Loaded:**
- 2,258 London state-funded primary and secondary schools.
- 204 schools with report-card grades (inspections from November 2025).
- Every other school: the last graded overall effectiveness or its
  judgements, plus any later ungraded outcome.
- KS4 2024/25 for 496 secondaries.
- Schools are listed within 1.5 km of the selected area. Admission and
  travel time stay explicitly unavailable.

## Noise

- **Loaded:** Defra strategic noise mapping Round 4 (2022), road and rail
  Lden at 10 m, read at every dwelling's UPRN point (1,305,310 homes).
  - 42% of London homes are modelled at 55 dB Lden or more from road or
    rail. Westminster and the City are about 69%.
- **extrium.co.uk (justified):** it shows the earlier Round 3 maps (2017,
  published 2019). Round 4 uses the CNOSSOS-EU method and a newer year, so
  levels differ at the same spot.
- **Our sampling matches the source.** At four test points the value we read
  equals a direct Defra WCS read.
- **Aircraft noise (open):** noise-map.com and the Heathrow departures
  contours (the Wandsworth PDF) cover aircraft. Defra's road and rail maps
  do not, and no airport contours are loaded.

## Gaps: what the other sites have that we don't

| Site | What it offers | Status here |
|---|---|---|
| crystalroof | Demographics, religion, age, affluence, ethnicity, transport, amenities, reviews | Census 2021 demographics are not loaded. Deprivation, income and tenure are loaded. |
| walkscore.com/score/W5 | Walkability score | The UK is unsupported; "W5" resolves to Guangzhou. No UK equivalent is loaded. |
| app.traveltime.com | Isochrones by mode and time | Commute routing is not loaded. Real mode says so. |
| gymist, pubsgalore | Amenity listings | Not loaded. The OSM extract could provide gyms and pubs. |
| propertytorenovate | Renovation and auction listings | Live listings are out of scope. |
| locrating extension | School overlays on Rightmove/Zoopla | Out of scope. |

## Reproduce

The order of the steps is in `RELEASE-CHECKLIST.md`, under "Rebuilding a data
release". Every number in this report comes from:
- the release database, via the API or SQL in this change set's commits, or
- `benchmarks.md` and `schools-check.md` for the external figures.
