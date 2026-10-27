# Portals: deep links, drawn zones and map overlays

Research date: 2026-10-18. Verified with curl and in a Chrome tab. Decisions are in
`docs/superpowers/specs/2026-10-18-extension-legal-strategy.md`. The owner dropped every map overlay
on 2026-10-18.

## Search links and drawn areas

| Portal | Deep-link parameters | Drawn-area search | Map |
|---|---|---|---|
| Rightmove | `maxPrice`, `minBedrooms`, `propertyTypes=detached,semi-detached,terraced`, `radius`, `mustHave=garden,parking`, `maxDaysSinceAdded=7`, `sortType=6`. Location: `OUTCODE^…`, `/NW6.html`, `STATION^…`, `REGION^…` | **1 polygon:** `locationIdentifier=USERDEFINEDAREA^{"polylines":"<Google encoded polyline>"}`; 800 points work, 1,000 are rejected. robots.txt disallows `draw-a-search` | Google Maps |
| Zoopla | `price_max`, `beds_min`, `/houses/` in the path, `property_sub_type`, `feature=has_garden`, `radius`, `results_sort` | **Many polygons:** repeat `polyenc=` (value URL-encoded twice). The UI allowed 9; 40 built by hand were accepted. One ring: 400 points work, 800 return nothing. Travel-time search at `/travel-time/` | Google Maps |
| OnTheMarket | `max-price`, `min-bedrooms`, repeated `prop-types`, `radius`, `recently-added=7-days`, `sort-field` | **Several:** `polygons0=`, `polygons1=`… work by URL, although the UI keeps only one | Google Maps |
| SpareRoom | `flatshare/search.pl?search=NW6&miles_from_max=1&max_rent=…&per=pcm`; redirects to `search_id` | none | — |
| OpenRent | `prices_max`, `bedrooms_min`, `area=<km>` | none | Leaflet |

**Verified examples** (NW6, 3+ beds, ≤ £1.25m, houses):
- Rightmove: `https://www.rightmove.co.uk/property-for-sale/NW6.html?maxPrice=1250000&minBedrooms=3&propertyTypes=detached%2Csemi-detached%2Cterraced`
- Zoopla: `https://www.zoopla.co.uk/for-sale/houses/nw6/?q=NW6&price_max=1250000&beds_min=3&search_source=for-sale`
- OnTheMarket: `https://www.onthemarket.com/for-sale/property/nw6/?max-price=1250000&min-bedrooms=3&prop-types=detached&prop-types=semi-detached&prop-types=terraced`

**Two zones in one link:** Fortune Green plus Crystal Palace gave 177 results on Zoopla and 152 on
OnTheMarket.

**Several zones on Rightmove:**
- one ring joining two zones through a ~30 m corridor is accepted, but the corridor picks up homes
  along its route;
- the cleaner option is one link per zone;
- a convex hull adds too much area.

**What our code builds today:**
- `api/area_api/home_search.py` (`portal_links`, `home_listing_links`) and
  `web/src/lib/listing-links.ts` (`areaListingLinks`, `homeListingLinks`): outcode searches with
  max price and min beds, plus OpenRent for rent and per-postcode links.
- Not built: property type, radius, must-haves, recency, sort, polygons.

**Proposed** (subject to the strategy doc):
- "Open my zones": one Zoopla link and one OnTheMarket link carrying every My match zone and
  criterion;
- Rightmove: plain outcode or station searches only, no `draw-a-search`.

## Map overlay (dropped)

The three big portals use Google Maps. A script running in the page before the portal could capture
the map instance and:
- restyle it (ignored when the portal uses a cloud `mapId`);
- add `TransitLayer`, our tiles (`overlayMapTypes`) or GeoJSON (`map.data`).

**Why we dropped it**
- Rightmove 8.3 bans "overlay".
- It runs on the portal's Google API key and quota.
- It breaks with each of their deploys.

**The alternative, if wanted later:** our own MapLibre mini-map inside our panel, with our tiles.
It leaves their map untouched.

**Portal terms on links** (see `10-extension-legal-risk.md`):
- Rightmove 13.4: no links "in any… extension, plug in", including deep links.
- OnTheMarket 3.4: no "deep link".
- Zoopla: links to the home page only without agreement.
- Plain hyperlinks are not infringement (*Svensson*, C-466/12).
- Every competitor links the same way.
