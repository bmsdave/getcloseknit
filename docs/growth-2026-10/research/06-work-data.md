# Cluster 6: people who use area data at work (research notes, 2026-10-17)

Evidence tags: [V] fetched or queried first-hand this session (URL/API given). [S] secondary source seen in search results, not checked at source. [E] my estimate or derivation (method given). [U] background knowledge, not verified this session; check before relying on it.

Limits of this research: the shared web-search budget ran out part-way. Not completed: JCQ June 2027 key-dates PDF, London school counts, a London charity count from the Charity Commission register, LinkedIn and Facebook group sizes (LinkedIn blocks fetches; Facebook groups are not indexed), Reddit rules per subreddit (Reddit blocks fetches; sizes are from GummySearch snapshots). Instagram and Threads follower counts were read from each profile's public og:description on 2026-10-17 and only kept where the account name clearly matches the organisation.

## 1. Ranking (size x repeat x fit, 1-5 each; judgement scores, product in brackets)

| Rank | Audience | Size | Repeat | Fit | Score |
| --- | --- | --- | --- | --- | --- |
| 1 | GCSE/A-level geography pupils and teachers (London) | 5 | 4 | 4 | 80 |
| 2 | University students (geography, planning, urban, public health, social science dissertations) | 4 | 3 | 4 | 48 |
| 3 | Charities and community groups (bids, "statement of need", Friends-of-parks) | 3 | 3 | 5 | 45 |
| 4 | Journalists and hyperlocal publishers (small, but they multiply reach) | 2 | 4 | 4 | 32 |
| 5 | Café/shop owners, aspiring owners, franchise scouts | 4 | 2 | 3 | 24 |
| 6 | Local government staff and councillors | 2 | 3 | 3 | 18 |
| 7 | Delivery and field-service planners | 3 | 2 | 1 | 6 |

Why this order: classrooms and coursework give many people, many sessions and a free-data need that Close Knit meets with no new feature. Charities and students have a recurring cited-evidence need that the printable area evidence pack already answers. Business owners are numerous and the topic spreads well on Instagram, but each person researches a site for a few weeks, and Close Knit has no footfall, rent or turnover.

No-new-feature starting kit that works for audiences 1-6: the cited, printable area evidence pack (`web/src/app/area/[carrier]/[code]/pack/page.tsx`: figures numbered to a sources list with release ids; "no valuation, no listings"), compare areas, shareable links, postcode/sector pages. The site collects no emails, so "weekly return" below relies on term calendars, shared links and social posts, not email.

## 2. London audience sizes behind the ranking (first-hand queries)

Nomis UK Business Counts, latest release (labelled 2026), London region, enterprises VAT/PAYE-registered, rounded to 5 [V]. Query pattern: `https://www.nomisweb.co.uk/api/v01/dataset/NM_142_1.data.csv?geography=2013265927&date=latest&industry=<code>&employment_sizeband=0&legal_status=0&measures=20100` (NM_141_1 for local units/sites).
- All industries: 552,505 enterprises.
- Food and beverage service (SIC 56): 27,205 enterprises, 35,475 sites. England 134,675, so London is about 20%.
- Unlicensed restaurants and cafés (56102): 6,280 enterprises, 7,780 sites. England 24,200 (London 26%). Up from 5,205 in 2021 (+21%).
- Licensed restaurants 7,865; takeaways and mobile food 6,810; pubs and bars 2,355.
- Size band of London food and beverage: 20,705 micro (0-9 staff, 76%), 5,705 small, 635 medium, 160 large.
- Retail trade (SIC 47): 44,260 (England 187,735, 24%).
- Hairdressing and beauty 9,695; dental 2,915; child day-care 2,355; chemists 1,395; fitness facilities 1,095; vets 310.
- Courier/postal 4,270; road freight 4,760.
- UK context: 2,734,615 enterprises and 3,180,620 local units in 2025; London 538k; accommodation and food 177k; retail 213k (ONS bulletin, rounded) [V]. https://www.ons.gov.uk/businessindustryandtrade/business/activitysizeandlocation/bulletins/ukbusinessactivitysizeandlocation/2025

