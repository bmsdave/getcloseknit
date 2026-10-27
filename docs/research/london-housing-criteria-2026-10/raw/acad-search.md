# Academic stream: housing search behaviour and portals

Stream: academic research on how people search for housing (segmented search, portal clickstream, filters, search radius, commute, information frictions, school information, discrimination in search, migrant search strategies, residential choice). Compiled October 2026.

Method note: the WebSearch budget was exhausted at the start of this stream, so sources were discovered with the OpenAlex and arXiv APIs plus known NBER pages, then read via WebFetch or downloaded open-access PDFs (pdftotext). Every number below was read in the source; nothing comes from search snippets. Sources marked "abstract only" in the JSON were not read in full.

---

## 1. The core finding: search is segmented, and geography comes first

**Geography is always the first filter. Price comes second and is nearly universal. Bedrooms or bathrooms come third.**

- **Trulia, San Francisco Bay Area (Piazzesi, Schneider and Stroebel, NBER w20823, 2015; AER 2020).** The data are 40,525 email alerts set by 23,597 searchers between 2006 and 2012.
  - Every alert has a geographic dimension. About two-thirds also set extra parameters.
  - Listing price appears in about two-thirds of alerts, and bathrooms in about one-third. Almost everyone who sets bathrooms picks "at least 2".
  - Price bands are fairly tight. The median searcher's range is about ±27% around its mid-point (10th percentile ±12.5%, 90th percentile ±58%). In dollars the median width is $300k (10th percentile $100k, 90th percentile $1.1m).
  - 25% of searchers want a single zip code. Among the rest, the maximum distance between chosen zip codes runs from 2.3 to 21.1 miles (10th to 90th percentile).
  - 61% of queries name a city as the finest geographic unit. The authors expect New York searches to follow sub-borough lines rather than whole-city lines.
  - Search ranges are often non-contiguous and non-circular. A "radius around a point" model fits real search poorly; a set of chosen areas fits better.
  - https://www.nber.org/papers/w20823 ; https://www.nber.org/system/files/working_papers/w20823/w20823.pdf

- **Who searches broadly (same paper).**
  - People in zip codes with a median age of 30 scan about five times as much inventory as people in zip codes with a median age of 50.
  - Households in areas with more children search more broadly. Higher-income areas search more narrowly.
  - The authors' explanation is a higher value of time, so older and richer buyers tolerate less commuting.
  - Implication: young or first-time buyers are flexible on location. Older, richer and family buyers are tightly anchored.

- **What makes an area popular (same paper).**
  - At zip-code level, the strongest correlate of search popularity is the density of restaurants and bars. It explains 25.3% of the variation across zip codes. One standard deviation more restaurants and bars raises popularity by 0.53 SD.
  - School quality explains 2.6%. Violent crime explains 0.4%. Weather, especially extreme heat, also lowers popularity.
  - Across cities, popularity correlates 36% with log price.
  - Primary vs secondary: amenities and "liveliness" dominate area choice for the average searcher. Schools and crime matter but are secondary in this cross-section. The paper notes this is the average searcher; the family segment differs (see section 4).

- **London (Rae and Sener, Cities 52, 2016).** Data: about 100,000 user-drawn "Draw-a-Search" polygons from Rightmove in March 2013, plus 80,000 listings.
  - Rightmove carried more than 90% of English for-sale listings.
  - Search areas are very local. 23.8% of drawn searches cover 1 km² or less, just over 50% cover 5 km² or less, and 86.5% cover 30 km² or less. For comparison, Camden is about 20 km², so most searches are smaller than a single borough.
  - Users searched with an average maximum price of £535k and minimum of £418k, against an average London price of about £464k.
  - Mean bedrooms requested was 2.2. In 51.5% of searches the user set no bedroom count at first.
  - Drawn shapes are simple: median 8 vertices, mode 5.
  - Mismatch between search and stock varies by segment. Two-bedroom homes at £250k–£500k drew about 407 drawn searches per listing, the highest-pressure segment. Search intensity forms a ring near the centre and fades outward.
  - The authors describe London as "multiple, overlapping, spatially and sectorally differentiated submarkets". Portals push users to think about place and property type at the same time.
  - **London-specific:** search units are postcode districts, stations and drawn polygons, not boroughs. Search is hyper-local and much smaller than administrative areas.
  - http://eprints.whiterose.ac.uk/99893/1/1-s2.0-S0264275115300251-main.pdf ; DOI 10.1016/j.cities.2015.12.002

