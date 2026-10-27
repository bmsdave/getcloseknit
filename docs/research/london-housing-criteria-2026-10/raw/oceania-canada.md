# Sydney, Melbourne, Toronto, Vancouver: how homes are searched for, priced and sold (stream notes, Oct 2026)

Scope: Australia (NSW/VIC) and Canada (Ontario/BC) as comparators for London. Covers sale method (auction, offer dates), price-signalling rules (underquoting laws, reserve disclosure, competing-offer disclosure), valuation tools (AVMs, CMA, HPI, Teranet), building-level due diligence (strata reports, depreciation reports, building and pest inspections), location criteria (school zones, transit proximity, aspect) and policy shocks (foreign-buyer taxes and bans, the Toronto pre-construction condo bust).

Method note: Reddit blocks WebFetch and curl. Threads were read in a headless browser: the opening post plus the top 18-30 comments in each. Whirlpool, PropertyChat and RedFlagDeals returned 403 or a paywall redirect. They appear below only as search snippets, marked read_fully=false. The web-search budget ran out before I could find a Domain or PropTrack aspect study, so the north-facing premium has no quantified source here.

---

## 1. The defining difference from London: in AU and CA the advertised price is often not the price

### 1.1 Australia: auction culture and underquoting

- **Auctions and price guides are the normal way to sell in Sydney and Melbourne.** In NSW and VIC the advertised figure is a "price guide" or "indicative selling price", not an asking price. Buyers expect the guide to be beaten.
  - CHOICE spot-checked 52 Sydney and Melbourne properties. 52% sold above the top of the quoted range and 25% sold more than 10% above it. One Sydney house quoted at $1.6m sold for $2.2m (+38%).
  - A Consumer Affairs Victoria investigation of 200 sales (2015-16) found that only 27% sold within the agent's estimate. CAV complaints rose 114% in a year. https://www.choice.com.au/money/property/buying/articles/real-estate-price-underquoting
- **Forum heuristics from buyers.**
  - r/AusProperty (Mar 2026): the OP's example sold about $200k above the bottom of its guide and $110k above the top. Commenters described homes going $200k and $330k over guide, and a Melbourne-east home quoted at $1m that sold at $1.3m.
  - The most practical tip in the thread: compare the guide with the suburb median. If the guide is $1m and the house median is $1.6m, the guide is probably understated.
  - Several commenters wanted a tool that compares each listing's guide with nearby sold prices and scores how far it underquotes. That is a product idea directly relevant to this project.
  - One commenter's view: anyone who knew the area should have known a 30% gap was coming. https://www.reddit.com/r/AusProperty/comments/1s0ljum/underquoting/
  - Whirlpool and PropertyChat snippets (not read in full) give the same rules of thumb: "add at least 20% to the top of the guide", "Sydney sells 15-30% over the guide", "guides run 10-15% under the reserve in high-demand areas". https://forums.whirlpool.net.au/archive/3kpy20nl ; https://www.propertychat.com.au/community/threads/guide-vs-reserve-vs-sale-price.83703/
- **Disagreement.** Industry voices separate deliberate underquoting from competitive bidding that legitimately runs past a fair reserve. Buyers on forums largely treat them as the same thing.

### 1.2 The regulatory answer: estimates must be evidence-based

- **NSW (current rules).**
  - The agent must put a reasonable estimated selling price in the agency agreement, based on comparable sales, valuations, property features, sale method and buyer feedback. The agent must not advertise or say anything below that estimate, and must revise it (with written records) when the evidence changes.
  - A price range can be at most 10% wide, e.g. $500k-$550k. "Offers over", "offers above" and "$X+" are banned.
  - Penalties: $2,200 on-the-spot fines, court fines up to $22,000 and loss of commission. https://www.nsw.gov.au/housing-and-construction/property-professionals/working-as-an-agent/underquoting-guidance
- **NSW (announced Mar 2026, expected late 2026).**
  - Every advertisement must carry a price or price guide.
  - Agents must publish a Statement of Information with comparable sales and the suburb median.
  - An agent cannot advertise below a rejected offer or a failed auction bid.
  - Maximum penalty rises to $110,000 or three times the commission, whichever is greater.
  - Fair Trading can order a price estimate to be independently verified by a valuer. https://www.nsw.gov.au/ministerial-releases/nsw-cracks-down-on-underquoting-tough-new-laws
