# Paris and southern/western Europe: how homes are searched for and priced (research notes, Oct 2026)

Stream: Paris (main focus), Madrid/Barcelona, Lisbon, Milan (thin coverage). Notes are in English. Quotes are paraphrased. Each finding cites its URL(s). Read status for each source is in `paris-south-europe.sources.json`.

Method caveat: Reddit (r/paris, r/vosfinances, r/askspain) returned 403 or a login wall for every access route tried (www, old, .json, headless browser), and expat.com and PAP also returned 403. Forum evidence therefore comes from Hacker News threads (300+ participants on Paris and Lisbon housing), CommentCaMarche, ForumConstruire and the Spanish Property Insight forum. The WebSearch budget ran out partway through, so coverage of Milan and Lisbon rents is weak and is marked as a gap.

---

## 1. Headline: what is different about Paris compared with London

| Dimension | Paris | London (for contrast) |
|---|---|---|
| Unit of price | **Price per m² (prix au m²)** is the universal language. Buyers, agents, notaires and portals all quote it, and surface is legally certified (loi Carrez). | Price is quoted per property, and sq ft is secondary and not certified. |
| Transaction data | **DVF**: open government data on notarised sale prices, updated twice a year with a lag of about 6 months. **Notaires-INSEE** indices. | HM Land Registry Price Paid (no floor area). EPC floor area is linked separately. |
| Online estimate | MeilleursAgents (owned by SeLoger) mixes DVF, its own models and partner-agent feedback. The typical gap to the final sale price is about 6%. | Zoopla/Rightmove AVMs. |
| Micro-location | **Arrondissement**, then the quartier. Rent control uses 80 "quartiers administratifs" grouped into 14 zones. | Postcode district, borough and tube zone. |
| Building attributes | **Floor (étage) × lift (ascenseur)**, era (Haussmannien vs post-war), copropriété works (ravalement), building-level DPE. | Period vs new build, leasehold/service charge, freehold share. |
| Energy | **DPE class is legally binding for renting**: G banned from new leases since 1 Jan 2025, F from 2028, E from 2034. Rents for F/G homes are frozen. | EPC minimum E for lettings, with a proposed path to C. |
| Rental regulation | **Encadrement des loyers**: a capped reference rent (loyer de référence majoré = median +20%) by sector, room count, era and furnishing. | No rent caps. |
| Tenant screening | **Dossier + garant**: income of at least 3× the rent, 3 payslips, tax notice, a guarantor or **Visale**/GarantMe. | Referencing plus guarantor or rent-guarantee firms. The common rule is annual income of at least 30× monthly rent (background knowledge, not sourced in this stream). |

---

## 2. Paris buying side: primary vs secondary criteria

### 2.1 Primary: price per m² × arrondissement/quartier
- Notaires du Grand Paris put the average Paris apartment at **€9,520/m² in Mar–May 2026, +0.1% year on year**. The Île-de-France average was €6,120/m². Paris sales volumes fell 2% year on year, and the notaires describe the market as stable but fragile because of credit-cost risk. https://paris.notaires.fr/fr/presse/communication-immobiliere-mensuelle/conjoncture-immobiliere-en-ile-de-france-de-mars-mai-2026
- Spread across arrondissements: about **1 : 1.8** from the 19e (median about €8,200/m²) to the 6e (about €14,500/m²). Prices are roughly 12% below the 2022 peak. This comes from search snippets of broker and PAP pages, not read in full: https://www.pap.fr/actualites/paris-ces-arrondissements-ou-les-prix-ont-vraiment-augmente-en-2026/a29652
- Practical meaning: Paris buyers set a budget in m² and then pick an arrondissement. A London-style "how many bedrooms for £X" framing is secondary. Agents and sellers anchor the asking price at local €/m² × Carrez surface, then adjust for floor/lift, condition, DPE and outlook.

### 2.2 Primary: certified surface (loi Carrez)
- For copropriété lots, the deed must state the Carrez surface. This excludes areas with ceiling height under 1.80 m and lots under 8 m². If the real surface is **more than 5% below** the stated figure, the buyer can claim a proportional price reduction **within one year** of the deed, and the buyer carries the burden of proof. Source: search snippets of PAP and law-firm pages, not read in full: https://www.pap.fr/acheteur/compromis-vente/erreur-de-superficie-pouvez-vous-exiger-une-baisse-du-prix-apres-la-promesse-de-vente/a26767
- A Paris luxury agent writing for French expats lists **Carrez surface, estimated renovation cost and DPE** as the three things buyers now check first. https://ufe.org/article-feed/proprietaires-expatries-dpe/
- Contrast with London: there is no legally certified floor area, so £/sq ft is a soft secondary metric. In Paris, m² is hard, legally enforced and directly priced.

