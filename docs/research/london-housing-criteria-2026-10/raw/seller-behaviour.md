# Seller pricing behaviour: how sellers and agents set and adjust asking prices

Stream: seller pricing behaviour. Research date: October 2026.
Scope: behavioural evidence on how sellers set and revise asking prices (anchoring, loss aversion, round and charm pricing, overpricing penalties, price cuts), agent incentives, sale method (sealed bids, best and final, auctions), and UK data on asking vs achieved prices and time to sell, with a London focus and comparisons to other markets (US, Denmark, Sweden, Poland, Scotland).

Method note: web search quota was exhausted at the start of this stream, so discovery used the OpenAlex and Semantic Scholar APIs, publisher site search (Property Industry Eye, The Negotiator) and forum category listings (MoneySavingExpert). Reddit was not reachable from this environment. Every source marked "read" in the JSON was fetched and its substantive content checked. Several paywalled papers (Genesove & Mayer full text, Pope, Pope & Sydnor 2015, Meng 2022) are cited from abstract or metadata only and marked read_fully=false.

---

## 1. Summary: what drives a seller's asking price

Primary drivers (strong, repeated evidence):

1. **Local comparable sales and the agent's valuation.** In the UK the asking price is normally set on an agent's market appraisal. Sellers usually get several. One London leasehold seller in Beckton got five appraisals ranging from £265k to £325k, a spread of more than 20% (MSE thread, 2026). The seller anchors on the highest figure. A GetAgent survey reported by Property Industry Eye (Sept 2026) found that 89% of agents think sellers give too much weight to the highest valuation, and 89% have lost instructions to rivals who quoted higher.
2. **The seller's own reference point: the purchase price, or the gain or loss against it.** This is the strongest behavioural finding in the academic literature. It has been replicated in Boston (Genesove & Mayer), England & Wales (Bracke & Tenreyro), Denmark (Andersen et al.) and US single-family homes (Ross & Zhou).
3. **Market conditions: competing stock, buyer demand and mortgage rates.** These determine how much any overpricing costs the seller. In 2025-26, with buyer choice at its highest since 2015, Rightmove measured a gap of more than 3 months in time to sell between well-priced homes and homes that needed cuts.
4. **Seller circumstances: chain, deadline, negative equity or a mortgage-driven reservation price.** Credit frictions (down-payment needs, high LTV) push asking prices up and reduce the chance of selling (Bracke & Tenreyro). In MSE threads the seller's floor price, such as "I can't accept below £280k", often comes from mortgage redemption or the deposit needed for the next purchase.

Secondary or tactical drivers:

5. **Round-number and charm pricing** (£299,950 vs £300,000), and portal search-band thresholds. The effects are real but small, and the studies disagree about which way they point (section 4).
6. **Agent incentives.** Commission structure and "overvaluing to win the instruction" push the initial asking price up. Once the property is listed, agents push for a quick sale (Levitt & Syverson; Hungria-Gunnelin et al.).
7. **Sale method.** Fixed asking price, guide price, "offers over" (Scotland), sealed bids or best-and-final, and auction. Each shapes how the asking price is used as a signal.
8. **Information from nearby listings.** Overpriced, stale listings nearby push other sellers' list prices and sale prices up (Agarwal, Seiler & Siebert). In Poland, average offer prices statistically "explain" transaction prices better than income or labour-market fundamentals (Kokot & Doszyń).

---

## 2. Loss aversion and the purchase-price anchor

**Genesove & Mayer (2001, NBER w8143; QJE).** Boston condominiums in the 1990s bust. Sellers facing a nominal loss set asking prices higher by 25-35% of the gap between their purchase price and the property's expected selling price. They achieved sale prices 3-18% of that gap higher. Their properties were much less likely to sell. The list-price effect for owner-occupiers was about twice that for investors. This is the seminal result explaining why volume collapses before prices fall in a downturn. Source: https://www.nber.org/papers/w8143 (abstract only; the PDF text layer could not be read).

