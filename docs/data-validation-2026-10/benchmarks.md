# Area benchmarks: 8 London areas (collected 2026-10-01)

## 1. crimerate.co.uk: borough crime rate

Source: https://crimerate.co.uk/london/{slug} (page updated 07 Jun 2026). Period: 12 months ending April 2026 (labelled "2026").
Denominator: 2011 Census **daytime ("workday") population**. The site says it does not use 2021 daytime figures. The text says "per 1,000 people", but the London comparison uses "per 1,000 daytime population".

| Area | Rate /1,000 | vs London | Denominator (2011 daytime pop.) |
|---|---|---|---|
| Ealing | 78 | -5% | 306,044 |
| Waltham Forest | 80 | -2.8% | 216,400 |
| Wandsworth | 67 | -19% | 246,154 |
| Islington | 91 | +10% | 266,076 |
| Westminster | 125 | +52% | 680,488 |
| Tower Hamlets | 69 | -16% | 369,042 |
| Croydon | 76 | -8% | 310,520 |
| Barnet | 66 | -20% | 314,629 |
| **London** | **82** | — | daytime population (figure not stated on /london) |

Note: the Ealing scorecard also shows "2.4% lower than London" (as of April 2026), which conflicts with -5% in the same page's text.

## 2. police.uk: neighbourhood monthly counts

Source: https://www.police.uk/pu/your-area/metropolitan-police-service/{slug}/ . police.uk has no borough-level page, so each row is one neighbourhood (ward). Latest month: **Aug 2026**. "Total" comes from the "Crime levels overview" list. It appears to include ASB, because ASB is listed among the "top reported crimes".

| Area | Neighbourhood (slug) | Total Aug 2026 | Total Jul 2026 | ASB Aug 2026 |
|---|---|---|---|---|
| Ealing W5 | Ealing Broadway (`ealing-broadway`) | 224 | 228 | 43 |
| Waltham Forest E17 | Hoe Street (`hoe-street`) | 148 | 133 | 56 |
| Wandsworth SW11 | Battersea Park (`battersea-park`) | 190 | 208 | 62 |
| Islington N1 | St Peter's and Canalside (`st-peters-and-canalside`) | 162 | 190 | 40 |
| Westminster W1 | West End (`west-end`) | 1,987 | 2,268 | not shown (not in top 4) |
| Tower Hamlets E14 | Canary Wharf (`canary-wharf`) | 322 | 349 | 81 |
| Croydon CR0 | Fairfield (`fairfield`) | 524 | 623 | 109 |
| Barnet EN5 | High Barnet (`high-barnet`) | 93 | 103 | 30 |

Alternatives checked: Lavender SW11 175/43, Shaftesbury & Queenstown 213/54, Barnsbury 219/42, St James's 1,434/203, Island Gardens 85/33, Barnet Vale 106/29, Underhill 48/10.

## 3. HM Land Registry UKHPI: borough

Source: https://landregistry.data.gov.uk/data/ukhpi/region/{slug}/month/2026-07.json (app: https://landregistry.data.gov.uk/app/ukhpi/browse). Latest month: **July 2026**. Aug/Sep 2026 return `missingEndpoint`.

| Area | Avg price (all) | Annual % | Flat/maisonette avg | Flat annual % |
|---|---|---|---|---|
| Ealing | £585,216 | +0.8 | £407,789 | -1.0 |
| Waltham Forest | £529,102 | +2.8 | £389,823 | +0.7 |
| Wandsworth | £686,076 | -5.5 | £526,813 | -6.6 |
| Islington | £674,592 | -4.9 | £560,124 | -5.4 |
| Westminster (`city-of-westminster`) | £876,788 | -20.7 | £775,956 | -21.4 |
| Tower Hamlets | £447,796 | -14.4 | £430,120 | -14.6 |
| Croydon | £390,041 | -3.4 | £253,660 | -5.3 |
| Barnet | £600,560 | -4.9 | £372,014 | -7.0 |
| **London** | £550,037 | -3.3 | £424,013 | -6.6 |

## 4. housemetric.co.uk: postcode district £/sqm (free pages)

