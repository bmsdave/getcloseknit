# Proptech Research Report — Housing Search, Data, Agents, Prices
## UK/London-first; Germany, US, other Europe, India compared
**Research date:** 2026-09-06. **Purpose:** evidence base for a London-first area-analysis property app (goal: build-a-proptech-startup, stage: "research existing applications and market approaches").

### Evidence discipline
Every claim below cites a real source: [type: file path — support degree]. Support degrees used: **fully confirms** (primary source read, claim verified), **partially supports** (transfer across countries/contexts, snippet-level, or secondary citation), **anecdotal** (forum posts — used for triangulation only), **disputed** (contested claims). Where workers found no data, the report says **"no data found"** — nothing is invented.
**Corpus:** 41 genuine papers/analytic notes + 16 structured app notes + 35 forum threads = 92 evidence files under `hidden_files/proptech-research/sources/` (papers/, threads/). Coverage: UK/London primary; Germany, France, Netherlands, Sweden, Spain, Ireland, US, India secondary.
**Known method limits:** reddit.com was blocked for direct retrieval on 2026-09-06 (workers instructed not to retry via curl), so UK forum evidence comes from MoneySavingExpert, Mumsnet and PistonHeads; some Reddit-sourced evidence is secondary-citation and graded accordingly. A minority of paper notes rest on abstract/snippet-level retrieval and are graded partially supports.

---

## Q1. How people search for houses (buy vs rent)

### 1.1 Buy-side funnel — England/London
The relocation literature gives a 3-stage frame: (1) the voluntary decision to move, driven by residential stress / consumption disequilibrium (mismatch between actual and desired housing); (2) residential *search*; (3) *choice* of a new home — a framework explicitly built to diagnose "unwise mobility decisions", i.e. comparing observed choices against theoretically-best ones [paper: `sources/papers/A-09-stress-resistance-moving-home-phipps.md` — fully confirms].

Thread-level London evidence shows stages are **iterative, not linear**, and homes are searched through two lenses — neighbourhood characteristics and individual properties — with property perceptions framed by neighbourhood perceptions [paper: `sources/papers/A-04-homebuyers-spatial-markets-information-providers.md` — fully confirms; conceptual, UK portal examples]:

1. **Trigger.** Residential stress (space mismatch, life events) starts the move [A-09 — fully confirms]. Thread buyers often buy under pressure — pregnancy, job relocation — which later predicts regret [thread: `sources/threads/A-10-mumsnet-regretted-house-purchase.md` — anecdotal].
2. **Area shortlist.** A London FTB used three primary filters — **work commute** (Westminster office, in-office 3–4 days/week), **transport links**, **budget** — then evaluated zone (3 vs 4), green space, gentrification trajectory ("up and coming"), and hyper-local nuisances ("what would it be like to live around there on match days?") [thread: `sources/threads/A-03-mse-area-choice-tooting-south-norwood.md` — anecdotal]. Desired attributes named: "green space, markets, diversity, independent shops" [thread: `sources/threads/A-04-mumsnet-ftb-overwhelmed-london.md` — anecdotal]. A cited survey finding: ~75% of buyers physically visit candidate areas (DriveBuy survey, secondary citation in A-03 — anecdotal).
3. **Portal search.** Rightmove, Zoopla, PrimeLocation, home.co.uk have displaced much estate-agent intermediation [A-04 — fully confirms]. Portals use **binary, hard-boundary filters** (price/size/area cut-offs) while agents can "interpret, extrapolate and in some cases refine" fuzzy preferences — rigid portal filters can systematically exclude suitable homes [A-04 — fully confirms].
4. **Viewings.** Major time cost: one FTB reported two viewings in a day — "an hour and 15 from us", then "another hour and a half from that one. Neither of them were nice and they were at our max budgets" [A-04 thread — anecdotal]. Agent pressure tactics: "several calls during working hours encouraging us to view ASAP" [same — anecdotal].
5. **Offer/negotiation.** "Best and final" sealed bidding is a known pressure point. Community norms: bid "an amount that... isn't so much more that it will cause me sleepless nights"; **price is not the only criterion** — "neighbours turned down an offer 25% over asking because they didn't have confidence in the buyer's ability or commitment"; sellers won "based on our short chain"; cash/fast completion won at equal offers [thread: `sources/threads/A-07-pistonheads-best-and-final.md` — anecdotal]. Anti-emotion discipline: "Put the bid in at an amount that they think represents value to them. Trying to second guess what the vendor or other potential buyers might do is a rabbit hole to avoid" [same — anecdotal].
6. **Survey / due diligence.** An FTB commissioned a full building survey, then paid £240 for an *independent* damp survey (deliberately non-contractor, to avoid sales bias), got 3 quotes, and renegotiated £5,000 off [thread: `sources/threads/A-06-mse-damp-survey-renegotiation.md` — anecdotal]. Under-budget buyers skimp: "I got the most basic valuation survey as money was so tight, then spent months obsessing over a crack in the ceiling" [thread: `sources/threads/A-02-mumsnet-regret-buying-house-survey.md` — anecdotal]. Even full surveys don't remove surprise risk: one poster "had the bells and whistles one AND a specialist structural one" yet found the house "coming away at the seams" [same — anecdotal]. London-specific: clay soils move seasonally — "Old houses always have some cracks in plaster work, especially in London where they are on clay" [same — anecdotal].
7. **Conveyancing.** Leasehold enquiries can stall a London purchase **2+ months**: a management company (FirstPort) "do not reply to the sellers solicitor", bouncing responsibility to an uncontactable freeholder; the buyer paid £500 deposit + owed £2.3k, "extremely stressed and even thinking of pulling out" [thread: `sources/threads/A-05-mse-management-company-leasehold.md` — anecdotal]. Consistent with HomeOwners Alliance (cited in thread file): 10% of Londoners regret buying leasehold vs 4% nationally [anecdotal/secondary].

**Timeframes — mostly no data.** Documented: 2+ months stuck on leasehold enquiries post-offer [A-05 thread — anecdotal]; regret anecdotes span 5 years of ownership, sale within 12 months, and 4-year regrets [threads A-01, A-10 — anecdotal]. **No data found** in the corpus for robust funnel timeframes (active search duration, viewings count, offer-to-completion timelines).