- **Victoria (from 1 Oct 2026, for auctions from 16 Oct).**
  - The vendor's reserve must be published as a single dollar figure at least 7 days before an auction or fixed-date sale. "From", "over", "+" and "starting at" are not allowed.
  - The Statement of Information becomes a **Property Price Statement**. It must list the property's key features (type, bedrooms, bathrooms, car spaces, floor area, land size) and the **3 most comparable sales**:
    - Melbourne metro: within **6 months and 2 km**.
    - Regional VIC: within **18 months and 5 km**.
  - Maximum penalty is about $48.8k. https://www.consumer.vic.gov.au/licensing-and-registration/estate-agents/new-changes-to-property-sales-and-underquoting-laws/industry-qas-new-changes-to-property-sales-and-underquoting-laws
  - **Implication for valuation:** this writes the agent's comparable-sales method into law. Comparables are matched on bedrooms, bathrooms, car spaces, floor area and land size, inside a fixed time and distance window. It is the closest any of these jurisdictions comes to a statutory definition of "what a home can sell for".
- **Industry pushback (trade press).**
  - The REIV commissioned a survey: 94% of Victorian owners said they would change their selling strategy under 7-day reserve disclosure. REIV argues this "will drive people away from auctions" towards private negotiation, and proposed a 10% reserve range disclosed 3 days out instead.
  - Premier Allan's case: buyers waste weekends on homes whose reserve was always above the range. https://www.realestatebusiness.com.au/industry/32201-will-drive-people-away-victorian-premier-real-estate-body-clash-over-reserve-prices
  - Unresolved practical questions (Elite Agent, Sep 2026):
    - Does raising the reserve restart the 7-day clock?
    - Does rejecting an offer above the published reserve create a new reserve?
  - Some agents were reportedly bringing auctions forward to before 1 October. https://eliteagent.com/victorian-auction-law-changes-agents-seek-clarity/
  - Buyers are also sceptical. On r/AusProperty, one commenter argued the published reserve is not binding and a vendor bid can push straight past it. https://www.reddit.com/r/AusProperty/comments/1s0ljum/underquoting/

### 1.3 Does auctioning actually raise the price? Academic evidence

- **Cortés, Singh, Solomon & Strahan, NBER WP 30760 (2022)**, using CoreLogic AU data (roughly a third of AU homes sell at auction):
  - Homes that fail at auction later sell at a **2.6% discount**. The discount is larger after repeated failures or when there were no bids.
  - Owners who **anchor their reserve on better nearby properties** are more likely to fail, and the authors use this to instrument failure. The discount mostly reflects stigma (lower buyer willingness to pay), not hidden defects.
  - Prices cluster just below round numbers. https://www.nber.org/papers/w30760
- **Published version (Review of Finance, 2026; read via university summaries, not the paper):**
  - About 480,000 NSW and VIC transactions, 2007-2019. Monthly auction failure rates were 10-40%, roughly 1 in 5 on average.
  - A home sold after a failed auction fetched about 1.3% less than a private-treaty equivalent.
  - A successful auction beat private treaty by only about 0.7%. Netting out the failure risk, the expected auction premium is about **0.3%**.
  - The stigma lasts about 6-10 months. https://www.unsw.edu.au/newsroom/news/2026/05/what-is-the-hidden-cost-of-a-failed-property-auction ; https://www.sydney.edu.au/news-opinion/news/2026/07/02/what-can-happen-when-a-home-does-not-sell.html