### 2.3 Secondary but systematic: floor × lift
- SeLoger editorial (2023): **with a lift**, a 3rd floor costs about 0.8% more than a 2nd floor and a 6th floor about 1.5% more. **Without a lift**, a 3rd floor costs about 0.6% more, but a 6th floor costs about **2.6% less** than a 2nd floor because of the stairs. Ground floors are generally discounted. Upper floors are valued for light, views, quiet and privacy. https://edito.seloger.com/conseils-d-experts/acheter/l-impact-d-un-etage-prix-d-un-appartement-paris-article-16840.html
- Brokers' rules of thumb are much larger. They cite **3–5% per floor above the 3rd** with no lift, or 10–20% for a 5th floor with no lift. These figures come from search snippets of broker sites and look anecdotal next to SeLoger's hedonic estimates, so treat them as a negotiation narrative rather than measured fact.
- DVF does not record floor, lift, view or transit access. Every estimate built on DVF has to adjust for these by hand, which is one reason agents still matter (see 2.6). https://habity.fr/blog/prix-immobilier-fiabilite-dvf-seloger-meilleursagents

### 2.4 Energy class (DPE): a rising criterion, but Paris-specific dampening
- **National**: notaires' "valeur verte" study (relayed Feb 2026) found A–B homes about **+16%** and F–G about **−12%** relative to class D. Other notaires figures for 2021→2024 show the F discount widening from −10% to −18% and the G discount from −17% to −25% (snippet). https://www.boursedescredits.com/actualite-valeur-verte-passoire-thermique-poids-diagnostic-energetique-prix-vente-29334.php
- **Paris was the exception in 2022**. The MeilleursAgents × SeLoger hedonic study (Apr 2022) found that F/G apartments sold for **13% less** than A/B nationally. In Paris, however, F/G homes were **+1.1% more expensive** than better-rated homes, because many prestigious historic (Haussmannian) buildings are energy sieves and buyers value the "cachet de l'ancien" over green value. The same study showed Paris F/G listings rising 34% (vs +8% nationally) as landlords sold rather than renovated. Even then, Paris F/G prices fell faster in 2021 (−4.2% vs −0.2%). https://www.precarite-energie.org/wp-content/uploads/2022/05/cp-etude-dpe-seloger-meilleursagents.pdf
- **By 2026 the dampening has narrowed but not disappeared.** A Paris broker estimates A–D as neutral, E about −5%, F −5–10% and G −10–20%. The August 2022 DPE reform turned the DPE from paperwork into a real valuation criterion. https://ufe.org/article-feed/proprietaires-expatries-dpe/ Snippets from notaires/press coverage say the DPE effect on price is "much lower in Paris than the rest of France" because demand far exceeds supply, and that G homes in Paris rent for only about €1.3/m² less than D homes. Building-level (collective) DPE has been required for nearly all Paris copropriétés since 1 Jan 2026 (snippet).
- **Rental legal effect** (gov): G homes have been barred from new or renewed leases since 1 Jan 2025, F homes will be from 2028 and E homes from 2034. Rents for F/G homes are frozen. Adverts must show the DPE class, annual energy cost and an "excessive consumption" warning for F/G. A 2026 change (electricity conversion factor cut from 2.3 to 1.9) lifts some electrically heated flats out of F/G. https://www.service-public.gouv.fr/particuliers/vosdroits/F16096
- A parliamentary answer cited in snippets estimated that about 60% of Paris rental homes would be caught by the G/F/E schedule. That is why DPE matters much more for **buy-to-let investors** than for owner-occupiers in Paris.
- Disagreement: the national studies (notaires, Ithaque via Moneyvox: €237–667/m² apartment discount in big cities) show large discounts. The Paris-specific evidence (MA/SeLoger 2022, UFE 2026) shows small or no discount for owner-occupier "charm" stock. https://www.moneyvox.fr/immobilier/actualites/102765/dpe-selon-la-note-de-votre-logement-voici-de-combien-sa-valeur-chute-dans-ces-grandes-villes