- **Netherlands, Funda (Steegmans and de Bruin, PLOS ONE 2021).** Data: 1.097 billion hits on 279,941 listings across 388 municipalities, January–June 2018.
  - Online search follows a gravity law. A 1% increase in distance from the searcher's location lowers search flows by about 1.1% (PPML estimate).
  - Searches within one's own municipality are 176% higher, and searches of neighbouring municipalities 71% higher, than distance alone predicts.
  - Serious and recreational searchers show similar distance decay.
  - The gravity model explains about 80% of bilateral search flows. Even online, buyers mostly look near where they already live.
  - https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0247712

## 2. Portal clickstream as a demand signal (seller and valuation side)

- **Funda clicks per listing (van Dijk and Francke, DNB WP 481, 2015; Real Estate Economics 2018).**
  - Funda had about 60% market share. 83% of buyers used it, and 93% of respondents named it unprompted.
  - Clicks per listing (demand) divided by the number of listings (supply) gives a market-tightness index. This index Granger-causes both price changes and liquidity (rate of sale).
  - A demand shock first raises liquidity temporarily, then raises prices permanently and more slowly.
  - Clicks respond to liquidity, not to prices.
  - Sticky asking prices in the falling 2011–13 market are consistent with seller loss aversion.
  - Agent and valuation relevance: views per listing and views relative to stock lead sale speed and price. This is the logic behind agents' "views and saves" dashboards.
  - https://www.dnb.nl/en/binaries/Working%20paper%20481_tcm47-325317.pdf

- **Zillow Zestimate feedback loop (Fu, Jin and Liu, NBER w29880, 2022).**
  - Listing prices rise 0.733% for each 1% rise in the pre-listing Zestimate.
  - Holding the listing price fixed, a 1% higher post-listing Zestimate raises the sold price by 0.081%.
  - Zillow's stated median error is 1.9% for on-market homes and 6.9% for off-market homes.
  - Simulated shocks of +20% to sold prices fade because every marginal effect in the chain is below 1. The COVID-19 shock faded within months.
  - For sellers: an automated valuation model (AVM) shown to the public anchors asking prices strongly and sold prices modestly. UK analogues are the Rightmove, Zoopla and Bricks&Logic estimates.
  - https://www.nber.org/papers/w29880 ; https://www.nber.org/system/files/working_papers/w29880/w29880.pdf

- **Information asymmetry: sellers know the neighbourhood better (Kurlat and Stroebel, NBER w19875, RFS 2015).** Abstract only.
  - When the seller mix shifts toward better-informed sellers, later local prices fall.
  - The effect is stronger where neighbourhood traits drive value.
  - Neighbourhood trajectory is a hidden criterion that buyers cannot see well in listings.
  - https://www.nber.org/papers/w19875

## 3. Search tools are shifting from filters to conversation (2025–26)

- **Redfin conversational search (Redfin news, November 2025).**
  - Users state compound preferences such as budget, area, specific finishes and an aesthetic like "cottage-like feel", plus commute and school proximity.
  - In early tests, users viewed nearly twice as many listings and searched broader areas with more specific home preferences. They were 47% more likely to request tours.
  - Natural-language search widens geography and narrows attributes, the reverse of classic filter search.
  - https://www.redfin.com/news/redfin-debuts-conversational-search/

