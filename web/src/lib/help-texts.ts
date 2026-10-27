import type { GuideSlug } from "./guide-slugs";
import { NOT_ADVICE, RATES_NOT_OFFERS } from "./tools";

/**
 * Text behind every (?) button: one to three plain sentences a newcomer
 * understands, and the guide article that explains more. Method detail and
 * caveats belong in the article, not here (tests/help-texts.test.ts).
 */
export interface HelpText {
  short: string;
  guide: GuideSlug;
}

export const HELP = {
  // Overview (track B)
  "home-cost": { short: "Roughly what a home of this size would cost here: its floor area times the typical price per square metre. A rough guide, not a valuation.", guide: "home-cost" },
  "price-trend": { short: "How much the typical price per square metre changed compared with the same month in an earlier year. Up means homes here got dearer.", guide: "price-trend" },
  "price-fallback": { short: "Too few homes sold in this small area, so the price comes from the bigger area around it.", guide: "sold-prices" },
  "scorecard": { short: "Scores from 1 to 10 show where this area sits among all London areas: 10 means more of that thing than 9 in 10 of them. Green to red marks only crime and deprivation, where more is worse.", guide: "reading-the-map" },
  "scorecard-price": { short: "Where this area's price per square metre sits among all London areas.", guide: "price-per-m2" },
  "scorecard-crime": { short: "How many crimes police recorded here for every 1,000 people, compared with the rest of London.", guide: "crime" },
  "scorecard-deprivation": { short: "An official mix of income, jobs, health, education, housing and environment. A higher score means more deprived.", guide: "deprivation" },
  "scorecard-income": { short: "The typical household income estimate for this area, compared with the rest of London.", guide: "income" },
  "scorecard-social-renting": { short: "The share of homes here rented from a council or housing association.", guide: "social-renting" },
  "scorecard-schools": { short: "State schools within 1 km of the area. Check each school's admissions: being close does not guarantee a place.", guide: "schools" },
  "scorecard-noise": { short: "How many homes here hear road or rail noise of 55 decibels or more over a day, from official noise maps.", guide: "noise" },
  // Map (track D)
  "crime-rescale": { short: "The colours stretch to fit only the crime types you kept, so differences between areas stay visible. The top colour is the highest area on the map.", guide: "crime" },
  "street-trees": { short: "Trees the councils, TfL and Royal Parks list on streets (GLA street trees, Nov 2025); the deeper the green, the more trees nearby. Private gardens and parks are not included: see Green cover for all greenery. Zoomed in to the street, one dot per tree sized by its canopy; hollow when the size is unknown.", guide: "nature" },
  "parcel-licence": { short: "Each outline is a plot of land, coloured by the price per square metre of its last recorded sale. Outlines come from HM Land Registry and appear only when you zoom in close.", guide: "sold-prices" },
  // Panels (track E)
  "price-sample": { short: "This is the middle price per square metre of homes sold here in the last 12 months. Only sales with a floor area from an energy certificate count; the rest are left out.", guide: "sold-prices" },
  "viewing-question": { short: "Why this question is on your viewing list.", guide: "your-match" },
  "stock-value": { short: "The middle price per square metre of the homes in this area, each home's last sale moved forward by the area's price change. An area figure: we never put a value on a single home.", guide: "stock-value" },
  "typical-price": { short: "Each area is coloured by the middle price of recent sales of the chosen kind of home, adjusted to today with the local price index. Areas with few sales borrow from the area around them.", guide: "typical-price" },
  "home-privacy": { short: "Sale prices come from HM Land Registry and floor areas from energy certificates (EPC), both public records, moved forward by the area's price change. If a figure is wrong or this is your home, you can report it or hide it.", guide: "sold-prices" },
  "hide-home": { short: "After you click the link we e-mail you, this home leaves search, sale history and the map. We keep no name, only scrambled codes (hashes) of your e-mail and connection, so nobody can repeat the request to abuse it.", guide: "sold-prices" },
  "flood-source": { short: "This shows flooding from rivers and the sea, from Environment Agency maps. Flooding from heavy rain (surface water) is a different risk and is not mixed in.", guide: "flood" },
  "flood-area": { short: "This is the share of the area's land inside a flood zone. It does not mean every building there is at risk: use the official check for one home.", guide: "flood" },
  "noise-method": { short: "Noise comes from official computer models of road traffic, not from microphones on your street. Real noise can be louder or quieter.", guide: "noise" },
  "noise-lden": { short: "Lden is the noise level averaged over a whole day, with evening and night counting extra because noise then bothers people more. Around 55 decibels and up is where health experts start to see harm from road noise.", guide: "noise" },
  "noise-no-score": { short: "There is no nuisance score here: a mapped noise band never decides for you. Visit at the times that worry you and listen for yourself.", guide: "noise" },
  "schools-distance": { short: "Distance is a straight line from the area, not a catchment. Being close does not mean a child gets a place, so check each school's admission rules.", guide: "schools" },
  "planning-records": { short: "Planning applications the council has logged near this area. They show what might change, not whether it will be approved. There is no planning-risk score here: a nearby proposal never decides for you.", guide: "planning" },
  "must-have-limits": { short: "A must-have is a hard limit: areas that miss it are taken out of your matches, never let through quietly. Importance only changes how the rest rank. You can relax a limit yourself to see what it was blocking.", guide: "your-match" },
  "rent-warning": { short: "Rent is the typical monthly rent for the whole borough over the last 12 months, from official figures, not live listings. Every neighbourhood in a borough shares one number, so street-by-street differences are hidden.", guide: "your-match" },
  "amenities": { short: "Walk times follow real streets to a public entrance; park size is the whole park. Places with no street link are listed, never guessed. Coverage reflects the sampled sources only.", guide: "your-match" },
  "match-not-rating": { short: "Your match shows how well each area fits what you asked for. It is not an objective rating of the neighbourhood, and it changes when your priorities change.", guide: "your-match" },
  "relaxed-limits": { short: "Too few areas met every limit, so these were loosened. What we found for each area still applies.", guide: "your-match" },
  "soft-edges": { short: "Inside the dark range an area fits fully; across the lighter soft edge it fits less the further out it is, and beyond it the area is out (grey). Must means no soft edge. Importance sets how much it counts.", guide: "your-match" },
  "forecast": { short: "A range for where prices in this area could be in one or five years. We show it only after the model was tested on past years and came close to what really happened. It is about the area, not one home.", guide: "price-trend" },
  "cost-comparison": { short: "A worksheet for weighing housing costs side by side with numbers you type in. It is not mortgage advice, a lending decision, or a promise of investment returns.", guide: "home-cost" },
  "demo-data": { short: "Demo data is made up to show how the app works. Switch to Real for actual London numbers.", guide: "demo-vs-real" },
  // Tools (track M). The tools' notice: one muted line with this (?).
  "tool-stamp-duty": { short: NOT_ADVICE, guide: "stamp-duty" },
  "tool-mortgage-rates": { short: RATES_NOT_OFFERS, guide: "mortgage-rates" },
  "tool-buy-to-let": { short: NOT_ADVICE, guide: "buy-to-let" },
  "tool-check-a-home": { short: NOT_ADVICE, guide: "home-cost" },
  "sdlt-first-time-buyer": { short: "You count as a first-time buyer if neither you nor anyone buying with you has ever owned a home anywhere, and you will live in it.", guide: "stamp-duty" },
  "sdlt-additional-property": { short: "Tick this if you will own two or more homes once you buy, for example a home to let. If you are replacing your main home and sell the old one within three years, you can claim the extra back.", guide: "stamp-duty" },
  "sdlt-non-resident": { short: "For stamp duty you are not a UK resident if you spent fewer than 183 days in the UK in the 12 months before buying.", guide: "stamp-duty" },
  "mortgage-rates-ltv": { short: "75% loan-to-value means the loan covers three quarters of the price and you pay a quarter as deposit. Bigger deposits usually get lower rates.", guide: "mortgage-rates" },
  "btl-gross-yield": { short: "A year's rent divided by the price. It ignores every cost, so it always looks better than what you keep.", guide: "buy-to-let" },
  "btl-net-yield": { short: "A year's rent, minus empty weeks and running costs, divided by the price. Mortgage payments are not taken off here.", guide: "buy-to-let" },
  "btl-cash-flow": { short: "What is left from the rent after empty weeks, running costs and mortgage payments. Below zero means you top it up yourself.", guide: "buy-to-let" },
  "btl-cash-required": { short: "The deposit plus stamp duty plus the fees and work you entered: roughly the money you need on the day.", guide: "buy-to-let" },
  "btl-tax": { short: "Rental profit is taxed as income. Landlords who own in their own name cannot deduct mortgage interest, they get a 20% tax credit on it instead.", guide: "buy-to-let" },
  // People and homes (track F)
  "people-population": { short: "How many people usually live here, from official estimates for the middle of the year. It is an estimate, not a head count.", guide: "people-and-homes" },
  "people-density": { short: "Residents divided by the area's size in square kilometres. Parks, rivers and railways count as area too, so busy streets can feel more crowded than the number says.", guide: "people-and-homes" },
  "people-london-marker": { short: "The thin line on each bar shows the share for London as a whole, so you can see where this area differs.", guide: "people-and-homes" },
  "people-ethnicity": { short: "How people described their own ethnic group in the 2021 Census. Everyone in the area is counted, including children.", guide: "people-and-homes" },
  "people-religion": { short: "The religion people said they belong to in the 2021 Census. The question was optional, so some chose not to answer.", guide: "people-and-homes" },
  "people-qualification": { short: "The highest qualification each adult holds, from the 2021 Census. Qualifications from abroad that did not match a UK level count as other.", guide: "people-and-homes" },
  "people-occupation": { short: "The kind of job working residents do, from the 2021 Census. It describes where people live, not where they work.", guide: "people-and-homes" },
  "people-work": { short: "Whether adults were working, studying, retired or something else in the week before the 2021 Census.", guide: "people-and-homes" },
  "people-tenure": { short: "Whether households own their home, rent privately or rent from a council or housing association, from the 2021 Census.", guide: "people-and-homes" },
  "people-home-type": { short: "The kind of building each household lives in, from the 2021 Census.", guide: "people-and-homes" },
  "people-age": { short: "Residents' ages on Census day 2021, in the census's five-year bands grouped into five ranges. Everyone is counted, including children.", guide: "people-and-homes" },
  "people-country-of-birth": { short: "Where residents were born, by part of the world, from the 2021 Census. It says nothing about nationality or how long people have lived here. On the map you can also pick one country, shown for whole boroughs only.", guide: "people-and-homes" },
  "people-household-type": { short: "Who shares each home, from the 2021 Census: one person, a couple with or without children, a lone parent, or anything else, such as flatmates or several families.", guide: "people-and-homes" },
  // Getting around and nearby (track H)
  "places-connectivity": { short: "A 1 to 10 score for how easy it is to get around by train from here. Stations within about a 15-minute walk count, and closer stations with more lines count more. Buses are not included.", guide: "getting-around" },
  "places-stations": { short: "The nearest train, tube, DLR, Overground, Elizabeth line and tram stations, measured in a straight line. Zones and lines come from TfL.", guide: "getting-around" },
  "places-parks": { short: "Public parks and green spaces mapped in OpenStreetMap, measured to their nearest edge. Sizes run from pocket parks under 0.4 hectares to huge parks over 400.", guide: "getting-around" },
  "places-amenities": { short: "Shops, pubs, cafés, pharmacies and GP surgeries mapped in OpenStreetMap. Volunteers keep it up to date, so a new or closed place may be missing.", guide: "getting-around" },
  // Property page (track K)
  "area-prices": { short: "What the same kind of home sells for in this area now: recent sales adjusted to today, and the middle half of them. About the area's sales, not this home: we never put a value on a single home.", guide: "typical-price" },
  "property-facts": { short: "Type and tenure come from the Land Registry. Age, rooms, floor and energy rating come from the latest energy certificate, which can be years old.", guide: "energy-rating" },
  "postcode-homes": { short: "Every home in this postcode with a recorded sale, with its type, size, energy rating and last recorded sale price.", guide: "sold-prices" },
  // Local market (track G)
  "market-median": { short: "The middle sale price of ordinary home sales here in the last 12 months: half sold for more, half for less.", guide: "local-market" },
  "market-per-area": { short: "The price divided by the floor area on the home's energy certificate. Only sales with a certificate count.", guide: "local-market" },
  "market-range": { short: "The middle half of sales fell in this range: a quarter sold for less and a quarter for more.", guide: "local-market" },
  "market-widened": { short: "Too few homes sold in this small area in a year, so these figures come from the bigger area around it.", guide: "local-market" },
  "market-by-type": { short: "P25 means a quarter of sales were cheaper, P75 means three quarters were. P5 and P95 leave out the cheapest and dearest few.", guide: "local-market" },
  "market-trend": { short: "Each point is the middle price of the 12 months up to that month. A gap means too few sales that year.", guide: "local-market" },
  "market-spread": { short: "The thick bar holds the middle half of sales, the thin line runs from the cheapest 5% to the dearest 5%, and the mark is the middle price.", guide: "local-market" },
  "market-recent": { short: "Ordinary sales from the last 18 months. New sales take weeks or months to appear in the public record.", guide: "local-market" },
  "short-lets": { short: "Airbnb listings for every 1,000 homes here, from Inside Airbnb's latest London snapshot. Active means reviewed in the last 12 months. The dot is this area's place among London areas.", guide: "local-market" },
  // Area guide and ranking pages (track L)
  "area-page-figures": { short: "Big areas have no single published price. We line up the figures of the small neighbourhoods inside and show the one in the middle.", guide: "reading-the-map" },
  "area-page-schools": { short: "State primary and secondary schools whose address is inside this area's boundary. Being close does not guarantee a place.", guide: "schools" },
  "ranking-price": { short: "Each area's price is the middle of its neighbourhoods' prices per square metre over the last 12 months. Where a neighbourhood had too few sales we use the wider area's figure.", guide: "price-per-m2" },
  "ranking-deprivation": { short: "England's official deprivation index puts every neighbourhood in a tenth, from 1 (most deprived) to 10 (least). We average the tenths of the neighbourhoods inside each area.", guide: "deprivation" },
  "ranking-income": { short: "The official estimate of typical yearly household income for each area (ONS, per MSOA). It describes a whole area, never any one household.", guide: "income" },
  "ranking-social-renting": { short: "The share of households renting from a council or housing association on Census day, March 2021. Each area's figure is the middle of its neighbourhoods'. It describes the mix of homes, neither good nor bad.", guide: "social-renting" },
  "ranking-crime": { short: "Crimes police recorded over 12 months for every 1,000 people who live there. Busy centres with few residents come out high.", guide: "crime" },
  "ranking-typical-price": { short: "The middle price of whole homes of this type sold in each neighbourhood, adjusted to today; each area's figure is the middle of its neighbourhoods'. A neighbourhood with under 20 sales uses the wider area's figure, and one with under 5 shows none. It describes the area's sales: we never put a value on a single home.", guide: "typical-price" },
  "ranking-station": { short: "The typical walk from each neighbourhood's homes to the nearest rail, tube, Overground, DLR or tram station entrance, along mapped paths at an easy pace. Each area's figure is the middle of its neighbourhoods'.", guide: "getting-around" },
  "ranking-food-hygiene": { short: "Of the cafés, restaurants, takeaways and pubs within 800 m that have a food hygiene rating, the share rated 4 or 5 (good or very good); each area's figure is the middle of its neighbourhoods'. It rates the food places, not the people who live there. Neighbourhoods with fewer than 5 rated places nearby are left out.", guide: "getting-around" },
  "ranking-lens": { short: "We count the places of this kind on the map inside each area's boundary and divide by its land in km², so big areas don't win for size. Areas with under 5 such places are left out. It counts places, not people.", guide: "getting-around" },
  "ranking-lens-borough": { short: "Places of this kind on the map inside each borough's boundary, per km² of land, so big boroughs don't win for size. The City of London is left out: its tiny area would top the list on a handful of places. It counts places, not people.", guide: "getting-around" },
  "ranking-lens-variety": { short: "The different cuisines among the cafés, restaurants and takeaways on the map inside each area's boundary, each cuisine counted once. It counts places, not people.", guide: "getting-around" },
  "ranking-lens-nearest": { short: "A straight-line walk from each neighbourhood's centre to the nearest market on the map, at an easy pace; each area's figure is the middle of its neighbourhoods'. It counts places, not people.", guide: "getting-around" },
  "ranking-lens-family": { short: "Playgrounds and nurseries inside each area's boundary, each counted once, per km² of land. It is a count of places, not a score of how good an area is for families, and says nothing about who lives there.", guide: "getting-around" },
  "ranking-school-results": { short: "Department for Education GCSE results for state-funded schools, latest year; provisional figures can change when the final tables come out. Schools with fewer than 30 pupils in the year group, or a figure withheld to protect pupils, are left out. Results reflect pupils' starting points as well as teaching.", guide: "schools" },
  "ranking-school-progress-8": { short: "Progress 8 compares each pupil's GCSE grades with pupils across England who had similar results at the end of primary school: 0 is average, +0.5 is half a grade better in each subject. We show the latest year published, which can be a year behind other results. Schools with fewer than 30 pupils are left out.", guide: "schools" },
  "ranking-school-outstanding": { short: "Schools whose last graded inspection under Ofsted's previous framework rated them Outstanding overall, newest inspection first. Schools since inspected under report cards are left out, and an old grade may not describe the school today, so check the year. It is a list, not a rank.", guide: "schools" },
  "ranking-school-report-card": { short: "Ofsted report cards, used since November 2025, grade each area of a school on its own; we count the areas graded exceptional. Only schools inspected since then appear, and their grades are never mixed with older ones. Ties are common.", guide: "schools" },
  "ranking-school-count": { short: "State-funded schools on Ofsted's list whose address is inside each area's boundary. Areas (MSOAs) hold similar numbers of people, so the plain count is fair. A school nearby doesn't guarantee a place.", guide: "schools" },
  // Civic (track J)
  "civic-place": { short: "Which council, ward and constituency this place belongs to, from the official ONS list of postcodes. If an area crosses a ward line, we name the ward most of its postcodes are in.", guide: "local-government" },
  "council-tax": { short: "Every home sits in a band from A (cheapest homes in 1991) to H. Each band pays a fixed share of band D, so band A pays two thirds and band H pays double. These are borough averages.", guide: "local-government" },
  "representatives": { short: "Ward councillors sit on the borough council and an MP represents the constituency in Parliament. We list who won the last election and show the day we checked.", guide: "local-government" },
  "civic-codes": { short: "Government data uses these codes instead of names. They help you look up this place in official statistics.", guide: "local-government" },
  // Flood risk (track I)
  "flood-bands": { short: "Each band is the chance of flooding in any one year, from Environment Agency models. Rivers and sea, and heavy rain on the surface, are mapped separately.", guide: "flood" },
  "flood-home": { short: "The band at this home's point on the map. It is a modelled chance, not a record of past floods, and says nothing about insurance.", guide: "flood" },
  // Research wave 1 (main, PR #4)
  "station-walk": { short: "The typical walk from this area's homes to the nearest rail, tube, DLR or tram station, along mapped paths at an easy pace.", guide: "getting-around" },
  "food-hygiene": { short: "Of the cafés, restaurants, takeaways and pubs within 800 m that have a food hygiene rating, the share rated 4 or 5 (good or very good). It describes the food places, not the people who live here.", guide: "getting-around" },
  "similar-areas": { short: "Areas whose crime, deprivation, income, price and station walk sit closest to this one's among London neighbourhoods. Who lives there is never compared.", guide: "your-match" },
  "area-code": { short: "The official statistics name for this small area: its borough, a number and a letter. London has about 5,000 of these, each home to roughly 1,500 people. The name above is the wider neighbourhood and the postcode district most of its homes share.", guide: "reading-the-map" },
  "map-scale": { short: "Each area takes the colour of its figure on the scale. Grey means no data, never very low.", guide: "reading-the-map" },
  // UK HPI (migration 080)
  "uk-hpi": { short: "HM Land Registry's official house price index for the whole borough, mix-adjusted so a change in which homes sold does not move it. Contains HM Land Registry data © Crown copyright, Open Government Licence v3.0.", guide: "local-market" },
  "flood-badge": { short:"The highest rivers and sea flood band that covers at least 1% of the area's land. Smaller patches still show in the Environment tab.", guide: "flood" },
  "council-tax-bands": { short: "Homes on the VOA valuation list by band. The typical bill is the middle home's band at the borough's average Band D.", guide: "local-government" },
  "future-transport": { short: "New stations from TfL, GLA and government scheme pages. The map counts only stations being built or with legal powers; proposed ones are shown as proposed, never as coming.", guide: "getting-around" },
  "hmo-per-1000": { short: "Shared houses (HMOs) on the borough's public licence register, per 1,000 homes. Unlicensed and small HMOs outside a licensing scheme are missing. Grey means the borough has not published its register, never none.", guide: "people-and-homes" },
  // Layers v5 PR 3 (migration 100): each names its source, year and licence.
  "typical-rent": { short: "The borough's average monthly private rent for homes with this many bedrooms (ONS Price Index of Private Rents, latest month, Open Government Licence v3.0). Every area in a borough shows the same figure: a ballpark, not the rent of any home.", guide: "home-cost" },
  "flood-risk": { short: "The share of the area's homes in a medium or high flood band, a 1% chance a year or more, from rivers and the sea or from surface water (Environment Agency NaFRA2, 2025, Open Government Licence v3.0). A modelled chance, not a record of past floods.", guide: "flood" },
  "good-schools-nearby": { short: "State schools within 1.5 km of the area's centre that rank in England's top 25% in the latest year: KS2 for primaries, Attainment 8 for secondaries (DfE performance tables, Open Government Licence v3.0). Being near a school does not guarantee a place.", guide: "schools" },
  "student-share": { short: "The share of residents aged 16 and over who were full-time students on census day, 21 March 2021 (ONS Census 2021, table TS066, Open Government Licence v3.0). It describes the area and is never ranked; universities and colleges show as points from street zoom (© OpenStreetMap contributors).", guide: "people-and-homes" },
  // Layers v5 PR 3 batch 2 (migration 101): each names its source, year and licence.
  "supermarket-walk": { short: "Minutes on foot from the area's centre to the nearest supermarket, a straight-line estimate at 4.8 km/h (OpenStreetMap, 2026, © OpenStreetMap contributors, Open Database Licence). Corner shops are not counted; a new or closed shop may be missing.", guide: "getting-around" },
  "gp-walk": { short: "Minutes on foot from the area's centre to the nearest GP practice, a straight-line estimate at 4.8 km/h (NHS England, Patients Registered at a GP Practice, 2026, Open Government Licence v3.0). Being near a practice does not mean it will register you.", guide: "getting-around" },
  "broadband-gigabit": { short: "The share of the area's premises where a gigabit-capable line can be ordered (Ofcom Connected Nations, January 2026 coverage, Open Government Licence v3.0). Availability, not what homes have signed up to.", guide: "people-and-homes" },
} as const satisfies Record<string, HelpText>;

export type HelpId = keyof typeof HELP;
