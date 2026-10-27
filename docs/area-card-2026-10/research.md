**Area-card brief: what buyers weigh, the header, ratings, and competitor patterns**

**1. Area factors, ranked by evidence**
1. **Price and affordability.** In Aviva's study, price was the biggest factor for every age group, followed by the condition of the home. [Foxtons/Aviva](https://www.foxtons.co.uk/discover/2016/12/80-of-uk-adults-aim-to-buy-a-property-in-their-lifetime)
2. **Transport and commute.** London was the only region where transport links were buyers' top priority ([Miller Homes](https://www.bdcmagazine.com/2017/07/miller-homes-carrying-research-different-things-buyers-look-houses/)). In London, prices rose about 1–4% for each 1 km closer to a station (Gibbons & Machin 2007, [LSE](https://personal.lse.ac.uk/gibbons/Papers/Valuing%20schools%20transport%20and%20crime%20December%202007.pdf)). Savills found station proximity slipped in importance after Covid ([Savills](https://www.savills.co.uk/research_articles/229130/319911-0)).
3. **Safety.** 9 in 10 recent buyers would not compromise on crime ([CityAM/Which?](https://cityam.com/?p=386679)). In London, one standard deviation less criminal damage was worth about £20k (year 2000 prices). Visible disorder costs more than burglary (same LSE paper).
4. **Schools, mainly for families.** 84% of parents named catchment as a must-have ([Hillarys survey via Property Reporter](https://www.propertyreporter.co.uk/property/school-catchment-areas-twice-as-popular-amongst-house-hunting-familes-than-low-crime-rate-areas.html)). One standard deviation of school quality adds about 3% to prices ([Gibbons, Machin & Silva](https://cep.lse.ac.uk/_NEW/PUBLICATIONS/abstract.asp?index=3333)). The premium is non-linear: it shows up only near the best schools. So "best nearby school" beats a count of schools.
5. **Green space.** 57% put a park in their top two priorities (2021) ([Savills](https://www.savills.co.uk/research_articles/166316/319911-0)).
6. **Shops and amenities.** Miller Homes found these top of the list overall (same Miller Homes source).
7. **Quiet.** 79–82% of older and empty-nester buyers said a quiet neighbourhood mattered (RICS, cited in the Property Reporter piece).
8. **Community and belonging.** This was the strongest driver of happiness in Rightmove's Happy at Home index ([Rightmove](https://hub.rightmove.co.uk/hexham-regains-crown-of-happiest-place-to-live-in-great-britain/)). It is context, not something to score. Demographics, households and ethnic group belong in a separate, neutral "People & homes" tab, never under Safety and never rated.

Most of these surveys are 2016–2022. I found no 2024–25 Rightmove or Zoopla priority ranking.

**2. Overview header KPIs (7)**

| # | Tile | Display |
|---|---|---|
| 1 | Price | Median sold £ + 12-month ▲/▼ % + "pricier than X% of London". Neutral colour, because a rise is neither good nor bad for every reader |
| 2 | Getting around | Score /10 from the London decile of time to centre or station access, plus "7 min to station" |
| 3 | Safety | /10 from London crime-rate decile + ▲/▼ vs last year |
| 4 | Schools | /10 from the best nearby primary's London percentile, plus the school name. Drop "6 primary within 1 km" |
| 5 | Green space | /10 from park-access decile |
| 6 | Quiet | /10 from noise decile |
| 7 | Shops & cafés | /10 from amenity-density decile |

Optional 8th tile: market activity (sales volume ▲/▼). Hide it when the sample is small.

**3. Rating conventions that work**
- **One scale everywhere.** Use 1–10, where 10 means the best 10% of London areas. Put the same plain-word band next to every score (Walk Score pairs 0–100 with "Walker's Paradise"… "Car-Dependent", [Walk Score](https://www.walkscore.com/methodology.shtml)). Crystal Roof mixes /10, /9, Ofsted words and prose on one page, which is slow to read.
- **Percentile vs London, said once.** For example, "Safer than 72% of London". This answers the "can't compare" complaint directly.
- **Colour never carries meaning alone.** Always show the number and word as well (WCAG 1.4.1). Keep one ramp, with no olive green, per DESIGN.md.
- **Trend arrows always state direction, % and period** ("▲4% vs 2025"). Colour an arrow good or bad only where the direction is clearly good or bad (crime up = bad). Price arrows stay neutral.
- **No data means "No rating", not a guessed value.** Niche does this for Crime & Safety ([Niche example](https://www.niche.com/places-to-live/n/downtown-nashville-tn/)).
- **Cut text.** The W3C cognitive accessibility guidance (COGA) advises against too much content ("Avoid too much content") and recommends words alongside numbers ("Provide alternatives for numerical concepts") ([W3C COGA](https://www.w3.org/TR/coga-usable/)). Each tile gets one number, one word and one arrow. Detail goes in the tabs.

**4. Patterns to copy**
1. **Niche report card.** One uniform grid of category grades at the top of the page ([Niche](https://www.niche.com/places-to-live/n/downtown-nashville-tn/)). Our version: a grid of 7 scores. I'd skip Niche's opaque overall composite score.
2. **Walk Score.** One large number plus a fixed word band, with a published methodology ([Walk Score](https://www.walkscore.com/methodology.shtml)).
3. **Rightmove and Redfin price headlines.** Average sold price plus % change year on year and vs peak, then a breakdown by home type ([Rightmove Hackney](https://www.rightmove.co.uk/house-prices/hackney.html), [Redfin](https://www.redfin.com/neighborhood/313918/NV/Reno/Wells-Avenue-Neighborhood/housing-market)).

**5. Patterns to avoid**
1. **Crystal Roof's mixed scales and raw counts.** It shows "8 stations within a mile" with no benchmark, and some tiles are locked ([Crystal Roof](https://crystalroof.co.uk/report/postcode/SE192AZ/overview)). This is exactly what our "6 primary, 1 secondary within 1 km" does today.
2. **Redfin's big % swings on a handful of sales.** One page shows +87.7% year on year. Show the sample size and suppress the arrow when it is too small ([Redfin Fargo](https://www.redfin.com/neighborhood/760761/ND/Fargo/South-High/housing-market)).

**What to do with the rest of the card**
- **Tabs:** Overview, Price & market, Getting around, Safety, Schools, Green & quiet, People & homes.
- **"Plan and check a home":** move it to Tools, linked from a footer.
- **"Areas with similar figures":** collapse it into a single footer link.
- **Copyable text:** make all text selectable (this was not researched; it is a fix to make).

All scores must come from London-wide distributions in our own data, with the source linked. I didn't make up any figures here.