### 1.2 Buy vs rent — how searches differ
- **Information environment:** online platforms (Craigslist in the US study) are now *central* to rental search, but "supply significantly different volumes, quality, and types of information in different communities" — searchers in some areas decide on thinner information [paper: `sources/papers/A-03-housing-search-age-of-big-data.md` — fully confirms; transfer to Rightmove/Zoopla listing-quality heterogeneity — partially supports].
- **Rent-first as information strategy:** households moving ≥50 miles are 5.5pp less likely to own their next home, because destination-market information quality falls with distance (Survey of English Housing 1993–2008, England) [paper: `sources/papers/A-02-long-distance-moves-homeownership-england.md` — fully confirms]. Long-distance movers are aware of the gap and more likely, especially renters, to move again quickly "after presumably having accrued better information on the property and local area" [A-02 — fully confirms]. Implication: renting first in an unfamiliar market is a rational information-compensation move.
- **Negotiation norms (rent):** in a hot market "landlords never agree to take an offer on the rent. It is not like buying a house" — asking was norm-violating ("Don't embarrass yourself"); negotiation only worked on stale listings [thread: `sources/threads/A-08-mumsnet-rental-budget-negotiation.md` — anecdotal, 33 replies, Central London + regional mix].
- **Speed/competition (rent):** "up to 50 applicants to every property in my area" / "roughly 20 applicants per flat"; renters must decide within days ("It goes in a day or two") [A-08 — anecdotal]. Market segmentation: stagnant top-end Central London ("some places... around £3500 per month are not moving") vs overheated provincial markets; days-on-market is the negotiation signal [same — anecdotal].
- **Regret by tenure:** 56% of renters vs 50% of homeowners regret something about their current home or the choosing process (Trulia/Kolko survey, cited US n=2,264) [paper: `sources/papers/A-11-regret-factors-buy-rent-decisions.md` — fully confirms as cited statistic].
- **Germany contrast:** rental search is application warfare — hundreds of messages, "never get a reply" without a premium ImmoScout24 account, Telegram bots and 15k–125k-member Facebook groups for speed [threads: `sources/threads/D-T2-expat-munich-apartments.md`, `D-T3-r-berlin-apartment-search-threads.md` — D-T2 fully confirms, D-T3 secondary-citation/partially supports]; one r/wohnen thread documents ~600 applications for a single flat [thread: `sources/threads/D-T5-r-wohnen-600-applications.md` — secondary-citation/partially supports].
- **US contrast:** consumers self-serve via portal alerts; the agent's search role is widely seen as displaced — "My agent would call days after the property came on the market. I set up notifications on Redfin and was getting instant notifications" [thread: `sources/threads/E-T02-hn-commissions-chopping-block.md` — anecdotal].

### 1.3 Information sought at each stage
- **Area shortlist:** commute, transport links, budget (hard filters); zone, green space, gentrification trajectory, hyper-local nuisances [A-03 — anecdotal].
- **Portal/property search:** attributes via rigid filters (price, size, area boundaries) [A-04 — fully confirms]; listing quality varies by neighbourhood [A-03 — partially supports].
- **Viewings:** condition in person; area feel — but "when we viewed it seemed quiet and fine" ≠ 5-year reality [thread: `sources/threads/A-01-mumsnet-council-estate-regret.md` — anecdotal].
- **Due diligence:** structural/damp/defects via survey; drain surveys for rat risk [A-10 — anecdotal]; crack monitoring via "tell tales" [A-02 — anecdotal].
- **Conveyancing:** leasehold enquiries, management-company/freeholder responsibilities [A-05, A-06 — anecdotal].
- **Neighbourhood-information gap (quantified):** 44% of homeowners have regrets due to poor quality or lack of information; 9% of parents of children <18 (vs 6% with older children) wished they had more neighbourhood information; 13% of parents of school-aged children wished they had chosen a neighbourhood with better schools (Trulia survey via A-11 — fully confirms as cited statistics).

### 1.4 Top pain points (London/UK first)
1. **Area-knowledge gap:** "there's so many areas of london that I've never been to before and it's impossible to know what they're all like" [A-04 — anecdotal]; information cost falls with distance from familiar areas [A-02 — fully confirms; A-04 — fully confirms].
2. **Viewing logistics/time:** cross-London travel between scattered viewings [A-04 — anecdotal].
3. **Agent pressure and opacity:** "view ASAP" calls [A-04]; unverifiable "best and final" competing-buyer claims [A-07]; pressure to exchange despite unresolved issues [A-06] — all anecdotal.
4. **Complicated process:** 20% of homebuyers regret some aspect of the buying process; 49% would do something differently; 38% wished they had a better grasp on the process (US surveys via A-11 — fully confirms as cited statistics).
5. **Survey/due-diligence anxiety:** skimping under budget pressure, then months of anxiety over minor defects [A-02 — anecdotal]; inspection is one of A-11's 8 regret factors.
6. **Conveyancing stalls, esp. leasehold:** 2+ month management-company stalls; £2.8k sunk pre-exchange [A-05 — anecdotal].
7. **Compromise pressure under competition:** "Should we wait and only view properties that are amazing? Or is it so competitive that we should just take what we get?" [A-04 — anecdotal].
8. **Renters:** 20–50 applicants per listing, days to decide, no-negotiation norm in hot markets [A-08 — anecdotal].

---

## Q2. Data landscape — what exists, what's open, what's agent-only

### 2.1 UK datasets (app-replicable, no agent needed)

| Dataset | Access / licence | Key fields / notes | Evidence |
|---|---|---|---|
| **HMLR Price Paid Data** | Open, OGL v3.0, monthly bulk CSV from 1995, >25M records | price, date, postcode, property type, new-build flag, **tenure (freehold/leasehold)**, address parts, category | gov.uk guidance https://www.gov.uk/guidance/about-the-price-paid-data — fully confirms. NEW (Aug 2026): HMLR added a UPRN→title-number lookup table to PPD, available from 28 Aug via public data channels — https://todaysconveyancer.co.uk/hmlr-adds-property-identifiers-to-price-paid-data/ (2026-09-04) — fully confirms |
| **EPC register** | Open, OGL v3.0, free for commercial use; bulk CSV (~25–30M records, monthly) + API at epc.opendatacommunities.org; new bulk service requires GOV.UK One Login bearer token | Energy rating (A–G), points, floor area, glazing, heating, CO₂, improvement recommendations | MHCLG Digital blog 2024-01-29; GitHub ingestion guides — fully/partially confirms. Caveat: Display Energy Certificate (non-domestic) data is NOT openly licensed (Royal Mail IP) — data.gov.uk — fully confirms |
| **ONS UK House Price Index** | Monthly on GOV.UK, CSV downloads + interactive tool; latest June 2026 published 19 Aug 2026 | Joint HMLR+ONS+Registers of Scotland+LPS NI; built on PPD + VOA data (VOA feed is **not** public) | https://www.gov.uk/government/statistics/uk-house-price-index-for-june-2026 — fully confirms |
| **HMRC SDLT statistics** | Quarterly Excel/PDF | Breakdowns by local authority / parliamentary constituency; HRAD surcharge 3%→5% from 31 Oct 2024 | gov.uk quarterly SDLT commentary — fully confirms |
| **police.uk crime** | Open REST API + bulk monthly CSV, no auth, OGL v3 | Street-level crime by category, monthly | https://data.police.uk/docs/ — fully confirms |
| **DfE school performance** | Explore Education Statistics catalogue: CSV/ZIP + documented GET/POST API | Attainment, Ofsted, absence | explore-education-statistics.service.gov.uk — partially supports (licence wording not restated in retrieved excerpt) |
| **EA flood risk** | Defra Data Services Platform: WMS, WFS, OGC Features API + downloads (GDB/GeoJSON/GPKG/SHP) | Flood zones 2/3, surface water, reservoirs | environment.data.gov.uk — fully confirms access methods; partially on exact licence |
| **TfL PTAL / WebCAT** | Public viewer; location CSV download | Walk time + service wait time → PTAL score | tfl.gov.uk WebCAT — partially supports (reuse terms not confirmed as OGL) |
| **Planning registers** | Every LPA must keep a register "available for inspection by the public at all reasonable hours" (TCPA 1990 s.69) | Applications, decisions, appeals | legislation.gov.uk — fully confirms. **No national planning API found — no data found** |
| **Council tax** | Only aggregate "Stock of Properties" statistics open; **per-address VOA attributes are effectively closed** (CRCA 2005) | — | gov.uk VOA quality-assurance page — fully confirms |

