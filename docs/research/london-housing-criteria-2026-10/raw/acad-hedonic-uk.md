# Academic evidence: hedonic house-price determinants in London and the UK

Stream: academic hedonic studies (LSE CEP/SERC and related). Compiled October 2026.
Method note: web search quota was exhausted at the start of this stream, so sources were found through the OpenAlex API and known repository URLs. Each was then downloaded and read: abstract, results and conclusions. All numbers below come from the documents, paraphrased. Effects are % of price unless stated. "Causal" means a quasi-experimental design (difference-in-differences, boundary discontinuity or repeat sales). "Cross-section" means a plain hedonic regression, which usually overstates effects.

---

## 0. Headline ranking (what the evidence says buyers actually pay for)

| Rank | Attribute | Typical causal size (UK) | Confidence | London-specific note |
|---|---|---|---|---|
| Primary | Lease length / tenure (leasehold vs freehold) | 80-99 yrs left: about -16%; 100-125 yrs: -10%; 125-150: -8%; 150-300: -3% | High | Most London flats are leasehold. Valuers' rules of thumb differ from what market prices imply |
| Primary | Rail / Tube access (walking distance to station, within 2 km) | +1.5% to +5.8% per km closer, causal; cross-section about 8.9%/km | High | No measurable effect beyond about 2 km. National Rail is valued about 3%/km and rises with service frequency |
| Primary | Condition / finish | Prime central London: "immaculate" vs "needs upgrade" about +30% (sales), +31% (rents) | Medium (agent data) | The gap is widening in a weak prime market |
| Primary | School quality (primary, value-added and peer intake) | +3% per 1 SD of school value-added or of prior attainment; about +11% per 1 SD of the pupil distribution | High | Premium concentrated close to the school and at admissions-district boundaries |
| Secondary | Neighbourhood disorder (criminal damage, not burglary) | 1/10 SD less criminal damage = +about 1% (about £2,200 in inner London, 2001) | Medium-High | Burglary rates showed no measurable price effect |
| Secondary | Green space, gardens, water | +1 percentage point ward share of gardens/green space/water = about +1% | Medium | Green Belt location about £5,800 premium in metro areas |
| Secondary | Energy efficiency (EPC) | A/B vs D: +5% (2015 study), +1.6% (Nationwide, recent); G vs D: about -7% | Medium; estimates disagree | Smaller effect in London and the South East than in the North |
| Secondary | Flood risk | Inland 100-year floodplain about -4.6% (rule of thumb); -6.9% right after a flood | Medium | Defences raise urban prices by 12.6-16.7% |
| Secondary | Conservation-area designation | New designation: about +2.8% inside, +2.3% just outside; mostly long-run | Medium | Gentrifying, high-education areas lobby for designation |
| Niche | Visual disamenity (wind farms; also airports) | Visible wind farm within 2 km: about -5% to -6%; fades to 0 by 8-14 km | High (rural) | Shows that "views" are priced |
| Niche | Floor level / height | Floor elasticity of residential rent about 0.07 (NYC/Chicago) | Medium | No equivalent UK estimate read |
| Structural | Density / supply constraints | Rent elasticity to density about 0.15; regulation raised England prices about 35% by 2008 | High (macro) | Westminster's "regulatory tax" on offices was over 800% of build cost |

---

## 1. Transport accessibility (primary, strongly London-specific)

**Gibbons & Machin (CEP DP 611, 2004; JUE 2005). New Jubilee Line Extension and DLR stations in south-east London, late 1990s.**
- Design: difference-in-differences comparing postcodes whose distance to the nearest station fell with postcodes that saw no change. Nationwide data for 1997-2001, within 30 km of Holborn.
- Prices in affected places rose 9.3 percentage points more than in unaffected places.
- About 5.5-5.8% per km of distance reduction for homes within 2 km of the new stations. The most conservative estimate is about 1.5% per km, roughly £2,500 per km in 2001.
- Beyond 2 km there is no distance effect. The 2 km cut-off maximised R² in a grid search.
- Cross-sectional estimates are much larger, about 8.9% per km within 2 km. The authors argue the cross-section is biased by unobserved local characteristics.
- National Rail stations: about 3% per km within 2 km, and about +0.2% for each extra train per hour. Service frequency matters.
- In this paper's comparison, a quarter-SD reduction in station distance is worth about 1.5% of price. A quarter-SD rise in primary-school performance is worth under 0.75%. On this evidence, tube access matters at least as much as schools in London.
- Source: https://cep.lse.ac.uk/pubs/download/dp0611.pdf