### 2.5 Secondary: building and copropriété condition
- Buyers look at the last 3 AG (general meeting) minutes, the carnet d'entretien and any votes on ravalement (façade works, often €10–25k per lot in Paris, per snippet). A ForumConstruire thread (2022, 2 participants) shows buyers trying to price unvoted façade works into their offer. The experienced member's advice was to check what the syndic has actually planned before believing proposals. https://www.forumconstruire.com/construire/topic-438906-achat-appartement-prix-ravalement.php
- City pre-emption: the City of Paris can pre-empt sales of whole buildings to convert them to social housing. HN participants describe a 2-month window for the city to match, buy or counter-offer (thread with 308 participants). https://news.ycombinator.com/item?id=39765692

### 2.6 How sellers and agents set the price (valuation)
1. **Local €/m² from DVF and notaires** (actual sale prices, about a 6-month lag, published twice a year, excluding Alsace-Moselle and Mayotte, open licence). https://www.data.gouv.fr/fr/datasets/demandes-de-valeurs-foncieres/
2. **Portal estimates** (MeilleursAgents, SeLoger). These are more reactive than DVF but opaque in how they weight sources. A reported **~6% average gap** to the real transaction. Asking prices typically sit **5–8% above** final prices, up to 15% in soft markets. https://habity.fr/blog/prix-immobilier-fiabilite-dvf-seloger-meilleursagents
3. **Adjustments** for floor/lift, view, condition, DPE and works voted in the copropriété. These are not in DVF, so they come from agent judgement.
4. **Negotiation**: 3–7% off asking in Paris in 2026, 10–15% for F/G homes or homes needing works. Flawless homes in sought-after areas barely negotiate (snippet from broker pages).
- A data-quality caveat in the Habity piece: even good median-based models land within ±5% of official figures for only about 70% of communes (apartments). Its conclusion is that a professional who knows the building is still required, and that data makes expertise more honest, not redundant.

---

## 3. Paris rental side

### 3.1 Primary for renters: the dossier and income multiple
- The standard French screening rule is **net income ≥ 3× rent including charges**. It is industry practice tied to rent-default insurance (GLI) requirements, not law. This was explained in a CommentCaMarche thread where agencies wrongly told a renter it was "a new law". https://droit-finances.commentcamarche.com/forum/affich-7019273-2016-2-ou-3-fois-le-loyer
- A landlord holding GLI cannot also demand a personal guarantor (snippet of other CCM threads).
- **Visale** (free state-backed guarantee, Action Logement), rules from 6 Jan 2026: anyone under 30 regardless of income, private-sector employees over 30 earning up to €1,710 net per month, people in job mobility, and others. **Rent ceiling in Île-de-France is €1,940/month** (students €1,000). Cover is now limited to the first 3 years of the lease. https://www.service-public.gouv.fr/particuliers/actualites/A17759?lang=fr
- Paid alternatives such as GarantMe (about 3.5% of annual rent) are used by foreigners without a French guarantor (snippet, The Local / parisrental guides).
- **London contrast**: Paris renters compete on *dossier quality*, meaning a CDI permanent contract, payslips and a guarantor, because the regulated rent cannot be bid up. In London, competition is more often on price (bidding wars) and move-in speed.

### 3.2 Rent control (encadrement des loyers): a criterion for both sides
- Mechanism: the prefect sets a reference rent per m² by sector (80 quartiers in 14 zones), room count, construction era and furnished/unfurnished status. The cap ("majoré") is median +20%. A "complément de loyer" is allowed only for exceptional location or comfort features, and is banned for F/G homes or homes with sanitary facilities on the landing. Since July 2022, adverts must show the cap and any complément. The current decree runs Jul 2025–Jun 2026 (snippet of Foncia/CAFPI pages).
- **Academic evaluation** (Breuillé, Le Gallo, Morin, Regnaud et al. for APUR, 2025 update): a difference-in-differences design using SeLoger listings against 8 unregulated tense cities. Rent control lowered Paris rents by **5–5.2% (Jul 2019–Jun 2024)**. The effect grew over time: −5.9% in 2022/23 and −8.2% in 2023/24. It was strongest for **studios and small units** and fairly even across era, furnished status and sector. With full compliance the effect would have been **9.8–10.2%**. Non-compliance is large: **43.2% of listings exceeded the cap in 2023/24** (up 6 points). The figure is 51% for furnished vs 32.7% for unfurnished, and 68.8% for units under 18 m². The study found **no durable effect on rental supply**; listing swings tracked COVID and the Olympics. https://www.apur.org/sites/default/files/2025-06/rapport-impact_encadrement_loyers_paris.pdf ; summary https://www.apur.org/en/housing-dwelling/housing-stock-evolution/impact-rent-control-Paris-2023
- An earlier SDES/ministry study of the 2015–17 scheme found that about 20% of rents stayed above the caps. Small-room flats, often occupied by poorer and larger households, saw rents fall about 3%, while other categories were stable. https://www.statistiques.developpement-durable.gouv.fr/encadrement-des-loyers-paris-une-contrainte-plus-forte-pour-certains-logements-0
- Practical implication for a search tool: in Paris, "is this advert above the legal cap?" is a real renter-side criterion. Furnished studios are the segment most often over the cap.

