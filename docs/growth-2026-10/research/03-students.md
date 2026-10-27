# Audience research 3: students and young adults (London)

Researched 2026-10-17. Product context: 00-product-catalog.md. Repo not touched.

Method and gaps (read first):
- WebSearch hit its shared per-turn budget (200) partway through, so these were NOT researched: intern/graduate headcounts, gym and run-club audiences beyond PureGym, newsletter subscriber counts, Facebook group sizes, Threads follower counts, Xiaohongshu/WeChat group sizes. Marked "not sourced" below.
- Reddit, HESA, TSR and UCAS pages returned 403/404 to fetch. Reddit sizes are stale GummySearch snapshots (GummySearch closed 2025-11-30).
- Instagram/TikTok follower counts were read from public profile page metadata on 2026-10-17 (curl). Treat as +-5%.
- ONS and Census numbers were pulled live from the Nomis API on 2026-10-17.
- "Rank score" = size x repeat visits x fit, each 1-5, my judgement (not measured).

---

## 1. Sizing: how many people are in this cluster

| Fact | Number | Source |
|---|---|---|
| London residents, mid-2025 | 9,122,909 | ONS via Nomis NM_2002_1 (API, date=2025): https://www.nomisweb.co.uk/api/v01/dataset/NM_2002_1.data.csv?geography=2013265927&date=latest&gender=0&c_age=0,205,6,7,8&measures=20100 |
| London aged 18-24 / 25-29 / 30-34 | 843,620 / 888,221 / 812,771 (18-34 total 2,544,612 = 27.9% of London) | same |
| Inner London aged 25-34 | 23.7% of people (12.7% rest of England) | Trust for London: https://trustforlondon.org.uk/data/topics/population |
| Students at London higher-education institutions | "nearly 550,000" across 140+ institutions (London Higher, July 2026) | https://www.kcl.ac.uk/news/new-campaign-champions-london-as-the-higher-education-capital-of-the-world (dated 20 Jul 2026) |
| London residents 16+ who are full-time students (Census 2021) | 702,947 (191,900 economically active + 511,047 inactive students; 9.9% of 7.10m aged 16+). Includes 16-17 sixth-formers and FE. | Nomis NM_2083_1 (Census 2021 economic activity) |
| International students in London | 179,000+ (almost a third of UK international students); net impact of one cohort GBP 9.59bn | London Higher via PIE News, 4 Apr 2024: https://thepienews.com/must-take-action-ensure-london-remains-worlds-top-study-destination/ . A later 2026 article claims "200,000+ per year" (not verified). |
| UK-wide HE enrolments 2023/24 | 2,904,425 (-1%); entrants 1,318,685 | HESA via Advance HE: https://advance-he.ac.uk/knowledge-hub/governance-news-alert-hesa-enrolment-data-202324 |
| Biggest London providers (2024/25, secondary source) | UCL 51,315; KCL 40,870 | https://unifresher.co.uk/resources/which-are-the-biggest-universities-in-the-uk/ (verify vs HESA) |
| Students' union reach | KCLSU ~36,000 members; Students' Union UCL 48,613 FTE | https://kiwix.lema.org/wikipedia_en_all_mini_2024-02/A/KCLSU ; https://assets.nationbuilder.com/nus/pages/12244/attachments/original/1791209893/Copy_of__NUS_England_Rep_Entitlement_202627.pdf |
| UK 18-year-old applicants, Jan 2026 deadline | 338,940 (record, +4.8%) | Wonkhe: https://wonkhe.com/blogs/what-does-the-2026-january-deadline-data-show/ |
| Applications from UK 18-year-olds to London providers | 239,780 (+5.8%), most of any region (applications, not people) | same Wonkhe page |
| Private-rented households in London (Census 2021) | 1,031,889 of 3,423,887 (30.1%; includes rent-free) | Nomis NM_2301_1 |
| London room ads (SpareRoom Q3 2026 sample) | ~103,000 | https://www.spareroom.co.uk/statistics/london-room-rents-q3-2026 |
| International demand shock | Sponsored study-visa applications Jan-Apr 2026 down 33% vs 2025 (UK-wide) | ICEF: https://monitor.icef.com/2026/05/uk-universities-bracing-for-a-further-decline-in-international-enrolments/ |