**Nguyen (Vietnamese Economic Review, 2026). Elizabeth line (Crossrail).**
- Design: difference-in-differences on 1.6 million Land Registry transactions, 2000-2024, in distance bands around 41 stations, with properties more than 10 km away as the control.
- Construction phase (2007-2015): prices within 1 km rose 4.9%, and the 2-10 km bands rose 7.7-8.1%. This points to anticipation effects and to avoidance of construction disruption close to stations.
- After the May 2022 opening, prices within 1 km fell 2.0%, read as a correction after overshooting. Outer bands did not change.
- Effects were concentrated in areas that TfL had served poorly before.
- Caveat: a new, low-tier journal with a single author. Use as indicative only.
- Source: https://vner.org/index.php/vner/article/download/3/3

**Implication for valuation:** the market prices transport upgrades years before they open. A "station within 10-15 minutes' walk" works as a threshold attribute, with little effect past about 2 km. Frequency and Tube/DLR versus National Rail also matter.

## 2. School quality (primary, England-wide, strongest in London and the South East)

**Gibbons, Machin & Silva (SERC DP 18, 2009; JUE 2013). "Valuing school quality using boundary discontinuities".**
- Design: matched identical properties on either side of admissions-authority boundaries, with sample maps covering London and the South East.
- A 1 SD change in school value-added, or in prior achievement (intake), raises prices by about 3%.
- In the pupil-score distribution, 1 SD is worth about 11%, or about £20,500 (£1,000 a year). That equals about 2.5 years of private day-school fees in 2006-07.
- Parents pay both for real effectiveness (value-added) and for a better peer intake, such as fewer pupils on free school meals.
- Source: https://researchonline.lse.ac.uk/id/eprint/30814/8/sercdp0018.pdf

**Gibbons, Mourato & Resende (SERC DP 74, 2011). Nationwide hedonic study with school controls.**
- 1 SD of value-added at the nearest primary school gives +2.2% for homes next to the school. The premium decays quickly and is close to zero by about 110 m in their specification.
- Source: https://researchonline.lse.ac.uk/id/eprint/33594/1/sercdp0074.pdf

**Rossi (Strathclyde working paper, 2021). Scotland, secondary-school catchments, 2015-2018.**
- In Scotland, prices respond to school-average attainment (about +3-4% per SD) but not to value-added.
- Contrast with England: Scottish buyers appear to pay for intake and attainment rather than school effectiveness. This is a regional difference within the UK.
- Source: https://strathprints.strath.ac.uk/76367/1/Rossi_2021_School_performance_noncognitive_skills_and_house_prices.pdf.pdf

**Disagreement:** whether buyers pay for value-added (England, Gibbons and colleagues: yes) or only for raw results and intake (Scotland, Rossi). Both find a premium of about 3-4% per SD.

## 3. Tenure and lease length (primary and very London-specific)

**Giglio, Maggiori & Stroebel (NBER w20133, 2014; QJE 2015). Universe of England and Wales transactions 2004-2013, plus Singapore.**
- Discounts against otherwise identical freeholds:
  - 80-99 years remaining: about 16%
  - 100-125 years: about 10%
  - 125-150 years: about 8%
  - 150-300 years: about 3%
  - 700+ years: negligible
- Their informal survey found very scattered beliefs. Many valuers expected smaller discounts than the data show, and many buyers expected larger ones.
- The results hold when London is excluded.
- Source: https://www.nber.org/system/files/working_papers/w20133/w20133.pdf

**Bracke, Pinchbeck & Wyatt (Bank of England / LSE; Economic Journal 2018). Prime central London flats, 1987-91 and 2004-13.**
- The authors note that most London housing transactions trade long leases of varying length. Lease length is therefore a first-order London valuation variable that barely matters in most other countries.
- Implied discount rates fall with horizon. They were 1.6 percentage points lower in 2004-13 than in 1987-91, converging to about 2-3% at very long horizons.
- The results contradict practitioners' rule-of-thumb lease-value tables (the "relativity" graphs).
- Other hedonic results in the same paper:
  - houses carry about a 20% premium over flats on the same street with the same bedrooms
  - "in need of improvement" listings carry a 15-20% discount
  - an onerous ground rent (above 0.1% of value) is used as a control
