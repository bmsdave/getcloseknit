# Audience research 1: nature and outdoors (not moving home, would return weekly)

Researched 2026-10-17. Product context: 00-product-catalog.md.

How to read this file
- VERIFIED = number read on the cited page or API today. DERIVED = my arithmetic on verified numbers. UNVERIFIED = secondary or undated; treat as a range.
- Instagram/Threads/Facebook counts were read today from each public profile's meta tag (rounded by the platform).
- Search budget ran out mid-task. Not retrieved: Reddit sizes (reddit.com blocks fetches), private Facebook groups (login wall), small London creator accounts, Overpass/OSM counts (API refused). Anything missing below is a gap, not a zero.

---------------------------------------------------------------------
## 1. Ranking (size x repeat x fit, each 1-5)

| # | Audience | Size | Repeat | Fit now | Score |
|---|----------|------|--------|---------|-------|
| 1 | Garden-bird and urban-wildlife spotters (RSPB / Springwatch crowd, hedgehog people, casual birders) | 5 | 3 | 5 | 75 |
| 2 | Dog walkers | 5 | 5 | 3 | 75 |
| 3 | Serious naturalists, patch-listers, iNaturalist/BirdTrack recorders | 2 | 5 | 4 | 40 |
| 4 | Runners (parkrun first) | 4 | 5 | 2 | 40 |
| 5 | Cyclists | 4 | 4 | 2 | 32 |
| 6 | Tree lovers and autumn/blossom photographers | 3 | 2 | 4 | 24 (time-critical now, see section 12) |
| 7 | Wild swimmers | 3 | 3 | 2 | 18 (becomes 36 with a bathing-water layer) |
| 8 | Gardeners and allotment holders | 4 | 2 | 2 | 16 |

Notes on scoring
- #1 and #2 tie. Wildlife goes first because the data already exists in the product. Dogs are the biggest weekly-habit audience but need park/walk content Close Knit does not have yet.
- #3 is small but is the credibility layer: they validate the wildlife layers, and they log nearly daily. About 500 London iNaturalist users produce 75% of London's observations (section 4).
- Fit is judged on the catalog only. "Fit" rises if the roadmap adds: parkrun start points, bathing-water status, allotments (OSM landuse), recent-sightings slice, trees layer (in progress).

Common weekly-return mechanics (what actually brings people back, across audiences)
1. "This week near you" card: last 7 days of new sightings and what is in season (swifts back, frogspawn, rut). Needs a recent slice of GBIF/iNaturalist; today's layers are cumulative.
2. A checklist to finish: patch list (species recorded in my area vs seen), "LonDone" (all Greater London parkruns), "20 species in my borough".
3. Event pegs with a date: Big Garden Birdwatch, City Nature Challenge, rut, National Tree Week, bathing-water season.
4. Shareable comparison cards (borough vs London) that people post to prove a point about their own patch.
5. Closed-loop: show a result after the event (BGB, CNC) with a link back to the area page.

---------------------------------------------------------------------
## 2. Garden-bird and urban-wildlife spotters (rank 1)

Size (VERIFIED unless marked)
- RSPB: about 1.1 million members incl. 195,000 youth members (2023/24), Wikipedia citing RSPB. Mark Avery (ex-RSPB) says roughly 1.2m (UNVERIFIED, blog). https://en.wikipedia.org/wiki/Royal_Society_for_the_Protection_of_Birds ; https://markavery.info/2024/11/28/rspb-replies-to-my-open-letter-3/
- Big Garden Birdwatch 2026: 650,000+ people, 9.4 million birds; House Sparrow most commonly sighted, 1,275,378 counted; 13.4m hours counted since 1979. 2025 was about 590,000 (search snippet). https://www.rspb.org.uk/whats-happening/big-garden-birdwatch/results ; https://www.rspb.org.uk/whats-happening/big-garden-birdwatch
- London share of BGB is not published on the page. If proportional to population (~13% of UK) it would be about 80k, but that is only an upper-bound guess (DERIVED, not sourced).
- The Wildlife Trusts: over 900,000 members across 46 trusts. London Wildlife Trust: 20,000 members, 1,800 volunteers, 36 reserves free to enter (about page); homepage says "more than 12,000" (conflict, use 12-20k). https://www.wildlondon.org.uk/about ; https://www.wildlondon.org.uk/
- Hedgehog Street: 136,643 registered Hedgehog Champions (UK). https://www.hedgehogstreet.org/
- Bat Conservation Trust Facebook: 136,746 followers. https://www.facebook.com/BatConservationTrust
- Royal Parks: over 77 million visits a year across 8 parks (London Assembly briefing, based on 2013/14 counts). https://www.london.gov.uk/media/107051/download

