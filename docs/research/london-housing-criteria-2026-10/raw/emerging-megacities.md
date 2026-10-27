# Emerging megacities: Moscow, Indian metros, Lagos, São Paulo, Mexico City

Stream: how buyers, renters and agents search and price homes in the cities that send many migrants to London, as a comparison set for London criteria. Research date: October 2026.

## Method and caveats

- **Web search ran out partway through.** The session hit its WebSearch limit after about 10 queries. After that, sources were found through Reddit's archive (Arctic Shift API: posts and comments, read in full), the OpenAlex academic index (often rate-limited), Wikipedia's API, and fetching known URLs directly.
- **Several sites blocked fetches:**
  - Reddit direct, Nairaland, Guardian Nigeria and TechCabal returned 403.
  - Business Standard returned 403. JLL Homes India was blocked by Akamai.
  - Housing.com returned 406.
  - CIAN showed a Yandex CAPTCHA.
  - Knight Frank India reports are behind a lead form.
- **CIAN, Avito and Yandex Nedvizhimost filter menus were not checked directly.** Moscow evidence on search criteria comes from hedonic research and resident discussion instead.
- No Nairaland thread could be read. Nigerian forum evidence comes from r/Nigeria.
- No academic paper on Mexico City or São Paulo could be retrieved. Those cities rest on forums, a portal-derived index (FipeZap) and practitioner guides.
- Forum threads are 2025–2026 Reddit posts, read with their top-voted replies.

---

## 1. Moscow (and Russian big cities)

### 1.1 Primary criteria (evidence)

**Size, then location.** Magnus & Peresetsky built a hedonic model on about 14,700 Moscow listings from 2003 (Applied Econometrics, 2010). They find price depends first on size and then on location.
- Price rises slightly more than proportionally with area (exponent about 1.08).
- Elasticity with respect to distance from the centre is about -0.20: 1% further out means 0.2% cheaper.
- The model predicted 85.6% of prices within 25%.
- Source: https://cyberleninka.ru/article/n/the-price-of-moscow-apartments

**Minutes to metro is priced explicitly.** In the same paper, every extra 10 minutes' *walk* to the nearest metro cuts price by about 3.9%. Every extra 10 minutes by *public transport* to the metro cuts it by about 11.6%.
- This is why Russian portals let users filter on "N minutes on foot / by transport to metro".
- Residents phrase demands the same way. A buyer on r/AskARussian specified "5 to 10 minutes from metro by walking" and "not more than 20 minutes with metro" to the centre.
- Sources: https://cyberleninka.ru/article/n/the-price-of-moscow-apartments ; https://www.reddit.com/r/AskARussian/comments/1nnl9cm/how_much_cost_an_aparmenthouse_in_moscow_with/

**Floor: not first and not last.** Ground-floor and top-floor flats trade about 9.3% below otherwise similar units (Magnus & Peresetsky). Residents on r/AskARussian (2025, 29 comments) give practical reasons for avoiding the top floor:
- roof leaks and roof-repair disruption;
- summer heat and heat loss;
- weak water pressure in older 9-storey blocks;
- dependence on the lift (one person was stuck without it for two weeks);
- a rule of thumb that above the 9th floor the building should have two lifts.

The upsides they list are no noise from upstairs, no flooding from neighbours above, and views. The informal "ne pervyi / ne poslednii" (not first / not last) rule therefore mixes security, damp and noise worries with roof and service risk.
- Sources: https://cyberleninka.ru/article/n/the-price-of-moscow-apartments ; https://www.reddit.com/r/AskARussian/comments/1o074dt/what_are_the_pros_and_cons_of_living_on_the_top_floor_of_an_apartment_building/

**Building type and material.** Brick buildings carried a premium over panel buildings in the 2003 model. A 2026 r/Moscow thread compared Stalinka (Stalin-era brick blocks) with "elite ZhK" (new gated complexes). Residents valued Stalinkas for thick brick walls (sound insulation, "sometimes 50 cm+"), larger rooms and central locations.
- Caveat: the opening image in that thread was AI-generated, so only the replies are useful evidence.
- Sources: https://cyberleninka.ru/article/n/the-price-of-moscow-apartments ; https://www.reddit.com/r/Moscow/comments/1rn1nzj/would_you_rather_own_an_elite_жк_apartment_in/