- Source: https://researchonline.lse.ac.uk/id/eprint/86393/1/Pinchbeck_Time%20value%20of%20housing_2018.pdf

## 4. Condition / finish (primary in prime London; practitioner evidence)

**Savills Research, "Value is in the eye of the buyer" (In Focus: Prime Central London, 2026).**
- "Immaculate" homes sell at about a 30% premium over those needing upgrade, and the gap is widening.
- PCL values are 26% below their 2014 peak.
- Houses have held up better than flats. Houses were over 60% of £5m+ sales in H1 2026.
- Domestic buyers make up 49% of sales, against 44% ten years earlier. North American buyers are close to 10%.
- Source: https://www.savills.co.uk/research_articles/229130/394353-0

**Savills Research, "What makes prime central London different" (2026, lettings).**
- "Immaculate" rentals command a 31% premium over "moderate" condition.
- 35% of PCL tenants are UK nationals, against about 50% in outer prime London.
- Western Europeans and North Americans are the largest international groups of tenants.
- Source: https://www.savills.co.uk/research_articles/229130/394382-0

The academic evidence agrees in direction: Bracke et al. find a 15-20% "in need of improvement" discount, and Ahlfeldt et al.'s controls show premia for new-build, central heating, parking and garages.

## 5. Crime and disorder (secondary, measured in London)

**Gibbons (CEP; Economic Journal 2004). "The costs of urban property crime" (London).**
- Criminal damage (vandalism, graffiti, arson) significantly lowers prices. Burglary showed no measurable effect.
- A 1/10 SD increase in criminal-damage density costs just under 1% of value: about £2,200 on an average inner-London home in 2001, or about £110 a year.
- Five extra incidents per km² per year means about -1.6%.
- Interpretation: buyers read visible disorder as a signal of neighbourhood decline more than they weigh actual victimisation risk.
- Side finding: 10 more pubs or wine bars per km² was associated with about +2.8% (a positive amenity effect).
- Source: https://researchonline.lse.ac.uk/id/eprint/20043/1/The_Costs_of_Urban_Property_Crime.pdf

**Implication:** total crime counts, which portals often show, may be the wrong measure. Visible disorder and anti-social behaviour carry the price signal.

## 6. Green space, water, gardens, landscape (secondary)

**Gibbons, Mourato & Resende (SERC DP 74, 2011; Environmental & Resource Economics 2014). About 1 million English transactions, 1996-2008, with Travel-to-Work-Area fixed effects.**
- Land-use shares in the ward: +1 percentage point of gardens, green space or water each gives about +1% (about £2,000).
- Distance effects, per km further away:
  - rivers: -0.9% (about £1,750)
  - National Trust sites: -0.7% (about £1,350)
  - churches with a tower or steeple: -4.2% in metro areas, read as a proxy for a historic centre
- Designations:
  - National Park: about +5% (about £9,400)
  - Green Belt: about £5,800 premium in major metropolitan areas, but no effect nationally
- Land cover: broadleaved woodland +0.19% per percentage point, freshwater +0.4%.
- The top amenity locations carry implicit values of about £67,900, or about £2,000 a year.
- Source: https://researchonline.lse.ac.uk/id/eprint/33594/1/sercdp0074.pdf

## 7. Conservation areas and heritage (secondary; London has many)

**Ahlfeldt, Möller, Waights & Wendland (SERC DP 143, 2013; Economic Journal 2017). "Game of Zones".**
- Data: Nationwide, England, combining difference-in-differences with regression discontinuity.
- New designations had no significant short-run effect. There was some evidence of a positive effect in the long run.
- One specification gives about +2.8% inside newly designated areas and +2.3% within 500 m outside them.
- Designation is driven by gentrification: places with more degree-educated residents push for it.
- Hedonic controls show premia for new-build, parking and garages, and central heating, and a discount for leasehold.
- The authors warn that conservation areas restrict supply, so the wider welfare effect may be negative.
- Source: http://eprints.lse.ac.uk/58349/1/__lse.ac.uk_storage_LIBRARY_Secondary_libfile_shared_repository_Content_SERC%20discussion%20papers_2013_sercdp0143.pdf

