# UK estate-agent valuation method (market appraisal) — research notes

Stream: UK estate-agent valuation method. Prepared October 2026.
Scope: how UK agents arrive at a recommended asking price, what evidence they use, how they adjust it, where the process goes wrong (overvaluation), and the London-specific factors: price per square foot, new-build premium, leasehold and service-charge discounting.

---

## 1. What an agent "valuation" actually is

- An estate agent's figure is a **market appraisal**: a recommended asking price and/or a likely selling price. It is not a RICS Red Book valuation and not a lender valuation. Forum users keep running into this gap. In one MSE thread a Crawley house was put at £285k by two agents and the existing lender, then at £265k by a different lender's surveyor. Replies explained that agents estimate what the house could be marketed and sold for, while surveyors give a conservative figure on the lender's behalf. [MSE 5752975]
- Mumsnet users say much the same. Agents give a "marketing price", and a buyer who doubts it should commission a RICS surveyor, whose figure is usually lower and closer to what a lender will accept. [Mumsnet 2958243]
- An MSE thread from 2018 shows how a lender's down-valuation can expose problems the price ignored. HSBC valued a flat £20k below the agreed price. The real issue turned out to be a lease of about 70 years. The vendor then offered a lower price if the buyer extended the lease, and experienced posters advised walking away because remortgaging or reselling would be hard. [MSE 5923285]

## 2. The regulatory baseline: the comparable method is mandatory

- **TPO Code of Practice for Residential Estate Agents** (England, Wales and NI, effective 1 June 2019), the code most agents are bound by:
  - **4b:** any recommended asking price or possible selling price must be given in good faith. It must reflect the available information about the property and current market conditions, and it must be supported by comparable evidence. Agents must never deliberately misrepresent market value.
  - **4c:** comparable evidence for similar properties in a similar location must be kept on file.
  - **4d:** the marketing strategy must be reviewed regularly with the client.
  - **4a:** the benefits and drawbacks of the recommended method of sale must be explained.
  - The code also bars misleading claims made to win instructions. [TPO Code PDF]
- TPO's guidance to agents (Christopher Hamer, The Negotiator, 2012) adds four practical points. Keep written market-appraisal records. Explain the reasoning on price in writing. Make clear that the asking price is not a promised selling price. Be willing to turn down an instruction at an unrealistic price. One example in the piece involved a house that sat unsold for three years. The agent recommended a cut of about 20% and backed it with comparables. [Negotiator "Great expectations"]
- **RICS professional standard "Comparable evidence in real estate valuation"** (1st ed. Oct 2019, reissued 2023, 2nd edition consulted on in 2026 covering ESG, AVMs/AI and post-dated evidence). It is the formal statement of the evidence hierarchy:
  - **Category A (direct comparables), in rough order of weight:** recent completed sales of near-identical properties with full information; recent completed sales of similar properties; completions with partial data; **properties under offer but not yet contracted** (in UK agency terms, sold STC or under offer); and **asking prices**, treated with caution.
  - **Category B (general market data):** published databases, indices, historic evidence, and supply/demand data.
  - **On asking prices:** they are unreliable evidence because they often differ substantially from the final price. They help only when combined with information on demand and offers, and getting that information usually depends on good contacts with selling agents.
  - **On published data:** public records can appear months after a deal was agreed, which makes them less relevant in a fast-moving market.
  - **Adjustments:** location, specification, condition, size, tenure and lease terms, timing, incentives, energy efficiency, and adaptability. A condition adjustment should not simply be the cost of works, because buyers also price in uncertainty and the time works take. Location and aspect adjustments are often a qualitative judgement. RICS recommends a comparables matrix and then "standing back" to weigh the evidence as a whole. [RICS standard PDF]
- **Is overvaluation unlawful?** Industry press has argued that knowingly overvaluing to win an instruction could breach consumer protection law (the CPRs, now the DMCC Act 2024 regime) or even fraud law. I could not read those articles (paywall/403), so this point comes from headlines only. [EAT 2020; EAT 2023, both unread]
- **CMA:** I found no dedicated CMA study of agent overvaluation in this stream. The work that exists comes from consumer and industry sources: Which?, GetAgent, Property Solvers and Zoopla. This is a gap; do not attribute overvaluation findings to the CMA.

## 3. Evidence sources agents use, and their limits