Census 2021, London residents in employment by occupation/industry (resident-based, not workplace) [V], Nomis NM_2081_1 (occupation minor groups), NM_2077_1 (industry), NM_2027_1 (age):
- Media professionals (SOC 249: journalists, editors, PR): 60,113 (England 142,256, so London is 42%). Artistic, literary and media occupations 118,002.
- Managers and proprietors in hospitality and leisure: 50,848.
- Shopkeepers and sales supervisors 36,229; managers/proprietors in other services 115,678.
- Teaching and other educational professionals 156,523; education industry 418,765.
- Public administration and defence 209,607 (includes central government). Social work without accommodation 162,283. Membership organisations 33,601.
- Architects, planning officers, surveyors, construction professionals 32,886.
- Road transport drivers 141,053; postal and courier industry 42,605.
- Age 15: 99,849 London vs 644,114 England (15.5%); ages 16/17: 101,944 and 100,378; ages 18-21 about 92-103k each.

## 3. Audience 1: GCSE and A-level geography pupils and teachers

Size:
- GCSE geography entries: 302,706 UK, 288,664 England (JCQ final), 297,411 UK in 2024, 265,169 in 2019 [S] https://mathsgenie.co.uk/blog/how-many-students-take-gcse-geography (cites JCQ and Ofqual).
- A-level geography 2025: 34,336 entries (down 5.4%, 12th most popular subject; AQA 13,070, Edexcel 12,789, OCR 4,595, Eduqas 1,115) [V] https://www.tutor2u.net/geography/blog/a-level-geography-2025-results-analysis
- London estimate [E]: London holds 15.5% of 15-year-olds, so roughly 45,000 GCSE geography pupils a year and about 5,000 A-level geography pupils, if uptake matches England. Not measured.
- Teachers: Geographical Association (GA) says 10,000+ personal and institutional memberships [S] https://geography.org.uk/what-we-do/. London teaching professionals (all subjects) 156,523 [V]. Teacher Tapp, Tes and GA are the teacher channels.
- Resource sites teachers use: tutor2u (bio claims 30 million student and teacher visitors a year) [S]; Internet Geography (self-funded, 1,800+ resources, teacher subscription about GBP 20 a year) [S] https://www.internetgeography.net/subscribe/; Digimap for Schools (OS/EDINA; trial and free access scheme, usage numbers not published) [V] https://www.digimapforschools.edina.ac.uk/. DataShine Census maps from UCL still serve the 2011 Census [V] https://datashine.org.uk/, so a 2021-based, 2026 map is a real gap.

Communities and accounts (measured 2026-10-17 unless noted):
- Instagram: BBC Bitesize 96K, Save My Exams 69K, Seneca Learning 14K, The Student Room 14K, Tes magazine 26K, Teacher Tapp 5.3K, RGS (@rgs_ibg) 28K, Ordnance Survey 190K, Geographical Association 2.0K, tutor2u 2.3K, Internet Geography 556.
- Threads: Ordnance Survey 34.3K, BBC Bitesize 12.6K, The Student Room 1.9K, RGS 1.8K, tutor2u 418, Geographical Association 340.
- Reddit (GummySearch snapshots, 2025, +/-): r/GCSE 198k, r/alevel 210k, r/6thForm 188k (another snapshot 137k), r/geography 1.7M (global, not UK).
- Read: geography teachers are not big on Instagram (GA 2K, tutor2u 2.3K); pupils sit on revision accounts. Reach teachers through GA/RGS/Tes/Teacher Tapp and school-staff networks; reach pupils through revision accounts and r/GCSE, r/alevel.

Seasonal moments:
- Now to December 2026: Year 13 A-level students gather data for the independent investigation (NEA, 20% of the grade per one college pack [S]) and Year 11 GCSE pupils write up fieldwork [U on typical timing].
- January 2027: school mock exams; one school letter schedules the NEA write-up ahead of them [S].
- Board deadlines last year, so expect similar in 2027: WJEC/Eduqas samples uploaded by 20 March 2026; Pearson portal opened 13 April 2026 and the final date for samples and marks was 15 May 2026 [S] https://qualifications.pearson.com/en/news-policy/subject-updates/geography/a-level-geography-nea-coursework-submission-summer-2026.html . AQA date not confirmed.
- Summer 2027 exams May-June (JCQ publishes a "June 2027 GQ" key-dates PDF; not read) [S] https://www.jcq.org.uk/exams-office/key-dates/ . Results days usually mid-August [U].
- GA annual conference in spring and RGS conference in late summer [U]; check dates.