Accounts and sizes (Instagram / Threads / Facebook)
- @bbcspringwatch IG 590K
- @rspb IG 544K, Threads 97.6K
- @thewildlifetrusts IG 388K, Threads 62.8K, FB 208,956
- @natural_history_museum IG 1M, FB 843,620
- @nhm_wpy (Wildlife Photographer of the Year) IG 294K
- @bbcwildlifemagazine IG 182K
- @londonwildlifetrust IG 37K, FB 19,082
- @wwtlondon (London Wetland Centre) IG 18K, FB 12,730
- @walthamstowwetlands IG 11K
- @theroyalparks IG 99K, Threads 12.2K
- Clubs: London Natural History Society (London Bird Club is a section; membership figure not found). https://lnhs.org.uk/index.php/about-us/who
- Reddit / Facebook groups: sizes NOT retrieved. Names to check by hand: r/ukbirds, r/london, borough and "patch" Facebook groups, BirdForum.

Hook in Close Knit
- Wildlife layers: bats, deer, fox, frog, hedgehog, heron, house sparrow, kingfisher, newt, owl, swift, woodpecker, plus nature score. House sparrow is the RSPB headline bird; swift and hedgehog both have large campaign communities.

What brings them back weekly
- In season: swifts arrive and leave, frogspawn, hedgehog hibernation, rut. After BGB: "compare my result to my area".
- A "recent sightings in my LSOA" view (not in the catalog today).

Risks
- Sensitive species: owls, kingfishers (nest burrows), bats (roosts legally protected), swift nest sites. Never show point locations; keep area-level (LSOA/MSOA) only and say so. GBIF generalises sensitive species, but verify per dataset before launch.
- Counts show recorder effort, not abundance. Always normalise (share of all bird records) and label it. A busy park will out-score a quiet street.
- GBIF licences: some records are CC-BY-NC; check the DOI/licence list already planned for launch.
- Self-promo: Facebook nature groups and subreddits often restrict links; rules were not retrieved (UNVERIFIED). Ask admins first, lead with the finding, not the site.

Instagram/Threads idea
- Title: "London's last sparrow streets"
- Shows: carousel. Slide 1: house sparrow share of all bird records by borough (top 5 and bottom 5, normalised). Slide 2: the RSPB 2026 fact (sparrow still no.1 nationally, 1,275,378 counted) against London's picture. Slide 3: map strip of the MSOAs with the highest sparrow share, area-level only. CTA: "Is your area on it?" Tag @rspb, @londonwildlifetrust.
- Threads variant: one stat plus one map screenshot.

---------------------------------------------------------------------
## 3. Dog walkers (rank 2)

Size
- UK: about 15.5 million dogs in 41% of households (up from 12.5m / 33% in 2021); survey in Jan 2026. London has the highest share of dog-owning households at 49% (46% in the 2024 report). VERIFIED (UK Pet Food Pet Population Survey 2026). https://www.ukpetfood.org/resource/britain-s-dog-ownership-boom-as-15-5-million-dogs-now-live-in-uk-homes.html ; https://www.ukpetfood.org/resource/london-leads-the-pack-as-the-uk-s-pet-capital.html
- London dog headcount: no primary figure. PDSA 2018 estimated about 700,000 dogs (16% of adults). A secondary article cites about 1.2m citing ONS (UNVERIFIED). Use the range 0.7-1.2m+. https://www.pdsa.org.uk/media/5896/47322_paw-report-2018_regional_london_v7.pdf
- Walk grounds: Royal Parks 77m visits/year; Bushy Park holds the parkrun record, so dog walkers and runners share the same turf.

Accounts and sizes
- @dogstrust IG 548K
- @borrowmydoggy IG 177K
- Meetup "London Dog Walks" network: 64 groups, some over 1,000 members; one Richmond Park bulldog meetup about 740 (undated, UNVERIFIED). https://meetup.com/topics/dog-walks/gb
- Heepsy July 2026 London dog-influencer list: one account about 353K, most 8-25K (individual dogs, not communities). https://www.heepsy.com/top-instagram/dogs/london
- Facebook groups and Reddit: sizes NOT retrieved.