**Kitchen area.** Kitchen area adds more to price per m² than living area. The model's implied optimal kitchen share is 24.5% of total area, against an actual average of 15.9% in 2003. This reflects the kitchen's role in Russian household life.
- Source: https://cyberleninka.ru/article/n/the-price-of-moscow-apartments

### 1.2 Current valuation practice: hedonic indices from listings

The Gaidar Institute's July 2026 monitoring note (N. Fokin) builds a quality-adjusted index from **72,230 Moscow and Moscow-oblast resale listings**, June 2025 to June 2026. It uses CatBoost gradient boosting. The attribute set is effectively the market's own checklist:
- total and living area, number of rooms;
- floor, and number of storeys in the building;
- condition and type of renovation (remont);
- building material;
- administrative district, distance to the centre, distance to the nearest metro.

The note says the effects of area, floor, distance to centre and metro proximity are rarely linear and vary by segment. For example, metro proximity matters differently in Moscow city and the oblast, and the renovation premium depends on district, class and size.
- Comparable housing rose 11.9% in nominal terms and about 7.1% in real terms.
- Over the comparable period, Rosstat's aggregate resale index rose only about 1.2% in Moscow and 3.4% in the oblast. The author attributes the gap to changes in the mix of listings.
- Source: https://www.iep.ru/ru/doc/43893/hedonic-price-trends-for-the-secondary-housing-market-in-moscow-and-moscow-oblast-14-219-july-2026.pdf

### 1.3 New build vs resale, housing class, ipoteka

Russian Wikipedia's overview of the housing market says:
- **Classes.** The market is segmented into economy, comfort, business and premium/elite. Mass developers such as PIK and Samolet serve economy and comfort.
- **Primary vs secondary.** New builds (novostroiki) and resale (vtorichka) are treated as separate markets.
- **Mortgages drive new-build demand.** Mortgages funded a record **81%** of new-build purchases in 2023. Once broad subsidies ended, targeted state programmes made up **84.5%** of mortgage issuance by late 2024. These include Family Mortgage at 6% and Far East Mortgage at 2%, running to 2030.
- **Price gap.** In 2025 average Moscow primary prices rose 29% year on year to about 725,500 RUB/m², while resale prices were broadly stable.

So in Moscow, "new build vs resale" is a core search filter, not a minor attribute, and mortgage eligibility helps decide which side a buyer shops.
- Source: https://ru.wikipedia.org/wiki/Рынок_недвижимости_в_России

Residents add detail on class and finish:
- Large flats (4+ rooms) exist almost only in business or elite complexes, which carry higher maintenance and service charges.
- New-build units are often sold with a bare shell (chernovaya otdelka), which foreign buyers mistake for unfinished listings.
- Owners of large budgets typically buy a country house or dacha rather than a big city flat.
- Source: https://www.reddit.com/r/AskARussian/comments/1nnl9cm/how_much_cost_an_aparmenthouse_in_moscow_with/

### 1.4 Renting in Moscow