| Evidence | What it gives | Limits |
|---|---|---|
| **HM Land Registry Price Paid Data (PPD)** | Price, date, address, property type (D/S/T/flat/other), new-build flag, freehold/leasehold. Category A (standard market sales) vs B (repossessions, buy-to-let, company buyers) | **No floor area and no bedroom count.** Registration lag is usually 2 weeks to 2 months, so the latest two months are incomplete. Right-to-buy, gifts and non-value transfers are excluded [gov.uk PPD] |
| **Sold STC / under offer (portal and agent data)** | The freshest signal of current price levels; RICS counts it as Category A | The agreed price is usually not public; agents get it through their contacts and networks [RICS] |
| **Asking prices / competing stock (Rightmove, Zoopla)** | Shows what the buyer will compare against, and the market "temperature" | Unreliable as evidence of value [RICS]; asking prices run above achieved prices (see section 5) |
| **EPC floor area** | Lets agents compute £/sqft by joining EPC data to Land Registry prices | EPCs measure *net* habitable area, excluding garages and conservatories, so they differ from floor-plan totals; the data needs human interpretation [PIE 2017, Neil Hudson] |
| **Indices (Rightmove asking, Zoopla, Nationwide/Halifax, ONS UK HPI)** | Used to bring older comparables up to date (time adjustment) | Each measures a different stage of the transaction (see section 6) |
| **Agent's own register and local knowledge** | Viewing volumes, offers received, buyer lists | Not verifiable by the seller |

Agency marketing material (Strutt & Parker 2022) describes the method more loosely: local demand and achieved prices, adjusted for size, décor, distinctive features such as high ceilings, potential to extend, nearby changes such as schools and transport, and wider trends like working from home. The piece warns that an over-ambitious valuation deters buyers and almost always ends in a lower price. [Strutt & Parker]

## 4. Primary vs secondary valuation criteria (as used by agents)

**Primary (they move the figure the most):**
1. **Recent achieved prices of close comparables.** Same street or postcode, same type and bedroom count, ideally sold in the last 6–12 months. Required by TPO 4b and ranked top by RICS.
2. **Size: bedrooms and, in London, floor area (£/sqft).** Nationwide's hedonic model (2023, its own mortgage approvals) finds that 10% more floor area adds about 5% to a typical house's price. Going from 2 to 3 bedrooms adds 13–17% depending on house type, 3 to 4 bedrooms adds 10–13%, an extra bathroom about 6%, and a loft conversion with a double bedroom and bathroom up to about 24–25% on a 3-bed, 1-bath house. Because the bedroom effect is larger than the floor-area effect, the *layout* of the space matters as well as its size. [Nationwide 2023]
3. **Property type and tenure.** Detached/semi/terrace/flat, and freehold vs leasehold. Both fields are in PPD, so both are always available for adjustment.
4. **Current market conditions.** Sales-agreed volumes, stock levels and time to sell. TPO 4b requires the figure to reflect them.

**Secondary (adjustments):**
- Condition and modernisation (RICS: cost of works plus a further allowance for uncertainty).
- Extensions and loft conversions, or the potential for them.
- Outlook, aspect, floor level, noise, and position on the street (qualitative, per RICS).
- Garden, parking, and period features.
- Energy efficiency / EPC rating (named by RICS as an adjustment factor).
- Lease length, ground rent, and service charge (primary for London flats; see section 7).
- Local changes (schools, transport) and buyer preferences (home office, outdoor space). [Strutt & Parker]

## 5. Asking price vs achieved price, and the cost of overvaluing

- **Historic baseline (academic).** Merlo & Ortalo-Magné used Halifax Estate Agencies records from Greater London and South Yorkshire, 1995–98, which logged every list-price change and every offer. Key findings:
  - Properties sold for about **96% of the initial listing price** after about **11 weeks**.
  - More than three-quarters sold **without any change to the list price**.
  - Almost 40% sold at the first offer received.
  - Hotter markets (London, and the 1997–98 boom) had higher sale-to-list ratios, fewer price changes and more offers.
  - A higher initial list price produced a higher sale price but a longer time on the market. When a price was cut, the cut was proportionally larger than the average gap between list and sale price.
  The paper also records that in England the list price is broadly understood as a price the seller is committed to accept. That explains why agents treat the asking price as a strategic anchor. [Merlo & Ortalo-Magné, CESifo WP 778 / JUE 2004]
- **Which? (Feb 2017).** Over 370,000 sales in England and Wales (Sep 2015–Sep 2016):
  - **19%** were cut by 5% or more before selling. A typical heavily-cut property was listed at £266k and sold at £241k.
  - The estimated cost to sellers was **£4.3bn a year**, and heavily-cut homes took **64 days longer** to sell.
  - London had 13% heavy reductions; the South East and East 11%; Wales and the North East 35% or more.
  - Online-only agents had 13% heavy cuts against 19% for traditional agents. [Which? 2017]