Hook in Close Knit
- Dog parks layer, vets, parks and nature score, pools/playgrounds as proxies of green space, crime by area, quiet nights.
- Missing for the habit: named park pages with facilities, off-lead rules, water access.

What brings them back weekly
- Daily walk decisions. Seasonal alerts: rut (late September to early November; keep dogs on leads or walk elsewhere, keep 50-100 m from deer), blue-green algae in ponds (the Environment Agency issued a bloom warning on the Thames at Ham on 17 August 2026), heat, grass seeds.
- Sources: https://www.royalparks.org.uk/get-in-touch/media-centre/news-press-releases/new-film-highlights-safety-during-deer-rutting-season-richmond-bushy-parks ; https://www.richmond.gov.uk/services/community_safety/water_safety/bathing_site

Risks
- Do not map or infer where dog owners live; OSM counts places, not people. Dog theft is a live worry, so never publish routines or home areas.
- Veterinary and pet brands will be tempted to sponsor; keep neutral wording.
- Self-promo in dog groups is usually banned for commercial links (UNVERIFIED).

Instagram/Threads idea
- Title: "Where London dogs run free"
- Shows: boroughs ranked by enclosed dog parks and green space per 100k residents (OSM, labelled "places not dogs"), with the 3 boroughs that have the fewest. Reel version: 20-second pan across London, pins appearing in order of density. Tag @dogstrust, @borrowmydoggy cautiously (not paid).

---------------------------------------------------------------------
## 4. Serious naturalists, patch-listers, iNaturalist / BirdTrack recorders (rank 3)

