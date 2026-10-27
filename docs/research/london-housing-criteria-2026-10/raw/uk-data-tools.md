# UK property data and analytics tools: what they expose and how they present valuations and area insight

Stream: UK property data and analytics tools. Research date: October 2026.
Method note: the web search quota for this session was exhausted at the start, so sources were found via trade-site search pages (The Negotiator, Property Industry Eye), Bing, URLs listed by sibling streams, and direct vendor/government pages. Reddit was unreachable (blocked), so forum evidence comes from MoneySavingExpert (MSE). Locrating (HTTP 403) and Moverly (JavaScript-only page) could not be read; StreetCheck now redirects to Crystal Roof.

## 1. The data stack: almost everything is built on a small set of open government datasets

Nearly every consumer and professional tool in the UK repackages the same few public datasets. Knowing what those datasets contain, and what they leave out, explains what the tools can and cannot tell a buyer, renter or seller.

| Base dataset | What it gives | Main limitations | Source |
|---|---|---|---|
| HM Land Registry Price Paid Data (PPD) | Price, completion date, postcode, type (D/S/T/F/O), new-build flag, tenure (F/L), category A (standard sale) or B (repossessions, buy-to-let/company sales) | No floor area, bedrooms or condition. Leaves out sales not for value, discounted Right to Buy, transfers between private parties (divorce, gifts), court orders and leases under 7 years. Registration lags the sale by 2 weeks to 2 months, so the latest 2 months are incomplete. Covers England and Wales from Jan 1995. | https://www.gov.uk/guidance/about-the-price-paid-data |
| EPC register | Energy certificates looked up by postcode, street or certificate number for homes in England, Wales and NI | The gov.uk lookup page says little about what a certificate contains. Tools use EPCs mainly for floor area and the energy band. | https://www.gov.uk/find-energy-certificate |
| data.police.uk street-level crime | 14 crime categories, monthly, with outcomes | Each location is moved to an anonymous "snap point" whose catchment has at least 8 postal addresses (or none). Dates stop at the month. Geocoding accuracy runs from 60% to 97% depending on the force, and court-outcome matching from 19% to 97%. Later reclassifications are usually not applied to old records. | https://data.police.uk/about/ |
| EA long-term flood risk | Risk from rivers and sea, surface water, reservoirs and groundwater, plus climate-change outlook | Area-level, not property-level. Leaves out flooding from blocked drains and burst pipes. | https://www.gov.uk/check-long-term-flood-risk |
| TfL PTAL / WebCAT (London only) | Score from 0 to 6b on a 100 m grid. Combines walk time to stops, reliability, number of services and average wait. WebCAT adds travel-time maps and catchment statistics. | Ignores speed, crowding and how easy interchanges are. Method dates from 1992 (Hammersmith and Fulham). The published dataset is from 2015. | https://data.london.gov.uk/dataset/public-transport-accessibility-levels |
| ONS / OS / NaPTAN / FSA geographies | Deprivation decile, census output areas, elevation, nearest stops and stations, food hygiene ratings | Data at postcode or output-area level. Census is described as "broad brush" and quickly out of date. | https://www.getthedata.com/postcode/SW9-8EH |

Design implication: for London, the key gap in PPD is floor area. London pricing is quoted per square foot and the housing stock is mostly flats and conversions, so a property type of "F" says very little. Tools fill the gap by matching PPD to EPC floor area (PropertyData says so explicitly; Hometrack Comparables bundles floor area, EPC and year built). The other London-only layer is PTAL/WebCAT, which has no equivalent in other UK cities.

## 2. Consumer portals: Rightmove and Zoopla (sold prices and instant estimates)