**Bracke & Tenreyro (CEP DP1568 / Bank of England WP; AEJ: Macro 2021). The key UK paper.** The data cover the whole of England & Wales Land Registry, about 20 million sales over 20 years, matched to Zoopla listings (via WhenFresh, from 2008) and to mortgage data.
- Market prices in the year a house was previously bought affect both its next sale price and the owner's propensity to sell.
- Worked example from the paper: two identical houses, one bought in 2007 and one in 2001. The 2007 house sells at about a **5% premium** and is about **50% less likely to sell**.
- An expected loss of 15-25% is associated with a transaction price about 3% higher. A loss of 5-15% is associated with about 1.5% higher. The most common bin, gains of 35-45%, is associated with about a 4% lower price.
- An expected loss of 15-25% lowers the annual selling propensity by about 2 percentage points. Large gains raise it by about 4 pp, against a baseline of 5-10%.
- On Zoopla listings, sellers expecting a loss post higher list prices and those expecting a gain post lower ones. Among homes that actually sold, the discounts given by sellers with large gains are bigger, which helps them sell. The list-to-sale discount effect itself is small, about 1% for large expected gains.
- Mechanisms: both cognitive factors (loss aversion and anchoring) and financial ones (the down-payment effect at high LTV). Together they contributed to the post-2008 collapse in transactions and its slow recovery.
Source: https://cep.lse.ac.uk/pubs/download/dp1568.pdf

**Andersen, Badarinza, Liu, Marx & Ramadorai (AER 2022), Denmark.** Using Danish administrative data, listing prices plotted against the expected nominal gain form a "hockey stick": flat for gains, steep for losses. Realised sale prices bunch sharply at exactly zero nominal gain. The structural estimate is that losses hurt about **2.5 times as much as gains**. The reference-dependence coefficient is about 0.63, meaning realised gains enter utility at about 60% of the weight of the price itself. Reference dependence is weaker among financially constrained households, which the model cannot fully explain. Source: https://spiral.imperial.ac.uk/handle/10044/1/98407

**Ross & Zhou (NBER w28796, 2021).** This paper raises a methodological caveat. Conventional loss-aversion estimates fall by **50-75%** once housing, mortgage and location controls are added, because expected loss correlates with unobserved quality. Sellers who show focal-point bias (they chose a round mortgage amount) show loss aversion about **10 pp higher**, and that differential is stable when controls are added. Loss aversion is real but heterogeneous, and the naive estimates are inflated. Source: https://www.nber.org/papers/w28796

**Related (metadata or abstract only).** Wiltermuth, Gubler & Pierce (Org Science 2022) find that owners who bought just under a round-number threshold later list about 1.8% lower. Meng (JUE 2022) finds that a round previous sale price carries about a 4% premium at resale. These come from Semantic Scholar abstract snippets only and are not verified in full text.

**Implication for a London pricing tool.** The seller's purchase date and price are among the strongest predictors of how high the initial asking price will be set and how long the property will stay listed. Both are publicly available from Land Registry Price Paid. London flats bought in 2014-2017 and now selling at nominal losses (London asking prices fell 2.4% year on year in May 2026; Zoopla reports London prices down about 1%) are exactly the Genesove-Mayer / Bracke-Tenreyro segment. The MSE Beckton thread is a live example: a flat bought for £275k in 2020, valuations from £265k to £325k, and a seller floor of £280k set by the purchase price. A commenter noted the flat had lost roughly 25% in real terms.

---

## 3. Overpricing penalty, price cuts and time on market (UK data)

**Rightmove HPI, May 2026.** Homes that needed a price reduction took about **127 days** to find a buyer, against **36 days** for homes priced well from the start, a gap of 91 days. **32%** of homes on the market had been reduced. Buyer choice was at its highest since 2015. London asking prices were down 2.4% year on year. Rightmove's explicit message was that overambitious initial pricing is lengthening selling times. https://www.rightmove.co.uk/press-centre/house-price-index/may-2026/

**Rightmove HPI, January 2026.** About a third of homes already on the market had their asking price cut. Rightmove advised sellers to follow their agent and avoid over-optimism, and said that well-presented, sensibly priced homes get the most attention. https://www.rightmove.co.uk/press-centre/house-price-index/january-2026/

**Zoopla HPI, September 2026 (published 1 Oct 2026).** Only **30% of London homes** listed in Q2 found a buyer within three months. The figure was about 75% in Scotland and about 50% in northern England. London was the weakest region, with prices about -1%. The most difficult pricing decisions are for flats and larger houses in southern England. Zoopla advises sellers to price against local competing stock and buyer affordability, not headline indices. https://www.zoopla.co.uk/discover/property-news/house-price-index/ (PDF read)