**Implication:** conservation status is mostly already priced in. It is a marker of an established, desirable area and of protection from unwanted change, rather than a separate uplift.

## 8. Energy efficiency / EPC (secondary; estimates disagree)

**Fuerst, McAllister, Nanda & Wyatt (Energy Economics 2015).**
- Data: repeat sales of 333,095 dwellings in England, 1995-2012.
- Against band D:
  - A/B: +5% (about £8,900)
  - C: +1.8%
  - E/F: about -1%
  - G: about -7%
- Larger effects for terraces and flats.
- Source: https://www.repository.cam.ac.uk/bitstreams/25ab511c-46b9-4141-bbc4-ad06941c988e/download

**DECC (2013) report by the same team (gov).**
- Against band G: E/F +6%, D +8%, C +10%, A/B +14%.
- Regional differences:
  - no significant effect in the South East, which the authors attribute to prices there being driven by transport links to London
  - London's log coefficients are flat at about 0.11-0.12 for A/B through E against G, so only the bottom band is penalised
  - effects are largest in the North East, where the A/B-against-G log coefficient is 0.38
- Source: https://assets.publishing.service.gov.uk/media/5a7cc5c340f0b6629523bb8f/20130613_-_Hedonic_Pricing_study_-_DECC_template__2_.pdf

**Nationwide HPI special report (undated; it cites the 2026 Warm Homes Plan, so it is recent).**
- Owner-occupier premium for A/B against D is only +1.6% (about £4,500). F/G is -1.4%.
- Buy-to-let purchases show a +12.2% premium for A/B, linked to rules for landlords.
- 78% of homeowners expect buyers to pay more for efficiency, and 49% of 25-34-year-olds call it "very important". Stated preferences run ahead of revealed ones.
- Source: https://www.nationwide.co.uk/media/hpi/reports/energy-efficiency-ratings-have-limited-impact-on-owner-occupied-house-prices-despite-increased-interest-in-going-green

**Disagreement:** 5-14% in the 2013-15 academic studies against 1.6% in recent lender data. The gap probably reflects different reference bands, different controls (neighbourhood, new-build) and EPC D now being the norm. For London owner-occupiers, the EPC is a secondary or "deal-breaker only at F/G" attribute. For landlords it is primary because of regulation.

## 9. Flood risk (secondary; specific to river and coastal areas)

**Beltrán, Maddison & Elliott (Ecological Economics 2018). Meta-analysis of 37 studies and 364 estimates.**
- Inland 100-year floodplain: -2.9%, rising to -6.9% just after a flood. The suggested rule of thumb is -4.6%.
- 500-year floodplain: -5.2% after a flood.
- Coastal floodplain shows an apparent premium (+13.4%) because sea views and coastal amenities are mixed into the flood-risk measure, and there is publication bias.
- Salience matters: discounts appear after floods and then fade.
- Source: https://researchonline.lse.ac.uk/id/eprint/86458/1/Beltran_Is%20flood%20risk%20capitalised%20into%20property%20values.pdf

**Beltrán, Maddison & Elliott (Risk Analysis 2018). Flood defences, England, 1995-2014, over 12 million transactions.**
- New defences raised urban prices by 12.6-16.7% at the 6-digit postcode level.
- Rural prices fell 0.8-5.0%, which the authors attribute to the visual disamenity of the defences.
- Source: http://eprints.lse.ac.uk/90207/1/Beltran_Maddison_Elliott_Economic_Benefits_of_Flood_Defenses.pdf

## 10. Noise and visual disamenities (niche, but views are clearly priced)

**Gibbons (SERC DP 159, 2014; JEEM 2015). "Gone with the wind", England and Wales.**
- A visible wind farm within 2 km lowers prices by about 5-6% (about 6.5% within 1 km). The effect is about 2.5-3% at 2-4 km and near zero at 8-14 km.
- Turbines hidden by terrain have no effect within 4 km. Buyers price the view, not mere proximity.
- Source: https://researchonline.lse.ac.uk/id/eprint/58422/1/__lse.ac.uk_storage_LIBRARY_Secondary_libfile_shared_repository_Content_SERC%20discussion%20papers_2014_sercdp0159.pdf