- **Disagreement inside the same research line.** The headline discount fell from 2.6% (NBER, measured against the property's counterfactual price) to 1.3% (RoF, measured against private treaty). The two use different baselines, so the numbers should not be mixed.

### 1.4 Canada: list-low and offer-date "blind auctions"

- **Toronto's version of the auction is the offer date (holdback).** The seller lists below market, sets a date to review offers, and invites "bully" pre-emptive offers. Offers are sealed.
  - TopHouse studied TRREB listings in July 2023. 27% of new listings used an offer date, and about 70% of those did not produce an accepted offer on the night: 53% got no bids and 20% had their bids rejected.
  - Brokers say the tactic only works with a list price **20-30% below market**, in demand pockets. https://www.theglobeandmail.com/real-estate/article-study-shows-most-properties-with-a-set-offer-date-failed-to-sell/
- **Forum consensus, 2026 (r/TorontoRealEstate).** A GTA seller's agent suggested listing $25k under the target price. Top-voted replies (57 and 56 points) called it a failed strategy in the current market:
  - $25k is not enough to trigger competition.
  - Buyers anchor on recent sold prices from HouseSigma and lowball accordingly.
  - Failed offer nights poison the listing. One buyer described a house relisted $400k higher after its offer day that then sat unsold.
  - The recommended alternative: price to comparables from the last 90 days, adjusted for renovation, lot size and parking. https://www.reddit.com/r/TorontoRealEstate/comments/1r3e5ya/selling_home_should_we_underprice_to_induce/
- **Counterpoint (Aug 2026).** Bidding wars persist in "desirable pockets", especially semis where first-time buyers stretch.
  - A frequent claim in the thread: list a $1.5m home at $999k and you get a bidding war in any market.
  - Several commenters say that how far a house is underpriced against comparables, not real demand, decides whether a bidding war happens. https://www.reddit.com/r/TorontoRealEstate/comments/1vd6clz/bidding_wars_are_still_a_thing/
- **Regulation (Ontario, TRESA).**
  - The seller's agent must disclose the *number* of competing written offers.
  - Since Dec 2023, the seller *may* direct the agent to disclose offer *content* (an "open offer"), never personal information. Buyers should not expect to see prices.
  - RECO warns against waiving financing or inspection conditions to compete. https://www.reco.on.ca/consumers/information-for-buyers/competing-offers/

**Implication for London.** London uses asking prices with "offers in excess of" (OIEO) and sealed or best-and-final rounds. That puts it somewhere between AU auctions (open bidding, regulated guides) and Toronto (sealed bids with an offer count). None of the AU or CA rules on guides or reserve disclosure exist in England.

---

## 2. How value is estimated: AVMs, CMA and price indices

- **AU portal AVMs are an orientation tool, not a price.** r/AusProperty, Mar 2026, "most accurate valuation website":
  - Most-upvoted answers: "auction day" and the realestate.com.au sold listings.
  - Users report Domain, REA and property.com.au estimates can be off by $50-200k, especially for atypical stock (one user's 6-bedroom house swings monthly). One buyer discounted property.com.au estimates by $50-200k as a rule.
  - Cotality's RP Data, the professional tool, is seen as more reliable but conservative. OnTheHouse gives free Cotality data.
  - Suburb medians and recent comparable sales are preferred to single-property AVMs.
  - A minority view: estimates were usually within 10%. https://www.reddit.com/r/AusProperty/comments/1rlwzjc/which_website_has_the_most_accurate_property/
- **Independent AVM test (Microburbs, Feb 2026).**
  - 7,037 Melbourne sales head to head (50,230 nationally). Median absolute error was about $37.6k for MicroVal and about $49.8k for Domain.
  - Domain was stronger above $1.5m: 93.6% of estimates within 10%.
  - Caveats: this is a vendor's self-test, and Domain's estimates were scraped after the sale, so Domain may already have updated them. https://www.microburbs.com.au/p/avm-vs-domain
- **What AVMs cannot see (Cotality, Feb 2026, US context).** Confidence scores and forecast standard deviation are reported per estimate. The model cannot capture condition or interior features without an inspection, so complex properties still need a human valuer. https://www.cotality.com/insights/media/the-reality-of-automated-valuation-models-and-ai-trust
- **Canada: Realtor CMA.** Toronto brokers price from sold comparables, active listings and expired listings. Adjustments cover location, size, lot, condition and features. The initial list price is treated as the biggest single lever. Stale listings shift buyers from "how much must I pay" to "what can I pick it up for". https://sagerealestate.ca/blog/pricing-toronto-home/
- **CREA MLS Home Price Index.**
  - It is a hybrid hedonic and repeat-sales model with a "benchmark home" for each neighbourhood and property type. Numeric attributes take the median of the last 5 years of sales; qualitative ones take the mode.
  - Example attributes for a two-storey detached home: finished basement, siding type, living area (1,600 sq ft), bathrooms, half-baths, fireplaces, garage spaces, rooms, and the square root of lot size.
  - It exists because medians mislead when the mix of sales changes. https://www.crea.ca/files/mls-hpi-data/english/HPI-Methodology-simplified-ENG.pdf
- **Teranet-National Bank HPI.**
  - A repeat-sales index built from land-registry data, covering 11 CMAs including Toronto and Vancouver.
  - It excludes non-arm's-length sales and properties whose type changed. It captures about 20% more sales than MLS, including private sales.
  - Data runs about 3 months behind. https://www2.geowarehouse.ca/blog/teranet-national-bank-house-price-index-why-you-should-be-following-this-valuable-data/
  - The closest UK analogues are the Land Registry and ONS repeat-sales (Teranet) versus hedonic (Rightmove asking, CREA) split.

---

## 3. Building-level due diligence: secondary criteria that act as primary filters

- **Strata reports (NSW).** A first-home buyer (Apr 2026) found the capital works fund, special levies and defects buried in meeting minutes hard to interpret. Replies:
  - "This is why you have a conveyancer".
  - Buyers screen 2-3 strata reports a weekend themselves (some paste them into ChatGPT) before paying a professional for the serious ones.
  - LLMs miss plan-level issues such as easements and services on the lot.
  - Ordering your own strata search is cheaper and more revealing. https://www.reddit.com/r/AusProperty/comments/1sc1ep7/first_home_buyer_in_nsw_how_are_you_actually/
- **Depreciation reports (BC).**
  - Since 1 July 2026, every strata with 5 or more units in Metro Vancouver, the Fraser Valley and the Capital Regional District must hold a current report. The ¾-vote waiver was removed, and reports must be updated every 5 years.
  - Buyers check the contingency reserve fund (CRF) against the 30-year plan, Form B (fees, levies owing), 2 years of minutes, the insurance deductible, and big-ticket items due within 5-10 years (roof, elevator, parkade membrane, cladding). https://www.zealty.ca/blog/depreciation-report-bc
  - Forum reality (r/vancouver, 2019): a 30-year-old building held only 10% of its recommended reserve, and the report called for about $2,000 per unit per year.
  - Replies: virtually no Vancouver building is fully funded. The real trade-off is higher fees now or large special levies later. "Remediation" in the minutes means walk away. The leaky-condo legacy of 1990s envelopes is a specific Vancouver risk.
  - Ontario's analogue is the status certificate. https://www.reddit.com/r/vancouver/comments/cwgmqy/condo_depreciation_reports_show_crazy_high_funds/
  - **London analogue:** leasehold service charges, section 20 major works and post-Grenfell EWS1/cladding. Leasehold length and ground rent have no AU or CA equivalent.
- **Building and pest inspections (AU).** These are standard pre-purchase checks. Underquoting forces buyers to pay for them on homes they cannot afford, and CHOICE cites this as a main harm of underquoting.
- **Ontario warning.** Waiving inspection or financing conditions to win a bidding war is common, and the regulator warns against it (RECO).

---

## 4. Location and dwelling criteria

### Primary criteria (drive price strongly)

1. **School catchment (AU, especially Melbourne and Sydney).**
   - Cotality custom-boundary analysis (Jul 2025): Killara High / Willoughby Girls / Lindfield catchment houses are worth about **$1.3m (39.8%) more** than comparable homes outside the zone in the same suburbs. Princes Hill / University High (Melbourne) carry about **$357k** more.
   - Not every zone has a premium: Cherrybrook Tech showed −$155k and Doncaster SC −$48k.
   - Six of the seven premium clusters had **lower 15-year capital growth** than nearby homes outside the zone, e.g. 126% vs 150%.
   - Cotality cautions that the premium may also reflect train stations and resident incomes. https://www.cotality.com/au/insights/articles/families-pay-six-figure-premiums-to-secure-homes-in-top-public-school-catchment-zones
   - This matches London's "outstanding primary" postcode premium, but AU zones are hard boundaries (strict public enrolment).
2. **Comparable recent sales and the suburb median** are the buyer's main price anchor in both countries, as in sections 1-2.
3. **Transit proximity (Toronto subway, Vancouver SkyTrain).** Hedonic studies find proximity capitalises into prices, with the effect varying by station type and neighbourhood. Snippet only: Toronto rents fall about 2.4% for houses and about 1.9% for condos per extra 5-minute walk to the subway. The JTLU paper text could not be extracted, so this is not verified (read_fully=false).
4. **Dwelling type and land.** In Toronto, detached vs semi vs condo, plus lot frontage and parking, shape the CMA. The CREA benchmark home makes lot size, basement, bathrooms and garage spaces explicit price drivers.

### Secondary criteria (tie-breakers, or primary for some segments)

- **Aspect and orientation (AU-specific).** In the southern hemisphere, north-facing living areas get winter sun. In a Sydney apartment thread (Mar 2025):
  - Most commenters advised avoiding south- and west-facing units. Reasons: dark, cold winters; very hot west-facing bedrooms in summer, needing air-conditioning; brick walls re-radiating heat at night.
  - North-facing units "sell well over budget".
  - Dissenters: a south and west unit stayed cooler in western Sydney summers; large windows mitigate; price and location can outweigh aspect.
  - The ideal stated for houses: a south-facing street frontage with north-facing rear living areas. https://www.reddit.com/r/AusProperty/comments/1jefl0n/thoughts_on_buying_an_apartment_with_mainly_south/
  - A trade commentary (2013) argues that location and water views can outweigh aspect. https://www.apartments.com.au/expert-insights/investing/north-south-east-or-west-how-can-investors-make-the-most-of-house-aspect
  - Unverified claim in a search snippet: north-facing outperforms by 20-25%. No source was read.
  - **London relevance:** south- or west-facing gardens are the UK mirror image. They are a secondary listing keyword rather than a priced attribute.
- **Strata health, fees and levies**, as in section 3. These become primary for older condo buildings.
- **Renovation need.** Toronto forum: buyers who lose bidding wars on fixer-uppers note the winner paid $100k over a value that already ignored $75-100k of renovation work.

---

## 5. Policy shocks: foreign buyers and investor condos

- **BC 15% Foreign Buyers Tax (Aug 2016).** West & Botsch (2020) use the tax as a natural experiment and find:
  - Out-of-town buyers significantly raise local house price growth.
  - The tax had an immediate but **limited** effect on affordability. Foreign buyers switched into renting (rental vacancy rates more than halved), and new owner-occupied construction fell in "destination" neighbourhoods, which dampens the long-run price effect. https://www.aeaweb.org/conference/2021/preliminary/paper/sEFGk7nH
  - Other studies (snippets only): about 6% bigger price falls in neighbourhoods with many foreign buyers (UBC Sauder). Foreign buyers' share of sales fell from 13.2% to 1.7%. A uOttawa paper estimates the Toronto NRST cut monthly price growth by 3.94 points and transactions by 38%.
- **Federal ban.** Non-Canadians are barred from buying residential property (3 units or fewer, including condos) in CMAs, extended to 1 Jan 2027, with exemptions. This is search snippet only, and whether it has been renewed again was not verified.
- **Toronto pre-construction and condo-assignment bust (Urbanation, Jan 2026).**
  - GTHA new-condo sales in 2025 were 1,599 units: the lowest since 1991, 91% below the 10-year average and 95% below 2021.
  - 28 projects (7,243 units) were cancelled.
  - About 10% of pre-sold units registered in 2025 (around 3,000) were taken back by developers.
  - A record 3,897 completed units were unsold.
  - New launches average $1,123/psf against $856/psf for resale, so assignment sellers face appraisal shortfalls. https://www.urbanation.ca/node/379
  - **Implication:** in investor-heavy condo stock, the gap between new-build and resale price per sq ft is the key valuation signal. This parallels London's new-build premium and investor-flat discount.

---

## 6. City-specific vs common patterns

| Theme | Sydney / Melbourne | Toronto | Vancouver | London (contrast) |
|---|---|---|---|---|
| Sale mechanism | Open auction (about 1/3 of AU sales), price guide | List-low plus offer date / bully, sealed bids | Offers, multiple-offer rounds; strata dominant | Asking price / OIEO, sealed best-and-final |
| Price-signal rule | ≤10% range, no "offers over"; VIC reserve disclosed 7 days out (Oct 2026); comparables within 6 mo / 2 km | Number of offers disclosed; content optional (TRESA) | n/a in sources read | No statutory guide or reserve rules |
| Value tools | Cotality RP Data, Domain/REA/PropTrack AVMs, sold listings, suburb medians | HouseSigma sold data, CMA, MLS HPI, Teranet | MLS HPI, BC Assessment (not read) | Rightmove/Zoopla, Land Registry, Hometrack |
| Building risk doc | Strata report, building and pest | Status certificate | Depreciation report, Form B, minutes | Leasehold pack, service charge, EWS1 |
| Distinctive criteria | School zone (hard boundary), north aspect | Semi vs detached, parking, subway | Leaky-condo era, CRF funding, SkyTrain | Lease length, tube zone, conservation area |

## 7. Disagreements and gaps

- **Auction premium.** Media and industry say auctions get the best price. Academic work finds about 0.3% net, with failure stigma of 1.3-2.6%.
- **Toronto list-low.** Brokers say it works at 20-30% under market in hot pockets. Most 2026 forum participants say it backfires in a soft market.
- **School-zone premium.** It is large in levels but tends to come with *lower* long-run growth, and part of it is confounded with transit and income.
- **AVM accuracy.** Users disagree (within 10% vs off by $200k). Accuracy depends on how typical the property is and its price band.
- **Gaps.** Not verified: a quantified north-facing premium, realestate.com.au and Domain filter sets, BC Assessment, and SkyTrain premium figures.