Rent anchors (SpareRoom, mean asking incl. bills): Q3 2026 inner London GBP 1,002 (+1.1% y/y), outer GBP 800, Greater London GBP 932. Cheapest postcodes E12 GBP 752, E6 GBP 755, N21 GBP 761. Priciest SW7 GBP 1,682, W1 GBP 1,519, SW3 GBP 1,472. Supply down 7.3% y/y in inner London. Director says average London room needs ~GBP 40K salary. Source: https://www.spareroom.co.uk/statistics/london-room-rents-q3-2026
Demand shift: London room seekers -18% Jan 2020 to Jan 2026 (rest of UK +11%); searches for "Greater London" +38% in 2025, postcode-area searches -20% to -33%; fastest-rising outer search areas Hillingdon +62%, Enfield +46%. Source: https://www.landlordtoday.co.uk/breaking-news/2026/05/renters-falling-out-of-love-with-london-claims-flatshare-site/ (20 May 2026, SpareRoom data).
Implication: young renters are being pushed outward and need exactly the commute + area facts Close Knit has.

---

## 2. Ranking (size x repeat x fit)

| Rank | Audience | Size | Repeat | Fit | Score | Risk |
|---|---|---|---|---|---|---|
| 1 | Room / flatshare seekers and young renters | 5 | 5 | 4 | 100 | medium |
| 2 | Current London students (incl. second-year house-hunters) | 4 | 4 | 4 | 64 | medium |
| 3 | Going-out / explore-London young adults | 5 | 3 | 3 | 45 | low |
| 4 | Interns and new graduates relocating | 3 | 3 | 5 | 45 | low |
| 5 | International students (London) | 3 | 3 | 3 | 27 | medium (census rules, language) |
| 6 | Applicants and their parents | 3 | 2 | 3 | 18 | high (safety claims) |
| 7 | Gym / run-club users | 2 | 3 | 3 | 18 | low |
| lens | Safety walking home | n/a | n/a | n/a | n/a | highest; treat as a content angle only |

---

## 3. Audiences

### 3.1 Room / flatshare seekers and young renters (rank 1)
Who: roughly 2.5m Londoners aged 18-34, many in the 1.03m private-rented households; seekers re-search every 6-12 months and for 2-6 weeks daily when searching.
Hook: Find my area (9-factor match + door-to-door TfL commute), compare areas, walk-to-station, 12-month recorded crime, gyms/cafes/pubs layers, "Fewer bars, pubs and clubs" (quiet nights) preset. Extension currently covers Rightmove/Zoopla/OnTheMarket only; most rooms are on SpareRoom (UK site ~6.14M visits in Sep 2025, Semrush estimate, 78% UK: https://cw.semrush.com/website/spareroom.co.uk/overview). A SpareRoom/OpenRent/Gumtree-capable extension would be the biggest single product lever for this audience (check each site's terms before building).
Weekly return: new ads every day; people re-check an area before each viewing; shareable area links to send to prospective housemates ("is E12 OK?"). Without email, the return trigger has to be social (a weekly postcode post) or the saved-link habit.
Where they are:
- SpareRoom: IG @spareroom ~9.6K, TikTok @spareroom ~9.6K (small, but their stats feed press: Landlord Today, Property Reporter).
- r/london ~1.5M (stale), r/LondonSocialClub ~225K (stale), local Facebook flatshare groups (sizes not sourced). Reddit snapshots: https://gummysearch.com/r/london , https://gummysearch.com/r/LondonSocialClub/ .
- Student halls/university housing groups (see 3.2).
Seasonal: Sept-Oct (post-freshers moves and graduate starts), Jan (new term/new year), quarterly SpareRoom Rental Index releases (Q4 2026 due ~Jan 2027) are a data-journalism hook. Renters' Rights Act in force from 1 May 2026 (one month's rent upfront max; no bidding above advertised rent, per the Close Knit plugin guidance) is a live explainer topic.
Risks: do not imply a listing is "safe"; crime is per 1,000 residents, 12 months, excludes ASB and British Transport Police, and is inflated in central areas with few residents. Do not copy SpareRoom data without attribution. No per-home valuation rule applies; room rent figures must be cited as SpareRoom borough/postcode means, not Close Knit estimates. Self-promo: Reddit communities usually restrict it (not verified for r/london; check each sidebar); Facebook groups often ban links.
Infographic: "GBP 752 rooms: what the commute costs" (3-slide carousel). Slide 1: SpareRoom Q3 2026 cheapest postcodes E12 GBP 752, E6 GBP 755, N21 GBP 761 vs SW7 GBP 1,682. Slide 2: for each, Close Knit walk-to-station minutes and door-to-door TfL minutes to Bank / King's Cross. Slide 3: 12-month recorded crime per 1,000 with the caveat line. Credit SpareRoom and "Powered by TfL Open Data".