### 3.3 Social housing as part of the Paris search landscape
- HN thread (NYT article, 648 comments, 308 participants): Parisians describe a three-tier city in which the rich buy or rent privately, poorer households get social housing (offers about 15–20% under market, with income caps), and the middle class moves to the suburbs. Commenters disagree on cost: some say the city's purchases at peak prices are driving up its debt, while others say the policy keeps a social mix. https://news.ycombinator.com/item?id=39765692

---

## 4. Madrid and Barcelona

### 4.1 Search mechanics
- Idealista is the dominant portal, with Fotocasa second. In Barcelona the listed surface is usually *usable* m² (útiles) rather than *built* m² (construidos), which matters when comparing €/m². Asking prices on Idealista differ from valuation (tasación) or notary data (SPI forum, an old 2007 thread but a durable point). https://www.spanishpropertyinsight.com/discussion/forum-topic/barcelona-prices-per-square-metre/
- **Madrid tension, Aug 2026 (AMADEI via Idealista)**: more than **200 applicants per rental flat**. Average rent is about €1,550/month (€1,500–1,800 in Salamanca/Chamberí/Chamartín, €900–1,000 in cheaper districts). Landlords now demand a **permanent contract, an effort ratio under 30–35% of income, rent-default insurance and extra guarantees**. Demand is spilling into Getafe, Leganés and Parla, with rises of more than 40% a year in some suburbs. https://www.idealista.com/news/node/910591
- Contract terms (expat guides, snippet): the nómina (payslip) is routinely requested. "11-month" contracts are used to dodge tenant rights but are reclassified by courts. Since May 2023 the agency fee should be paid by the landlord.

### 4.2 Rent regulation (Ley de Vivienda 2023, zonas tensionadas)
- A zone qualifies when housing cost exceeds 30% of median income, or prices have grown more than 3 points above CPI over 5 years. As of 30 Sep 2026 there were **317 municipalities in 5 regions (Catalonia 271)** and **none in Madrid**, because the region refuses to apply the law. New contracts are capped at the previous rent, plus up to 10% for refurbishment or energy upgrades. Large landlords (10+ homes) must respect the state reference index. https://taxdown.es/propietario/zonas-tensionadas
- **Barcelona outcomes** (Fedea/OBS via Idealista, Jun 2026): Barcelona rents +5.7% (Q1 2024–Q4 2025) vs Madrid +8.5% and Spain +10.8%. Corrected for composition, €/m² is essentially unchanged. **Listings −22.2% in Barcelona**, average flat size −5% to 71.4 m², and **462 enquiries per listing vs 103 in Madrid**. https://www.idealista.com/news/node/903549
- Spanish Property Insight (trade press, sceptical of controls), using INCASÒL deposit data: declared average rent €1,125 (−2.4% year on year) but +2.35%/m² in 2025. Contracts signed fell 9.4% year on year to 25% below the 10-year average, while **Idealista asking rents rose 12% to €23.73/m²**. The analyst reads the growing gap between declared and asking rents as a sign of a growing undeclared economy. https://www.spanishpropertyinsight.com/2026/02/24/barcelona-rent-controls-nine-months-into-2025 ; one-year view (Q1 2025: contracts −23% to a record low of 7,615) https://www.spanishpropertyinsight.com/2025/06/21/barcelonas-rent-controls-one-year-on-prices-down-access-collapsed/
- **Academic**: Monràs & Montalvo (UPF, 2022) studied Catalonia's first cap (Sep 2020–Mar 2022, struck down by the Constitutional Court). They found rents about **−5%** and the share of units above the reference falling from about 50% by 13–22 points (i.e. heavy non-compliance). **Rental supply fell about 15%**, driven by the disappearance of above-reference units with no matching rise in below-reference units. A directed-search model implies welfare losses for owners and low-price tenants and gains for high-price tenants. https://www.frbsf.org/economic-research/wp-content/uploads/sites/4/Effect_second_generation_rent_Monras.pdf
- **Disagreement Paris vs Barcelona**: the Paris evaluation finds no durable supply effect, while Barcelona and Catalonia show 15–22% supply loss. Possible reasons are Paris's lighter-touch cap (median +20%, complément allowed), weak enforcement, and Barcelona's easier exit routes into seasonal or room rentals. Short-term rentals are a major issue in Spain: an HN thread on Spain fining Airbnb €65M in Dec 2025 (89 participants) argues that tourist demand absorbs new supply in central districts, while others argue the core problem is under-building. https://news.ycombinator.com/item?id=46313266