PPD × EPC linkage is feasible at scale: a 4-stage linkage achieved **79% coverage, 5.73M transactions** [paper: `sources/papers/B-03-chi-attribute-linked-price-dataset.md` — fully confirms].

### 2.2 Paid / account-gated (no agent needed, not open)
- **HMLR title register/plan:** official copy or inspection **£7 digital / £11 post** since 9 Dec 2024 (was £3; first rise in a decade). Business Gateway API is certificate-gated for business customers [gov.uk fees guidance — fully confirms].
- **OS data (address/UPRN geocoding):** OS Data Hub premium tiers exist (e.g. ~£250/month per 100k transactions per secondary source); OS OpenData free [secondary — partially supports].

### 2.3 Agent-only / closed (genuine gates)
- **Rightmove:** membership requires evidence the customer "performs actual estate-agency services"; no public API/open data; Rightmove Plus analytics included in membership with negotiated pricing [The Negotiator; Property Solvers; ExpertAgent; Emoov — fully confirms gating]. Rightmove's sold-price pages are HMLR-derived (Rightmove FAQ) — the underlying data is open; the presentation isn't.
- **Zoopla:** legacy public listings API retired; integration is membership/customer gated, OAuth not self-serve [github.com/api-evangelist/zoopla — fully confirms]. Academic alternative: UBDC Zoopla dataset restricted to UK academics, non-commercial social-science research, explicitly **excluding** commercial proptech uses [researchdata.gla.ac.uk/1914 — fully confirms].
- **OnTheMarket:** no public developer API; member-only RTDF feed via agency CRM vendors [github.com/api-evangelist/onthemarket — fully confirms].
- **Proprietary moat:** historical asking-price changes, listing photos/floor plans, buyer lead/CRM data — none available as open data [B-file notes — fully confirms gating].

### 2.4 Other countries (comparative)
- **US:** MLS databases are **agent-only by NAR rule** — "Access to MLS databases… may not be provided to any person or entity not expressly authorized"; IDX feeds allow only limited display; VOW access requires an established broker-client relationship [analytic note: `sources/threads/E-A01-data-sources-us-india.md` — fully confirms]. Public/open: county assessor records, Census/ACS, Zillow's aggregate ZHVI/ZORI. Research-grade MLS microdata via commercial vendors only (e.g. 653,475-listing sample in Barwick/Pathak/Wong). Redfin/Zillow API licensing terms, FEMA/GreatSchools/Walk Score access status — **no data found**.
- **Germany:** listing data is **asking prices only, not transactions**; Gutachterausschuss transaction data exists but is fragmented by state — **no official national source retrieved — no data found**. Structurally weaker than the UK for an app builder [D-file notes: `sources/papers/D-01-stoll-commission-reform.md` — partially supports for the data claims].
- **France:** **DVF open since 2019** — nationwide official transaction data, far more consumer-accessible than Germany's fragmented system [paper: `sources/papers/D-07-france-open-data.md` — partially supports for data details; ownership findings fully confirm].
- **India:** public: state RERA portals — MahaRERA publishes registered projects, sanctioned plans, quarterly booking/status updates "available online for citizens" [fully confirms]; RBI HPI (10 cities, registration data) and NHB RESIDEX (26 cities, bank/HFC data) are public but lagged, population-weighted, and frequently divergent [paper: `sources/papers/E-05-india-hpi-forecast-models.md` — fully confirms]. Digitized records in pockets: Bangalore e-khata for ₹125, encumbrance certificates via Karnataka's Kaveri portal [thread: `sources/threads/E-T05-team-bhp-property-thread.md` — anecdotal]. Agent-only/proprietary: 99acres/MagicBricks/NoBroker databases; **transaction-level registrar prices are not open** [partially supports; exact access rules — no data found]. Circle/guidance rates published by state departments but freshness/URLs — **no data found**.
- **Netherlands / Sweden / Spain / Ireland:** only commission-level data retrieved (NL 1–2%; Sweden 1.5–4.5% bands seller-pays; Spain 4–6% seller-pays; Ireland 1–2.5% statutory Bestellerprinzip) — [paper: `sources/papers/D-08-bundestag-commission-comparison.md` — fully confirms as institutional claims; no threads/papers on search behaviour or data — gaps].

---

## Q3. Decision support — what helps people make the best decision

### 3.1 What predicts satisfaction vs regret (buyer's remorse studies)
**A. Satisfaction structure (SEM, off-plan apartments, France — Andrew & Larceneux 2019).** Buyer evaluations are "cognitively dominated by the assessment of utilitarian benefits but emotion plays a significant role". Standardized estimates for homebuyers: **perceived quality 0.494** (largest; 0.308 for investors) > perceived financial value 0.267 (0.417 for investors — matters more to them) > perceived emotion value 0.216; perceived **social value is statistically insignificant**; psychological measures influence decisions *via* satisfaction. **Purchase price has no direct effect on satisfaction** — it works indirectly through a negative influence on perceived quality value (overpaying registers as dissatisfaction only if it reframes quality perception) [paper: `sources/papers/A-05-emotion-housing-purchase-satisfaction-france.md` — fully confirms; France off-plan context limits transfer to UK resale].

**B. Affective-forecasting error (SOEP long panel, Germany — Odermatt & Stutzer).** Moving via property purchase raises life satisfaction on average, BUT buyers "for whom the purchase of the home is a main reason for moving, on average, **systematically overestimate the long-term satisfaction gain**" — inaccurate both just before and just after the move. The misprediction "is driven by home buyers who follow **extrinsically-oriented life goals**" (income, success, buying power); intrinsic-goal buyers show no significant errors; not explained by socio-demographics. Errors also occur for rented moves but are "substantially smaller" — the error is about the *purchase*, not just the move [paper: `sources/papers/A-10-biased-beliefs-homeownership-soep.md` — fully confirms; Germany transfer with caution].

