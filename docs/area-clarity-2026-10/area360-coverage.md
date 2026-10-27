# Area360 coverage map (scanned 2026-10-05)

Reference: area360.uk — postcode page (NW107NN), property profile (58 Heather Park Drive, HA0 1TA),
postcode property list, England area page, /page/features, /page/methodology, /page/about, /blog,
/analytics (ratings), tools (investor calculator, stamp duty, mortgage rates), extension page.
We match the *cases they cover*, with our own wording, layout and method
(their text, branding and their school-rating rules are theirs).

Status: **have** = data loaded and shown · **partial** = data loaded, block missing ·
**new data** = source not loaded yet (file in ~/data noted when already downloaded).

| # | Area360 block | Us | What it takes | Track |
|---|---|---|---|---|
| 1 | Breadcrumb England › London › borough › MSOA › ward › postcode | partial (no ward) | ONS postcode directory (ONSPD) | J |
| 2 | Map with Crime / Deprivation / Income / Social housing / Price layers | have (more layers) | — | — |
| 3 | One-paragraph plain summary of the area | partial | generate from area profile | B |
| 4 | Score badges: crime 1–10, crimes per 1k, deprivation 1–10, income 1–10, social housing %, connectivity 1–10, flood, noise | partial (no connectivity, no real flood) | scores from percentiles; connectivity needs stations; flood needs EA | B, H, I |
| 5 | Topic cards with one-sentence explanation (deprivation rank of 33,755 in England, crime per 1k vs London, income £, noise dB, flood % per year) | partial | IMD rank is in imd/ file; noise dB median is in API | B |
| 6 | Transport: nearest stations, distance, zone, lines | new data | stations from OSM pbf (osm/) + TfL zones/lines | H |
| 7 | Parks: name, size, distance | new data (osm/ downloaded) | OSM parks | H |
| 8 | Population and density | partial (population/ downloaded) | population ÷ boundary area | F |
| 9 | Crime per 1k by category vs London average (+%) | partial (categories loaded) | per-category rates in profile | B (+A) |
| 10 | Demographics: ethnic groups, religion | new data | Census 2021 TS021, TS030 | F |
| 11 | Economics: education, occupation, economic activity | new data | Census 2021 TS067, TS063, TS066 | F |
| 12 | Housing: tenure breakdown, housing type | partial (TS054 tenure loaded) | Census TS054 full + TS044 | F |
| 13 | Property prices: median sale price, £/sq ft, sales in 12 months, middle-50% range | partial (£/m² median only) | Price Paid aggregates | G |
| 14 | Prices by property type: sales, median, £/sq ft, P5/P25/P75/P95 | new block (data loaded) | Price Paid property type + EPC floor | G |
| 15 | 10-year trend by property type (sale price and £/sq ft) | partial (20-year £/m² overall) | per-type timelines | G |
| 16 | Price distribution box plot by type | new block (data loaded) | percentiles per type | G |
| 17 | Recent sales list: date, address, type, tenure, price | partial (sales map) | list query near the area | G |
| 18 | Schools: distance, phase, type, rating | have (Ofsted + DfE) | our own rating summary, not theirs | — |
| 19 | Local amenities: supermarkets, pubs, cafés, pharmacies with distance | new data (osm/ downloaded) | OSM POIs | H |
| 20 | Council tax bands A–H for the borough | new data | gov.uk council tax levels (33 boroughs) | J |
| 21 | Ward councillors and MP | new data | Democracy Club / UK Parliament API | J |
| 22 | Geographic codes: region, district, constituency, ward, parish, MSOA, LSOA, police force, postcode introduced | partial | ONSPD | J |
| 23 | FAQ (safe? price? schools? station? deprivation? representatives?) | missing | generated from the same data | B (+J) |
| 24 | Data sources list | have (moves to /guide) | — | C |
| P1 | Property: estimated value vs last sale | have (restated last sale) | — | — |
| P2 | Property: EPC rating | partial (EPC floor area only) | EPC rating fields | G |
| P3 | Property: full sales history | have (address history) | — | — |
| P4 | Property: flood and noise at the address | noise have, flood new data | EA | I |
| P5 | Listing price history, days on market | out of scope | needs portal listing data we cannot license | — |

## Rest of the site

| # | Area360 part | Us | What it takes | Track |
|---|---|---|---|---|
| S1 | Postcode → list of every address (tenure, floor area, last sale) | partial (address search + history) | list endpoint from address-history + EPC | K |
| S2 | Property profile: estimated price with local box plot, last sale, change since, annualised change vs borough same-type change, £/sq ft vs local median, vs local type median | partial (restated last sale) | comparisons from Price Paid by type | K |
| S3 | Property facts: type, tenure, construction period, floor area, rooms, floor level, EPC rating and date | partial (floor area only) | full EPC certificate fields (epc-london-floor.sqlite has floor only) | K |
| S4 | Property: other homes at the postcode, share report, Google Maps / Street View links, "investment?" link | missing | links + share URL | K |
| S5 | Area hierarchy pages: England → region → borough → ward → postcode, each with the same profile, "all areas in" navigation and FAQ | partial (/area and /postcode pages) | borough + ward pages, nav lists | L |
| S6 | Ratings pages: most expensive areas, poorest, wealthiest, most deprived, borough crime ranking | missing | ranking pages from loaded data (London only) | L |
| S7 | Stamp duty calculator (SDLT, first-time buyer, additional property, non-resident) | missing | pure calculator | M |
| S8 | Mortgage rates tracker (Bank Rate vs 2/3/5-year fixed at 75% LTV since 1996) | missing | Bank of England IADB series | M |
| S9 | Property investor calculator (BTL, HMO, BRRR, flip; yields, cash flow, tax) | partial (cost worksheet) | extend the cost worksheet | M |
| S10 | Blog: data stories (safest areas, council tax visualised, first-time buyer series) | partial (/guide) | editorial, later | — |
| S11 | About page: who builds it, why, sources, no ads/registration | partial (privacy page) | short About page | C |
| S12 | Browser extension for Rightmove/Zoopla, location finder, iOS app | out of scope | — | — |
| S13 | Asking-price history, days on market | out of scope | portal listing data we cannot license | — |

## Proposed new tracks (after Wave 1)
- **F. Census area profile**: population, density, ethnicity, religion, education, occupation, economic activity, tenure, housing type (LSOA, Census 2021).
- **G. Market by property type**: sale-price median and range, by-type table with percentiles, 10-year by-type trend, box plot, recent sales list, EPC rating.
- **H. Getting around and nearby**: stations (zone, lines), parks, amenities, connectivity score (OSM + TfL).
- **I. Flood risk**: Environment Agency rivers and sea risk for areas and addresses.
- **J. Geography and civic**: ONSPD codes and ward, council tax bands, councillors and MP.
- **K. Property profile**: postcode address list, estimate vs last sale and local medians, full EPC facts, other homes at the postcode, share and map links.
- **L. Area pages and rankings**: borough and ward pages with the full profile, "all areas in" navigation, FAQ, London ranking pages.
- **M. Money tools**: stamp duty calculator, mortgage rates tracker (Bank of England), investor calculator built on the cost worksheet.