**Kaur, Cardak & McAllister (Q Open 2021). Essendon Airport, Melbourne (non-UK comparator).**
- Prices ignore official noise-contour maps. They track straight-line distance from the runway (up to a +37% premium at 1.64 km) and the number of flights (about -4.5% per extra 1,000 flights a year).
- Their literature review cites roughly 0.4-2.4% per dB.
- Lesson for London (Heathrow, City Airport flight paths): buyers use simple proxies such as distance and visible flights, not technical contours.
- Source: https://academic.oup.com/qopen/article-pdf/1/2/qoab012/39406604/qoab012.pdf

No UK-specific air-quality or road-noise hedonic paper could be read in this stream. A 2026 SSRN paper on house prices and London's ULEZ exists (doi 10.2139/ssrn.6170029) but was not accessible, so it is excluded from the evidence. Ahlfeldt & Pietrostefani recommend a rent-to-pollution elasticity of about 0.3 as a generic value.

## 11. Density, height and supply constraints (structural; explain London's level, not micro-ranking)

**Ahlfeldt & Pietrostefani (JUE 2019). "The economic effects of density: a synthesis".**
- Based on 347 estimates. Recommended density elasticity of rent: 0.15, rising with density; 0.21 for France.
- Other recommended elasticities: wages 0.04, crime reduction 0.085, pollution -0.13.
- Density is a net amenity overall but its effects are regressive.
- Source: https://researchonline.lse.ac.uk/id/eprint/100482/1/GA_EP_The_economic_effects_of_density.pdf

**Ahlfeldt & Barr (CEP DP 1704, 2020; JUE 2022). "The economics of skyscrapers".**
- Floor elasticity of residential rent is about 0.07 in New York and Chicago, read as a view or prestige premium on higher floors.
- No London figure, but this is the best evidence that floor level is a valued attribute in tall-building cities.
- Source: https://researchonline.lse.ac.uk/id/eprint/108469/1/dp1704.pdf

**Hilber & Vermeulen (SERC DP 119, 2012/2014; Economic Journal 2016). 353 English local planning authorities, 1974-2008.**
- Regulatory constraints sharply increase how strongly prices respond to local earnings.
- Without regulation, England's real prices would have been about 35% lower in 2008.
- With the North East's level of restrictiveness, South East prices would have been about 25% lower.
- Physical land scarcity matters only in highly urbanised areas such as London.
- Cites Cheshire & Hilber: the office "regulatory tax" in Westminster exceeds 800% of construction cost.
- Source: http://cep.lse.ac.uk/pubs/download/sercdp0119.pdf

---

## 12. Cross-cutting observations

1. **Ranking of location attributes for London, from causal evidence:**
   - transport access within about 2 km
   - school quality, at about 3% per SD
   - visible disorder
   - green and blue space
   - heritage designation

   Tenure (lease length) and condition can each move price by 10-30%, more than any single neighbourhood attribute.
2. **Cross-section overstates.** Every study comparing designs finds naive hedonic coefficients larger than quasi-experimental ones (rail: 8.9% vs 1.5-5.8% per km). An AVM or portal "premium" based on raw comparisons will exaggerate amenity effects.
3. **Thresholds and decay are sharp:**
   - stations: about 2 km
   - school premium: falls off within a few hundred metres
   - wind-farm views: about 8-14 km
   - flood discounts: fade with time since the last flood

   Distance bands work better than linear distance.
4. **Salience and signals beat technical measures.** Buyers react to visible graffiti more than to burglary statistics, to runway distance more than noise contours, to recent floods more than mapped risk, and to EPC only at the extremes (F/G).
5. **London versus the rest of the UK:**
   - Leasehold length is a London-centred variable.
   - EPC premia are smaller in London and the South East than in the North.
   - The Green Belt premium appears only in metropolitan areas.
   - Land-scarcity constraints bind mostly in urban London.
   - Scotland's school premium tracks raw attainment rather than value-added.
6. **Valuer versus market gaps** are documented for lease length (both Giglio et al. and Bracke et al.). Professional valuation conventions can lag what transaction data show.

## 13. Gaps / not covered here
- No readable UK paper on air quality or road noise, or a causal UK new-build premium; the latter appears only as a positive hedonic control in Ahlfeldt et al.
- Crossrail evidence beyond the 2026 single-author paper: the 2017 Ealing anticipation paper in the Journal of Transport Geography was paywalled.
- Recent post-2020 London school-premium updates were not found in open form.