**C. Price regret via false reference points (US survey experiment — Seiler et al. 2008).** Regret is driven by comparison against a **"false reference point"** — a foregone all-time price high learned only in hindsight. **Significantly higher regret when they had actively failed to sell at the all-time high (commission) than when unaware of the gain (omission)**; women more susceptible. Price regret is a major remorse channel separable from property-quality regret [paper: `sources/papers/A-01-regret-aversion-false-reference-points.md` — fully/partially confirms; hypothetical-investment scenario, transfer to owner-occupied is partial].

**D. Eight regret factors (meta-synthesis of 118 articles 2010–2019 — Ullah & Sepasgozar 2020):** (1) not enough information, (2) complicated buy/sell process, (3) house size, (4) housing costs, (5) mortgage, (6) emotion, (7) agents, (8) inspection [paper: `sources/papers/A-11-regret-factors-buy-rent-decisions.md` — fully confirms]. Cited survey stats (US, thematic not single-sample — fully confirms as cited statistics): 44% of homeowners have regrets due to poor quality/lack of information; 20% regret some aspect of the buying process; 49% would do something differently; 57% of millennials / 61% of Gen X vs 38% of baby boomers report regrets; 42% picked a place too large (9%) or too small (33%); 62% wished homes were bigger or laid out differently; 21% wish they had shopped around more; "lack of effort in decision accounted for large part of cases concerning housing regret (45%)"; 16% would do more research on the process; 55% wished they had bought sooner. 25% of decision regrets relate to neighbourhood information, parking/transport, renovation ambitions, price, and lenders' requirements [partially supports].

**E. Thread-ranked regret drivers (London/UK, selection-biased, anecdotal — "Have you ever regretted a house purchase?", 20 replies):**
1. **Neighbours #1** — "Neighbours seem to be the biggest issue, or their dog/s"; "Nuisance neighbours can really wreck your mental health, its like you're constantly on edge"; "Lovely house, horrendous (attached) neighbours, we lasted 4 years".
2. **Unfamiliar area / crime / schools** — "Chosen by my husband, due to relocation... I never saw it in person. Cried the day we moved in, still hate it 4 years on"; "moved 400 miles for work... It was a high crime area"; "Area was deprived, school was backward... sold within 12 months". Corroborates A-02's information-cost finding.
3. **Hidden defects invisible at survey** — rats after moving in ("drain surveys, drain repair"); lesson: "a thorough drain survey before purchase in future".
4. **Buying under pressure** — "I launched into that with more optimism than sense"; "I was pregnant and it did the job".
5. **Neighbourhood latent issues (single-poster depth):** viewed quiet/fine; 5 years later "absolutely hate it to the point where it's making me ill" — teenagers all night, fly-tipping, regular police visits, weed smoke in the baby's nursery; **trapped by illiquidity** — identical house "next door but one has been on the market for well over a year despite being nice and a bargain".
6. **"Ticks all the boxes" but never felt like home** — functional criteria met while emotional fit fails.
7. **Belated school regret** — "Main reason apart from the house itself was the school".
[`sources/threads/A-10-mumsnet-regretted-house-purchase.md` + `A-01-mumsnet-council-estate-regret.md` — all anecdotal]

### 3.2 Ranked decision criteria, especially for London
**Revealed willingness-to-pay (US boundary-discontinuity, Bayer et al., JPE 2007):** households pay **<1% more for a 5% increase in average local school performance** — substantially lower than prior estimates; full capitalisation of school quality is **70–75% greater** than the direct effect via a "social multiplier"; much apparent willingness-to-pay for educated/wealthier neighbours is explained by correlation with *unobserved neighbourhood quality* — **"neighbourhood quality" as a bundle matters more than sociodemographics per se**; considerable preference heterogeneity and self-segregation [paper: `sources/papers/A-06-willingness-to-pay-schools-neighborhoods.md` — fully confirms; US metro transfer caution; UK school-catchment premiums documented in separate literature but no data found in A-files].

**Neighbourhood satisfaction drivers (Franklin County, Ohio — Hur & Morrow-Jones 2008):** criteria are **context-dependent**: "There is no specific set of characteristics nor any standard rule" [paper: `sources/papers/A-07-neighborhood-satisfaction-factors-hur.md` — fully confirms, press-summary-based]. In **unsatisfactory** neighbourhoods: safety from crime (**3.7× more important** to overall satisfaction than in satisfactory areas), proximity to known problem areas, traffic. In **satisfactory** neighbourhoods: general appearance, recreational opportunities, police/fire services, social interaction with neighbours. School quality was explicitly not studied — no data there.

**London thread criterion stack (stated, anecdotal):** 1) commute → transport links → budget (hard filters); 2) zone centrality, green spaces, gentrification trajectory ("up and coming"); 3) hyper-local nuisances (match-day noise/crowds, traffic); 4) street-level, not town-level: "If you picked up our house and put it on the street behind us you'd raise the price by around £100k basically and it would be sold within a week" [threads A-03, A-04, A-01 — anecdotal].

