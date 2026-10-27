# US west coast + US valuation stack (SF, LA, Seattle, Austin, Miami)

Stream: how US buyers search and how US sellers, agents, appraisers and algorithms (AVMs) set price, as a comparator for London.
Research date: October 2026. Web searches were capped mid-stream. Reddit (www, old, the JSON API, Pullpush and mirrors) returned 403/429 or TLS errors, so forum evidence comes from Blind (teamblind.com) threads by Bay Area and Austin tech workers.

---

## 1. The US valuation stack in one picture

US residential pricing has four layers. Each one feeds the next.

1. **MLS (Multiple Listing Service)**: broker-run databases holding list prices, status changes and, critically, *closed* sale prices, plus photos and remarks. Agents trust it above every other source. In 2020, 91% of agents said they trusted MLS data most, and 84% thought the Zestimate was inaccurate (Inman survey, cited in search results; the article was not readable).
2. **CMA (Comparative Market Analysis)** by the listing agent. It takes 3 to 9 comps (sold, pending and active) and adjusts them for size, beds/baths, condition, lot, garage, pool and renovation date to give a price range. The 2026 Giant Steps / Lone Wolf survey (2,165 agents, 46 states, Nov 2025 to Feb 2026) found:
   - Agents now use fewer comps: a typical range of 3.7 to 8.7, down from 5 to 11 in 2020. They describe this as quality over quantity.
   - 63.7% name pricing as the top seller objection, up from 52.7% in 2020.
   - 33.6% say disagreement over list price is the second most common reason they lose a listing.
   - Sellers often cite Zestimates and online tools when they push back.
   - About 90% expect CMAs to matter more, up from 67%.
   - 83.2% are likely to use AI-assisted CMA tools, mainly to speed up research rather than to set the price.
   Source: https://www.realestatenews.com/2026/07/27/better-informed-sellers-are-raising-the-stakes-for-cmas
3. **Lender appraisal (URAR)** by a licensed appraiser: the sales comparison grid with Q1–Q6 quality and C1–C6 condition ratings. It is required for nearly all mortgaged purchases.
4. **AVMs**: Zillow Zestimate, Redfin Estimate, Black Knight/ICE, CoreLogic and others. They are shown to consumers on every listing page and in practice anchor both sides.

**London contrast.** The UK has no single MLS-equivalent with shared sold prices at listing time. Agents value from their own branch records, Rightmove/Zoopla, and HM Land Registry Price Paid data, which arrives with a lag. US agents work from a shared, near-real-time sold-price database, so the CMA is more standardised and an "agent valuation" is easier to check. The US problem runs the other way: consumers see an algorithmic number before they see the agent.

---

## 2. AVMs: methodology, error rates, and how they move prices

### 2.1 Published accuracy