**Sold prices.** Rightmove's sold-price tool uses HM Land Registry (and Registers of Scotland) data, refreshed on the 20th of each month. It shows photos and floorplans from the last time each home was listed. That listing archive is the portal's real advantage over raw PPD, because it lets a buyer see bedrooms, layout and condition at the last sale. Rightmove notes the latest two months are incomplete and Northern Ireland is not covered. (https://www.rightmove.co.uk/house-prices.html)

**Instant estimates.**
- Zoopla's estimate uses public records (PPD), HM Land Registry and Zoopla's own listing and sales data, covering about 34 million UK homes since 2007. Zoopla itself calls the figure a "starting point". It says the algorithm cannot see condition, features or recent improvements and does not give street-level accuracy. (https://www.zoopla.co.uk/home-values/)
- Rightmove's Track My Property (May 2023) is a machine-learning model built on sold prices, Rightmove listing data and feedback from agents and the public. It deliberately shows a range, not a single figure. Rightmove's product director said an exact valuation needs a local agent, a framing chosen to protect agents' valuation business. (https://thenegotiator.co.uk/news/rightmove-to-offer-home-owners-valuation-tool-from-may-onwards/)
- In April 2026 Rightmove added an equity tracker to its Instant Online Valuation. It combines the estimate with the mortgage deal end date, remortgage options, available equity and borrowing capacity. (https://propertyindustryeye.com/rightmove-steps-up-drive-to-digitise-uk-property-market-with-new-tool/)
- Valuation leads sent to agents through Rightmove rose 55% in the first five months of 2026, year on year. The portal's valuation is mainly a way to capture seller leads, with the online estimate as the first step before an in-person agent visit. (https://propertyindustryeye.com/valuation-leads-jump-for-agents-says-rightmove/)

**How users judge them (forums).**
- In an MSE thread from 2025, one user's Rightmove and Zoopla estimates came to 58.6% and 106% of the same reference value. Another user got £1.093m from Zoopla, £1.325m from Rightmove and £1.5m from an agent. Other posters found the two sites close. Recurring complaints were wrong attributes (terraced recorded as semi, wrong bedroom counts) and very old last-sale anchors (no sale since the early 1990s). One poster explained the difference as Zoopla relying on past sales plus area trends while Rightmove also uses current listings. Rightmove lets owners add renovations such as extensions and loft conversions. Consensus: buyers set the price, and online figures are rough. (https://forums.moneysavingexpert.com/discussion/6597469/rightmove-vs-zoopla-valuation)
- In an MSE thread on sold-price accuracy, sold prices that looked absurd were explained by things PPD does not label clearly. Examples given were shared-ownership part-stakes, partner buy-outs, part-exchange, mistyped data, and one owner's house recorded as a £65k leasehold flat when it was a £163k semi. Comps should be checked one by one. (https://forums.moneysavingexpert.com/discussion/6094425/are-sold-prices-always-correct-on-rightmove)

## 3. Professional valuation and AVM providers

**Hometrack (part of Houseful, alongside Zoopla and the Alto CRM).**
- Hometrack calls itself the UK's leading AVM provider for mortgage lenders. It says it contributes valuation data, risk insight or decisioning to nearly all of the roughly 1.4 million UK mortgage approvals a year. (https://www.hometrack.com/about/)
- Its £19.95 consumer report includes the AVM estimate, a calibrated confidence level, a value range, comparable homes, Zoopla search-demand data and the property's past transactions. It declines to issue a report when confidence is too low. (https://www.hometrack.com/data-services/property-valuation-report/)
- In October 2023 Hometrack launched a Comparables product for agents. It bundles property attributes and subtype, year built, EPC, floor area, sales history with current valuation, tenure and rental comparables, refreshed every 30 days. It sits next to a listings product (asking prices, rental yields, sales-agreed data). (https://thenegotiator.co.uk/news/hometrack-launches-platform-to-help-agents-make-better-decisions/)

**PropertyData (investor- and agent-focused, from £14/month).**
- The valuation model is built on price per square foot. Inputs are postcode, type, internal floor area in sq ft, bedrooms, condition, finish quality, outdoor space, parking and construction date. Outputs are an estimate, a range, comparables and a confidence flag: High when the property sold recently, Medium when the estimate rests on comparables. (https://propertydata.co.uk/valuation)
- The wider platform covers asking prices from Rightmove, Zoopla and OnTheMarket, PPD, floor area matched to EPC, rents (including SpareRoom room rents), gross yield (weekly rent × 52 ÷ asking price), demand and turnover, consensus growth forecasts (Savills, Knight Frank, OBR), planning, flood, schools, council tax band, census demographics, tenure mix and the national HMO register. (https://propertydata.co.uk/)
- Its list of valuation inputs is the most explicit statement of what UK professionals treat as secondary value drivers once floor area is fixed: condition, finish, outdoor space, parking and age.

**Chimnie (consumer plus B2B, with partners including Barclays).** Offers free value, location and risk reports for every residential property in Britain. Values are shown as a range (for example £725k–£775k). The location report scores schools, shops, stations and other amenities. The site claims 150,000+ active users. (https://www.chimnie.co.uk/)

**Sprift (agents, surveyors, brokers, conveyancers).** Claims 420+ data points on more than 30 million homes. Products are white-label reports, a comparables engine, prospecting tools and an API. (https://sprift.com/Home)

**What agents think of AVMs.**
- An Alto poll of 250 agents (June 2025) found 87% think AI valuations fail to reflect true value. Nearly a third adjust AVM figures by £10,001–£20,000, and 10% routinely by more than £20,000. (https://thenegotiator.co.uk/news/agents-are-anti-ai-when-it-comes-to-property-valuations-agent-poll/)
- What agents say AVMs miss: extensions, loft conversions, renovations, condition, unique features and smart-home technology.
- Where agents see bias: a fifth think AVMs undervalue rural homes, and 11% think they strongly undervalue northern or lower-income areas.
- Yet 39% of agents rely heavily on AVMs and 23% "always" use them, mainly to save time.

The same split between the data and the human valuer appears among consumers (section 2).

## 4. Area-insight tools for buyers and renters

**Crystal Roof (free, about 2.6 million postcodes; StreetCheck now redirects here).** Eight headline categories:
- Crime
- Noise: traffic, aircraft, emergency services, nightlife
- Demographics: ethnicity, religion, household type, age
- Affluence: income, deprivation, social grade, qualifications
- Transport: station distances and London Underground reliability
- Amenities: supermarkets, restaurants, pharmacies, GP surgeries
- Schools: Ofsted, results, admissions
- Environment: NO2, particulates, flood

Sources are ONS, Ofsted, TfL and the Environment Agency. (https://crystalroof.co.uk/)

How it presents results:
- Crime for a Brixton postcode (SW9 8EH) is shown as 389 crimes per 1,000 "at-risk population", scored 10/10 (worst). It is benchmarked against Lambeth (123 per 1,000, 9/10) and London, with a 2011–2025 trend line. Each of 13 crime types gets its own score. Burglary is measured per 1,000 properties, not per resident. Data covers Sep 2025–Aug 2026. (https://crystalroof.co.uk/report/postcode/SW98EH/crime)
- The transport tab for the same postcode is simple: a 9/9 connectivity score, TfL zone 2, and nearby stations with walking distances and lines. There is no journey-time or crowding analysis on that page. (https://crystalroof.co.uk/report/postcode/SW98EH/transport)

The overall pattern is a score out of 10 plus a comparison against the borough and the city. That works well for scanning but hides the snap-point and denominator caveats in section 1.

**Plumplot (England and Wales; maps of prices, crime, census, salaries, home features, energy efficiency).** Its London page summarises PPD for Sep 2025–Aug 2026 (https://www.plumplot.co.uk/London-house-prices.html):
- Mean £653k, median £500k, down 5% year on year
- 70.6k sales, down 27.9%
- By type: detached £1.3m, semi £779k, terraced £757k, flat £504k
- Cheapest postcode sector RM1 1 at £234k; most expensive SW1X 7 at £12.8m
- Median price-to-earnings ratio 11.7, against 7.54 for England and Wales

Within-London price spread is extreme, so district-level averages are misleading without per-sq-ft normalisation. (Homepage: https://www.plumplot.co.uk/)

**Get the Data (free postcode pages).** Raw open data per postcode: deprivation percentile, census geographies (OA/LSOA/MSOA), elevation, nearest bus, tube and rail stops (NaPTAN), food hygiene ratings and PPD. It is useful as a transparent reference because every figure cites its source. (https://www.getthedata.com/postcode/SW9-8EH)

**Locrating** (school catchments and ratings maps) could not be read (HTTP 403). Its features are not covered here; see other streams.

**How users judge area tools (forum).** An MSE thread on StreetCheck (2017) concluded that these tools are just a front end to police.uk and census data:
- Crime counts alarm buyers without context. Several posters' quiet streets showed monthly violent crimes.
- The anti-social behaviour category is vague.
- Census data is stale and broad-brush.
- Conditions change over about 200 m.
- Advice: compare against an area you know, use the IMD map, visit at different times and talk to residents. Treat the tools as first indicators, not decision drivers.

(https://forums.moneysavingexpert.com/discussion/5651228/streetcheck-has-anyone-used-this-to-influence-buying-choices)

## 5. Site-sourcing and development tools (agents, developers, land teams)

These tools show what professionals screen on, which is a different list from what buyers screen on.

- **Searchland** (2,000+ professionals):
  - Planning: 30 years of applications updated every 24 hours, local plan policies, SHLAA sites, settlement boundaries, 5-year land supply
  - Ownership and titles, with letter campaigns; HMO licences with expiry dates
  - Constraints: flood zones, green belt, conservation areas, biodiversity net gain
  - PTAL, substations and grid capacity
  - Rightmove comparables updated weekly, demographics, footfall and amenities

  (https://searchland.co.uk/)
- **LandTech / LandInsight** (5,000+ UK developers, including CBRE, Savills, JLL and McCarthy Stone): planning policy and constraints, ownership, Hometrack comparables, PTAL, biodiversity, utilities, grid capacity and demographics. Pitched as triaging sites in minutes with citations to planning policy. (https://land.tech/)
- **Nimbus Maps** (surveyors, agents, developers, planners):
  - 2,000+ data sources and 30m+ residential and commercial comparables
  - Land Registry, OS and Companies House ownership
  - Planning and constraints, EA flood data, EV chargers and substations
  - Rightmove availability and footfall

  (https://www.nimbusmaps.co.uk/)

The professional primary set is ownership/title, planning history and policy, constraints (flood, green belt, conservation), comparables and PTAL. In London, PTAL drives permissible density and parking, so it feeds land value directly.

## 6. Regulation is shaping which criteria appear on every listing ("material information")

- National Trading Standards introduced material-information guidance in 2022–23 (Parts A/B/C). It covered tenure, price, council tax, property characteristics, flood risk and broadband, among others. The guidance was withdrawn on 9 May 2025 because the CPRs were superseded by the Digital Markets, Competition and Consumers Act 2024. The duty to disclose material information remains enforceable, with the CMA able to fine, but sector guidance was missing and agents called the situation "considerable confusion". (https://thenegotiator.co.uk/news/regulation-law-news/material-information-rules-axed-overnight-as-new-consumer-act-takes-precedence/)
- A Moverly audit of about 523k listings (Nov 2024) found tenure missing on 4% (20.7k) and parking missing on 25% (133k). Gaps were larger in Scottish and northern cities (Edinburgh 12% missing tenure; Glasgow 36% missing parking). (https://thenegotiator.co.uk/news/regulation-law-news/thousands-of-agents-not-complying-with-material-info-rules/)
- Material-information data products (Moverly, Sprift, Propalt-type reports) exist mainly to auto-fill these fields from title, EPC, flood, broadband and mobile data. The Moverly site itself rendered no readable content.

## 7. Primary vs secondary criteria as exposed by the tools (synthesis)

**Primary (in every tool, drives price or search filters):**
1. Location at fine grain: postcode sector or street. In London the price gap between sectors runs from £234k to £12.8m.
2. Sold-price comparables from PPD, filtered by type and tenure and normalised by floor area (£/sq ft). Floor area comes from EPC matching.
3. Property type and tenure. Leasehold vs freehold is a mandatory listing field, and in London flats are the default stock.
4. Bedrooms and floor area.
5. Transport access. In London this is PTAL, station walk time and TfL zone; elsewhere it is distance to a station.
6. Price / rent and yield (investors).

**Secondary (appear in area or risk reports and are adjusted by humans):**
- Crime rate
- Schools and Ofsted rating
- Flood risk
- Noise and air quality (NO2, particulates)
- Deprivation and affluence
- Demographics
- Broadband and mobile
- Council tax band
- EPC band
- Parking and outdoor space
- Condition and finish
- Extensions or loft conversions
- Planning history

**Professional-only:** title, ownership and covenants; planning policy and constraints; grid capacity; HMO licensing; footfall; construction year.

**London-specific:**
- PTAL/WebCAT, TfL zones and tube-line reliability (Crystal Roof)
- Price per sq ft as the standard unit
- Leasehold flats and conversions dominate
- Very large differences between neighbouring sectors
- Price-to-earnings ratio of 11.7

**Other UK cities:**
- Listing-data gaps are larger (Glasgow, Edinburgh, Newcastle; source above)
- Scotland uses Registers of Scotland, not PPD
- Agents believe AVMs undervalue rural, northern and lower-income homes

## 8. Disagreements and caveats

- **Accuracy of AVMs.** Hometrack claims accuracy leadership and calibrated confidence. 87% of agents distrust AVMs, and MSE users report gaps of up to ±40% between portals. The two positions are compatible: AVMs work statistically across a whole portfolio but are noisy for any single home, and they miss condition and improvements.
- **Crime scores.** Crystal Roof turns snapped, anonymised police.uk points into precise-looking scores out of 10. The police.uk methodology warns that geocoding accuracy is 60–97% and that town-centre postcodes are inflated (Brixton's 389 per 1,000 "at-risk" vs 123 for Lambeth). Forum users find street-level counts misleading.
- **PPD completeness.** It has a lag of up to 2 months, excludes non-market transfers, and contains errors such as misclassified types and shared-ownership part-prices. Any sold-comps view should flag category B sales and outliers.
- **Portal estimates as lead generation.** Both portals frame estimates as ranges that end in "ask an agent". Rightmove's 55% rise in valuation leads shows the estimate's commercial job is to start a seller conversation rather than to give a final price.