Hook (features): compare two areas (deprivation, income, crime counts, nature score, walk to station, price per m2, social rent); Census 2021 tables as descriptive facts; nature/wildlife and trees layers for physical-geography and ecology enquiries; the cited pack for the "sources" line in a write-up. Specs usually ask for a UK-city urban case study and, at A-level, place profiles (Changing Places, Regenerating Places) [U: confirm in AQA 7037, Edexcel 9GE0, OCR H481 spec text]. London inequality within one city is the common case study.

What brings them back weekly: lesson sequences and homework in term time. A teacher shares one link set (a "class set" of 4-6 area comparisons) and a class returns across a 3-4 week fieldwork block. Each new cohort restarts it every autumn. Pupils return to re-check figures while writing up.

Risks:
- Under-18s: first-party analytics with a localStorage id may need a children's-code (ICO Age Appropriate Design Code) check [U]; confirm opt-out and no personal data. School web filters may block map tiles.
- Method: secondary data does not meet the primary-data part of most fieldwork rules; position as "secondary data for your enquiry". Teachers will discard anything they cannot cite, so keep the sources/licence line visible.
- Census facts are for describing one area; never rank people. Do not label areas "good/bad".
- Self-promo: Reddit teen subs (r/GCSE, r/alevel) usually limit promotion [U; read rules]; Tes/Facebook teacher groups usually ban adverts. Better to approach GA/RGS or write a free fieldwork guide.

Instagram/Threads idea:
- Title: "Same city, 3 km apart: pick two London areas for your enquiry" (7-slide carousel).
- Shows: slide 1 the enquiry question ("Does quality of life change across a London borough?"); slides 2-5 one map each for two example areas (deprivation, income, nature score, walk to station, crime counts per area) with the same scale; slide 6 "how to sample, how to cite" with the pack screenshot; slide 7 the link. Use areas where the data is stable and describe, never rank, residents. Add "Teachers: free class link".

## 4. Audience 2: university students (dissertations and projects)

Size:
- UK geography students (HESA CAH26): 45,775 in 2023-24 (33,575 undergraduates) and 43,955 in 2024-25 (33,140 undergraduates). UCAS geography, earth and environmental acceptances about 9,650 a year, applications 51,815 in 2025 [V] https://rgs.org/research/higher-education-resources/data-on-geography-at-university
- Wider users (planning, urban studies, public health, economics, sociology, real estate) not counted. London census residents aged 18-21 are about 92-103k per year of age [V]. UK HE total 2,904,425 in 2023-24 [S].
- RTPI has 27,421 members including students [S] https://www.rtpi.org.uk/new-from-the-rtpi/rtpi-chartered-membership-applications-almost-double/

Communities and accounts:
- Reddit: r/UniUK 342k (snapshots 221-342k), r/urbanplanning 237k (global), r/LondonSocialClub 229k.
- Instagram: UCL official 321K; The Student Room 14K; Save My Exams 69K (A-level crossover); RGS 28K. Academic departments' accounts were not found at guessed handles; ask the societies (GeoSoc, planning societies) directly.
- The Claude plugin matters here: students already work in AI assistants, and the MCP server returns evidence with sources and caveats.

Seasonal moments (typical, [U]): topic choice and ethics approval October-December; fieldwork and analysis January-March; undergraduate submission April-May; MSc dissertations September. Check two or three London departments (UCL Geography, KCL, Queen Mary, Westminster, Birkbeck) for exact dates.

Hook: area pack with numbered footnotes and release ids, compare areas, CSV-style citation of sources, Census 2021 tables, street-level and postcode pages. Dissertations on gentrification, green space, food environment (hygiene ratings plus takeaways), student housing near universities (university layer), health access (pharmacies, dentists).