| AVM | On-market median error | Off-market median error | Date / source |
|---|---|---|---|
| Zillow Zestimate | 1.78% | 7.20% | Zillow figures as of 8 Aug 2026, reported by naperville.com (https://naperville.com/?p=8569) |
| Zillow Zestimate | 1.94% | 7.06% | March 2025 per The Close (https://theclose.com/how-accurate-is-zillow-zestimate/) |
| Zillow Zestimate | 1.9% | 6.9% | March 2022, cited in Fu, Jin & Liu NBER w29880 |
| Redfin Estimate | 1.89% | 7.38% | Redfin methodology page (https://www.redfin.com/redfin-estimate) |

- **On-market figures are flattering.** Both AVMs take in the list price once a home is listed. A median error under 2% therefore mostly shows that the list price predicts the sale price. The honest measure of "what is my unlisted house worth" is the **off-market error of about 7%**: on a $1.2M Bay Area home, half of estimates miss by more than roughly $85k. naperville.com makes the same point: at a $595k median, 7.2% is about $43k either way. Zillow's Chicago-metro on-market figures were 83.7% within 5% and 96.1% within 10%. The Close reports national figures of 82/100 within 5%, 95 within 10% and 99 within 20%.
- **Inputs.** The Redfin Estimate uses more than 500 data points covering market, neighbourhood and home, including water views and proximity to busy roads. It is updated daily for on-market homes and weekly for off-market homes, covers about 92M homes, and needs enough comps from the past year. The Zestimate uses public records, tax-assessor data, prior sales, MLS feeds, user-submitted facts and market trends. Neither can see condition, finish quality, layout or unpermitted work, which is exactly what UAD 3.6 now makes appraisers record in detail.
- **Head-to-head (dated).** In Redfin's own 2016 study, run by SSRS (5,661 pending sales, 189 metros), the median error was Redfin 2.06%, Zillow 5.95% and Homes.com 10.26%. 64% of homes sold within 3% of the Redfin estimate, against 29% for Zillow. The study is old, Redfin-commissioned, and from before Zillow began ingesting list prices more aggressively. https://www.redfin.com/news/redfin-estimate-accuracy/

### 2.2 Non-disclosure states: Austin is the weak spot
- Texas is a **non-disclosure state**. Sale prices are not public record, so portals see closed prices only through MLS feeds. Spyglass Realty (Austin) says Zestimates there lean on list prices, tax assessments and partial feeds. It also says this is especially misleading in a cooling market, where homes increasingly sell below ask. https://spyglassrealty.com/blog/zillow-home-values-austin
- Blind thread (May 2023, about 30k views): one Austin home was valued at $460k by Zillow, $600k by Redfin and $530k by Black Knight. Repliers blamed non-disclosure and advised using comps, not AVMs. A Zillow employee argued that if buyers can negotiate down to the Zestimate, then it was "right". https://www.teamblind.com/post/zillow-estimation-is-too-wrong-in-austin-qevnugdc
- Fu, Jin & Liu likewise note that many Austin properties in their data lacked sold prices because Texas does not require disclosure. They call for more data sharing.
- **London parallel.** England and Wales publish every sale price via HMRC/Land Registry, so a UK AVM is structurally closer to California than to Texas. The UK lag, however, is weeks to months, against near-real-time MLS feeds in the US.

### 2.3 AVMs move the market: the feedback loop (academic)
- Fu, Jin & Liu (NBER WP 29880, 2022) studied Austin, Boston and Pittsburgh from 2019 to 2021. They used Zillow's unannounced algorithm updates as instruments.
  - A 1% rise in the pre-listing Zestimate raises the **list price by 0.733%**.
  - Holding the list price fixed, a 1% higher post-listing Zestimate raises the **sale price by 0.081%**.
  - Zillow updates Zestimates for the home and its comps almost immediately after a listing or sale. This creates a human–algorithm feedback loop.
  - Because each stage's effect is below 1, shocks fade. The COVID-2020 disturbance dissipated within months.
  - The authors conclude that Zestimate's ability to manipulate the market "seems low", but its pull on sellers' asking prices is large. https://nber.org/system/files/working_papers/w29880/w29880.pdf
- **Implication for London.** A displayed estimate anchors the asking price strongly and the sale price only weakly. The UK equivalents are Zoopla/Rightmove estimates and agents' instruction-winning over-valuations.

### 2.4 Practitioner and forum view
- A Blind thread (Nov 2023, Bay Area) reported AVMs running $50–100k above actual sold prices. Participants called them marketing tools, said they lag the market, and said they cannot see condition or bidding-war dynamics. The consensus was "within ~10% at best". https://www.teamblind.com/post/why-are-zestimates-redfin-estimates-way-off-from-sold-prices-qjzf3jdj
- **Disagreement.** Zillow-side voices (and the NBER paper) treat the Zestimate as informative and close to the market. Agents (84% calling it inaccurate in 2020) and appraisers treat it as noise. The evidence fits both views: it is accurate *once listed* and loose *off-market*.

---

## 3. Appraisal: URAR / UAD 3.6 and the "appraise at contract" problem

### 3.1 UAD 3.6 (the redesigned URAR)
- A single, dynamic, data-driven URAR replaces Forms 1004, 1073, 1025, 2055, 1075 and their condo, co-op, manufactured and exterior-only variants. Sections expand or contract depending on the property. https://www.appraisalinstitute.org/insights-and-resources/insights/blog/the-new-urar-rollout-has-begun
- **Timeline:**
  - Limited production from 8 Sep 2025.
  - Broad production (UAD 2.6 or 3.6) from 26 Jan 2026.
  - **Mandatory for all new UCDP submissions from 2 Nov 2026.**
  (Search-result summaries of McKissock / Appraisal Institute; the Appraisal Institute post confirms November 2026.)
- **Ratings:** the Q1–Q6 and C1–C6 scales stay, but their definitions are rewritten to reduce subjectivity. New elements are:
  - separate **interior and exterior** condition and quality ratings;
  - **room-level condition for every kitchen and bathroom**;
  - an overall condition rating in the reconciliation section.
  (Search-result summary of McKissock/CE Shop; those pages returned 403/405 when fetched.)
- **Appraiser concerns** (Appraisal Institute): workflow disruption, a feared shift from analysis to data entry, more revision requests, and fee implications. The Institute insists the job is still judgement, analysis and support.
- **Relevance.** The GSEs are turning appraisals into structured, machine-readable data, so condition and quality become model features. UK RICS Red Book mortgage valuations have no comparable structured national dataset. This is a possible gap or opportunity for London tooling: room-level condition is exactly what AVMs miss.

### 3.2 Appraisals rarely contradict the contract
- Calem, Lambie-Hanson & Nakamura (Philadelphia Fed WP 17-23; later *Real Estate Economics*, 2021):
  - About **30% of purchase appraisals equal the contract price exactly**, and fewer than 10% come in below it.
  - Exact-at-contract appraisals cluster at LTV notches where mortgage-insurance pricing jumps, and are associated with higher default.
  - Appraisals add some default-risk information but are **less informative than AVMs**.
  - A below-contract appraisal does have value: it lets buyers renegotiate.
  https://www.philadelphiafed.org/-/media/frbp/assets/working-papers/2017/wp17-23.pdf
- **For London.** In both systems the lender valuation mostly confirms the agreed price. In England, "down-valuations" play the same renegotiation role a low US appraisal does.

---

## 4. Buyer criteria: primary vs secondary (NAR data)

### 4.1 Neighbourhood choice (NAR 2025 Home Buyers & Sellers Generational Trends, Exhibit 2-7; all buyers, % citing)
Read from the PDF: https://www.nar.realtor/sites/default/files/2025-04/2025-home-buyers-and-sellers-generational-trends-04-01-2025.pdf

| Factor | All | 26–34 | 35–44 | 60–69 |
|---|---|---|---|---|
| Quality of the neighbourhood | **59%** | 61 | 65 | 58 |
| Convenient to friends/family | 45 | 53 | 43 | 47 |
| Overall affordability of homes | 36 | 51 | 41 | 33 |
| Convenient to job | 34 | **64** | 55 | 19 |
| Convenient to shopping | 30 | 22 | 25 | 34 |
| Design of neighbourhood | 26 | 23 | 26 | 29 |
| Convenient to entertainment | 22 | 26 | 25 | 22 |
| Walkability | 21 | 23 | 22 | 21 |
| Parks/recreation | 20 | 26 | 24 | 20 |
| Health facilities | 19 | 7 | 8 | 24 |
| Larger lots/acreage | 17 | 17 | 24 | 15 |
| Pet/vet/outdoor space | 16 | 26 | 16 | 15 |
| Quality of school district | 16 | 29 | **34** | 7 |
| Convenient to schools | 15 | 26 | 35 | 5 |
| Airport | 9 | 9 | 9 | 11 |
| Planned community | 9 | 5 | 6 | 11 |
| Bike paths | 8 | 8 | 9 | 10 |
| **Public transportation** | **6** | 9 | 6 | 4 |

The November 2025 annual Profile (surveying July 2024 to June 2025 buyers) headlines quality of neighbourhood 59%, friends/family 47% and affordability 35% (GAAR summary https://www.gaar.com/blog/article/inside-the-2025-home-buyer-seller-trends). WAV Group points out that "convenient to job" was 52% in 2014 and 31% in the 2025 Profile, and attributes the fall to the age of buyers (median buyer age 59, first-time buyers 40) more than to remote work. https://www.wavgroup.com/2025/11/11/nar-2025-profile/

**Primary vs secondary in the US:**
- **Primary:** price/affordability, neighbourhood quality, proximity to family, and job proximity for under-45s. For buyers aged 26–44 with children, school district quality is roughly 30–35% and acts as a hard filter.
- **Secondary:** walkability (about 21%), parks, entertainment and lot size.
- **Marginal:** public transport at **6%**. That is the starkest contrast with London, where tube/rail access is a first-order filter.

### 4.2 What buyers compromise on (Exhibit 2-12)
Price 30%, condition 23%, size 22%, style 18%, lot size 13%, distance from job 11%, friends/family 10%, neighbourhood quality only 7%, school quality only 3%. 31% made no compromise. Buyers bend on the building but hold firm on neighbourhood and schools. That ordering matches location-first London behaviour.

### 4.3 Process facts (2025 Profile)
- Search and buyers:
  - 88% of buyers used an agent.
  - Median search: 10 weeks.
  - 43% began by looking online (Generational Trends); the 2025 Profile summary gives 46%.
  - 21% were first-time buyers, a record low.
  - 26% paid all cash.
- Sellers:
  - Median tenure 11 years.
  - Median 4 weeks on market.
  - 99% of list price at sale.
  - FSBO 5%, a record low.
  - 36% cut the asking price at least once.
  - 24% offered incentives.
  (Virginia Realtors summary https://virginiarealtors.org/2025/12/08/key-takeaways-from-nars-2025-profile-of-home-buyers-and-sellers; Generational Trends PDF.)
- Agent value as buyers see it: finding the right home 49%, negotiating terms 14%, price negotiation 11%. Only **7% valued the agent most for knowing comparable prices**, which suggests buyers believe they can get comps themselves from portals.

### 4.4 Walk Score / Transit Score
- Walk Score methodology:
  - Maximum points for amenities within a 5-minute walk (0.25 mi); a decay function to zero at 30 minutes; penalties for long blocks and low intersection density.
  - Bands: 90–100 "Walker's Paradise", 70–89 "Very Walkable", 50–69 "Somewhat Walkable", below 50 car-dependent.
  - Transit Score sums route "usefulness" by frequency, mode and distance.
  https://www.walkscore.com/methodology.shtml
- Capitalisation (Redfin 2016 hedonic study, more than 1M sales in 14 metros):
  - +1 Walk Score point ≈ **+$3,250 / +0.9%** on average.
  - The effect is non-linear: a 19→20 step is worth about $181, a 79→80 step about $7,000.
  - By metro: SF $3,943 (0.42%), LA $3,948 (0.83%), Seattle $3,603 (0.96%).
  - Miami and Austin were not covered.
  https://www.redfin.com/news/how-much-is-a-point-of-walk-score-worth/
- **Tension.** Buyers *say* walkability matters to only 21% (NAR), yet prices capitalise it strongly in dense metros. Stated preferences understate it. London shows the same pattern with station proximity.

### 4.5 Schools: GreatSchools
- The 1–10 Summary Rating combines student progress (growth), test scores, college readiness and equity, relative to schools within the state. 1–4 is below average, 5–6 average, 7–10 above average. Only public and charter schools are rated. Growth is emphasised as less tied to socioeconomic status. https://www.greatschools.org/gk/ratings/
- It appears on Zillow, Redfin and Realtor.com listings by default, so it works as a search filter in a way Ofsted does not on UK portals. Bay Area Blind threads use school ratings as the first filter when choosing a town; see section 6.

---

## 5. Hazard and insurance risk: a growing primary criterion in CA and FL

### 5.1 First Street on portals, and Zillow's retreat
- First Street provides property-level Flood/Fire/Wind/Heat/Air Factor scores over a 30-year horizon. Zillow added them to listings in **September 2024** and removed them from more than 1M listings in **late November 2025**, leaving a less prominent link.
- The removal followed objections from **CRMLS (California Regional MLS)**. Its CEO said homes were assigned high flood chances despite decades with no flooding, and that showing them hurts perceived desirability. CRMLS asked Redfin, Homes.com and Realtor.com to remove predictive climate data too.
- Agents complained the scores put doubts about their listings into buyers' minds.
- **Redfin, Realtor.com and Homes.com still show the scores.** Redfin's chief economist pledged to keep doing so.
- Evidence for the model: First Street rated over 90% of homes that burned in the January 2025 LA fires as severe or extreme risk.
- Sources: https://techcrunch.com/2025/12/01/zillow-drops-climate-risk-scores-after-agents-complained-of-lost-sales, https://www.realestatenews.com/2025/12/01/why-did-zillow-remove-climate-data-from-its-home-listings
- **Disagreement.** MLS and agents question model accuracy and stigma. Climate economists argue that disclosure is what corrects mispricing (see 5.2).

### 5.2 Academic evidence that disclosure moves prices
- **Gourevitch et al. (2023, *Nature Climate Change*)**, using First Street's flood model:
  - Flood-exposed US homes are overvalued by **$121–237 billion**.
  - Overvaluation concentrates in coastal counties with **no flood-disclosure law** and low climate concern. Florida alone accounts for more than $50 billion.
  - Low-income owners and property-tax-dependent municipalities are the most exposed.
  - More than 14.6M properties face at least a 1% annual flood risk.
  https://www.rff.org/publications/journal-articles/unpriced-climate-risk-and-the-potential-consequences-of-overvaluation-in-us-housing-markets/; briefing https://riskfrontiers.com/wp-content/uploads/2023/03/Unpriced-Climate-Risk-and-Overvaluation-in-US-Housing-Markets-1.pdf
- **Ma, Walls, Wibbenmeyer & Lennon (RFF WP 23-26, 2023)**: a boundary-discontinuity study on California ZTRAX 2015–2022.
  - High fire-hazard-zone homes **with mandatory disclosure sold ~4.3% less** than nearby homes without it; moderate zones sold 2.6% less.
  - Effects were larger in Southern California and grew in 2020–21 after major fires.
  https://media.rff.org/documents/WP_23-26.pdf
- **Bengali, Nechio & Stewart (FRBSF Economic Letter 2024-22)**:
  - Distance from past wildfires had little effect on CA values from 2008 to 2017.
  - From 2018 to 2021, being farther from fires was worth about a 2% higher value.
  - Controlling for insurance and FAIR Plan use barely changed the result, so insurance does not protect values.
  https://www.frbsf.org/research-and-insights/publications/economic-letter/2024/08/wildfires-and-real-estate-values-in-california/

### 5.3 Insurance availability as a deal-killer
- The California FAIR Plan (insurer of last resort) grew about 43% from September 2024 to December 2025. Growth then slowed to under 4% in Q4 2025.
- 14% of FAIR Plan policies, and 28% of its exposure, now sit in urban, lower-fire-risk areas, including parts of the Bay Area and LA.
  https://uphelp.org/californias-fair-plan-carries-growing-load-as-insurers-retreat-beyond-wildfire-zones/
- Real Estate News reports:
  - Premiums rose about 14% a year in 2023–24.
  - Over 14% of California agents in 2024, and over 16% in 2025, had a sale collapse because the buyer could not get insurance.
- Bay Area forum talk (search-level only) cites Rossmoor (Walnut Creek) losing full fire coverage.
- **London contrast.** Insurance in London is a secondary cost, except for flood-zone or cladding/EWS1 leasehold flats. In California and Florida, insurability now gates financing and therefore works as a primary filter.

### 5.4 Miami: condo HOA and structural reserves
- After Surfside (2021), Miami-Dade recertifies at 30 years, or 25 years near the coast. State milestone inspections apply to condos over three storeys.
- **Structural Integrity Reserve Studies (SIRS)** require funded reserves for roofs, structure, fire protection, plumbing, electrical and waterproofing, covering items over $10k. This has pushed up monthly fees and special assessments.
- Miami-Dade's zero-interest loan programme had lent $19.9M to 734 owners by September 2024, up to $50k each. Failing an inspection can jeopardise a building's financing eligibility.
  https://www.miamirealtors.com/wp-content/uploads/bsk-pdf-manager/2025/02/Miami-Condos-What-Every-ResidentBuyer-Needs-to-Know-Opinion-Miami-Herald-December-13-2024.pdf
- Search summaries (not verified) indicate that Fannie and Freddie ended "limited review" for condo projects in 2026, so conventional loans now require full project reviews.
- **Primary for condo buyers:** HOA fee level, reserve funding, pending special assessments and building age. The closest London analogue is leasehold service charges, major-works (s20) bills and building safety/EWS1.

---

## 6. Forum evidence (Blind, Bay Area / Austin)

- **SF HOA thread (Dec 2018, 20+ replies).** Typical SF condo HOA is $500+/month, and high-rises run about $1k. Repliers warned of special assessments "in the thousands". Advice was to read the HOA budget. They disagreed on "never buy a condo" versus the 50–100% condo appreciation seen over 7 years. https://www.teamblind.com/post/hoa-fees-in-sf-sdztd2wt
- **South Bay vs East Bay SFH, $2M budget (Dec 2020).**
  - Criteria in order: school quality, commute under 30 minutes, a backyard for young children.
  - Pleasanton/San Ramon were praised as safe, with good schools. Dublin was discouraged because new high-density housing was straining schools. Fremont was mixed, varying neighbourhood by neighbourhood (Northgate, Brookvale).
  - Rush-hour commutes of about 1.5 hours were noted.
  https://www.teamblind.com/post/sfh-suggestions-south-bay-vs-east-bay-bp12dsbi
- **AVM accuracy threads**: see section 2.4 (Bay Area, Nov 2023) and section 2.2 (Austin, May 2023).

**Pattern.** For Bay Area tech buyers, the decision is **schools (GreatSchools/API) → commute minutes → price per sq ft/lot → hazard/insurance**. Transit is rarely mentioned outside SF proper. HOA matters only in the condo segment.

---

## 7. MLS access and listing visibility (2025–26)

- **NAR's MLOS policy (March 2025)** lets sellers choose "delayed marketing". The listing goes into the MLS within 24 hours of public marketing but is withheld from IDX and syndication for a period.
- **Zillow's Listing Access Standards** (enforced from 30 June 2025) ban from Zillow any listing publicly marketed for more than one business day before it reaches Zillow.
- **Compass** sued Zillow (June 2025) and **NWMLS (Seattle)**, which bans office exclusives; trial was set for June 2026. Douglas Elliman, Howard Hanna and Anywhere brands launched private-listing networks.
- https://www.housingwire.com/articles/compass-zillow-private-listings-2025-rewind/
- **Implication.** US search is still mostly the near-complete MLS inventory delivered through portals. Fragmentation from "private exclusives" is the live risk. London has never had a single shared inventory: Rightmove's dominance plays that role, and off-market and "coming soon" sales at the prime end are a long-standing parallel.

---

## 8. Takeaways for the London study

1. **Primary US criteria:** affordability/price, neighbourhood quality, school district (families with children), job proximity (under-45s), and increasingly **insurability and hazard** (CA, FL).
   **Secondary:** walkability, parks, lot size, design.
   **Marginal:** public transport (6%).
   London flips the transport item to primary.
2. **Valuation** is anchored on comparables in both countries. The US adds a public algorithmic anchor (about 7% off-market error) that measurably moves list prices (0.73 elasticity). Structured appraisal data (UAD 3.6) is moving condition and quality ratings into machine-readable form.
3. **Data regimes matter.** Disclosure states give AVMs real accuracy; Austin's non-disclosure degrades them. Hazard-disclosure laws make risk show up in price: −4.3% for CA fire zones, and $121–237bn of US flood overvaluation where disclosure is absent.
4. **The building and its costs are a primary filter for flats.** HOA, reserves and assessments (Miami, SF) mirror London leasehold service charges and building safety.
5. **Industry pushback on risk data.** The Zillow/CRMLS episode shows agents and MLSs resist hazard scores shown at listings. London portals face the same tension with flood-risk and EPC displays.

## Gaps / not verified
- Zillow's own Zestimate page and the Fannie Mae UAD pages returned 403. The figures come from secondary reports.
- Reddit was inaccessible, so there are no r/RealEstate, r/FirstTimeHomeBuyer or r/bayarea threads.
- No metro-level HOA medians or Seattle-specific criteria data were obtained before the search budget ran out.