Size (iNaturalist numbers are PRIMARY, from api.inaturalist.org, place_id 66357 Greater London, pulled 2026-10-17)
- All time: 1,057,143 observations; 38,707 observers; 14,493 species.
- By year: 2022: 88,505 obs / 6,053 observers. 2023: 139,336 / 7,044. 2024: 161,441 / 8,110. 2025: 215,139 / 9,268 (obs +33% vs 2024, observers +14%). 2026 year-to-date: 219,874 / 8,902 (already above all of 2025).
- 2025 mix: plants 84,249 (39%), insects 64,065, birds 32,239, fungi 15,608, mammals 2,976, amphibians 751. Birds are only 15% of London iNaturalist, so plants/insects/fungi people are a bigger iNat crowd than birders.
- Concentration: top 100 observers = 56% of 2025 London observations; top 500 = 75% (the 500th logged 44 observations). The core is a few hundred people; the other ~8,800 are casual (about 6 observations each).
- City Nature Challenge London: 2025: 660+ community scientists, 19,353 observations, 1,926 species (NHM). 2024: 560+ recorders, 8,012 observations. 2026 ran 24-27 April; a Green Londoner / Regen City campaign aimed at 1,000+ Londoners. https://www.nhm.ac.uk/take-part/citizen-science/bioblitz/city-nature-challenge.html ; https://luma.com/4rj0g9rq
- UK iNaturalist: about 126,000 users by 2023 (NBN analysis); UK is the 4th biggest contributor to global growth in 2025. https://nbn.org.uk/news/inaturalistuk-user-survey-reports/ ; https://nbn.org.uk/news/inaturalistuk-year-in-review-2025/
- BTO: 50,000 volunteers (BTO page); BirdTrack (partner of RSPB etc.); membership count not found. https://www.bto.org/about-bto
- @btobirds IG 45K. iNaturalist.org FB 110,191. GiGL (London's biodiversity records centre) offers a public Discover London map. https://www.gigl.org.uk/

Hook in Close Knit
- GBIF sightings by species, area comparison, nature score. Natural "patch" framing: which species are recorded in my LSOA and which are missing.

What brings them back weekly
- They already log daily elsewhere (iNaturalist, BirdTrack, eBird). Close Knit must add what those do not: "species recorded in my area vs the borough", "gaps nobody has recorded", "first record this year".

Risks
- Experts spot errors fast; credibility depends on correct methodology and clear data attribution (GBIF DOIs).
- Sensitive species again; they will test it.
- Tools/apps promo: iNaturalist forum and BirdForum have their own norms (UNVERIFIED); introduce the tool as feedback request.

Instagram/Threads idea
- Title: "The 500 who record London"
- Shows: one stat story. In 2025 about 9,300 people logged 215,000 London observations, but 500 of them logged 75%. Slide 2: the least-recorded boroughs (from Close Knit GBIF density, normalised by area). CTA: add one observation in the emptiest MSOA near you. Tag @natural_history_museum (CNC organiser) and @londonwildlifetrust.

---------------------------------------------------------------------
## 5. Runners, parkrun first (rank 4)

Size
- UK parkrun: 879 events (30 Aug 2026, Wikipedia); about 190,000 participants per week as of March 2026. https://en.wikipedia.org/wiki/Parkrun ; https://www.geograph.org.uk/photo/8281075
- London (DERIVED from parkrun's own public events.json, https://images.parkrun.com/events.json, pulled today): UK has 901 5k events and 534 junior events. Inside a Greater London bounding box there are 82 5k and 59 junior events; the box also catches some pins just outside the boundary (e.g. Rickmansworth, Brentwood, Cassiobury, Gunpowder), so about 65-75 5k events are inside Greater London (my estimate; a proper boundary join would give the exact count). If London averages 200-250 runners an event, that is 15-20k people each Saturday (my estimate, UNVERIFIED).
- Bushy parkrun: record 6,204 finishers on 31 Aug 2024 for event no. 1,000; first run 2 Oct 2004 with 13 runners. https://www.guinnessworldrecords.com/world-records/771973-most-people-attending-a-single-parkrun-event
- Events: TCS London Marathon 24-25 April 2027, first time across two days; organiser page says 100,000 runners will take part in 2027 (capacity figure). https://www.londonmarathonevents.co.uk/london-marathon

Accounts and sizes
- @parkrunuk IG 233K, FB 200,309; @bushyparkrun IG 7.2K; @hampsteadheathparkrun IG 1.4K
- @londonmarathon IG 591K; @runnersworlduk IG 192K; @strava IG 2M
- Run clubs (Run Dem Crew, etc.): handles and sizes not confirmed.
- Note: Instagram counts for @hampsteadheathparkrun and @bushyparkrun come from their public profile meta tags; I did not confirm they are the official event accounts.

Hook in Close Knit
- Parks/green space and nature score; "run from my door" is not a Close Knit feature. Strongest idea: a parkrun layer (all Greater London start points) with the area facts around each one, and a "LonDone" tracker (parkrun's own challenge: finish every Greater London parkrun).

What brings them back weekly
- The Saturday 9am ritual, plus Christmas Day and New Year's Day doubles. Bushy's Christmas Day 2019 had 2,545 (fastrunning.com ranking, older).

Risks
- parkrun's events.json is public but terms of reuse are not checked (UNVERIFIED); seek permission before building on it. Never use individual result data.
- Runner safety/crime maps feel intrusive; keep to area-level facts.
- Strava owns route behaviour; do not compete.

Instagram/Threads idea
- Title: "Every London parkrun, ranked by green"
- Shows: map of ~70 London 5k parkruns, each pin sized by tree/nature score of its MSOA, with the nature-score top 5 and bottom 5. Reel: pins popping up in start-time order, with a Saturday-morning countdown. Tag @parkrunuk.

---------------------------------------------------------------------
## 6. Cyclists (rank 5)

Size (VERIFIED)
- TfL: about 1.5 million cycle journeys a day in 2025, up 12.7% on 1.33m in 2024 and 43% above 2019; cycle network over 431 km (90 km in 2016). Journeys, not people. https://www.bikeradar.com/news/transport-for-london-2025-travel-in-london ; https://tfl.gov.uk/info-for/media/press-releases/2024/november/new-tfl-data-shows-cycling-journeys-in-london-are-up-by-26-per-cent-compared-to-2019-levels
- London Cycling Campaign: "20,000+ members and supporters" (its Facebook description); Wikipedia says over 11,000 members (undated). Borough group for each of the 33 boroughs. FB followers 21,007. https://en.wikipedia.org/wiki/London_Cycling_Campaign ; https://www.facebook.com/LondonCyclingCampaign
- Strava: 180m users globally, 2025 Year in Sport (UK/London counts not found). https://www.bikeradar.com/news/strava-year-in-sport-2025

Hook in Close Knit
- Bike parking layer. Possible: bike theft by area (police data) if the product holds that category; not confirmed in the catalog.

Weekly return
- Weak without routes or live data. Strava, Citymapper and TfL own it.

Risks
- OSM bike parking is incomplete; do not claim "bike parking deserts" as fact. TfL publishes its own cycle parking data; cross-check.
- Cycling is politically heated in London (LTNs); keep wording neutral.

Instagram/Threads idea
- Title: "Where to lock your bike"
- Shows: boroughs by bike parking spots per 10,000 residents (OSM, flagged as incomplete) next to bike-theft rate if available. CTA: link to the area page.

---------------------------------------------------------------------
## 7. Tree lovers and autumn/blossom photographers (rank 6; urgent right now)

Size
- Woodland Trust: income 2024-25 of £89.4m, of which membership £13.6m; members/supporters quoted anywhere from 300,000 to 500,000+ (UNVERIFIED, Wikipedia and a third-party page). @woodlandtrust IG 477K. https://www.woodlandtrust.org.uk/media/bvdedeju/woodland-trust-report-and-accounts-2024-2025.pdf
- Ancient Tree Inventory: over 240,000 verified records; 168 volunteer verifiers added 17,283 in 2025. Nature's Calendar: 2,500 new registrations in 2025. https://naturescalendar.woodlandtrust.org.uk/blog/2026/a-big-thank-you-to-all-citizen-science-volunteers/
- London trees: GLA/LTOA dataset London Public Realm Trees covers over 1.1 million street and park trees (update May 2025); London i-Tree estimate is over 8 million trees (all land types). Source from a search result; the dataset page returned 404 today, so re-check the URL. https://ckan.publishing.service.gov.uk/dataset/london-public-realm-trees
- Treezilla (Open University) crowd-maps trees; London-specific count not found. https://nbn.org.uk/news/launch-of-treezilla/
- Accounts: @thetreecouncil IG 21K; @treesforcities IG 22K; @kewgardens IG 881K; @theroyalparks IG 99K. No London-specific tree-lover account with real size was found.

Seasonal peaks (VERIFIED where noted)
- Autumn colour: now to mid-November. Londonist's autumn guides name Richmond Park, Regent's Park Broad Walk, Blackheath Avenue in Greenwich Park, maples in Notting Hill. https://londonist.com/london/art-and-photography/autumn-in-london
- National Tree Week (UK, Tree Council): 21-29 November 2026. https://www.treecouncil.org.uk/take-part/national-tree-week/
- Blossom: late March to April (general knowledge, not sourced).

Hook in Close Knit
- Trees layer in progress; London Public Realm Trees is the obvious base. Nature score.

Weekly return
- Seasonal, not weekly, unless there is an "autumn colour index" or "this week's best streets". Strong shareability and press interest.

Risks
- The public-realm tree data is council-supplied and uneven (boroughs that did not send data kept 2019-20 numbers). Label the year.
- Photographers crowding fragile spots; no precise locations for veteran or ancient trees of conservation concern.

Instagram/Threads idea
- Title: "London's most golden streets"
- Shows: top 10 streets/MSOAs by share of maple, ginkgo, plane and lime trees (species mix), with a swatch bar showing autumn palette, and a "peak date" estimate. Tie to National Tree Week (21-29 Nov). Tag @thetreecouncil, @treesforcities, @woodlandtrust.

---------------------------------------------------------------------
## 8. Wild swimmers (rank 7)

Size
- Outdoor Swimming Society: Wikipedia says it claims over 200,000 members (source dated Dec 2023); its Facebook page says "over 100k members". Self-reported, UK-wide. @theoutdoorswimmingsociety IG 67K; FB 30,748. https://en.wikipedia.org/wiki/Outdoor_Swimming_Society ; https://www.facebook.com/outdoorswimmingsociety
- Hampstead Heath bathing ponds: 655,000 swim visits a year (2020), up 121% in a decade from 296,000. https://www.camdennewjournal.co.uk/article/heath-managers-you-will-have-to-splash-out-to-swim-in-ponds
- Swim England: IG 47K, Threads 6.9K, FB 62,499 (pool-led, not wild).
- Big news hook: the River Thames at Ham and Kingston was designated London's first river bathing water on 15 May 2026 (season 15 May to 30 September; 464 designated sites nationally). A blue-green algae bloom warning was issued on 17 August 2026. https://www.richmond.gov.uk/news/news_may_2026/londons_first_thames_bathing_site ; https://www.gov.uk/government/news/communities-set-to-benefit-from-13-new-bathing-spots-proposed-across-england
- London wild-swim groups/Facebook groups: sizes NOT retrieved. OSS says there are 50+ wild swim groups UK-wide (2019). https://www.outdoorswimmingsociety.com/wild-swim-groups/

Hook in Close Knit
- Pools and sports centres layers only. Real hook needs a bathing-water layer (Environment Agency open data) plus lidos and ponds.

Weekly return
- Seasonal and highly checked: "is it safe today". Winter swimming keeps Heath ponds busy year-round.

Risks
- Safety liability: never say "safe to swim". Link to Environment Agency status, show the date, and refuse to infer. Algae and sewage alerts change daily.
- Cold-water deaths are a recurrent news story; keep tone factual.

Instagram/Threads idea
- Title: "Where London can actually swim"
- Shows: public pools, lidos and designated bathing water per borough (OSM plus EA), with a call-out for the Ham designation and the 3 boroughs with the fewest public pools per 100k. Carousel plus a note that water quality changes daily.

---------------------------------------------------------------------
## 9. Gardeners and allotment holders (rank 8)

Size
- RHS: 609,000+ members (2024, Wikipedia; the RHS 2025-26 report mentions local-membership decline). @the_rhs IG 446K, Threads 73.8K. @gardenersworldmag IG 560K, Threads 110.5K. https://en.wikipedia.org/wiki/Royal_Horticultural_Society
- London allotments (Imperial College study, news 14 Sept 2020): 24,883 plots across 682 sites; over 30,000 people waiting; average wait 4-5 years; demand up four-fold since 2006; 41 sites closed in seven years; plot supply would need to grow 77%. 64% of plot holders are women. https://www.imperial.ac.uk/news/204133/thousands-chasing-london-allotments-supply-dwindles/ ; https://www.sustainweb.org/news/nov20-allotment-demand-outstrips-supply
- Capital Growth (Sustain): London food-growing network, over 2,000 spaces/members; 2,012-space target met in 2012. https://www.capitalgrowth.org/what_we_do/
- Newham alone: waiting list over 4,000 for about 727 plots (council policy document). https://newham.gov.uk/downloads/file/8115/allotment-policy-side-by-side

Dates
- Chelsea Flower Show 18-22 May 2027 (public days 20-22 May). https://www.rhs.org.uk/shows-events/rhs-chelsea-flower-show
- National Allotments Week 10-16 August 2026 (2027 dates not shown). https://thenas.org.uk/national-allotments-week/
- London Open Gardens 6-7 June 2026 (120+ gardens; 2027 TBC). https://londonist.com/london/things-to-do/london-open-gardens
- Bulb planting and hedgehog hibernation: autumn (general knowledge).

Hook in Close Knit
- Garden-wildlife layers (hedgehog, house sparrow, frog, newt), nature score. Allotments are not in the catalog; OSM landuse=allotments is an easy add.

Weekly return
- Low and seasonal. Good for one-off sharing, not a weekly habit.

Risks
- Waiting-list figures are borough-by-borough and go stale fast (2018-2020 FOIs); label dates.
- Do not publish plot-holder names or exact plot locations.

Instagram/Threads idea
- Title: "The 5-year wait for a plot"
- Shows: the Imperial figures (30,000 waiting, 4-5 years, 41 sites lost) next to a borough strip of nature score and garden-wildlife records (hedgehog, frog, newt). CTA: "Records near your plot".

---------------------------------------------------------------------
## 10. Wildlife photographers (fold into 2 and 7)

- Sizes: @nhm_wpy IG 294K, @natural_history_museum IG 1M, @bbcwildlifemagazine IG 182K. London-specific photographers (Simon de Glanville, Joseph Hart, Kyle Moore, Laurent Geslin) appear in press but follower counts not retrieved. https://www.digitalcameraworld.com/features/my-mission-to-highlight-the-beauty-of-londons-urban-wildlife
- Hooks: heron, kingfisher, owl, fox, deer, parakeet layers; golden hour hotspots such as Richmond Park deer in rut.
- Risks: disturbance at nests and roosts; Royal Parks asks photographers to use long lenses and keep back from deer (see Section 3). Never give point locations for owls, kingfisher nests or bat roosts.
- Idea: "Heron hour" reel: ten London parks ranked by heron records per km2 at area level, with a "please keep your distance" end card.

---------------------------------------------------------------------
## 11. Competitors and partners worth knowing

- London National Park City: "Urban Nature Map" covering 4,000+ parks, rivers, city farms and green spaces for £10; Ranger programme; borough guide for all 33 boroughs. A partner or a rival; check before pitching. https://www.nationalparkcity.london/
- GiGL (Greenspace Information for Greater London): the official biodiversity data hub. https://www.gigl.org.uk/
- Natural History Museum City Nature Challenge team; The Green Londoner and Regen City ran the 2026 community push. https://luma.com/4rj0g9rq
- Strava, iNaturalist, BirdTrack, eBird, BirdGuides, Citymapper own the daily habits. Close Knit's edge is the area frame (LSOA/MSOA comparisons) and the all-in-one context.

---------------------------------------------------------------------
## 12. Seasonal calendar from today (17 Oct 2026)

| When | Moment | Audience | Status |
|------|--------|----------|--------|
| now to early Nov | Deer rut in Richmond and Bushy Parks (late Sept to early Nov) | dogs, photographers | VERIFIED (Royal Parks advice, undated pages) |
| now to mid Nov | Autumn colour | trees, photographers | Londonist guides |
| 21-29 Nov 2026 | National Tree Week | trees | VERIFIED |
| Nov to Mar | Hedgehog hibernation | wildlife, gardeners | general knowledge |
| 9 Dec 2026 | Big Garden Birdwatch 2027 registration opens | birds | VERIFIED |
| late Jan 2027 | Big Garden Birdwatch (2026 was 23-25 Jan) | birds | 2027 dates not confirmed; expect last weekend of January |
| 25 Dec, 1 Jan | parkrun Christmas and New Year doubles | runners | general knowledge |
| Feb to Mar | Frogspawn, toad migration | wildlife, gardeners | general knowledge |
| late April 2027 | City Nature Challenge (2025: 25-28 Apr; 2026: 24-27 Apr) | naturalists | 2027 dates not announced |
| 24-25 Apr 2027 | TCS London Marathon (two days) | runners | VERIFIED |
| late Apr to May | Swifts return | birds | general knowledge |
| 15 May to 30 Sept | Thames bathing-water season (2026 dates) | swimmers | VERIFIED for 2026 |
| 18-22 May 2027 | Chelsea Flower Show | gardeners | VERIFIED |
| early June | London Open Gardens (6-7 Jun in 2026) | gardeners | 2027 TBC |
| Aug | National Allotments Week (10-16 Aug in 2026) | gardeners | 2027 TBC |

---------------------------------------------------------------------
## 13. Cross-cutting risks and rules

- Sensitive species: area-level only, never points, for bats, owls, kingfishers, swifts, badgers. State it on the map.
- Effort bias: sightings follow recorders, not animals. Normalise and label.
- Licences: GBIF per-record licence (NC records), OSM ODbL attribution, EA data under OGL, parkrun terms unknown.
- Close Knit's own rules: places not people, no census ranking, no per-home values, no email list. Infographics must follow these.
- Safety claims: never "safe to swim" or "safe for dogs"; link to authorities and date the data.
- Community self-promo: reading each Facebook group and subreddit rules was not possible (Reddit blocked, groups private). Assume link-drops are banned; offer data to admins and local newsletters instead.
- Competitor overlap: London National Park City (paid map) and GiGL (official data).

---------------------------------------------------------------------
## 14. Key sources not listed inline

- Instagram counts: public profile pages https://www.instagram.com/<handle>/ (read 2026-10-17).
- Threads counts: https://www.threads.net/@<handle>; Facebook counts: https://www.facebook.com/<page>.
- iNaturalist API: https://api.inaturalist.org/v1/observations?place_id=66357&per_page=0 (and /observations/observers, /observations/species_counts with year and taxon_id filters).
- parkrun events: https://images.parkrun.com/events.json.