Source: https://housemetric.co.uk/analysis/area/{W,E,SW,N,CR,EN} (district tables; e.g. https://housemetric.co.uk/analysis/district/W5/Ealing). Period: sales in the last 2 years, data updated 2026-09-22. The site reports £/sqm by default, and £/sqft needs a toggle on an account. The £/sqft column below is derived as sqm ÷ 10.764. **Median price (£) was not found on the free district pages.**

| District | LQ £/sqm | Median £/sqm | UQ £/sqm | Median £/sqft (derived) | Sales (2y) |
|---|---|---|---|---|---|
| W5 | 6,000 | 7,410 | 8,600 | ~688 | 1,230 |
| E17 | 6,320 | 7,360 | 8,350 | ~684 | 2,352 |
| SW11 | 7,640 | 9,350 | 11,310 | ~869 | 2,351 |
| N1 | 8,310 | 9,920 | 11,830 | ~922 | 1,866 |
| W1 | n/a, split into sub-districts: W1D 13,370; W1F 14,130; W1H 14,750; W1J 20,000; W1K 22,320; W1U 15,100; W1W 13,400 (median) | | | | W1K 151, W1U 170 |
| E14 | 6,050 | 7,240 | 8,610 | ~673 | 2,158 |
| CR0 | 4,120 | 4,710 | 5,300 | ~438 | 3,268 |
| EN5 | 5,490 | 6,370 | 7,030 | ~592 | 825 |

## 5. accuval.co.uk

**Not available.** The browser refused or failed to navigate to accuval.co.uk and www.accuval.co.uk.

## 6. Time Out first-time-buyer affordability article

| Item | Value |
|---|---|
| URL | https://www.timeout.com/london/news/a-new-interactive-map-shows-londons-most-affordable-places-for-first-time-buyers-053125 |
| Date | 31 May 2025 |
| Metric | % of properties for sale within a budget, by area. Bands: green ≥90% (per article), orange 10–30%, red <10%. The text also mentions 30–70%. |
| Budget used | £315,000 (average FTB budget, 1-bed flat, London) |
| Source | reallymoving (home-moving comparison site) interactive affordability map |

Related (search only, not opened): "Revealed: the 10 most affordable London boroughs to buy a home" (salary as % of avg house price), https://www.timeout.com/london/news/revealed-the-10-most-affordable-london-boroughs-to-buy-a-home-042924

## 7. Feature lists (no numbers)

| Site | URL | Features / status |
|---|---|---|
| Crystal Roof | https://crystalroof.co.uk/ | Postcode report tabs: Overview, Affluence, Crime, Demographics, Noise, Transport, Amenities, Schools, Environment, Reviews. Free. Crime methodology blog. Acquired StreetCheck. |
| Walk Score | https://www.walkscore.com/score/W5 | **"W5" geocodes to Guangzhou, China**: score 93 "Walker's Paradise", flagged "Unsupported Country". No valid UK score. Features: Walk Score, travel-time map, nearby parks, nearby apartments, widget/API. |
| TravelTime | https://app.traveltime.com/ | Isochrone/travel-time map (car, public transport, bike, walk). Up to 3 origins. Departure time (e.g. weekday morning). Time slider. H3/Geohash/isochrone display. POI counts in reach by band (cafés, gyms, schools, restaurants). Shareable results link. Radius map and drive-time calculator demos. Free API key. |
| Gymist | https://gymist.co.uk/ | Gym finder by postcode/town, gym-buddy matching, groups, filters (activity, level, availability, gym facilities), gym owner listings/claims, articles. |
| Pubs Galore | https://www.pubsgalore.co.uk/ | UK pub listings by country, real ale pubs, pubs near me, pub crawls, festivals, member ratings/reviews/photos, forum, CAMRA discounts, popular pub names stats. Consent banner had no visible reject button, and nothing was accepted. |
| area360.uk | https://area360.uk/ | **Not available.** Blocked by a Cloudflare bot-verification page. |
| Property With Potential (propertytorenovate) | https://propertytorenovate.co.uk/ | Listings filtered for opportunity: auction, cash buyers only, derelict/renovation, land & plots, planning permission, repossessions. Price filters. Saved listings, email alerts. Conveyancing/surveys/removals referrals. "Investment insights". |