- **Realtor.com RealAssistAI (HousingWire, June 2026).**
  - Conversational search covers affordability, neighbourhood traits, commute routes, nearby schools, parks and local businesses.
  - It remembers budget and priorities across sessions.
  - No usage statistics were published.
  - https://www.housingwire.com/articles/realtor-com-launches-realassistai-powered-by-google/

- **JPIF "Real Estate Insights" (Szumilo and Wiegelmann, UCL, 2024).**
  - A practitioner overview. Machine learning already personalises search results from browsing habits, and AVMs give first-pass valuations.
  - Large language models are useful but probabilistic, so they need human checking.
  - Algorithmic bias and loss of personal service are the main risks.
  - The authors frame this as a "jagged frontier": AI helps a lot on some real-estate tasks and fails on others.
  - https://discovery.ucl.ac.uk/10190161/1/Szumilo_The%20Good%2C%20the%20Bad%2C%20and%20the%20Algorithmic%20-%20Szumilo%20%26%20Wiegelmann.pdf

- **LLM steering audit (Samad et al., arXiv 2606.06694, 2026).** Abstract only.
  - Seven LLMs were tested in four US cities. They showed inconsistent racial steering, which increased or changed when lifestyle preferences were added to the prompt.
  - Results depended on the city.
  - Risk for AI area recommenders: preference-based prompts can reproduce sorting.
  - https://arxiv.org/abs/2606.06694

## 4. Information frictions: schools, climate risk and neighbourhood quality

- **School information on listings changes search and moves (Bergman, Chan and Kapor, NBER w27209, 2020).**
  - Design: an RCT on GoSection8, the largest US listing site for voucher holders. School-quality information was randomly added to listings.
  - Treated families sent more inquiries to units zoned to better schools. After moving, their zoned schools were 0.10 SD better, equal to 1.5 percentage points more pupils proficient.
  - Estimated trade-off: families would accept 54 extra minutes of commute downtown for a 10-percentile gain in school quality.
  - Ignoring the information friction understates this to 24 minutes, a bias of more than 50%.
  - Families underestimate school quality given neighbourhood traits, and use poverty as a poor proxy for school quality.
  - Implication: schools are a primary criterion for families, but only when the information is shown at the point of search. Without it, revealed preference makes schools look secondary. This reconciles the Piazzesi et al. finding that schools explain little search popularity.
  - https://www.nber.org/system/files/working_papers/w27209/w27209.pdf

- **How school information is framed (Figlio and Lucas, NBER w8019; AER 2004).** Abstract only.
  - Florida A–F school grades moved house prices even where differences in the underlying scores were arbitrary.
  - How information is labelled matters. UK analogue: Ofsted grades shown on portals.
  - https://www.nber.org/papers/w8019

- **Measuring willingness to pay for schools (Bayer, Ferreira and McMillan, NBER w13236, 2007).** Abstract only.
  - Using a boundary-discontinuity design inside a residential-choice model, a 5% rise in school performance is worth less than 1% on house prices, lower than earlier estimates.
  - Apparent willingness to pay for richer or better-educated neighbours mostly reflects unobserved neighbourhood quality.
  - Preferences vary widely, including self-segregation by race and education.
  - https://www.nber.org/papers/w13236

- **Flood risk shown on listings (Fairweather, Kahn, Metcalfe and Sandoval Olascoaga, NBER w33119, 2024).** Abstract only.
  - Design: an RCT with 17.5 million Redfin users.
  - Showing flood-risk information changed search, bids and purchases. Buyers gave up amenities to get lower risk.
  - Effects were largest in high-risk areas, with no partisan difference.
  - Environmental risk becomes a primary criterion once it is visible. London relevance: Thames and surface-water flood maps on portals.
  - https://www.nber.org/papers/w33119

## 5. Discrimination and unequal information in search

