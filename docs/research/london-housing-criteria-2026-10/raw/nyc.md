# New York City: how people search, how homes are priced (research stream, October 2026)

Scope: NYC search and valuation for comparison with London. Covers StreetEasy search behaviour and data, co-op vs condo, board approval and building financials, price per square foot, maintenance/common charges, doorman/elevator/walk-up, subway proximity, school zones, broker fees and the FARE Act (2025), rent stabilisation, CMA/appraisal practice, and the 40x income / guarantor rule.

Method note: Reddit was not reachable through the normal fetch tools. Threads were read through the Arctic Shift Reddit archive API, which returns the opening post plus comments. Comment scores in the archive are snapshot values. StreetEasy blog pages were read with curl because WebFetch returned 403. The web-search budget ran out partway through, so a few planned topics (a subway-proximity hedonic paper, guarantor-company terms, a full StreetEasy filter list) are covered only by forum and indirect evidence. These gaps are flagged below.

---

## 1. What NYC home-seekers filter on first (primary criteria)

### 1.1 Budget is set by an income rule, not by preference (renters)
- **The 40x rule is the gate.** Most NYC landlords want annual gross income of at least 40 times the monthly rent. Guarantors usually need about 80x (forum consensus; I could not confirm a guarantor-company source). Posters point out that 40x works out to rent of about 30% of gross income (12/40 = 0.3), so it is roughly the US national "3x monthly income" rule written differently. Several say that after NYC city and state income tax, 40x leaves about one paycheck for rent. (r/NYCapartments "How are we feeling about the 40x rule in 2026?", 2026: https://www.reddit.com/r/NYCapartments/comments/1t3aiw2/)
- **Why it is strict.** The most-upvoted explanations say NYC's tenant protections make eviction slow and costly, often quoted as "2 years+". Landlords therefore screen hard at the door. Another poster disputes that the rule is NYC-specific. (same thread; also https://www.reddit.com/r/NYCapartments/comments/1m8d8fs/)
- **Pooled income and roommates.** Advice conflicts. Some say roommates can combine incomes to reach 40x. Others say the rule applies to the whole apartment and that landlords ask each unrelated tenant to qualify alone or bring a guarantor. In one 2025 thread a brownstone landlord asked every one of four unrelated adult tenants for a guarantor. Commenters called this legal and common for unrelated groups. (https://www.reddit.com/r/NYCapartments/comments/1m8d8fs/)
- **Credit score and income type are secondary filters.** A self-described landlord-side commenter says scores under 700 get extra scrutiny, and that many applicants now show 700-800. Bonus and commission income usually counts if tax returns or W-2s show it. When applicants compete, landlords prefer people who clear 40x on base salary alone. Bidding above asking rent happens on cheap units. (r/NYCapartments "How strictly is the 40x rule applied?", 2026: https://www.reddit.com/r/NYCapartments/comments/1se736q/)
- **Affordability gap.** A 2025 thread works through the arithmetic: median household income is about $80k, so 40x qualifies for about $2k/month, while the median studio asks about $3.2k. Replies explain that most lower-income New Yorkers live in rent-stabilised, subsidised or family housing, not on the open market. One commenter says about 45% of units are rent-stabilised. (https://www.reddit.com/r/NYCapartments/comments/1o8l1a5/)

### 1.2 Location: subway walk time and neighbourhood
- **Minutes to the subway is a hard criterion.** A housing-lottery winner asked whether to accept a below-market one-bedroom 15 minutes' walk from the train. The top replies all treated the walk as the deciding negative: "single biggest factor", "all she complains about", worse in winter. Citi Bike was suggested as a workaround. (r/AskNYC, 2026: https://www.reddit.com/r/AskNYC/comments/1vpopk6/)
- **Neighbourhood vs unit trade-off.** In r/AskNYC "Nice neighborhood or nice apartment?" most respondents chose the better neighbourhood because it gets them outside. Two qualifications came up. Light, quiet and sunlight were named as unit-level deal-breakers. "Bad neighbourhood" was split into "desolate, no groceries" (worse) and "busy but rougher" (more acceptable). One commenter said the nice-neighbourhood rule matters more in Manhattan, because non-stabilised Manhattan units below a certain price "all suck", while Brooklyn has decent units a few blocks from prime areas. (https://www.reddit.com/r/AskNYC/comments/18s4nf7/)

### 1.3 Unit and building amenities (StreetEasy's must-have data)
- From StreetEasy's analysis of anonymised searches (Nov 2021-Feb 2022), using its "Flexible Search" must-have vs nice-to-have feature:
  - **In-unit laundry** ranks first for both renters and buyers.
  - **Renters:** dishwasher (2), elevator (3), doorman (4).
  - **Buyers:** elevator (2), doorman (3), dishwasher (4).
  - Laundry in the building ranks 5th, private outdoor space 6th, parking 9th and shared outdoor space 10th.
  - 90% of polled followers said they had compromised on at least one amenity.
  - Users who marked must-haves were 20% more likely to save, and 34% more likely to contact an agent, on listings that met the must-haves but not every nice-to-have.
  - "Pets allowed" cannot be marked nice-to-have; StreetEasy treats it as a binary filter.
  (https://streeteasy.com/blog/apartment-amenities-new-yorkers-want-most/, 2022)
- **The doorman premium is large in rental data.** In January 2026 the Manhattan median rent was $5,433 in doorman buildings vs $3,850 in non-doorman buildings, a gap of about 41%. Building quality and size also feed into that gap. (Elliman Report rentals, Miller Samuel, Jan 2026: https://millersamuel.com/wp-content/uploads/2026/02/Rental-01_2026.pdf)
- **Walk-up vs elevator** is a top-3 must-have because so much of the stock is pre-war walk-ups. Forum threads list a 4th-floor walk-up with no dishwasher as a common reason to discount even very cheap HDFC co-ops (thread titles seen in the archive listing; not read in full).

### 1.4 Market tightness changes how people search
- StreetEasy's May 2026 report:
  - Citywide median asking rent was **$4,199** (+7.3% y/y), the highest since its records began in 2010. Manhattan was $4,927, Brooklyn $3,895, Queens $3,350.
  - Inventory was 33,064, down 10.7% y/y. Manhattan inventory fell for the 27th month in a row.
  - The average listing got **63.6% more inquiries** than in May 2019.
  - Brooklyn sales closed at a median 98.5% of last asking price.
  (https://streeteasy.com/blog/nyc-rental-market-update-one-year-after-fare-act/, June 2026)
- Elliman/Miller Samuel, January 2026:
  - Manhattan vacancy was 2.44%.
  - 16.4% of new leases went to bidding wars, at an average 9.9% over asking.
  - Average rent per square foot was $96.35/year.
  - 12.7% of leases had concessions or owner-paid fees.
  Rent per square foot appears in professional reporting but is rarely a consumer filter. Consumers filter on bedrooms and price. (https://millersamuel.com/wp-content/uploads/2026/02/Rental-01_2026.pdf)

---

## 2. Broker fees and the FARE Act (2025): structural changes to NYC search

- **What the law does.** The FARE Act took effect on 11 June 2025. A broker who represents the landlord, including one who lists with the landlord's permission, may not charge the tenant. Listings and leases must disclose every fee the tenant must pay. Tenants who hire their own agent still pay that agent. NYC DCWP enforces the law. Separately, the 2019 state rent laws cap the background-check or application fee at $20 and ban "key money". (NYC Rent Guidelines Board pages: https://rentguidelinesboard.cityofnewyork.us/resources/apartment-hunting/broker-info/ and https://rentguidelinesboard.cityofnewyork.us/resources/apartment-hunting/the-basics/)
- **Before the law.** About 44% of NYC rentals still carried a tenant-paid broker fee. Fees were typically 12% of annual rent and up to 15%. Upfront move-in costs averaged about $12.9k-$13.1k. (Brick Underground, Dec 2024: https://www.brickunderground.com/rent/fare-act-broker-fee-law-impact-rents-new-leases-nyc; StreetEasy six-month report)
- **Effect on rents.** StreetEasy estimates:
  - After controlling for building, bedrooms, amenities, seasonality and trend, the FARE Act is linked to a **1.1% rise** in asking rent for broker-represented units. That is about $38/month in Nov 2025 and $46/month in May 2026.
  - Renters avoid an average upfront fee of **$5,454-$5,862**.
  - Raw annualised re-listing rent growth was 6.4% for units that used to charge a fee vs 4.8% for units that never did.
  - If landlords had passed on the whole fee, rents would be about 11% higher.
  - The May 2026 estimate is based on 290,000+ broker relistings, Jan 2021-May 2026.
  (https://streeteasy.com/blog/fare-act-six-months-market-impacts/, Dec 2025; https://streeteasy.com/blog/nyc-rental-market-update-one-year-after-fare-act/, June 2026)
- **Where sources disagree.** Before the law, REBNY and broker groups predicted rents would rise 7-10% or more as fees were folded in. StreetEasy and tenant-side sources predicted, and later measured, small effects (Brick Underground 2024). Some forum posters still insist the cost is "passed on" (https://www.reddit.com/r/NYCapartments/comments/1o8l1a5/). Media citing an NYT analysis of 1.3M listings reported some landlords raising rent (search snippet only, not read).
- **Enforcement and workarounds.**
  - StreetEasy's Sept 2025 survey: 38% of renters reported a rights violation. Of those, 21% were charged a fee for an agent they did not hire, 19% met undisclosed fees, 16% saw a first month's rent higher than later months (a possible disguised fee), and 16% were asked to hire the broker before they could tour.
  - DCWP has received more than 1,400 complaints and issued about 50 summonses. By March 2026 only two brokers had been ordered to refund tenants.
  - 311 broker-fee complaints by borough: Brooklyn 67, Queens 46, Manhattan 41, out of 186.
  (StreetEasy six-month report; Hoodline citing The Real Deal, Mar 2026: https://hoodline.com/2026/03/nyc-renters-fume-as-fare-act-refunds-barely-trickled-in/)
- **For search UX.** The "no-fee" label used to be one of NYC's main rental filters. After FARE it means much less, and a StreetEasy page says the no-fee filter has been retired (search snippet, not verified). Fee transparency (disclosed fees, net-effective vs gross rent with concessions) now matters more as a criterion. London has had a similar change since the Tenant Fees Act 2019.

---

## 3. Rent stabilisation: a hidden search dimension

- About 1 million NYC units are rent-stabilised. The Rent Guidelines Board sets annual increases. **For leases starting 1 Oct 2026-30 Sep 2027 it set 0% for both 1-year and 2-year leases**, a rent freeze. Stabilised tenants have a right to renew and succession rights. Landlords must attach a lease rider showing the prior legal rent. Tenants can check rent history with HCR. (RGB Order #58, June 2026: https://rentguidelinesboard.cityofnewyork.us/2026-27-apartment-loft-order-58/; RGB basics page)
- Stabilised status is a big factor in whether a renter stays or moves. Forum threads weigh giving up a stabilised unit against better location or space (archive titles, e.g. "Give up rent-stabilized 1BR..."). Lottery units are traded off against subway distance and neighbourhood (https://www.reddit.com/r/AskNYC/comments/1vpopk6/). Commenters warn that a "won" lottery unit can lock you into a place you dislike.
- Effect on the market: much of the stock rarely comes up for rent, so the open market is thinner and pricier than the stock-wide median suggests. This helps explain both the 40x rule and the low vacancy. There is no close London equivalent.

---

## 4. Buying: co-op vs condo is the first fork

### 4.1 Tenure type sets price, financing and who can buy
- **Share of stock.** Co-ops are about 70-75% of NYC apartment stock and dominate pre-war areas such as the UES, UWS and West Village. Condos dominate new-build areas such as FiDi and Battery Park City. (Hauseit: https://hauseit.com/co-op-vs-condo-nyc)
- **The co-op discount.**
  - Practitioner sources put condos 10-40% above comparable co-ops.
  - Schill, Voicu & Miller (Furman Center working paper, 2006, NYC sales 1984-2002) estimate a typical condo premium of **8.8%**. It is 13.4% against co-ops with no financing limit and no flip tax, and 10.6% against co-ops that allow 60-79% financing.
  - Against co-ops that allow **no financing**, which are exclusive, mostly very high-end buildings, condos sell at a **25.4% discount**. Exclusivity is priced in at the top of the market.
  - The authors put co-op persistence down to transaction costs, collective-action barriers to converting, and a taste for exclusivity.
  (https://millersamuel.wpengine.com/files/2006/07/coop-condo-article-july-23_2006.pdf)
- **Other hedonic results from the same paper.**
  - Pre-war co-ops are worth 12.4% more than post-war co-ops; for condos the pre-war premium is 30.7%.
  - Each extra floor adds 1.0% for co-ops and 0.6% for condos.
  - A fireplace adds 9.7%.
  - Central AC adds about 2% over window units.
  These are the attributes NYC appraisers adjust for.
- **The 2026 shift.**
  - Manhattan median co-op price rose 8.5% y/y to $895k in Q2 2026, while condos rose 2.9% (TRD Data).
  - Brokers say buyers are "realizing co-ops are good value" because they are larger, cheaper monthly and well located, and that resale condos now ask for board packages similar to co-ops.
  - The new NY pied-à-terre tax reportedly put off condo second-home buyers.
  (The Real Deal, July 2026: https://therealdeal.com/data/new-york/2026/manhattan-co-op-prices-rise-in-second-quarter/)
  - Manhattan co-op+condo median was $1.25M in Q2 2026 (+4.2%). Listings were down 15% and transactions down 6.3%. Average days on market was 95 (+21.8%, Coldwell Banker Warburg). Brown Harris Stevens put average co-op resale at $1.55M (+9%) and resale condos 5% lower. (Brick Underground, July 2026: https://www.brickunderground.com/sell/manhattan-co-op-condo-sales-market-report-nyc-second-quarter-2026)

### 4.2 Board approval: buyer financials are a criterion the seller cannot control
- **Typical co-op rules:**
  - 20% minimum down payment, up to 50%. Condos typically need 10%.
  - Debt-to-income usually below 25-30%, sometimes up to 35% outside Manhattan. Banks allow up to 43%.
  - Post-closing liquidity of 1-2 years of mortgage plus maintenance. Strict buildings want 1-1.5x the purchase price.
  - Sublet limits: usually none in the first 1-3 years, then something like 2 years in every 5.
  - A flip tax on sellers.
  - Boards can reject buyers without giving a reason. Condo boards can only exercise a right of first refusal.
  (Hauseit co-op vs condo; Hauseit affordability: https://www.hauseit.com/can-i-afford-to-buy-an-apartment-nyc/)
- **Worked example (Hauseit).** On $150k income with $1k/month maintenance, a 30-year loan at 5% and 20% down, the maximum price is $999k at 43% DTI (condo, lender-led) but only $475k at a 25% DTI co-op limit. The board's rules can halve what a buyer can spend.
- **Board risk for sellers.** A Queens owner wrote that their "junior 4" had been listed since Aug 2022 and that the board had turned down 3 qualified buyers without saying why. A co-op litigator replied that the business judgment rule gives boards wide discretion, but they still cannot discriminate against protected classes. Others suggested a board member might want the unit cheap or for a combination. (r/AskNYC, 2025: https://www.reddit.com/r/AskNYC/comments/1lumb2v/) So "board reputation" is a hidden valuation factor that listings do not show.

### 4.3 Building financials as a buyer criterion
- In a 2026 thread a buyer posted a 150-unit co-op's figures:
  - $2.35M revenue against $2.13M operating expenses.
  - Operating assessments in 2024 and 2025.
  - Reserves fell from $2.33M to $1.82M.
  - A **$13.5M interest-only underlying mortgage at 3.2% due in 2032**.
  - A façade project that ran over budget.
  - No reserve study.
  - A Chapter 11 in 2009.
  Replies flagged refinancing risk at maturity, possibly doubling debt service; Local Law 97 carbon-compliance capex; maintenance that looked "too low", which can mean the building is under-collecting and relying on assessments; and pending litigation. They advised using the problems to negotiate on price rather than walk away automatically. (https://www.reddit.com/r/NYCapartments/comments/1vqg0di/)
- **What drives maintenance** (Habitat Magazine, 2019, drawing on Brick Underground):
  1. Underlying mortgage
  2. Property taxes and abatements
  3. Building size (fewer units means higher per-unit costs)
  4. Basic amenities
  5. Luxury amenities
  6. Union vs non-union staff
  7. Mismanagement or arrears
  8. Commercial space income or vacancy
  9. Land lease (a red flag)
  10. Share allocation by view, floor and so on
  Average co-op maintenance was $1.73/sq ft/month in Q4 2018. (https://habitatmag.com/Publication-Content/Board-Operations/2019/2019-January/Maintenance-Math)

### 4.4 Monthly carrying cost is priced like part of the price
- **2026 levels (Miller Samuel):**
  - Q1 2026: co-op maintenance averaged $3,007/month ($2.76/sq ft); condo common charges plus taxes averaged $4,559 ($3.44/sq ft).
  - Q2 2026: co-op $3,077 ($2.83/sq ft, +16% y/y); condo $4,466 ($3.37/sq ft).
  - Monthlies "continue to outpace inflation", driven by insurance and utilities.
  (HousingNotes/Miller Samuel Q1 2026: https://millersamuel.com/wp-content/uploads/2026/04/The-1Q26-Manhattan-Story-Told-Before_After-War.pdf; Brick Underground Q2 2026)
- **Appraisers disagree on how to adjust for it.** In an AppraisersForum New York thread, certified appraisers split:
  - One said he never adjusts for maintenance.
  - Another adjusts only between buildings, at **$25-$50 per $1 of monthly difference**, and argues that "buyers look at total monthly cost and brokers price accordingly".
  - A third refuses because the tax-deductible share and assessments make clean comparison impossible, so differences are "already reflected in prices".
  - A fourth uses a formula: maintenance per square foot scaled to the comparable's size, times a $20-$50 factor.
  Everyone agreed that sales within the same building are the best comparables. (https://appraisersforum.com/forums/threads/co-op-maintenance-adjustments.140375/, 2008, still a practitioner reference)

---

## 5. How NYC values homes: CMA and appraisal practice

- **Comparables come from the same building first.** NYC apartments are priced against recent sales in the same building, then similar buildings (same tenure, era, doorman/elevator status, neighbourhood). Within a building, shares or common-charge allocation already capture floor and view (AppraisersForum thread).
- **Price per square foot is the main yardstick, with caveats.** Market reports quote $/sq ft for sales and rentals (rentals around $96/sq ft/year in Manhattan, Jan 2026). Co-op listings often give no square footage, which is why maintenance per sq ft and room counts ("junior 4", "classic 6") are used instead (Miller Samuel; Reddit threads). Average Manhattan sale size in Q1 2026 was below the decade average of 1,526 sq ft (Miller Samuel).
- **Hedonic adjustments used in valuation:**
  - Floor: +0.6-1.0% per floor.
  - Pre-war vs post-war.
  - Doorman.
  - Fireplace, outdoor space, central AC.
  - Condition.
  - Financing rules (co-op).
  - Flip tax.
  - Monthly charges.
  (Schill/Voicu/Miller 2006; AppraisersForum)
- **Market-level signals sellers use:**
  - Listing discount (asking vs sale).
  - Days on market, now less reliable because more listings start off-market.
  - Months of supply: 7.0 in Q1 2026 vs a decade average of 8.2.
  - Share of bidding wars.
  (Brick Underground Q2 2026; Miller Samuel Q1 2026)
- **Building financial health enters the price.** Underlying mortgage, reserves and assessments are checked by buyers' attorneys and by lenders' appraisers (see 4.3).

---

## 6. School zones (buyers with children)

- NYC elementary schools are mostly zoned, but "choice" schools (magnet, charter, unzoned) weaken the link between home and school.
- Schwartz & Voicu (Lincoln Institute working paper, 2007), using NYC sales from 1988 onward matched to zoned schools:
  - Zoned-school quality is capitalised into prices. Each 1 percentage point increase in teacher-pupil ratio adds 0.3-0.5% to values. Reading scores have small positive effects.
  - Having a choice school nearby is linked to a 21.8% higher value.
  - Closing a zoned school cuts values by 2.6%.
  (https://www.lincolninst.edu/app/uploads/2024/04/1303_schwartz_final_0.pdf)
- A follow-up by Schwartz, Voicu & Horn (RSUE 2014) uses a boundary-discontinuity design. It finds that the price jump at school-zone boundaries shrinks after a choice school opens (abstract via search; full text not accessible).
- So school zones are a secondary criterion for families, especially in the Brooklyn brownstone belt and Manhattan districts such as D2 and D3. The effect is weaker than London's catchment premium because of choice and gifted admissions. The forum evidence here is thin.

---

## 7. Primary vs secondary criteria (NYC synthesis)

**Primary (filters applied first):**
1. Monthly price, bounded by the 40x rule for renters, or by down payment plus co-op DTI and liquidity limits for buyers.
2. Bedrooms.
3. Neighbourhood and borough.
4. Subway access (line and walk minutes).
5. For buyers: co-op vs condo.

**Strong secondary (must-have tier):**
- In-unit laundry, dishwasher.
- Elevator vs walk-up, doorman.
- Pets allowed (binary).
- Light and quiet (unit inspection).
- Monthly maintenance or common charges.
- For rentals: rent-stabilised status, net-effective rent and concessions, and since 2025 fee disclosure.

**Tertiary or niche:**
- Outdoor space (private or shared).
- Parking.
- Gym and other amenities.
- Pre-war character.
- Floor and view.
- School zone (families).
- Land lease, flip tax and sublet policy (buyers, investors).
- Building financials and board reputation (buyers, due-diligence stage).

---

## 8. NYC-specific vs London (comparison notes for the synthesis)

- **Tenure is a first-order filter in both cities**, but the type of tenure differs. NYC's co-op/condo split acts as a gate, through board approval, DTI, liquidity, sublet rules and the 10-40% price gap. London's version is leasehold vs freehold: lease length, ground rent and service charge. NYC co-op maintenance is roughly London's service charge plus part of the council tax, plus the building's mortgage.
- **Renter screening.** NYC's 40x income rule plus about 80x for guarantors is stricter in form than London referencing at around 30x monthly rent (London stream to confirm). NYC tenant protections, the rent freeze and slow evictions push landlords toward strict screening and bidding wars.
- **Broker fees.** FARE (2025) parallels the UK Tenant Fees Act 2019 and removes a 12-15% upfront fee. Measured pass-through to rent is small (about 1.1%).
- **Transit.** The subway walk is quoted in minutes, as with London tube and Overground stations. Fare zones do not apply in NYC (flat fare), so line and walk time matter, not zone.
- **Data culture.** NYC portals publish $/sq ft, months of supply, bidding-war share and concession share (StreetEasy, Miller Samuel). Square footage is often missing on co-op listings, so room-count conventions are used, much like London listings often lacking floor area.

## Gaps and caveats
- No peer-reviewed paper on the subway-distance premium was read; the evidence for it is forum-based.
- Guarantor-company terms (TheGuarantors, Insurent) and the "80x" guarantor norm were not checked against a primary source.
- The claim that StreetEasy dropped its no-fee filter after FARE comes from a search snippet only.
- The AppraisersForum thread dates from 2008. The co-op/condo hedonic data covers 1984-2002.