### 3.2 Current London students (rank 2)
Who: ~550K at London HE providers; Census 2021 shows 703K full-time students aged 16+ living in London.
Hook: neighbourhood around campus or halls (walk to station, nightlife/gyms/takeaways counts, food hygiene nearby), "where to live next year" for second years, compare two areas, a Find my area run with campus as the pinned place.
Weekly return: Thursday-to-Saturday plans (where to go out), and the Oct-Feb second-year house hunt (typical pattern; not sourced). Students share group links in housemate chats ("can we afford Mile End vs Camberwell").
Accounts and groups (followers read 2026-10-17):
- Official: IG @ucl 321K, @imperialcollege 241K; TikTok King's College London 30.9K.
- Students' unions: IG @kclsu 27K, @lsesu 24K.
- Halls and housing: IG @unite_students 31K, @lsereslife ~9K, @ual_hallslife ~5.2K (these two are recommended to residents by LSE and UAL pages: https://halls.lse.ac.uk/story/22044239/must-follow-instagram-accounts-for-london-content , https://hallslife.arts.ac.uk/story/22805723/your-london-guide-social-media-accounts-to-follow ).
- Student platforms: The Student Room ~5.9M registered members, 5.2M threads (forum stats page, undated): https://www.thestudentroom.co.uk/forum.php?f=6 ; claims of 5-10M monthly users are unverified (https://my.barton.ac.uk/digital/?p=747302); Ahrefs puts organic search visits at ~266K in Jul 2025: https://ahrefs.com/websites/thestudentroom.co.uk ; TSR socials are small (IG ~14K, TikTok ~8.5K).
- Discounts: Student Beans IG 136K, TikTok 217.7K; UNiDAYS ~20M verified members worldwide (undated SU page: https://upsu.com/news/article/upsu/Accessing-student-only-deals-and-discounts ).
- Reddit: r/UniUK ~221K (stale): https://gummysearch.com/r/UniUK .
- Study London brand (London Higher), relaunched 12 Jun 2024, on X, Instagram, LinkedIn and TikTok: https://www.onlondon.co.uk/anna-zvagule-new-study-london-campaign-matters-for-the-whole-of-the-city . Handles not verified.
Seasonal (2026 pattern, repeat in 2027): freshers/welcome passes Northeastern London from 7 Sep; UEL and Brunel passes 13-20 Sep; London Met 20-27 Sep; York St John London w/c 21 Sep (commercial listings: https://eventslist.co.uk/london/events/london-metropolitan-university-freshers-pass-2026 ). UCL/KCL/Imperial/LSE dates not confirmed. Second-year house hunt Oct-Feb (not sourced). January intake at many London universities (https://gostudyin.com/study-in-uk/study-guides/london-universities-january-intake/ ). Exam season Apr-Jun; graduation Jul.
Risks: halls accounts and SUs control their channels, so this is partnership not posting; universities are cautious about being named in crime comparisons. Counts of bars/pubs/clubs describe places, not who goes there.
Infographic (real data, run 2026-10-17 on Close Knit release rel-202610161805-kids, count of places inside each neighbourhood boundary, London median per neighbourhood is 0):
"Four campuses, one chart" - bars/pubs/clubs / takeaways / gyms:
- Bloomsbury West W1T (UCL, WC1E 6BT): 21 / 18 / 11
- Knightsbridge side SW7 (Imperial, SW7 2AZ): 22 / 8 / 11
- Mile End West E1 (QMUL, E1 4NS): 4 / 7 / 2
- Lambeth North and Waterloo SE1 (SE1 8WA): 8 / 6 / 2
Caveat to print: places merge OSM, FSA, Overture and Foursquare; neighbourhood boundary, not walking radius; central totals are boundary artefacts (City of London EC2M tops every list: 296 bars, 265 takeaways, 96 gyms, 23 colleges).

### 3.3 Going-out and explore-London young adults (rank 3)
Who: the 2.5m aged 18-34 plus visitors; "Londonmaxxing" (a 2026 trend about getting the most out of London, started on X, covered by The Times 26 Mar 2026 and The Evening Standard 20 Apr 2026, endorsed by Sadiq Khan, spread to cultural-scene content): https://en.wikipedia.org/wiki/Londonmaxxing . London Higher uses the term in its July 2026 campaign: https://thepienews.com/londonmaxxing-the-latest-trend-in-international-education/
Hook: place layers as a "where to go this weekend" tool: Bars, pubs and clubs, takeaways, cinemas/theatres/museums, variety of cuisines, specialty coffee vs kebab shops, markets (walk minutes), nightlife vs station walk.
Weekly return: this is where a recurring content format ("Neighbourhood of the week", Thursday post) creates the habit; the site itself offers no reminder.
Benchmark accounts (IG followers, TikTok followers): @secret.london 3M / 356K; @london 3M; @visitlondon 2M / 559K; @timeoutlondon 1M / 175K; @exploringlondon 853K / 145K; @ministryofsound 870K; @london.foodguide 222K (TikTok @londonfoodguide 12.8K); @hotdinners 126K / 35K; @londongraffiti 55K. Cheap-eats creator example: @samaspeaks (TikTok 36K) - Time Out, Aug 2025, five meals under GBP 10 (Finchley, Haringey, Old Kent Road, Barking, Southall): https://www.timeout.com/london/news/londons-best-cheap-eats-according-to-tiktok-foodie-sama-ansari-pour-082025 .
Newsletters (Time Out, Londonist, Secret London, Hot Dinners): subscriber counts not sourced.
Seasonal: freshers weeks (Sep), Christmas parties (Dec), spring "Londonmaxxing" peak, summer.
Risks: Close Knit has no prices, no opening hours, no reviews; "cheap eats" is a weakness vs creators, so lean on counts, variety and food hygiene (FSA share rated 4-5 within 800m). Do not rank areas as "best nightlife": it counts venues, not quality or safety. Closed venues may still be listed.
Infographic/reel: "5 postcodes, 5 Friday nights" (reel, 20s). Each postcode shown with its bars/pubs/clubs count, cuisine variety, nearest market minutes, and walk to station, ending on "Open it on the map" link. Alt: "Specialty coffee vs kebab shops" balance map (preset good-coffee-kebab) as a fun share graphic.

### 3.4 Interns and new graduates relocating (rank 4)
Who: headcount not sourced (search budget). Proxy: 25-29 and 30-34 bands are 888K and 813K in London. Sources to check next: HESA Graduate Outcomes, High Fliers, Bright Network, Prospects.
Hook: Find my area with workplace pinned, door-to-door commute, rent context by borough, gyms/coworking/cafes ("Coworking spaces, libraries and cafés" preset) for WFH.
Weekly return: months 1-3 after the start date; then once at lease renewal.
Seasonal: summer internships May-Aug (short-let search from ~Mar-May, not sourced), graduate starts Sep-Oct.
Risks: commute accuracy (TfL data, cite "Powered by TfL Open Data"); employers' names should not be used as brands in copy.
Infographic: "Commute vs rent sweet spots" - 5 outer-borough postcodes with door-to-door minutes to King's Cross, Canary Wharf and Shoreditch, coloured by SpareRoom borough room rent.

### 3.5 International students (rank 5)
Who: 179K+ in London (2024), UK demand falling (visa applications -33% Jan-Apr 2026 vs 2025). UK-wide top countries are China and India; one secondary source gives 145,620 (China) and 107,555 (India) for 2023/24: https://en.uhomes.com/blog/which-uk-universities-have-the-most-chinese-students (verify vs HESA). Platform sizes (Xiaohongshu, WeChat groups, Indian Telegram/WhatsApp groups) not sourced.
Hook: arrive-blind problem: they pick halls or a flat before seeing the area: walk to station, door-to-door commute, nearby markets and cuisine variety, food hygiene.
Weekly return: low outside Aug-Oct arrivals.
Risks: English-only product; census must never be used to point people to or away from areas by origin (product rule), so no "areas with many X students" content. Rental-scam content is out of scope but needs a caveat.
Infographic: "Landing in London: 6 things to check around your halls" (walk to station minutes, nearest market, variety of cuisines, food hygiene nearby, bike parking, nearest gym).

### 3.6 Applicants and parents (rank 6)
Who: 338,940 UK 18-year-old applicants (Jan 2026); London providers received 239,780 applications from UK 18-year-olds (+5.8%). Parents are not buyers but ask "is it safe".
Hook: neighbourhood around each campus compared side by side; "where would I live" for second year.
Weekly return: low; concentrated Oct-Feb then offer-holder visits in spring.
Dates (2027 entry, https://www.theprofs.co.uk/student-resources/university-applications/ucas-key-dates-and-deadlines-for-2027-entry/ ): 15 Oct 2026 Oxbridge/medicine/dentistry/vet deadline (passed); 13 Jan 2027 18:00 main deadline; 25 Feb 2027 Extra opens; 2 Jun 2027 offer reply deadline; 30 Jun apps after this go to Clearing; 2 Jul 2027 Clearing opens; 23 Sep 2027 final deadline. A-level results day 2027: BCU lists 12 Aug 2027 (unconfirmed). 2026 cycle: results day 13 Aug 2026; Clearing runs 2 Jul-19 Oct 2026 (last day to add a choice is 19 Oct 2026, two days from now). Wonkhe on 2026 Clearing: https://wonkhe.com/wonk-corner/a-busy-ucas-clearing-for-2026/
Risks: highest. Never say "safe" or "unsafe"; show recorded crime per 1,000 residents with the caveat. Under-18s: the site collects no emails, which helps. Universities may object to ranking their campus areas.
Infographic: "Deadline week 13 Jan: the neighbourhood around 4 campuses" using the same chart as 3.2, no ranking, no verdict.

### 3.7 Gyms and run clubs (rank 7)
Scale: PureGym is Britain's largest chain, 1.9M+ members UK-wide, 362 UK gyms Dec 2024 (no London split): https://en.wikipedia.org/wiki/PureGym . Close Knit has gyms/sports centres/pools/yoga/tennis as places.
Hook: "gyms within walking distance of the flat" criterion; repeat is weak (one-off decision) unless tied to a new-year January spike.
Infographic: "Gym deserts: London neighbourhoods with 0 gyms" using the gyms preset (London median per neighbourhood: 0). Check data first.

### 3.8 Lens: safety walking home at night
Evidence: a July 2024 ITV News survey (n=1,232 young adults) found 81% of women aged 18-25 feel unsafe walking home in the dark (second-hand: https://policeprofessional.com/?p=140779 ). The Mayor's Charter for Women's Safety at Night and UCL research are context (https://www.ucl.ac.uk/research-innovation/case-studies/2021/sep/exploring-womens-night-walking-safety-london-built-environment-perspective ).
Hook without a claim: station-to-door walking minutes (Close Knit "Walk to a station", median minutes along mapped paths at 4.8 km/h), pubs/clubs counts, recorded crime per 1,000 with caveats.
Risks: never score safety; avoid naming and shaming small areas; link to police.uk and TfL; crime data excludes ASB and BTP and uses resident denominators.
Infographic: "How far is the station from your door?" - a ranking-free map or small multiples of walk-to-station minutes for 8 student postcodes. No safety wording.

---

## 4. Seasonal calendar (today is 2026-10-17)

| When | What | Audience |
|---|---|---|
| 19 Oct 2026 | Last day to add a Clearing choice (2026 cycle) | applicants |
| Oct-Feb (typical) | Second-year student house hunt (not sourced) | students |
| Nov-Dec | Christmas party season | going-out |
| 13 Jan 2027, 18:00 | UCAS main deadline | applicants, parents |
| Jan 2027 | London university January intake; new-year gyms; SpareRoom Q4 2026 rent index | students, renters |
| 25 Feb 2027 | UCAS Extra opens | applicants |
| Mar-Apr | "Londonmaxxing" peaked in 2026 | explorers |
| May-Aug | Summer internships; short-lets | interns |
| 2 Jun 2027 | Offer reply deadline | applicants |
| 2 Jul 2027 | Clearing opens | applicants |
| ~12 Aug 2027 | A-level results (unconfirmed) | applicants |
| 7-27 Sep 2027 (pattern) | Freshers | students, international |
| 23 Sep 2027 | UCAS final deadline | applicants |

---

## 5. Cheap tests to run first
1. Four-campus chart (3.2) as an IG carousel via two students' unions (KCLSU 27K, LSESU 24K) and two halls accounts, tagging with utm_source per account (analytics already tracks retention by utm_source).
2. "GBP 752 rooms" carousel (3.1) timed to the SpareRoom Q4 2026 release in January; pitch the numbers to property trade press.
3. One "Neighbourhood of the week" reel on Thursdays for 6 weeks (3.3); compare day-7 retention against posts for 3.1.
4. Product ask: extension support on SpareRoom (the biggest gap for rank 1), subject to terms of use.

## 6. Cross-cutting risks
- Safety claims: describe, do not rate. Crime per 1,000 residents in the centre is inflated by tiny resident counts; ASB and BTP excluded.
- Census: never rank or filter people; no origin-based area lists for international students.
- Place counts: OSM + FSA + Overture + Foursquare merge; stale entries; boundary artefacts (EC2M).
- Self-promo: Reddit communities normally limit it; Facebook flatshare groups often remove links; verify each rule set before posting. Use creators, SUs and halls accounts instead.
- Attribution: SpareRoom, TfL ("Powered by TfL Open Data"), police.uk (OGL), ONS.
- Age: applicants are 17-18; the site collects no emails, so keep it that way for this audience.

## 7. Source URLs not already inline
- Student numbers: https://www.gov.uk/government/statistics/higher-education-student-enrolments-uk-2023-to-2024
- International student trend (Wikipedia compilation of HESA): https://en.wikipedia.org/wiki/International_students_in_the_United_Kingdom
- Freshers nightlife guide: https://www.musicofourdesire.com/blog/freshers-week-london
- SpareRoom stats hub: https://www.spareroom.co.uk/statistics