- **Discriminatory steering (Christensen and Timmins, NBER w24826, 2018/2022).** Abstract only.
  - In HUD paired audits across 28 US cities, minority testers were steered toward areas with worse schools, more poverty, more assaults and more pollution.
  - Steering alone explains a substantial share of minority concentration in poor neighbourhoods.
  - The agent is an active filter on choice.
  - https://www.nber.org/papers/w24826

- **Listing information differs by neighbourhood (Boeing, Besbris, Schachter and Kuk, Housing Policy Debate 2020).** Data: 1.4 to 1.7 million US Craigslist listings.
  - Over half of majority-White tracts are over-represented relative to vacancies, against under a quarter of majority-Black or Latino tracts.
  - Over-represented tracts have $21k higher incomes and $80k higher home values.
  - Listings in poor Black, Latino and Asian tracts are 7–9 points less likely to show an exact address.
  - Searchers in poorer or minority areas get thinner information.
  - https://arxiv.org/abs/2001.11585 ; https://escholarship.org/content/qt8st3t83j/qt8st3t83j.pdf

- **Personalised portal ranking (Asplund et al., ICWSM 2020).**
  - Sock-puppet audits of Trulia and Realtor.com, which use "Just for you" and "Relevant listings" sorts. Zillow and Redfin were excluded because their sorts were not personalised.
  - Female profiles saw more expensive properties ranked first on Realtor.com.
  - White profiles saw more housing ads. Black male profiles saw more rent-to-own ads.
  - There was some evidence that Chicago's Lake View appeared less often to Black profiles.
  - https://ojs.aaai.org/index.php/ICWSM/article/download/7276/7130

- **UK rental platforms and "No DSS" (Meers, Information, Communication & Society 2024).** Highly relevant to London.
  - 96% of UK renters found their home through Rightmove, SpareRoom, Zoopla or Gumtree.
  - On SpareRoom in 2016, 83% of 1,683 listings ticked "No DSS" in the built-in preference tool, so only 2% accepted housing-benefit tenants.
  - After the tool was removed, 48% of 2021 listings were open to benefit recipients, up from 9%.
  - Advertisers did not move the exclusion into free text or the "professionals only" option.
  - The search filters themselves (occupation, gender, age, pets) shape who can find what. "Pet-friendly" filters make most stock vanish.
  - Implication: in London renting, the filters that matter include landlord-side eligibility criteria (benefits, pets, professionals, couples, age), not just tenant preferences.
  - https://eprints.whiterose.ac.uk/id/eprint/210566/3/The_new_lettings_agents_window_interface_design_and_discrimination_on_online_rental_platforms.pdf

## 6. Migrants' search strategies

- **London migrant room rentals (Barry Born, Antipode 2026).** Data: 63 interviews (29 migrants, mostly EU and Latin American) with fieldwork in 2017–21.
  - Low-income migrant renting runs through an informal economy of rooms advertised in Facebook and WhatsApp groups and newsagent windows, often aimed at one nationality or language.
  - Access often comes through co-ethnic contacts or chance contacts at work.
  - 75% of migrants who arrived within the last five years rent privately, against 13% of those resident over 20 years.
  - Criteria are price per week or month (£165 per week for a partitioned central room; £300 per month for a former storeroom), closeness to work to save transport cost and time, and the ability to get a formal tenancy or proof of address.
  - Space is the variable people give up.
  - https://eprints.whiterose.ac.uk/id/eprint/245931/1/Antipode%20-%202026%20-%20Barry%20Born%20-%20Rental%20Rooms%20%20Spaces%20of%20Migrant%20Housing%20%20Overcrowding%20%20and%20Social%20Reproduction%20in%20the.pdf (Antipode 2026, DOI 10.1111/anti.70197)