### 3.3 What actually helps people decide (evidenced decision aids)
1. **Information quality is the first-order lever.** A-02: information quality about destination (property + neighbourhood) is a first-order determinant of purchase quality/satisfaction; buyers compensate by renting first rather than buying blind [partially supports interpretation]. A-11 authors: digital tools "can help mitigate most of these regrets" (authors' conclusion — partially supports).
2. **Rent first in unfamiliar markets** — behavioural pattern documented in A-02 [fully confirms].
3. **Independent surveys + multiple quotes:** non-contractor damp survey (£240), 3 quotes, used to renegotiate £5,000 off — the funnel's "information injection" [A-06 thread — anecdotal].
4. **Community/practical knowledge:** "tell tales" crack monitors; "cracks thinner than a 5p piece aren't worth worrying about"; London clay moves seasonally [A-02 thread — anecdotal].
5. **Offer discipline:** bid what represents value to you; don't second-guess vendors/other bidders; walk away at your ceiling — an anti-emotion/regret hedge [A-07 thread — anecdotal; relates to A-01 false-reference-point and A-11 emotion factors].
6. **Fuzzy-preference search beats rigid filters:** agents "interpret, extrapolate and in some cases refine" preferences vs portals' hard boundaries that hide suitable homes — implies "search outside the portal" as an aid [A-04 — fully confirms mechanism; behavioural implication partially supports].
7. **Drain surveys** as a pre-purchase check against rat infestations [A-10 thread — anecdotal].
8. **Decision-quality framing (theoretical):** operationalise regret as the gap between the chosen home and the theoretically-best home given the household's own utilitarian stressors — Phipps' "unwise mobility decision" diagnostic [A-09 — fully confirms framework; proptech-metric application partially supports].

---

## Q4. The estate/letting agent's role in the UK value chain

### 4.1 What agents actually do
1. **Valuation/pricing** from local comparables + qualitative property knowledge. The information edge is real — but so is the incentive conflict: agents' own homes sold **~3.7% higher** and stayed listed **9.5 days longer** than clients' [paper: `sources/papers/B-01-levitt-syverson-agent-information-advantage.md` — partially supports for UK (US study)].
2. **Listing preparation:** photography, copy, EPC/property-information compliance. Quality varies both ways — one high-street agent reused an old blurb with factual errors [thread: `sources/threads/B-04-mumsnet-purplebricks.md` — anecdotal].
3. **Portal publication** — the hard gate: Rightmove/Zoopla/OTM access requires agency membership [Q2.3 evidence]. DIY route exists via online agents (£100 + £40/month example [thread: `sources/threads/B-03-mse-putting-house-up-for-sale.md` — anecdotal]; Doorsteps £250–499 in 2022 [thread: `sources/threads/B-05-mumsnet-online-estate-agents.md` — anecdotal]).
4. **Buyer screening/vetting** — failure point for online agents (eMoov case: buyer pulled out after 4 months, couldn't get mortgage) [B-05 thread — anecdotal].
5. **Viewings** — self-doable; sellers often prefer doing them [B-05 — anecdotal].
6. **Negotiation** — genuine skill, but incentive misalignment is documented: Purplebricks pressured a seller to accept £295k vs £315k asking; seller held out for £310k [B-05 — anecdotal]; academic conflict evidence in B-01.
7. **Sales progression / chain chasing** — the most consistently cited human value-add: a local agent described as a "Rottweiler" who "pushed & pushed it through to completion"; PB's "postsale support team are just a call center" [B-05 — anecdotal]. Experience drives sale probability, especially in weak markets [paper: `sources/papers/B-05-gilbukh-goldsmith-pinkham-heterogeneous-agents.md` — fully confirms; 8.5M listings].
8. **Lettings:** tenant finding, referencing, compliance, rent collection, management — regulated by the Tenant Fees Act 2019.

### 4.2 Fee structures (sourced)
- **Sales (traditional):** average **1.42% incl. VAT**, range 0.9–3.6% (2014–2018 sample); online fixed fee ~**£1,000** upfront in the same period. At £231k average price: traditional ≈ £3,280 vs online ≈ £1,000 [paper: `sources/papers/B-02-gedikli-online-agencies-housing-market.md` — fully confirms, period caveat]. Online agents cut time-on-market by ~80 days (IV) at a −2.4% sale/list discount [same — fully confirms].
- **Sales (online, anecdotal):** Doorsteps £250 (then £499) in 2022 [B-05 thread — anecdotal]; £100 + £40/month [B-03 thread — anecdotal]. 17% of sellers didn't use a traditional agent (10% private sale, 5% online agent, 1% auction); chain sellers were more worried about communication without a traditional agent (26% vs 15%) [DCLG/BEIS 2018 "Buying and selling homes" research — fully confirms].
- **Lettings:** Tenant Fees Act (June 2019) capped tenant payments at £50; saved renters **£376–400 per tenancy**; agents absorbed ~70%, landlords ~30%; **no rent increase, no agent/landlord exit** over ~5 years [paper: `sources/papers/B-04-bakker-datta-tenant-fees-act.md` — fully confirms]. Full-management letting fees 8–15% seen in a secondary source — **not independently verified, partially supports**.
- **Current (2025–2026) traditional commission rates — no data found** (only 2014–2018 study figures).

### 4.3 Can the agent be replaced/augmented? What can be done without an agent?
- **Genuinely agent-gated:** portal memberships/feeds and agent analytics (Rightmove/Zoopla/OTM); VOA per-address attributes; HMLR Business Gateway (certificate-gated); proprietary listing history, photos, asking-price changes, buyer leads [Q2.3 — fully confirms].
- **App-replicable today:** valuation models on PPD + UK HPI + EPC (79% linkage achievable — B-03); listing creation; viewing booking; offer workflows; chain tracking; compliance reminders. Private sale is legal; a solicitor can handle transfer directly once a buyer is found [thread: `sources/threads/B-02-mse-estate-agent-or-solicitor.md` — anecdotal, UK law].
- **Operationally hard to replicate (not legally gated):** buyer vetting, negotiation, chain rescue, emotional buffering — threads consistently show this is where online/DIY models fail; papers show experience drives sale probability, especially in downturns [B-05 paper + B-05 thread].
- Bottom line: **data is mostly replicable; the human parts that survive are negotiation, vetting, and chain progression** — the app's wedge is pre-decision analytics (where portals under-serve), not replacing the transaction.

### 4.4 Country comparisons — agent role
- **US:** ~2–3% buyer-side commission paid from the seller's check, agent keeps 50–95% [thread: `sources/threads/E-T03-bogleheads-buyer-agent-fees.md` — fully confirms as reported norm]. A licensed agent concedes: "I don't believe I am worth the $10–15k I receive on a purchase like yours" [same — direct quote]. Near-uniform commissions create agency conflicts; unbundling lowers transaction costs without changing prices [paper: `sources/papers/E-04-realtor-commission-puzzle.md` — fully confirms]. Post-NAR-settlement (Aug 2024): **no meaningful change** in negotiation, commission rates, or decoupling in the first ~18 months [paper: `sources/papers/E-03-nar-settlement-negotiation-barriers.md` — partially supports, preregistered]. Commission framing suppresses buyer negotiation via salience/denominator bias [same — partially supports]. Solo (unrepresented) buyers pay **1.8–2.2% less** [same — partially supports, verify comparison group before headlining].
- **Germany:** rental Bestellerprinzip since 2015 (tenant pays 0 if landlord commissioned the agent; otherwise max 2 months' cold rent + VAT). Dec 2020 purchase reform (buyer pays ≤50%) **backfired**: commissions rose up to 2pp, +€6,000 on average, 85% of sellers don't negotiate [paper: `sources/papers/D-01-stoll-commission-reform.md` — fully confirms]. UK commissions ~1–1.6% vs Germany up to 7.14% — structurally ~5–7× higher friction [paper: `sources/papers/D-08-bundestag-commission-comparison.md` — fully confirms institutional claims, 2018]. Broker incentive misalignment appears in rentals too (NoBroker RMs pushing sellers to under-quote to close fast) [thread: `sources/threads/E-T05-team-bhp-property-thread.md` — anecdotal].
- **India:** brokers' value = navigating informal legal/paperwork processes, not listing aggregation: a Noida resale case describes token → Agreement to Sell (10% advance) → society dues/NOC → transfer memorandum → registry, taking **45–90 days**, with NoBroker refusing "legal paperwork" work, forcing a broker hire [E-T05 — anecdotal]. RERA mandates project/agent registration and 70% escrow, but enforcement is uneven [paper: `sources/papers/E-06-rera-homebuyer-protection.md` — fully confirms].
- **France:** commissions 3–8% (up to 5–10% + 20% VAT); Bestellerprinzip in principle but contractually variable [D-08 — fully confirms].

---

## Q5. Price formation — what builds a house price (London)

### 5.1 Ranked London-specific price components (cited magnitudes)
1. **Location / postcode gradient** — largest hedonic group, R² 0.427 (Yang et al. 2023) [paper: `sources/papers/C-01-hedonic-london-attribute-groups.md` — fully confirms]; SW3–SW6 gap ≈ **+81%** vs W2 baseline (Bracke) [paper: `sources/papers/C-10-bracke-hedonic-central-london.md` — fully confirms]. *Weight location fixed effects above all property features.*
2. **Lease decay** — 80–99y ≈ **−16%** vs freehold → 100–124 ≈ −10% → 125–149 ≈ −8% → 150–300 ≈ −3% → 700+ ≈ 0 (Giglio et al., QJE 2015); below 80y the regime steepens (~−25% at 45y; Andrew/Culley/Sleptcovac 2024, sourced in file) [paper: `sources/papers/C-04-leasehold-discount-lease-length.md` — fully confirms]. Buyers actively monitor the 80-year marriage-value cliff [thread: `sources/threads/C-01-leasehold-80-year-marriage-value.md` — anecdotal].
3. **Floor area** — +1.454 log points per 1,000 sqft (≈ **+0.145%/sqft**), concave; **bedrooms conditional on area** add +12.5% (2-bed), +9.4% (3-bed), −8.0% (4-bed); house vs flat +6.7% (Bracke) [C-10 — fully confirms]. *Area is the binding constraint, not bedroom count.*
4. **Transport access** — quarter-SD reduction in station distance → **+1.5%** (Gibbons & Machin, JUE 2005 — direct quote) [paper: `sources/papers/C-06-rail-access-jubilee-dlr-uplift.md` — fully confirms]; new line uplift ≈ +9.3% (TfL's reading — partially supports); Crossrail announcement effect +2.2% within 500m, −2% displacement at 1–2km (TfL/DfT evaluation) [paper: `sources/papers/C-02-crossrail-elizabeth-line-uplift.md` — analytic, not peer-reviewed — partially supports]. Small in causal terms; industry corridor narratives are non-causal.
5. **Schools** — descriptive +8.0% top-decile primary / +6.8% secondary (DfE 2017); causal ≈ **+3–4% per 1 SD** (second-hand — partially supports); Ofsted +0.5%/grade [paper: `sources/papers/C-03-school-catchment-premium-uk.md` — analytic — partially supports]. Threads show catchment driving purchase decisions outright [threads: `sources/threads/C-03-location-transport-vs-house.md`, `C-04-buying-for-school-catchment.md` — anecdotal].
6. **New-build / Help to Buy** — London HtB raised new-build prices **~+6%**, no construction effect (Carozzi/Hilber/Yu, REE 2020) [paper: `sources/papers/C-05-new-build-premium-help-to-buy.md` — fully confirms]; raw London new builds trade at −10.5% vs existing (industry, Aug 2026) — composition-driven; never read raw averages as causal. Threads document buyers disputing developer premiums (£186k vs £200k; developer £270k vs Land Registry £225–250k) [threads: `sources/threads/C-02-new-build-premium-questioned.md`, `C-05-new-build-valuation-gap.md` — anecdotal].
7. **EPC** — **~0.47%/EPC point**, ≈ 4.87%/letter in 2021, rising since 2013 (Wei & Peiser, Land 14(10):2053, pub 14 Oct 2025) [paper: `sources/papers/C-08-epc-green-premium-london.md` — fully confirms]; F/G carry a discount. Use time-varying weights.
8. **Macro: interest rates** — +1pp index-linked gilt yield → just under **−20%** long-run real prices; 1985–2018 rate decline "more than accounts for" the price/income rise (Miles & Monro, BoE SWP 837) [paper: `sources/papers/C-09-interest-rate-user-cost-boe.md` — analytic — fully confirms as cited]. Market-level adjustment, not a hedonic coefficient.
9. **Macro: supply constraints** — **−35%** counterfactual without regulatory constraints; South East at North-East restrictiveness → −25% (Hilber & Vermeulen, EJ 2016) [paper: `sources/papers/C-07-supply-constraints-house-prices-england.md` — fully confirms]. Location fixed effect, not a property feature.

### 5.2 Formula-style hedonic decomposition (terms only where directly supported)
```
log P ≈ α + β_postcode_district            (C-10: e.g. SW3 +0.309 … SW6 −0.285 vs W2)
      + 1.454×(area/1000) − 0.156×(area/1000)²   (C-10, concave)
      + bedroom_dummies | area (2b +0.118, 3b +0.090, 4b −0.083) + house +0.065  (C-10)
      − lease_decay(term)                     (C-04: −16% at 80–99y → 0 at 700y+; steeper <80y)
      + 0.0047×EPC_points (rising over time)  (C-08, ~2021)
      + γ×school_quality (causal ~3–4%/SD; descriptive +8% top decile)  (C-03)
      + δ×station_proximity (quarter-SD → +1.5%)  (C-06)
      ± HtB_era_newbuild (+6% London, causal)  (C-05)
      + macro_market_adjustment(real_rate, LPA_restrictiveness)  (C-09, C-07: market level only)
```

### 5.3 App weighting recommendations (tied to citations)
- **Primary features:** postcode-district fixed effects; floor area (concave); lease remaining term with a **kink at 80y** [C-01, C-10, C-04].
- **Secondary:** bedrooms conditional on area; EPC with rising time weight; top-decile school flag; distance to station [C-10, C-08, C-03, C-06].
- **Market-level priors:** index all valuations to real-rate/mortgage-rate baseline [C-09]; LPA planning-restrictiveness fixed effect [C-07].
- **Do NOT:** treat raw new-build averages as premiums; treat developer asking prices as market value [C-05 thread T-05]; use bedrooms independent of area; present C-02/C-03/C-09 as peer-reviewed (they are high-credibility government analytics, explicitly labelled in source files).

### 5.4 Country comparisons — price formation
- **US:** algorithmic anchoring — 1% higher pre-listing Zestimate → **+0.733% higher listing price** (IV, causal), sold-price effect only +0.081% [paper: `sources/papers/E-01-zestimate-feedback-loop.md` — fully confirms]. Structural model: lower commissions → *higher* house prices via the durable-asset transaction-cost channel, welfare gains accruing mostly to current homeowners [paper: `sources/papers/E-02-nar-settlement-house-prices-welfare.md` — partially supports, model counterfactual].
- **India:** quality mismeasurement is severe — a Mumbai hedonic index was *"considerably lower than traditional median-weighted average price indices"* [paper: `sources/papers/E-05-india-hpi-forecast-models.md` — direct quote, fully confirms as the paper's finding]; implicit prices for basic infrastructure dominate (drinking water, sanitation, separate kitchen, structure condition, slum vs non-slum) [paper: `sources/papers/E-07-india-hedonic-housing-demand.md` — fully confirms]. NRI price discrimination suggests information-asymmetric price formation in the overseas channel [analytic: `sources/threads/E-T06-nri-investment-checklist.md` — partially supports, single executive source].
- **Germany:** central-city hot spots persist after hedonic controls; migration drives upper-quantile rents [paper: `sources/papers/D-04-berlin-spatial-rents.md` — partially supports, abstract-level]; efficiency premiums don't cover retrofit costs [paper: `sources/papers/D-06-energy-retrofit-premiums.md` — partially supports].

---

## Q6. App design recommendations — what an area-analysis app should show

### 6.1 Data schema (London-first)
Ranked by the evidence above: what predicts price (Q5), what buyers seek (Q1.3), what drives regret (Q3.1), and what's obtainable (Q2).

**MUST-HAVE (each row is a field or field-group; source of data; why the evidence demands it):**
1. **Achieved prices per postcode/address** — HMLR Price Paid (open, OGL, from 1995; UPRN→title lookup added 28 Aug 2026) [Q2.1 — fully confirms]. Users trust achieved-price comps and distrust AVMs: Mumsnet users call Zoopla "WILDLY inaccurate" and trust Land Registry/Rightmove sold prices [thread: `sources/threads/F-17-thread-mumsnet-zoopla-accuracy.md` — anecdotal, 31 replies].
2. **£/sqft by postcode district + address-level price history** — postcode fixed effects are the largest hedonic group (R² 0.427) [C-01 — fully confirms]; threads operate at street level ("street behind us... raise the price by around £100k") [A-01 — anecdotal].
3. **Lease remaining term + lease-decay estimate** — −16% at 80–99y → 0 at 700y+; steeper below 80y [C-04 — fully confirms]; 10% of Londoners regret buying leasehold vs 4% nationally [A-05 thread — anecdotal/secondary]; leasehold enquiries stall purchases 2+ months [A-05 — anecdotal].
4. **EPC rating + points + floor area** — ~0.47%/EPC point, rising [C-08 — fully confirms]; area +0.145%/sqft concave is the binding size constraint [C-10 — fully confirms].
5. **Transport access: station distance + PTAL** — quarter-SD station-distance reduction → +1.5% [C-06 — fully confirms]; commute is a top-3 hard filter for London FTBs [A-03 — anecdotal]; TfL WebCAT data publicly viewable [Q2.1 — partially supports reuse terms].
6. **School proximity / top-decile flag + Ofsted** — causal ~+3–4%/SD [C-03 — partially supports]; 13% of school-age parents wish for better-school neighbourhoods [A-11 cited survey — fully confirms as cited statistic]; catchment drives purchases outright [C-03/C-04 threads — anecdotal].
7. **Crime rate (police.uk, open API)** — safety from crime is 3.7× more important to satisfaction in unsatisfactory neighbourhoods [A-07 — fully confirms]; crime/area quality is a top-2 regret driver [A-10 — anecdotal].
8. **Flood risk (EA, open GIS)** — open data exists [Q2.1 — fully confirms]; insurance-relevant.
9. **Planning applications nearby** — LPA registers are public by statute [Q2.1 — fully confirms]; no national API — per-borough scraping needed [no data found for a national feed].
10. **Asking-vs-achieved gap + days-on-market signals** — the negotiation signal renters and buyers both use [A-08 thread — anecdotal]; asking data is portal/CRM-gated [Q2.3 — fully confirms] so this field depends on partner feeds or user crowdsourcing.
11. **New-build flag + developer-premium warning** — buyers dispute developer premiums vs Land Registry [C-02/C-05 threads — anecdotal]; HtB-era +6% effect [C-05 — fully confirms].
12. **Tenure mix / property-type mix per area** — house vs flat +6.7% [C-10 — fully confirms]; PPD carries tenure [Q2.1 — fully confirms].

**NICE-TO-HAVE:**
- Commute isochrones (Immowelt's Targomo-style) — most location-intelligent German portal feature [app note: `sources/papers/F-10-app-immowelt.md` — partially supports as observed feature].
- True cost of ownership: service charges, ground rent, building-safety risk — nobody connects this to buying decisions (Plentific-adjacent data) [app note: `sources/papers/F-08-app-plentific.md` — partially supports].
- Estimator **ranges with confidence bands** instead of single numbers — Zillow/Redfin disagree $10k–$50k+ on identical homes; Zestimate 7.49% off-market median error; weakest on thin-data/off-market properties (worst in low-income areas per 2025 academic research) [app notes: `sources/papers/F-11-app-zillow.md`, `F-12-app-redfin.md`; thread: `sources/threads/F-18-thread-estimate-showdown.md` — partially supports].
- **Homeowner condition inputs** (Redfin Owner Estimate mechanic: homeowner picks comps + adds renovations — human-in-the-loop; no UK portal offers this) [F-12 — partially supports].
- Cross-area **scored comparison** (not single-area pages): ~50-metric profiles exist only lender-internally (Proportunity) [app note: `sources/papers/F-04-app-proportunity.md` — partially supports, claims disputed].
- Hyper-local nuisances (match-day noise — [A-03 — anecdotal]), air quality, broadband, GP access, demographics, green space — evidence-light but consistent with "neighbourhood quality as a bundle" [A-06 — fully confirms as a concept].
- Rental yields + investor metrics (yield vs 4.5% cash ISA framing used by landlords) [thread: `sources/threads/A-09-pistonheads-second-property.md` — anecdotal].
- Forecast layer (à la Proportunity's internal ML engine) built on open PPD data [F-04 — partially/disputed supports].

### 6.2 Competitive matrix (condensed; full per-app notes in `sources/papers/F-01..F-16`)
| App | Area data | Price analytics | Unique | Monetization | Gap vs ideal |
|---|---|---|---|---|---|
| Rightmove (UK) | Sold prices by postcode (LR-derived) | Monthly asking-price HPI; unpublished-accuracy estimate | Largest listing sample | Agent subs | No scored/visual area comparison; no school/transport overlays; funnels to agents |
| Zoopla (UK) | Market overview, £/sqft, heatmaps | Hometrack AVM ±10% caveat; growth rankings (120 postal areas) | Sold prices matched to old listings | Agent subs + Houseful cross-sell | No manual correction; ignores renovations; single-area pages |
| OnTheMarket (UK) | LR sold prices on listings | None consumer-facing | 24h-early listings; AI search | Agent subs | Thinnest consumer analytics |
| Proportunity (UK) | ~50 location metrics (internal) | ML forecasting; "gems" claims | Closest to area-prediction | Equity-loan margin | Analytics lender-internal only |
| Habito (UK) | None | Affordability only | True-cost mortgage comparison | Lender commission; embeddable API | Zero area data — but proves API economics |
| Nested / HouseSimple (UK) | None | Valuation as lead-gen | Cash advances / £0 seller fees | Transaction cut / referral fees | No buyer-side data product |
| Plentific (UK) | Ops data (repairs/compliance) | None | Analytics as paid add-on; 1.7m homes | SaaS + take + data upsell | B2B only |
| ImmoScout24 (DE) | Metro trends (8.5m listings) | WohnBarometer quarterly + forecast | Demand/supply indicator | Agent subs | PDF-grade; no public sold-price register; no overlays |
| Immowelt (DE) | Commute isochrones; POI profiles | Property Radar (agent-only) | Commute-first search | Agent tiers; Aviv Group | Search-filter grade, not scored comparison |
| Zillow (US) | Price/tax history per listing; ZHVI/ZORI | Neural Zestimate, 110m homes, 3×/week | Published accuracy; AI Mode 2026 | Premier Agent ads; loans | Home-level not area-level |
| Redfin (US) | MLS-depth data | Estimate 1.85%/7.25%; Owner Estimate (human-in-loop) | Brokerage data moat | Discount brokerage; Rocket Cos | Area analysis in articles, not product |
| 99acres / MagicBricks (IN) | Locality trends; reviews | Asking-price trends only | Project/floorplan depth; UGC ratings | Portal subs + ads | No sold-price truth; 32% mismatch/stale |
| NoBroker / Housing.com (IN) | Owner-direct; locality insights | None / thin trends | Broker-detection; clean map UX | Consumer plans; portal subs | Zero/undocumented analytics |

### 6.3 White space for a London-first area app (evidenced)
1. **Achieved-price truth + condition inputs:** users trust Land Registry sold prices and call AVMs "WILDLY inaccurate" because they ignore condition/renovations [F-17 — anecdotal]; Redfin's homeowner-input Owner Estimate has no UK equivalent [F-12 — partially supports].
2. **Scored, comparable cross-area profiles** blending price trends, schools, crime, transport, true cost of ownership — unclaimed in the UK [F-matrix — analytic synthesis of F-01..F-16].
3. **Structural data advantage:** open Land Registry Price Paid vs Germany's closed/fragmented register and India's 32%-distorted asking-price soup [Q2.4 — fully/partially confirms] — London is the right beachhead; forecasting can be built on open data.
4. **Proven free-consumer monetization:** HouseSimple referral fees, Habito lender commission + embeddable API, Plentific/Rightmove B2B analytics upsell [F-05, F-07, F-08 — partially supports] — free consumer tool + mortgage/conveyancing referrals + B2B market-intel API tier.
5. **Ranges, not single numbers:** estimator disagreement $10k–$50k+ and off-market weakness [F-11, F-12, F-18 — partially supports]; confidence bands + achieved-price comps differentiate instantly.

---

## Cross-country comparison (synthesis)

| Dimension | UK (London) | Germany | US | India | France / other EU |
|---|---|---|---|---|---|
| Transaction data openness | **High:** HMLR PPD open OGL from 1995 | **Low:** asking-only; Gutachterausschuss fragmented (no official source found) | **Medium:** MLS agent-only by NAR rule; county assessor + Census open | **Low:** registrar prices not open; RERA project data public; HPI lagged/divergent | **France high:** DVF open since 2019; NL/SE/ES/IE: no data found |
| Agent commission (sale) | ~1.42% incl VAT (2014–18) | Up to 7.14%; 2020 reform backfired (+2pp, +€6k) | ~2–3% buyer-side pre-settlement; NAR 2024: no change yet | Broker norms; 45–90d paperwork processes | FR 3–8% (+VAT); NL 1–2%; SE 1.5–4.5%; ES 4–6%; IE 1–2.5% |
| Rental search intensity | 20–50 applicants/listing; days to decide | **Application warfare** (~600 applications; premium accounts; bots) | Portal-alert self-serve | Classifieds + broker-led | No data found |
| Key local regret/decision factor | Neighbours #1; leasehold; area crime | Fees/deposits in cash; energy efficiency | Zestimate anchoring (+0.733% listing per 1%) | Infrastructure (water, sanitation); RERA confidence | No data found |
| Portal landscape | Rightmove/Zoopla/OTM (agent-gated) | ImmoScout24/Immowelt (asking-only) | Zillow/Redfin (MLS-derived) | 99acres/MagicBricks/NoBroker/Housing (asking-only, 32% distorted) | No data found |

## Explicit "no data found" log (gaps)
- Robust buy-side funnel timeframes (search duration, viewings count, offer-to-completion) — no data.
- National UK planning-application API — none found.
- Current (2025–2026) UK traditional commission rates; DfE catalogue current licence wording; TfL WebCAT exact reuse terms; Redfin/Zillow API licensing terms; FEMA/GreatSchools/Walk Score access status.
- r/IndiaInvestments and most Reddit threads — blocked domain, search-only.
- NL/SE/ES/IE search behaviour and data landscapes — only commission-level data.
- Krysan A-08 owner-vs-renter search-process findings — only research questions retrieved.
- UK/London-specific regret-prevalence surveys (Trulia 44% etc. are US) — no data.
- Algorithmic/portal recommendation features' effect on decision quality — no data.
- Effect sizes/Ns for several A-files (A-01 N unstated; A-05 N uncaptured; A-10 N uncaptured).

## Sources index
- **Worker A (Q1+Q3):** 11 papers + 10 threads — `sources/papers/A-01..A-11`, `sources/threads/A-01..A-10`; synthesis: `A-FINDINGS-SUMMARY.md`.
- **Worker B (Q2+Q4):** 5 papers + 5 threads — `sources/papers/B-01..B-05`, `sources/threads/B-01..B-05`.
- **Worker C (Q5):** 10 papers + 5 threads — `sources/papers/C-01..C-10`, `sources/threads/C-01..C-05`.
- **Worker D (DE+EU):** 8 papers + 6 threads — `sources/papers/D-01..D-08`, `sources/threads/D-T1..D-T6`.
- **Worker E (US+IN):** 7 papers + 5 threads + 2 analytic notes — `sources/papers/E-01..E-07`, `sources/threads/E-T01..E-T06, E-A01`.
- **Worker F (competitive):** 16 app notes + 2 thread notes — `sources/papers/F-01..F-16`, `sources/threads/F-17, F-18`.
- **Coordinator notes:** `hidden_files/proptech-research/NOTES.md`.
- Totals: **41 papers/analytic notes + 16 app notes + 35 threads = 92 evidence files**, all written 2026-09-06, each carrying source type, URL, dates, and a support-degree grade.