---

## 5. Lisbon (golden visa) and Portugal

- **Academic**: Pereira dos Santos & Strohmaier (IZA DP 16857, Mar 2024) used the full population of Portuguese transactions from 2007–2019. After the 2012 Golden Visa launch, excess bunching at the **€500,000 threshold rose about 60%**, meaning sellers priced to the visa threshold. A difference-in-differences comparison of transaction price against fiscal (tax) value finds a "Golden Visa premium". The abstract gives about €38k (>10%) and the conclusion says about €50k (an internal inconsistency to note). Buyers from outside the EU and Portuguese buyers drove the bunching; EU buyers did not bunch. Older, educated Lisbon residents most wanted the programme ended. https://repec.iza.org/dp16857.pdf
- **Forum view** (HN, 303 comments, 182 participants, Feb 2023, on Portugal's proposal to end golden visas and curb Airbnb): locals and long-term expats describe the main pressures as short-term lets (claims of more than 10% of homes, and more than 60% in some neighbourhoods, unverified), digital-nomad tax regimes, and an income/rent mismatch (a 1-bed at about €1,000 vs about €1,300 net pay). Others argue the golden visa was too small (a few thousand per year) to drive prices, and that Airbnb also revived a derelict historic centre. https://news.ycombinator.com/item?id=34832045
- Rental search mechanics (snippet only, not read): Idealista and OLX are the main portals. Landlords ask foreigners without a Portuguese fiador (guarantor) for up to 6 months' rent upfront. Signed rents are reportedly 25–30% below advertised. **Gap**: no forum or official source was read in full for Lisbon rents.
- The real-estate route of the golden visa was abolished in 2023 (Mais Habitação). This is background knowledge and was not verified with a source read in this stream.

## 6. Milan

- **Gap**: Immobiliare.it market pages returned 403 and the search budget ran out. No Milan source was read. Expected criteria (not verified here): €/m² by zone (Brera/Centro vs periphery), student and young-professional rental pressure, and energy class (APE). Treat Milan as uncovered by this stream.

---

## 7. Synthesis: primary vs secondary criteria in this region

**Primary (price-setting) across Paris, Madrid, Barcelona and Lisbon**
1. **€/m² × micro-location** (arrondissement/quartier, barrio/distrito). This is far more explicit than in London. Evidence: notaires, DVF, Idealista, SPI forum.
2. **Certified or quoted surface** (Carrez in France; útiles vs construidos in Spain).
3. **Regulatory status of the unit for renting**: DPE class (France), whether it sits in a rent-controlled zone, and its reference rent (Paris/Catalonia). This drives investor demand and, increasingly, price. Evidence: service-public, APUR, Monràs & Montalvo, Idealista/Fedea.
4. **For renters: eligibility, not price**. A 3× income dossier, permanent contract, guarantor or Visale (Paris), or nómina + 30–35% effort ratio + insurance (Madrid). Excess demand of 200–460 applicants per listing makes landlord selection the binding constraint. Evidence: CCM, Visale, AMADEI, Fedea.

**Secondary (adjusters)**
- Floor × lift (Paris: −2.6% to +1.5% in measured data, larger in broker lore). Haussmannian "cachet", which can outweigh poor DPE among Paris owner-occupiers. Copropriété works and ravalement. View and light. Furnished vs unfurnished (in Paris, furnished units are more often above the rent cap).
- Visa thresholds (Lisbon €500k bunching) as a city-specific distortion.

**London-specific vs this region**
- London has no per-m² legal surface, no rent caps, no tenant-dossier culture (though income multiples exist), and no legally binding energy-based letting ban comparable in strictness to France's G/F/E timeline.
- Paris shares with London the role of historic "charm" stock overriding efficiency, and the use of open transaction data (DVF vs Land Registry). DVF is richer: it includes surface and room counts.

## 8. Open questions and data gaps
- No Reddit evidence. All Reddit access routes were blocked, and Spanish/French Reddit sentiment should be collected by another method.
- Milan and Lisbon rent data were not read in full.
- The HAL version of the JHE 2025 Paris rent-control paper was blocked by an anti-bot wall. Its conclusions were taken from the APUR 2025 report by the same team and from the RePEc ERES 2023 abstract (−3.2% rent effect on data to Jul 2022).