**The Property Franchise Group / Property Industry Eye (July 2026).** Only about **50.9%** of homes that leave agents' books actually exchange and complete. 14.3% of listings were reduced in June. The fall-through rate was 24.2%, against a decade average of 24.5%. There were 760k homes on the market at 1 July 2026. The piece blames agents who take instructions at the seller's aspirational price, which removes urgency. https://propertyindustryeye.com/estate-agents-only-getting-paid-on-50-of-listings/

**HomeOwners Alliance survey via PIE (Oct 2025).** 49% of buyers paid the asking price or more: 39% exactly at asking and 10% above. 39% negotiated a discount. Of those, 20% got up to 5% off, 14% got 5-10% and 6% got more than 10%. Sealed bids accounted for only about 2% of above-asking purchases. First-time buyers negotiated less: 35% paid below asking, against 42% of previous owners. https://propertyindustryeye.com/half-of-homebuyers-paid-the-full-asking-price-or-higher-for-their-property/

**RICS UK Residential Market Survey, August 2026.** The new buyer enquiries balance was -19% and agreed sales -17%, recovering from a low of -38% in April. The price balance was -28%. London continues to show a steeper decline than the UK average and negative 12-month price expectations. Agents give fewer market appraisals (-17%), which means fewer new instructions are coming. https://www.rics.org/news-insights/market-surveys/uk-residential-market-survey

**Industry commentary (PIE, Aug 2026).** The Guild of Property Professionals, Jackson-Stops and Fine & Country all argue that buyers now have more choice, more time and more negotiating power, so sellers must price realistically "from day one". https://propertyindustryeye.com/modest-growth-highlights-importance-of-realistic-pricing-say-experts/

**International evidence on the overpricing trade-off:**
- **Sweden, Gothenburg** (Hungria-Gunnelin, Kopsch & Enegren 2021, IJHMA; 11,658 condo sales from 2012-2016). Brokers in Sweden's auction-style market often list low ("bait pricing") to draw bidders. Underpricing did sell homes faster, but it lowered the sale price: 10% more underpricing meant about 8.5% lower prices. Higher relative list prices were associated with higher sale prices and longer time on market. The authors read underpricing as serving brokers' interest in quick deals. https://www.emerald.com/insight/content/doi/10.1108/IJHMA-04-2020-0034/full/html
- **US, Orange County** (Agarwal, Seiler & Siebert 2022, CESifo WP 10069; listings from 2000 to 2020). About 30% of US listings never sell. "Essayer" sellers who test the market list about 8.1% (~$59.6k) above fair value. These stale overpriced listings spill over to neighbours, raising their list prices by about 5.5% and their sale prices by about 5.2%. Overpricing is greater in booms. https://www.econstor.eu/bitstream/10419/267302/1/cesifo1_wp10069.pdf
- **Poland, 17 cities 2010-2022** (Kokot & Doszyń 2026, Wiadomości Statystyczne). In cross-city regressions, average offer prices were essentially the only significant explanatory variable for transaction prices. Wages, unemployment and similar fundamentals dropped out. The authors interpret this as transaction prices anchored on asking prices. This matters because Poland is one of the main origin countries of London migrants. http://ws.stat.gov.pl/WS/2026/6/gus_ws_2026_06_sebastian_kokot_mariusz_doszyn_the_effect_of_anchoring_transaction_prices_to_offer.pdf

**Points of disagreement:**
- Rightmove, Zoopla and the agents present overpricing as costly in time and, implicitly, in price. Genesove-Mayer, Bracke-Tenreyro and Hungria-Gunnelin show that higher asking prices can raise the sale price somewhat (3-18% of the loss gap in Boston, about 3% for 15-25% losses in England & Wales) but sharply lower the probability of selling. The academic consensus is a **price vs liquidity trade-off**, not a pure penalty. The portal statistics compare reduced and non-reduced homes, which mixes in selection on quality.
- The TPO case-study column (The Negotiator, 2012) shows how both sides can complain. Sellers accuse agents of inflating the price to win the instruction and then pushing a cut. Agents who quote realistically lose the instruction to rivals who quote higher.

---

## 4. Round numbers, charm pricing and portal bands