- **Which?/The Times on Zoopla data (2019).** The ten agents that overvalued most charged on average **double the commission rate** of the ten that overvalued least. About a third of listings were cut, by an average of £23,400 (6.9%). Larger chains overvalued most. [Which? 2019]
- **Rightmove (Sept 2020).** Homes priced right found a buyer in **21 days** on average. Those needing a cut took **47 days**. **63%** of unreduced homes were marked under offer or sold STC, against **32%** of reduced ones. The average cut was 5%. [Negotiator 2020]
- **Property Solvers (2019).** Across 89,582 sales, the gap between asking and sale price was largest in London and the Home Counties: SW London about £82k, NW London about £80k, West London about £59k. [Negotiator 2019] (A commercial quick-buy firm; treat with caution.)
- **Zoopla consumer research (Mar 2025).** 78% of owners misjudge their home's value. Among sellers who found their home worth less than they expected, 28% disagreed with the agent on asking price, and only 16% got the asking price. [Negotiator 2025]
- **Zoopla HPI (Sept 2026).** The index tracks *achieved* prices using sold prices, mortgage valuations and agreed-sale data. London was the weakest region (−1% year on year), with only about **30% of London homes selling within three months**, against about 75% in Scotland. Sales agreed were down 9% year on year. [Zoopla HPI]

**Why agents overvalue (supply side).** GetAgent agent survey, Sept 2026:
- 95% have seen rivals give unrealistic valuations, and 89% have lost instructions to a higher valuation.
- 67% say the practice grew in the past year.
- Agents name the drivers as sellers choosing the highest figure (33%), competition (28%), market-share pressure (22%), and internal listing targets (11%).
- 95% say overvaluing harms sellers.
- Agents advise sellers to choose on the percentage of asking price achieved (33%), track record with similar homes (28%), and average time to sell (22%).
Readers' comments blame the industry's lack of professionalisation, and note that corporate agents chase stock volume for referral income. [PIE 2026; Negotiator 2026; PIE Jamie Carr 2026]

Earlier proptech reports (Agent Software, 2018) described the same pattern in a weak market but gave no quantified rates. [Negotiator 2018]

**Forum perspective.**
- Mumsnet (Blackpool, 2010): a £50k spread between three agents. Posters described the agent's dilemma as "price for a fast sale or inflate to win the listing". Several who had picked the top valuation reported long campaigns and an eventual sale *below* the lowest original figure. They advised asking every agent for their comparables list and checking sold prices yourself. [Mumsnet 960981]
- MSE posters estimated, as an anecdote, that agents run about 15% above lender valuations. [MSE 5752975]

## 6. Rightmove asking-price index and other indices: what agents should read from them

- **Rightmove HPI.** It reports the average **asking price of newly listed** homes in England and Wales, released on the third Monday of each month and **not seasonally adjusted**. It covers about 90% of new listings, uses mix adjustment by strata, removes about 10,000 outliers a month, and runs back to 2002. Rightmove itself says to read it alongside sold-price data and that local markets diverge. It is a *leading sentiment* indicator, not a measure of value. [Rightmove "HPI – the facts"; PIE index analysis]
- **The family of indices.** Halifax uses mortgage approvals with a hedonic model. Nationwide also uses its own mortgage approvals and excludes buy-to-let. LSL/Acadametrics uses mix-adjusted Land Registry completions. ONS/Land Registry UK HPI is the most comprehensive but lags by months. Zoopla uses achieved and agreed prices. [PIE index analysis; Zoopla HPI]
- **Practical use.** An agent bringing a 9-month-old Land Registry comparable up to date should use an *achieved-price* index for the local area. Rightmove's asking index should inform only competitive positioning, not the time adjustment.

## 7. London nuances

### 7a. Floor area (£/sqft) pricing
- London agents have long priced by £/sqft. Neil Hudson (Residential Analysts, formerly Savills) joined EPC floor areas to Land Registry prices and mapped London from under £300/sqft at the edges to about £1,000/sqft or more across a large central zone. Agents use £/sqft to explain differences between comparables to sellers; one example was a nearby detached house with 50% more floor area that sold for £75k more. [PIE 2017]
- **Caveats.** EPC area is net habitable area, which differs from marketing floor plans. Press reports (FT analysis, cited by EAT; not read in full) found floor-plan areas differing by up to about 300 sqft for the same London homes. £/sqft is only as good as the measurement behind it.
- **Prime central London levels (unverified).** Search snippets citing Knight Frank and LonRes give median achieved prices of about £1,182/sqft in Chelsea and £976/sqft in Fulham (Q2 2025), and a Chelsea premium over Fulham that has narrowed from 47% to 21% in a decade. The PrimeResi source was paywalled, so these figures are not verified.
- PPD has no floor area, so £/sqft analysis *requires* joining in EPC or agent data. This is a data-engineering point for any product built on this.