Weekly return: dissertation supervision cycle (each draft prompts a figure check), group projects, and repeated use of the Claude plugin for a literature-plus-data workflow.

Risks: students need a stable citation (date-stamped release, licence); OSM counts places not people and is incomplete in places, which supervisors will catch. Reddit self-promo: 9:1 style rules are common [U]. Do not present Close Knit as "official statistics".

Instagram/Threads idea:
- Title: "Dissertation data in 10 minutes: pick an area, print a cited pack" (reel, 30 s).
- Shows: screen recording of choosing an MSOA, opening the evidence pack, expanding the sources list, saving to PDF; overlay "Contains OS data / OGL / ODbL" credit line; end card with 3 dissertation question starters ("Do areas with more libraries have more...").

## 5. Audience 3: charities and community groups

Size:
- 171,112 charities on the England and Wales register at end of March 2026; 171,231 at end of December 2025; 11,162 registration applications in the year to December 2025 [S] https://www.gov.uk/government/publications/charity-commission-casework-and-registrations-data-2025-to-2026/casework-and-registrations-data-january-to-march-2026
- London [E]: NCVO Almanac 2019 gives London 2.8 general charities per 1,000 residents [S] https://www.norfolkfoundation.com/blog/in-good-shape; at 8.8 million residents that is about 25,000. Treat as an order of magnitude; a count by area of operation from the Charity Commission register would replace it (the register extract is a 6 MB file; I did not download it).
- Staff: 162,283 London residents work in social work without accommodation; 33,601 in membership organisations [V].
- Networks: London Funders 170+ members across all 32 boroughs [S] https://4dayweek.io/company/londonfunders ; London Friends of Greenspaces Network reports 600+ Friends-of-parks groups (older sources 700-900) [S] https://www.london.gov.uk/sites/default/files/London%20Friends%20of%20Greenspaces%20Network%20%283034%29.pdf ; Pride in Place covers 284 communities, with about a quarter of the 40 added in February 2026 in London per UnHerd [S]; programme worth up to GBP 5.8 billion over 10 years [V] https://www.gov.uk/government/publications/pride-in-place-programme-prospectus
- Accounts (Instagram): The National Lottery Community Fund 22K, GoodGym 29K, London Community Foundation 3.6K, Trust for London 1.4K (Threads 196), London Councils 2.2K (Threads 312), Mayor of London 322K (Threads 274K).

Seasonal moments:
- Pride in Place accountable bodies' monitoring return due 29 October 2026 [V]. Council Impact Fund rounds vary by authority (Tameside closed 31 July 2026; Haringey reports a GBP 1.5 million allocation) [S].
- National Lottery Reaching Communities England: rolling, GBP 20,001 and up in one listing, long decision times (40 weeks in one council listing); sources disagree on the ceiling [S] https://youngcamdenfoundation.org.uk/funding/the-national-lottery-community-fund-reaching-communities-england
- GivingTuesday is Tuesday 1 December 2026 [E: day after US Thanksgiving, 26 November]; Big Give Christmas Challenge runs in early December [U].
- Financial-year end 31 March drives council and trust deadlines [U].

Hook: "statement of need" evidence for a postcode or LSOA: deprivation, income, crime, nature score, nearby playgrounds, libraries, sports centres, pools, pharmacies; the printable pack; Census 2021 descriptive tables for one area; the places layers show what exists nearby (gaps in provision). Free versus paid tools such as Local Insight (OCSI) [U; domain not reachable this session].

Weekly return: every bid, project plan or partner meeting needs a new patch; trustees and Friends groups reopen shared links. Park Friends groups can run seasonal "what lives in our park" with wildlife layers.