- **Beracha & Seiler (2015, Journal of Housing Research), US MLS data.** Just-below prices ($199,900) let sellers set a higher list price without losing buyers. Round-priced homes sell faster and at a smaller discount from list. Net of everything, just-below pricing gives the **highest transaction price relative to underlying value**. Selling probabilities did not differ: 61.3% vs 60.9%. Source PDF read: http://s3.amazonaws.com/fieldexperiments-papers2/papers/00630.pdf
- **Cardella & Seiler (2016, Journal of Economic Psychology), lab negotiation experiment.** This contradicts the field result. A **high precise** list price (e.g. $372,500) gave the highest final price, the smallest percentage discount and the largest share of the surplus to the seller. Just-below pricing gave the *lowest* final price. The mechanism is that sellers who start with a precise price make persistently higher and more precise counter-offers. The effects weaken as participants gain negotiating experience. http://s3.amazonaws.com/fieldexperiments-papers2/papers/00623.pdf
- **Pope, Pope & Sydnor (2015, Games & Economic Behavior)** find that buyers and sellers bunch final prices at round numbers. Buyers bargain toward round focal points, which costs sellers. This is cited from metadata only.
- **Englmaier et al. (2023, SSRN, Germany)** find that professional sellers cluster on round prices much less than private sellers. **Kuo & Hsieh (2026, BE Journal of Economic Analysis & Policy)** find that prices also cluster on culturally lucky digits, especially 8, with about a 2.4% hedonic premium in an East Asian market. This is relevant to the Chinese and Hong Kong buyers who are a large segment of London new-build demand. Both are cited from abstracts only.
- **UK-specific mechanism.** Rightmove and Zoopla search filters use price bands (e.g. £300k, £500k, £1m). UK agents commonly price at or just under a band edge, or use "offers in excess of" and guide ranges (the MSE thread "negotiating best purchase price": asking £325k, then a £300-325k guide). Stamp duty thresholds (£250k, £925k, £1.5m) add a tax incentive for prices to bunch below them. The academic literature above is mostly US-based. A UK band-threshold study was not found in this stream.

---

## 5. Agent incentives and valuation inflation

- **Levitt & Syverson (NBER w11053; REStat 2008), Chicago suburbs.** Agents sell their own homes for **3.7% more (~$7,700)** and leave them on the market about **10 days (10%) longer** than client homes. The gap widens where the agent has a bigger information advantage. With a commission of a few percent, the agent gains little from holding out, so clients are nudged to sell too fast and too cheap. Conclusion read in full: https://www.nber.org/papers/w11053
- **The UK version of the problem is front-loaded.** Agents compete for instructions on valuation. GetAgent's 2026 survey (PIE, 9 Sept 2026) found that 95% of agents have seen rivals give unrealistic valuations, 89% have lost instructions to higher quotes, 67% say overvaluing is getting worse, and 95% say it harms sellers. Agents named the causes as sellers favouring the highest number (33%), competition (28%), market-share pressure (22%) and internal listing targets (11%). Agents recommend that sellers choose agents on **% of asking price achieved** (33%), **local track record** (28%) and **average time to sale** (22%). https://propertyindustryeye.com/estate-agents-at-odds-over-overvaluing-to-win-instructions/
- So the UK pattern is "**overvalue to list, then cut to sell**". The US pattern (Levitt-Syverson) is "underprice and sell fast". Swedish brokers underprice to drive bidding (Hungria-Gunnelin). The direction of agent bias depends on how instructions are won and on contract terms such as sole-agency length and tie-in periods. MSE commenters warn about minimum contract terms and "ready, willing and able" fee clauses.
- **Scotland as a natural experiment.** The Home Report, a mandatory seller-commissioned survey and valuation introduced in 2008, reduced the old practice of setting artificially low "offers over" asking prices. After its introduction, asking prices tracked nearby comparables more closely (Lo, Liu & McCord 2021/22, IJHMA; Aberdeen, 79k transactions). Cited from the landing-page abstract only.

---

## 6. Sale method: sealed bids, best and final, auctions