- **Seville, Spain (Iglesias-Pascual, Housing Studies 2018).**
  - New economic migrants initially avoid stigmatised immigrant areas and prefer areas with more native residents.
  - Owners' and letting agents' refusal to rent to immigrants pushes them into enclaves.
  - Over time, co-national networks for jobs and help make those areas more valued, which the author reads as resignation as much as preference.
  - Transport links are the stated positive. Irregular migrants choose enclaves to stay inconspicuous.
  - https://rio.upo.es/bitstreams/b3da62df-8d2a-4fa8-be13-e06390c0d1ed/download

- **Short-term transnational professionals and students, Porto (Monteiro et al., JTLU 2021).**
  - Lower residential satisfaction goes with lower rent, living further from work or study, and higher transport spending.
  - Newcomers who trade distance for rent often lack information on the transport supply and land-use mix of outer areas.
  - For relocators, commute distance and transport access are the first criteria. The main risk is that information gaps lead to "dissonant" choices.
  - https://www.jtlu.org/index.php/jtlu/article/download/1952/1588

## 7. Primary vs secondary criteria (synthesis)

**Primary, near-universal, set as hard filters:**
1. Geography: a named area, station, postcode district or drawn polygon. In London this is very local (median under 5 km²) and often non-contiguous. (PSS; Rae and Sener; Steegmans and de Bruin)
2. Price band, typically ±12–58% around a target. (PSS; Rae and Sener)
3. Size, as bedrooms (US: bathrooms). In London about half of initial searches leave bedrooms unset. (PSS; Rae and Sener)
4. For renters, eligibility filters: benefits, pets, professionals only, sharers. (Meers)
5. Commute or travel time to work, implicitly. It drives search radius and is worth large trade-offs, such as 54 minutes against 10 school percentiles. (Bergman et al.; PSS; Monteiro et al.)

**Secondary (soft, area-level, often not filterable):**
- Restaurants, bars and amenity density: the strongest area-popularity correlate on average. (PSS)
- School quality: primary for families when shown, otherwise underweighted. (Bergman et al.; Figlio and Lucas; Bayer et al.)
- Crime and safety: modest on average. (PSS)
- Climate and flood risk: primary once disclosed. (Fairweather et al.)
- Property type and finishes: increasingly expressed in conversational search. (Redfin)
- Co-ethnic community and networks, for migrants. (Barry Born; Iglesias-Pascual)

**Seller and agent side:**
- Views or clicks per listing relative to supply predict liquidity first and price later. (van Dijk and Francke)
- Public AVMs anchor listing prices with an elasticity of about 0.73. (Fu, Jin and Liu)
- Sellers hold private knowledge of where the neighbourhood is heading. (Kurlat and Stroebel)

## 8. Where sources disagree

- **Do schools matter?** Area-level search popularity (PSS) gives schools only 2.6% explanatory power. The RCT (Bergman et al.) shows families value schools highly once informed. Bayer et al. find willingness to pay is lower than naive estimates. The difference reflects both who is measured (average searcher vs families) and information gaps.
- **Do online platforms equalise access?** Boeing et al. and Asplund et al. say no: information and rankings are uneven. Meers shows that interface changes can sharply reduce exclusion. Design decides the outcome.
- **Is search local or broad?** Funda gravity flows and London polygons both show very local search. Conversational AI search (Redfin) widens geography. The tool shapes how wide people look.

## 9. Different markets

- **London:** drawn-polygon and station-based search smaller than a borough; a dominant portal with more than 90% of listings; highest search pressure on two-bedroom homes at £250k–£500k (2013 prices); rentals sit behind landlord-set eligibility filters; a large informal room market for migrants.
- **San Francisco Bay Area:** search follows city lines (61% of queries); bathrooms are a common filter.
- **Netherlands:** search follows a distance-decay gravity pattern with strong own-municipality bias; one portal (about 60% share).
- **US low-income renters:** voucher listing sites; information gaps on schools.
- **Spain and Portugal migrants:** network-led search; owner discrimination; transport links as the stated positive.