### 7b. New-build premium and its decay
- Nationally, new builds sell at a premium of about 30% over existing homes in Great Britain (UK Property Development via PIE, Aug 2026), up 6.2 points since 2016. **London is the exception:** average new-build prices there are about **10.5% below** existing homes. This is largely a composition effect, because London new builds are mostly flats. [PIE 2026]
- Another 2026 aggregator (new-builds.co.uk, read as a snippet only) puts the London premium at +4.7%. That conflicts with the −10.5% figure: definitions differ (like-for-like vs raw averages). It also reports a 61% premium for new flats vs 8% for new houses nationally, and 24% for new flats in Outer London.
- **Decay.** One PIE commenter observed that ten-year-old new builds often still sell at about their original price. Which? found more than 5,000 Help to Buy owners sold at a loss in the scheme's first six years. A Telegraph analysis, reported second-hand, found about 37% of Wandsworth new-build flats bought after 2010 resold at a cash loss from 2020 onwards. These were search snippets, not read in full. **Implication for agents:** price a resale new-build flat off *second-hand* comparables in the same block, not off the developer's price list.

### 7c. Leasehold discounting (lease length, ground rent, service charge)
- **Academic evidence on lease length.**
  - Giglio, Maggiori & Stroebel used about 1.4M English flat transactions and Rightmove listing data. Relative to otherwise identical freeholds, leaseholds with **80–99 years** left trade about **16% lower**, **100–125 years** about 10% lower, **125–150 years** about 8% lower, **150–300 years** about 3% lower, and **700+ years** at no discount. Leaseholds also stay on the market 3–6% longer. [GMS, NBER w20133 / QJE 2015]
  - Bracke, Pinchbeck & Wyatt used historic prime-London sales (Belgravia, Chelsea, Mayfair, 1987–92, before statutory extension rights) to estimate the "relativity" curve. They argue that tribunal practice under-values leases with fewer than 70 years left. [BoE WP 621 / Economic Journal 2018 abstract; LSE news 2017]
- **Market evidence (2026).** House Buyer Bureau listings analysis: short-lease flats (60 years or fewer) are listed about **22.1% below** the average flat in England (£170k vs £218k). **London's gap is the smallest, at about 11%**, reflecting strong demand for flats. Extension costs typically run above £12.5k near 100 years and above £33k below 60 years. Many lenders set minimum remaining terms, which shrinks the buyer pool; about 70 years is a common cut-off (MSE). [Landlord Today Aug 2026; MSE 5923285]
- **Marriage value.** Below 80 years, the cost of an extension includes 50% of the "marriage value" uplift, so agents and buyers treat 80 years as a pricing cliff. The Leasehold and Freehold Reform Act 2024 legislated to abolish marriage value. Leasehold Knowledge's 2023 article predates the Act, and I did not verify whether the change is in force, so treat the 80-year cliff as still relevant until checked. [Leasehold Knowledge 2023]
- **Service charges (Hamptons, Mar 2026).**
  - The England and Wales average is £2,405 a year (above £200 a month for the first time). London's average is **£2,801**, up 64.5% in a decade.
  - Flats with a service charge **at or below 1% of value were 50% more likely to sell** than those at 2% or more. 37% of flats are now above 1% and 14% above 2%.
  - Some lenders now exclude flats whose service charge is above about 1% of value.
  So agents now have to adjust for the service-charge-to-value ratio as well as lease length. [Landlord Today / Hamptons 2026]

## 8. Disagreements and uncertainties between sources

- **Size of the asking-to-sold gap.** The academic historic evidence is about 4% (Merlo & Ortalo-Magné). Which? found 19% of homes cut by 5% or more. Property Solvers reports gaps of £80k or more in SW/NW London. The sources differ in method (initial list vs last list price; averages vs subsets) and in market phase.
- **London new-build premium.** −10.5% (UK Property Development, raw averages) vs +4.7% (new-builds.co.uk). The difference is definitional.
- **Whether overvaluation is a regulatory or a market problem.** TPO says the code already forbids it. Propertymark-linked commentary says the fix is professionalisation and licensing (the RoPA agenda), not new law. Agents themselves blame sellers who choose the highest figure.
- **Agent vs surveyor vs AVM.** Forums show lender valuations falling below agreed prices, especially where there are hidden lease or condition problems. The 2026 RICS consultation on AVMs/AI in comparable evidence suggests professional standards are starting to cover automated valuations.

## 9. Implications for an close-knit product (valuation side)

- Show **achieved** comparables (PPD) joined to **EPC floor area** to give £/sqft. Flag the measurement caveat, and filter to Category A transactions only.
- Show tenure, and for flats show lease length, ground rent and service charge as a share of value, using the Hamptons 1% and 2% bands.
- Treat new-build sales separately (PPD new-build flag), and track how comparables perform on resale over time.
- Show the asking-to-achieved ratio and time to sale by area. These are the metrics agents themselves say sellers should use to judge them.
- Use achieved-price indices for time adjustment. Label Rightmove's index as asking-price sentiment.