- An HSE St Petersburg guide (2023) names CIAN and Avito as the main search tools. CIAN supports searches by budget, layout, rental duration and pets.
- The same guide flags landlord discrimination: ads stating a preference for Russian citizens or "Slavic" tenants.
- Recommended lease contents are both parties' passports, the landlord's proof of ownership, and clarity on utilities.
- The agent commission level (often cited as 50–100% of a month's rent) appears only in search snippets and was **not verified**.
- Source: https://spb.hse.ru/soc/illuminated/news/880748598.html

---

## 2. Indian metros (Mumbai, Bengaluru, Delhi NCR)

### 2.1 Area definitions: carpet vs built-up vs super built-up

Area measurement is a primary, India-specific criterion because price per sq ft depends on which area is quoted.

**The 2026 r/IndianRealEstate thread** ("Should people pay based on carpet area", 33 comments) shows:
- Since RERA (Real Estate Regulation and Development Act, 2016), Maharashtra and Mumbai projects must be sold on **RERA carpet area**, published on the RERA site and in the sale agreement. Several posters say super built-up "doesn't exist anymore in Mumbai".
- Bengaluru and North India still market mainly on **super built-up area (SBUA)**.
- "Loading" (SBUA over carpet) is said to be about 25% in older projects and up to 30–50% in newer ones. That makes per-sq-ft prices hard to compare across projects.
- Disagreement: one camp wants carpet-only pricing. Another argues buyers need both numbers, because the carpet-to-SBUA ratio is itself the key comparison.
- Source: https://www.reddit.com/r/indianrealestate/comments/1uoc5vv/should_people_in_india_pay_appartment_based_on/

**Regulator guidance (snippet only, not read).** A June 2026 Business Standard article reports that UP RERA advised buyers to rely on carpet area. It notes that loading (e.g., 30% making 1,000 sq ft carpet into 1,300 SBUA) is not regulated by RERA.
- Source: https://www.business-standard.com/finance/personal-finance/buying-a-flat-up-rera-warns-against-relying-on-super-built-up-area-126061100362_1.html

### 2.2 Vastu: a priced secondary criterion, partly primary for resale

- **Builders charge for it.** A 2026 thread explains that builders add Vastu compliance (north or northeast facing, east entrance, southeast kitchen) to **Preferential Location Charges (PLC)**. PLC is a per-sq-ft premium alongside park-facing, higher-floor and corner units. On a ₹1.5 crore flat the poster puts this at ₹2–4 lakh, roughly 1.3–2.7%. The poster stresses there is no certifying body, so the builder decides which units qualify.
  - Replies are split. Practitioners say many builders apply the label loosely. Others say demand justifies the premium, and that "almost all new construction is Vastu compliant" anyway.
  - Source: https://www.reddit.com/r/indianrealestate/comments/1u6cwc9/vastu_is_being_used_by_builders_to_charge_you_more/
- **Resale is the real concern.** A Bengaluru buyer booked a cheaper **west-facing** 2BHK and argued that in modern towers balcony orientation, floor, setback distance and cross-ventilation matter more than door direction. The top reply (24 points) chose a west door specifically to get an east-facing balcony and morning sun.
  - Several replies stress resale risk: you buy west or south facing at a discount, but you "resell to a smaller pool of Vastu-conscious buyers". One owner of a Mumbai flat with toilets in the northeast plans only to rent it out or sell it, never to live in it.
  - So Vastu acts as a discount or premium on **liquidity**, not only on price.
  - Source: https://www.reddit.com/r/indianrealestate/comments/1utr5zu/i_booked_a_westfacing_flat_because_it_was_cheaper/
- **Unverified premium figures.** Industry FAQs claim premiums of 5–15% and faster resale, but these were seen only in search snippets.
  - Sources (snippet only): https://www.aurumproptech.in/pulse/faqs/how-does-vaastu-compliance-affect-apartment-pricing-in-india ; https://www.jllhomes.co.in/blogs/beyond-bricks-mortar-the-vaastu-factors-in-indian-homebuying

### 2.3 Water, sanitation and society services: primary in practice

**Hedonic evidence (World Bank, Karmali & Weng 2022, Policy Research WP 10031).** The paper uses NSS and IHDS rental microdata for urban India, 1993–2018.
- A 1% increase in floor area raises rent by only 0.33%.
- In the log-linear model, the largest premiums are electricity (+43.9%), a separate kitchen with water (+40.1%) and a flush toilet (+25.2%).
- The authors conclude that high income elasticity of housing demand is driven by demand for **improved water and sanitation bundled with housing**.
- In the 11 megacities, median value per sq ft is 2.5× the urban-India median and rent per sq ft is 46% higher. The implied rental capitalisation rate is only about 2.4%.
- Source: https://documents1.worldbank.org/curated/en/099342105022229388/pdf/IDU0ba4ed93c0c44a0485c09c6b046aabdec42dc.pdf

**Bengaluru lived experience (r/bangalore 2026, 29 comments).** A tenant in Byrathi paid for about 4 water tankers in 2 weeks. The landlord orders tankers only once every tenant has paid.
- The overwhelming advice was simply "move out" (118 points).
- Others describe pooled tanker or maintenance charges of about ₹800–₹2,000+ a month. Some landlords fold tanker costs into rent.
- Rainwater harvesting and the lack of municipal (Cauvery) supply recur as themes.
- Water source (municipal Cauvery supply vs borewell vs tanker) and how the society or landlord manages it are therefore **first-order rental criteria in Bengaluru**, with no London equivalent.
- Source: https://www.reddit.com/r/bangalore/comments/1wdfn0w/absolutely_no_water_whatsoever_paid_for_almost_4/

### 2.4 Affordability and supply (consultancy view)

An Anarock opinion piece (Santhosh Kumar, May 2026) argues that India's affordability crisis is about land economics, not total supply.
- Land and approval costs make up about 40% of project costs, against 15–20% historically.
- Affordable units fell from 26% of launches in 2021 to 17% in 2024.
- The supply-to-demand ratio fell from 1.05 in 2019 to 0.36 in 2025.
- Units under about ₹45 lakh in Mumbai or Bengaluru are viable only with subsidised land.

This explains why buyers trade location (outer periphery) against ticket size, the same trade-off London buyers make between zone and budget.
- Source: https://www.anarock.com/blogs/the-affordability-crisis-is-not-a-supply-problem-it-is-a-land-economics-problem

### 2.5 Portals and process (thin evidence)

MagicBricks, 99acres, NoBroker and Housing.com are the standard tools. NoBroker's pitch is avoiding brokerage, which is typically one month's rent; that figure was not verified this session. The RERA registration number is the main check on a builder's legitimacy. No portal filter documentation was read, because fetches were blocked.

---

## 3. Lagos

### 3.1 Up-front cost structure: the dominant renter criterion

- **The fee stack.** A Nairametrics analysis (2022) and a DiscoverLagos guide (Dec 2025) describe the same package on top of rent:
  - agency fee of about 10% (up to 20% on rents under ₦1m);
  - legal or agreement fee of about 10%;
  - caution deposit of 10–20%;
  - a service charge for security, waste, grid power and generator diesel.
- Together the fees can reach **about 50% of annual rent**, and rent itself is normally paid **1–2 years in advance**. Nairametrics reports rents up 20%+ in a year, with new units carrying 30%+ premiums.
- Sources: https://nairametrics.com/2022/09/26/how-surging-inflation-is-impacting-lagos-housing-market/ ; https://www.discoverlagos.ng/post/the-rental-market-nightmare-practical-tips-for-renting-in-high-demand-lagos-areas
- **Regulatory dispute (snippet only).** Lagos regulators describe caution, inspection and "finder's" fees as illegal. The LASRERA framework caps agency fees at 10%. Practice diverges from the rules.
  - Sources (snippet only): https://guardian.ng/property/lagos-urges-professionals-to-halt-illegal-agency-fees-rent-hike/ ; https://guardian.ng/features/how-agents-shut-young-people-out-of-affordable-housing-in-lagos-with-illegal-commissions/
- **Search costs.** Zikoko collected six house-hunting accounts:
  - inspection fees of ₦10,000–₦20,000 per agent, with one person paying about 15 agents;
  - about ₦60,000 lost on viewings of irrelevant properties;
  - a ₦400,000 commitment fee never refunded.
  - One hunter gave up on agents and walked neighbourhoods to find landlords directly.
  - Source: https://www.zikoko.com/?p=384051
- **Real-world example (r/Nigeria, 2026).** A studio rent of ₦5m became an ₦8.5m total package once agency and legal fees were added.
  - Source: https://www.reddit.com/r/Nigeria/comments/1v69644/theres_nothing_currently_as_demonic_as_a_lagos/

### 3.2 Physical and service criteria

- **What justifies a higher rent (r/Nigeria, 2026, 38 comments).** A tenant's rent jumped from ₦350k to ₦800k a year after the compound was sold. Comparable local units go for ₦450–500k. The tenant says higher rents are justified only by added value such as **a compound generator to pump water during outages**. Their own compound has serious drainage problems, "literally no security" and too few water tanks.
  - Replies cite case law (Udih v. Izedonmwen): a unilateral rise without a review clause is only an offer the tenant can refuse.
  - Others note there is no real rent control, and one gives a personal history of rent rising from ₦600k (2018) to ₦1.5m (2025).
  - Source: https://www.reddit.com/r/Nigeria/comments/1tyy62s/outrageous_increment_of_rent/
- **The three physical tests (DiscoverLagos).**
  - Visit after heavy rain to check flooding, a Lekki and Victoria Island problem.
  - Run the taps to check water quality ("Lekki-brown").
  - Ask neighbours how many hours of grid power they get.
  - The guide also says not to trust photos and to use verified portals (PrivateProperty, Nigeria Property Centre) or registered realtors.
  - Prime 2-bed rents in Victoria Island and Ikoyi are quoted at ₦2.5–5m a month.
  - Source: https://www.discoverlagos.ng/post/the-rental-market-nightmare-practical-tips-for-renting-in-high-demand-lagos-areas
- **Climate damage (academic).** Peter et al. (Frontiers in Sustainable Cities, 2024) surveyed 100 residents of Wemabod Estate, Ikeja.
  - 82% said climate change affects their homes; 51% said it affects rent.
  - Extreme heat and flooding are the main hazards, causing peeling paint, wall cracks, roof leaks and burst pipes.
  - The authors expect lower demand for affected areas and more reliance on power for cooling.
  - Source: https://public-pages-files-2025.frontiersin.org/journals/sustainable-cities/articles/10.3389/frsc.2024.1382386/pdf

### 3.3 Title documents (buyers)

Under Nigeria's Land Use Act 1978, all land is vested in the state. A **Certificate of Occupancy (C of O)** is a state-granted right of occupancy, typically for 99 years, not freehold ownership. Buyers therefore check the C of O, any later Governor's Consent and the remaining term. Title verification is a **primary purchase criterion in Lagos**, whereas in London it is handled routinely by conveyancers.
- Source: https://en.wikipedia.org/wiki/Certificate_of_occupancy_(land_tenure)

---

## 4. São Paulo

### 4.1 Price signals and portals

- **FipeZap index.** FipeZap is built from **asking prices** in OLX Group listings (ZAP, VivaReal, OLX). It covers up to 56 cities, with separate monthly sale and rent series, stratified by bedroom count (1, 2, 3, 4+), in price per m². It is the portal-derived benchmark Brazilian agents and owners quote.
  - Source: https://www.fipe.org.br/pt-br/indices/fipezap/
- **Buyer's view (r/saopaulo, 2026, 117 comments).** A buyer with R$350k cash wanted 2 bedrooms, 1 parking space and 40 m² or more in the Zona Sul. QuintoAndar and ZAP showed nearly everything starting at R$450–500k.
  - Replies say asking prices include negotiating "fat": offer R$300k on a R$400k listing.
  - Cash buyers get meaningful discounts, and drops of up to R$200k have been seen on houses.
  - A parking space alone can be worth R$50–70k.
  - Caixa financing can take 2–4 months.
  - Transaction taxes and fees add about R$30k.
  - Commenters suggest neighbourhoods near the metro (Aclimação, Saúde, Vila Mariana, Santa Cecília, Jabaquara).
  - Source: https://www.reddit.com/r/saopaulo/comments/1uqyev8/comprar_apartamento_em_sp_com_r_350_mil_à_vista/

### 4.2 Recurring costs: condomínio (and IPTU)

**Condo fee (r/saopaulo, 2026, 66 comments).** An owner of a 43 m² flat about 50 m from Parada Inglesa metro pays **R$700 a month**. The building has no pool or parking but has 24-hour concierge (portaria 24h), a gym and a laundry.
- Replies say this is normal and give comparisons: R$900 for 36 m² elsewhere, and about R$900 for 29 m² with a pool.
- What drives the fee: staff, 24-hour concierge, lifts, outsourced security, and the number of units sharing costs. Fewer towers and fewer units per floor mean higher fees.
- Advice: request the last 3 months of accounts and attend the owners' assemblies.

Condomínio fee plus IPTU (municipal property tax) are therefore standard search-and-compare fields. QuintoAndar and ZAP show them beside the rent, a total-cost-of-occupancy view similar to London service charge plus council tax.
- Source: https://www.reddit.com/r/saopaulo/comments/1tiiko1/meu_condomínio_é_caro_ou_tá_no_preço/

### 4.3 Floor, security and parking

- **Low floors (r/saopaulo, 2026, 84 comments).** A renter asked whether a ground-floor "garden" flat is a mistake. Replies overwhelmingly say yes: residents above throw rubbish, and worse, onto the garden; there is constant noise; and old buildings risk sewage backflow.
  - A minority report years without problems, and one notes that higher floors can carry more traffic noise.
  - This mirrors Moscow's first-floor discount, with security and nuisance as the shared mechanism.
  - Source: https://www.reddit.com/r/saopaulo/comments/1uvicl2/apartamento_em_andar_baixo_é_roubada/
- **Parking (r/saopaulo, 2026, 107 comments).** Under the master plan (Plano Diretor), new buildings near metro lines are often built without parking. Residents are split.
  - Many say they would not buy without a space, because public transport is crowded and the commuter rail (CPTM) is unreliable.
  - Others note that only luxury units elsewhere in the world come with parking.
  - So **parking (vaga)** remains a primary filter and value driver in São Paulo, unlike inner London.
  - Source: https://www.reddit.com/r/saopaulo/comments/1u1213u/dúvida_apartamentos_sem_vaga_de_garagem_no/

---

## 5. Mexico City

A Wise guide (updated Sept 2024) describes how people search:
- **Search channels:** walking neighbourhoods for "Se Renta" signs (called one of the best methods), Facebook groups, Trovit and Vivanuncios (often outdated), word of mouth, and agents.
- **Guarantor:** the main barrier is the **fiador**, who must own fully paid-off property in Mexico City. Alternatives are paid guarantor companies, or larger deposits on furnished units. The usual deposit is one month's rent.
- **Rents:** about MXN 18,100 for a central 1-bed and MXN 11,200 outside the centre.
- **Expat neighbourhoods:** Condesa, Roma, Polanco, Coyoacán and Juárez.
- **Checklist:** **earthquake safety documentation**, water pressure, hot water, noise, laundry, roof access, building condition and maintenance fees.

Seismic safety and water reliability are criteria with no London equivalent.
- Source: https://www.wise.com/us/blog/renting-in-mexico-city

---

## 6. Primary vs secondary criteria across this stream

**Primary everywhere:**
- price or ticket size;
- size, but **measured differently**: m² total and kitchen in Moscow, carpet vs SBUA in India, m² and bedrooms in São Paulo (FipeZap stratifies by bedrooms);
- location expressed as **transit access** (minutes to metro in Moscow, metro proximity in São Paulo) or commute.

**Primary and city-specific:**
- **Moscow:** new build vs resale, and mortgage-programme eligibility; floor (not first, not last); building type (brick/monolith vs panel); housing class (economy, comfort, business, elite); renovation condition.
- **India:** carpet area and loading; RERA registration; water source and supply; society maintenance and management; Vastu for resale liquidity.
- **Lagos:**
  - up-front fees (agency, legal, caution) and paying 1–2 years in advance;
  - power (grid hours, generator);
  - water (borehole, tanks, quality);
  - flooding and drainage;
  - estate security;
  - title documents (C of O, Governor's Consent);
  - agent trustworthiness.
- **São Paulo:** condomínio fee and IPTU; parking space; floor and security; portaria 24h.
- **Mexico City:** fiador or guarantor; seismic safety; water pressure.

**Secondary:**
- views and orientation (also tied to Vastu in India);
- amenities (pool, gym) — in São Paulo these mainly show up through the condo fee;
- balcony;
- pets policy.

**Valuation practice.** Moscow analysts now value from large listing datasets with machine-learning hedonic models, and a portal-derived index (FipeZap) is the São Paulo reference. In both cities the reference value is built from asking prices, not completed sales. In Lagos and much of India, price discovery is informal and agent-mediated, and asking prices carry a large negotiating margin. São Paulo commenters suggest 15–25% below asking.

**Disagreements and uncertainty.**
- Whether Vastu premiums are real value or builder rent-seeking; forum posters are split.
- Whether carpet-only pricing helps buyers.
- Whether parking-free transit-oriented development suits São Paulo.
- Whether official indices (Rosstat) or listing-based hedonic indices better describe Moscow prices; they differed by about 10 points in 2025–26.