- **Prime London (Savills, Q2 2019, via PIE).** 16% of Savills' prime London deals involved competitive bidding, and 56% of those went to sealed bids. The cause was low stock combined with buyers' commitment to the very best properties in a weak market. Competition is driven by the property, not the market as a whole. https://propertyindustryeye.com/sealed-bids-make-a-surprise-return-amid-fragile-marketplace/
- **The 2021 stamp-duty-holiday boom (PIE, May 2021).** In hot markets (Cornwall, South Hams), "best and final" became standard for desirable homes, with prices 15% to over 30% above guide. Reader comments at the time noted that houses were selling quickly while flats sat unsold, and that best-and-final is not binding, so agents may keep taking offers. https://propertyindustryeye.com/bidding-wars-and-sealed-bids/
- **Auctioneer view (The Negotiator, July 2021, SDL Auctions).** Open bidding beats sealed bids because visible competition draws more bidders and buyers cannot unknowingly overpay. Auction sales have under 1% fall-through and complete in about 40 working days, which compares with about a 24% fall-through rate in private-treaty sales. https://thenegotiator.co.uk/features/dont-seal-your-bids-open-them/
- **In 2025-26 sealed bids are rare.** HomeOwners Alliance found only about 2% of above-asking purchases involved sealed bids. With London taking the longest to sell, best-and-final is now a feature of individual sought-after properties rather than of the market.
- **Seller strategy in a slow market (MSE thread "overpriced house offer rejected", 2025-26).** A home was listed at £850k, cut to £800k, withdrawn and relisted at £775k. The seller then signalled £750k against a buyer offer of £700k, which was based on a comparable sale. Repliers advised one final offer and then walking away, or using non-price leverage such as being chain-free, cash or quick to complete. One said that staying in touch led the seller to come back weeks later. This shows the sequence of stepwise cuts and relisting (to reset "days on market" on portals) that portal data record as reductions.

---

## 7. What buyers and sellers use to judge price (forum evidence)

- MSE users judge whether prices are falling at the level of individual homes, not averages. They watch comparables on Rightmove and use browser extensions such as "Property Log" that show a listing's original asking price and every reduction. Several posters described homes relisted below their previous purchase price despite renovation. https://forums.moneysavingexpert.com/discussion/6670278/how-can-i-tell-if-individual-house-prices-are-falling
- Buyers set offers using the property's previous sale price (Land Registry), how long it has been listed (a home listed for a year justifies a lower offer) and its reduction history. They also take into account schools, condition, local saturation and the seller's attachment. https://forums.moneysavingexpert.com/discussion/6673255/negotiating-best-purchase-price
- London-specific signals from the Beckton leasehold thread are lease length (102 years), service charge and the flat's mortgageability. Commenters cite a very high share of flats still unsold after six months, worse in London, so a short sale deadline is unrealistic. https://forums.moneysavingexpert.com/discussion/6683387/estate-agent-advice-selling-leasehold-flat-in-london

---

## 8. London vs elsewhere: synthesis

| Dimension | London (2025-26) | Rest of UK | Other markets |
|---|---|---|---|
| Liquidity | Lowest: about 30% of Q2 listings found a buyer within 3 months (Zoopla) | About 50% in northern England, about 75% in Scotland | US: about 30% of listings never sell (Orange County) |
| Price trend | Asking -2.4% YoY (Rightmove, May 2026), HPI about -1% | Modest growth in North and Scotland | n/a |
| Loss-aversion exposure | High: many flats bought 2014-17 now at nominal loss; leasehold and service-charge drag | Lower: more owners with gains | Denmark: loss aversion 2.5x; Boston condos 1990s |
| Asking-price mechanism | Fixed asking or guide; "offers in excess of" in prime; sealed bids only for scarce prime homes | Same; Scotland uses "offers over" plus Home Report valuation | Sweden: low list price plus open bidding; Australia: auctions; US: MLS list price, more just-below pricing |
| Agent bias | Overvalue to win instruction, then cut | Same | US: sell-fast bias (Levitt-Syverson); Sweden: underprice to attract bidders |

Criteria a seller-valuation tool should model, in order of evidence strength:
1. Recent comparable sales (Land Registry) adjusted for type, size, tenure and lease length. Agents themselves say comparables come first.
2. Current competing stock and its asking prices, including the reduction history of nearby listings. Stale overpriced listings distort local anchors.
3. The seller's purchase price and date, which give the expected gain or loss. This predicts list-price markup and time on market.
4. The market's selling rate (sales-to-listings ratio and days to sell for that segment), which sets the price-vs-time trade-off.
5. Secondary: price-band and stamp-duty thresholds, round or charm pricing, sale method, and agent choice and contract terms.

---

## Gaps and caveats

- Pope, Pope & Sydnor (2015), Meng (2022), Wiltermuth et al. (2022), Englmaier et al. (2023), Kuo & Hsieh (2026) and Lo et al. (2022) were seen only as abstracts or metadata. Their numbers are flagged and should be verified before reuse.
- Reddit r/HousingUK could not be fetched. Forum evidence comes from MoneySavingExpert only.
- No UK-specific peer-reviewed study of Rightmove price-band bunching or the effect of the sealed-bid premium was found in this stream.
- The Rightmove 127- vs 36-day comparison is descriptive. Homes that need reductions may differ in quality, not only in initial price.