Risks:
- Accuracy claims: a funder may quote it, so keep the sources/caveats visible; use "recorded crime", "estimated", and the release date.
- Avoid stigmatising language ("deprived area" is a statistical label); do not rank or filter by census characteristics (product rule).
- GBIF records carry per-record licences (some non-commercial); if wildlife figures appear in public graphics, keep the GBIF DOI and licence note (also in the maintainer's launch checklist).
- Self-promo: London Funders, Locality and CVS newsletters accept free-resource items, forums often ban adverts [U].

Instagram/Threads idea:
- Title: "Statement of need in 5 minutes" (carousel).
- Shows: one worked example for a single area: six facts with source and year (deprivation decile, recorded crime count, income band, nature score, count of youth-relevant places within walking distance such as sports centres and libraries, distance to a station), a "what we can't tell you" panel, and "Print the pack" step. Pin to GivingTuesday week.

## 6. Audience 4: journalists and hyperlocal publishers

Size:
- UK journalists: about 101,500 (ONS LFS estimate, noisy; 73,000 in 2017) and 55,688 in England, Wales and Northern Ireland at Census 2021; NUJ 24,528 members in 2022 (20,722 paying) [S] https://pressgazette.co.uk/media-audience-and-business-data/nuj-fees-high-membership-low/
- London: 60,113 media professionals (42% of England's) [V], including PR, so the core news workforce is much smaller.
- BBC-funded local democracy reporters: 165 posts across UK news organisations [S] https://pressgazette.co.uk/news/bbc-funded-local-democracy-reporter-scheme-already-strengthening-local-journalism-and-accountability-of-local-public-bodies-despite-teething-problems/
- Hyperlocal: ICNN had 115 members in 2020, strongest in London, Bristol, Cardiff and Manchester (Hackney Citizen, Inside Croydon named) [S] https://www.communityjournalism.co.uk/?p=73017

Communities and accounts:
- Journo Resources: about 20,000 on the weekly newsletter (60%+ open rate), 27,000 on X, 10,000 on LinkedIn (self-reported) [S] https://www.journoresources.org.uk/advertise-journo-resources/ ; Instagram 5.9K; Threads 1.4K.
- London hyperlocals (Instagram, measured): Peckham Peculiar 21K, Brixton Buzz 7.0K, Brixton Blog and Bugle 5.2K, Hackney Citizen 3.9K.
- Hold the Front Page, Press Gazette and Journalism.co.uk are the trade reads; no verified follower counts.

Seasonal moments: ONS crime in England and Wales is quarterly and police.uk monthly [U]; London borough elections were in May 2026, so many new councillors and "what did the new council inherit" stories [S] https://en.wikipedia.org/wiki/2026_London_local_elections ; London Coffee Festival 13-16 May 2027 for food-and-drink pieces [V]; wildlife stories follow nature (swift arrival, hedgehog hibernation) [U].

Hook: shareable links with the map state, the cited pack, rankings, nature and wildlife layers (soft-news hooks), "specialty coffee vs kebab shops" style place counts, food hygiene ratings.

Weekly return: a monthly "data drop" (post and a press page) gives a reason to come back; a journalist who finds one reliable local number returns whenever there is a council, crime or school story.

Risks:
- They will quote it: every claim needs the source and release date. Recorded crime is not risk; wildlife counts follow observer effort; OSM counts places, not people. The repo terms ask for attribution and ban bulk extraction (`web/src/app/terms/page.tsx`).
- Legal/reputation: avoid "most dangerous street" framing; use area-level counts only; no per-home claims.
- Pitching: ICNN members and LDRS reporters are small and busy; offer a ready-to-use chart and a method note rather than a cold pitch.

Instagram/Threads idea:
- Title: "Hedgehog Watch London: the 10 boroughs with the most recorded sightings" (single image plus Threads thread).
- Shows: ranked bar of boroughs by GBIF hedgehog records for a stated period, with a "records follow observers" caveat and DOI/licence line. Pair with the same layout for swifts in May. Journalists pick up wildlife counts for easy local features.

## 7. Audience 5: café and shop owners, aspiring owners, franchise scouts

Size: see section 2: 27,205 London food and beverage enterprises (76% micro), 6,280 cafés, 44,260 retail, 9,695 hair and beauty, 2,915 dental. Plus aspiring owners (not measurable). Branded coffee: UK 12,313 outlets in 2025 (11,456 in the previous edition), Greggs 2,737 vs Costa 2,707 [S] https://retailgazette.co.uk/blog/2026/09/greggs-overtakes-costa . Franchising: 1,009 systems and 50,421 units, GBP 19.1 billion contribution [S] https://www.franchisedirect.co.uk/information/the-results-are-out-the-bfa-and-nic-services-group-reveals-the-results-of-the-2024-national-franchise-survey

Communities and accounts:
- Instagram: The London Coffee Festival 111K, KERB 90K, UKHospitality 23K, Morning Advertiser 3.9K, London Coffee Guide 233.
- London Coffee Festival 13-16 May 2027, Truman Brewery; 22,000 visitors in 2025; 275 brands; Thursday-Friday are industry days [V] https://www.londoncoffeefestival.com/
- Reddit: r/smallbusinessuk 83k, r/CoffeeShopOwners about 6k (global, "independent specialty coffee shops"). Facebook café-owner groups were not found in search; check Facebook search by hand.

Seasonal moments: Small Business Saturday 5 December 2026 [V] https://www.smallbusinesssaturdayuk.com/ ; London Coffee Festival 13-16 May 2027 [V]; new-year starts in January and lease quarter days (25 March, 24 June, 29 September, 25 December) [U]; the April 2026 business-rates revaluation changed costs [U; verify].

Hook: place layers as competitor and complement density (specialty coffee vs kebab, bakeries, gyms, coworking, universities, bike parking); station walk; price per m2 and social rent as area character; income and deprivation as descriptive context; shareable links to send to a partner or landlord. First-pass shortlist ("where are the gaps"), then they go to paid footfall data.

Weekly return: low. It happens in research bursts around a lease search. Aspiring owners come back more often than actual owners, and the topic is highly shareable.

Risks:
- Close Knit has no footfall, trading, rent or lease data; say so. OSM completeness varies by area; "gap" is not "demand".
- Commercial users: OGL data is fine; OSM needs ODbL attribution; the product rule counts places, not people.
- Self-promo: r/smallbusinessuk and trade groups usually limit promotion [U; read rules]. Free-tool posts with a worked example tend to be better received than links.

Instagram/Threads idea:
- Title: "Flat white or doner? Where London's cafés outnumber its kebab shops" (carousel).
- Shows: map of boroughs or MSOAs coloured by specialty-café share vs kebab-shop share (OSM place counts), a top-10 and bottom-10 list, and a closing slide "Gaps: areas with no specialty café within 10 minutes' walk". Keep to place counts and say "mapped places".

## 8. Audience 6: local government staff and councillors

Size: 1,817 councillors across 32 boroughs after the 2022 elections; 1,817 seats again in 2026 [S] https://en.wikipedia.org/wiki/2022_London_local_elections ; 209,607 London residents work in public administration (includes central government) [V]; RTPI 27,421 members; planning/architecture/surveying professionals 32,886 London residents [V].

Communities: London Councils (32 boroughs and the City; Instagram 2.2K, Threads 312) [V]; RTPI regions; LinkedIn is the main channel for this group (counts not verified).

Seasonal moments: new councillors after May 2026 elections are finishing induction; council budgets and council tax set February-March [U]; Pride in Place monitoring 29 October 2026 [V]; Local Plan consultations through the year.

Hook: ward-sized profile using MSOA, school pages with borough comparison, sector pages, quick comparisons for a committee paper or a casework email.

Weekly return: councillors do casework every week, but the group is small, and officers have official tools (LG Inform, Fingertips, London Datastore) [U]. Treat councillors as a free-tool audience, not a procurement route.

Risks: not official statistics; public-sector users may need a DPIA/procurement review before relying on a tool; avoid political framing. Self-promo risk is low if the content is neutral.

Instagram/Threads idea:
- Title: "New councillor? 6 local facts to check first" (carousel).
- Shows: one example MSOA with six panels (schools and Ofsted, recorded crime, nature score, food hygiene ratings, tenure from Census as a descriptive fact, station walk), each with the source and a note on what it cannot show.

## 9. Audience 7: delivery and field-service planners

Size: London has 4,270 courier/postal and 4,760 road-freight enterprises [V]; 141,053 road-transport drivers and 42,605 postal/courier workers live in London [V]. There is no official rider count; a November 2025 report describes hundreds of thousands of UK riders, mostly on Just Eat, Deliveroo and Uber Eats [S] https://www.bhrrc.org/en/latest-news/uk-migrant-delivery-riders-for-deliveroo-uber-eats-just-eat-allege-challenging-low-paid-working-conditions-incl-12-hour-days-harassment-injuries-incl-cos-comments/ (the page returned 403 to my fetch; seen in search results only).

Fit: low. Close Knit does not route or time deliveries. Layers that touch their work: EV chargers, bike parking, late-night food, takeaways, markets. Tradespeople choosing a patch are limited because there is no per-home data.

Weekly return: low. Seasonal peaks are Black Friday (27 November 2026) and December.

Risks: OSM coverage of EV chargers lags real-world installs; nothing safety-related should be implied for riders.

Instagram/Threads idea:
- Title: "Charger and bike-parking deserts: where London runs short" (reel).
- Shows: boroughs ranked by mapped public EV chargers and bike parking per km2 with an "OSM coverage" caveat. Aim at e-bike and EV-van drivers.

## 10. Benchmarks: accounts checked on 2026-10-17 (public og:description, name matches the organisation)

Instagram followers: Ordnance Survey 190K; London Coffee Festival 111K; BBC Bitesize 96K; KERB 90K; Save My Exams 69K; Mayor of London 322K; UCL 321K; GeoGuessr 160K; GoodGym 29K; RGS 28K; Tes magazine 26K; UKHospitality 23K; National Lottery Community Fund 22K; Peckham Peculiar 21K; ONS 17K; Seneca Learning 14K; The Student Room 14K; Brixton Buzz 7.0K; Journo Resources 5.9K; Teacher Tapp 5.3K; Brixton Blog and Bugle 5.2K; Hackney Citizen 3.9K; Morning Advertiser 3.9K; London Community Foundation 3.6K; tutor2u 2.3K; London Councils 2.2K; Geographical Association 2.0K; Trust for London 1.4K; Internet Geography 556.
Threads followers: Mayor of London 274K; Ordnance Survey 34.3K; BBC Bitesize 12.6K; GeoGuessr 10.3K; The Student Room 1.9K; RGS 1.8K; Journo Resources 1.4K; tutor2u 418; Geographical Association 340; London Councils 312; Trust for London 196.
Read-across: map content with an "outdoors" angle works at scale (Ordnance Survey 190K IG / 34K Threads, GeoGuessr 160K), while professional bodies are small on both. Content for work audiences travels better as practical carousels (save-worthy) than as brand-account follows.
Not used because the handle did not match the organisation: guessed handles for Press Gazette, Hold the Front Page, NUJ, NCVO, Charity Commission, BFA, Datawrapper-style tools and several university departments.

## 11. Cross-cutting risks

- Licensing: OGL v3.0 sources are safe to reuse with attribution (see `DATA-LICENCES.md`); OSM needs ODbL attribution; GBIF licences vary per record (some non-commercial), keep the DOI before public wildlife graphics; no address extraction (HMLR PPD/OS conditions; terms ban bulk extraction).
- Claims: say "recorded crime", "mapped places", "reported sightings"; no per-home valuation; never rank or filter people by census characteristics; avoid "good/bad/safe/dangerous" labels; keep release dates visible.
- Minors: schools and students bring under-18 traffic; check the children's-code position of first-party analytics before a schools push.
- Self-promotion: Reddit (general guidance is a small share of posts about your own product), Facebook teacher/charity groups and trade forums commonly restrict adverts; subreddit rules were not readable this session, so read each set before posting. Prefer partner posts (GA, RGS, London Funders, a hyperlocal) and worked examples.

## 12. Verify next

1. JCQ June 2027 key-dates PDF (exam start/end, results days, NEA deadline) and AQA A-level NEA date.
2. A London charity count by area of operation from the Charity Commission register extract (needs your go-ahead to download the 6 MB file).
3. London secondary-school counts and a geography-teacher count (DfE School Workforce).
4. Facebook and LinkedIn group names and sizes for geography teachers, café owners, community groups; check by hand.
5. Spec text for GCSE and A-level urban case-study requirements (AQA, Edexcel, OCR).
6. Read subreddit rules for r/london, r/UniUK, r/GCSE, r/alevel, r/smallbusinessuk before any posting.
