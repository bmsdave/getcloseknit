"""Each operation's OpenAPI documentation, by operationId: the response model, what the answer and its error
statuses mean. Route decorators in app.py take it as **operation("getAreaSummary"); summaries stay on the routes.
Carried over from the hand-kept contracts/openapi.yaml (2026-10); the generated contracts/openapi.yaml is built from
these (deploy/tools/gen_openapi.py)."""
from __future__ import annotations

from typing import Any

from . import models
from .base import NO_RELEASE, binary, errors, text

OPERATIONS: dict[str, dict[str, Any]] = {
    "reportCorrection": dict(
        response_model=models.CorrectionResponse,
        description="publisher-error / transformation-error reports are stored in correction_report and forwarded "
                    "to the operator (webhook/SMTP when configured). privacy-objection needs the dwelling (uprn or "
                    "addressId) and an e-mail: a pending objection is stored (hashes only) and a confirmation link "
                    "is e-mailed; once confirmed the dwelling disappears from search, history, property reads and "
                    "tiles. Limits: 5 requests per IP and 3 per e-mail per day.",
        response_description="Report stored and routed (status received), or objection pending confirmation",
        responses=errors({400: "invalid-correction-report | invalid-objection",
                          409: "objection-exists (this home is already hidden)",
                          429: "too-many-requests (daily objection limit or rate limit)"})),
    "confirmObjection": dict(
        response_model=models.ObjectionConfirmResponse,
        response_description="The objection is active; the dwelling is hidden from now on",
        responses=errors({404: "objection-not-found (unknown or already used token)"})),
    "listMetrics": dict(
        response_model=models.MetricCollection,
        summary="List metric definitions",
        response_description="Versioned metric definitions",
        responses=errors({400: "Invalid request",
                          503: NO_RELEASE})),
    "searchAreas": dict(
        response_model=models.SearchResponse,
        summary="Search postcodes, addresses, and areas",
        response_description="Postcode, address, and area matches (with scope=all also schools, stations and parks)",
        responses=errors({400: "Invalid search query",
                          503: NO_RELEASE})),
    "getAreaBoxes": dict(
        response_model=models.AreaBoxesResponse,
        response_description="{schemaVersion: area-boxes.v1, carrier, productReleaseId, chunk?, areas: "
                             "[[geographyId, west, south, east, north], ...]} at four decimals",
        responses=errors({400: "Unknown carrier or chunk",
                          503: NO_RELEASE})),
    "getMapCoverage": dict(
        response_model=models.MapCoverageResponse,
        description="{schemaVersion, coverage: england|london, productReleaseId, bounds: [[west, south], [east, "
                    "north]], regions: [{id, name, bbox}], chunks: [{id, region, bbox, areas}]}. With "
                    "CLOSE_KNIT_ENGLAND on, England's bounds, every region with loaded areas and the neighbourhood "
                    "chunks (London whole, every other LAD on its own); off, London's bounds and no regions or "
                    "chunks (the map loads every area at once). areaTiles {release, minzoom, maxzoom, url}: the "
                    "area boundaries, one static PMTiles archive per kind (/tiles/areas-<release>-{kind}.pmtiles, "
                    "read with Range requests, immutable; migration 127) once built, else the tile URL template of "
                    "/api/v1/tiles/areas; London's alone with the flag off.",
        response_description="The map's coverage",
        responses=errors({503: NO_RELEASE})),
    "getScope": dict(
        response_model=models.ScopeResponse,
        description="{schemaVersion, id, level: region|nation, name, served: [{id, code, name}], bbox: [west, "
                    "south, east, north], outsideReason: outside-london|outside-coverage}. London with "
                    "CLOSE_KNIT_ENGLAND off; England with it on (the MCP and the extension read it as off while "
                    "the site is private). ?regions= narrows England to those regions, as POST /api/v1/matches "
                    "does.",
        response_description="The served scope",
        responses=errors({400: "Unknown region code"})),
    "getMapLabels": dict(
        response_description="GeoJSON FeatureCollection of Points whose properties are kind (borough or district), "
                             "code (GSS code or outward code), label (\"Bromley\", \"BR6 · Orpington\"), name (or "
                             "null) and rank (lower places first when labels collide)",
        responses=errors({503: NO_RELEASE})),
    "getAreaNames": dict(
        response_model=models.AreaNamesResponse,
        response_description="area-names.v1: names maps each known id to its friendly title (\"Alperton East · "
                             "HA0\"), else its official name; centers maps it to [longitude, latitude]; unknown "
                             "ids are left out",
        responses=errors({400: "A malformed id or more than 50 ids",
                          503: NO_RELEASE})),
    "getAreaSummary": dict(
        response_model=models.AreaResponse,
        summary="Get evidence for an area",
        response_description="Raw value, comparisons, provenance, and price timeline",
        responses=errors({400: "Invalid area, metric, or period",
                          404: "Area, metric, or period not found",
                          503: NO_RELEASE})),
    "getAreaProfile": dict(
        response_model=models.AreaProfileResponse,
        response_description="area-profile.v1: geographyId, name, metrics (AreaSummary per metric with a value; "
                             "absent otherwise; a district or borough's £/m² is the middle value of its LSOAs), "
                             "schools {primary, secondary, radiusMetres: 1000} or null when no schools are loaded, "
                             "noise {available, any55Share} or null",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaMarketByType": dict(
        response_model=models.AreaMarketByTypeResponse,
        response_description="area-market-by-type.v1: available, basis {geographyId, name, carrier, widened, "
                             "minimumSales}, window {start, end} (YYYY-MM), summary and byType[D,S,T,F,O] "
                             "{propertyType, sales, medianPrice, p5, p25, p75, p95, minPrice, maxPrice, "
                             "pricePerSquareMetreSales, medianPricePerSquareMetre}, trend [{propertyType: "
                             "all|D|S|T|F|O, points: 11 × {windowEnd, sales, medianPrice, "
                             "medianPricePerSquareMetre}}], sourceVersion, attribution, caveats. Too few sales → "
                             "null, never 0.",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaStandouts": dict(
        response_model=models.AreaStandoutsResponse,
        response_description="area-standouts.v1: verdict, tags [{id, kind: pro|con, text, section}], tiles (12, "
                             "fixed order) [{id, label, section, topic, available, value, display, standing "
                             "(0-100, 100 = better; null for neutral price and nightlife), regionPercentile "
                             "(neutral tiles), extreme: pro|con|null, detail, trend, period}], withheld (laeiAir "
                             "while its flag is off: the Air tile is unavailable and the site leaves it out), "
                             "caveats. A tile without data has available false and nulls, never 0. A borough adds"
                             " carrier: borough and neighbourhoods [{geographyId, price, "
                             "priceLondonPercentile, crime, safetyStanding (100 = safer), schoolStanding (best "
                             "primary within 1 km, 100 = best)}], each null when unknown; its tags say 'of "
                             "boroughs'.",
        responses=errors({400: "invalid-query (neighbourhoods and boroughs only: uk:lsoa:…, uk:lad:…)",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaLayers": dict(
        response_model=models.AreaLayersResponse,
        response_description="area-layers.v1: layers (one per metric with a row for the area, newest period; a "
                             "metric of a wider carrier is read at the area's parent) in the standouts tile shape "
                             "[{id, label, section: null, topic: null, available, value, display, standing (0-100, "
                             "100 = better; null for neutral and Census), regionPercentile (neutral layers), "
                             "extreme, detail, trend {direction: up|down|flat, percent, years: 1} | null, "
                             "period}], chips [{id: flood|air|broadband, label, band | null}], presets (the 3 "
                             "ready-made criteria rated highest here, never an 'X vs Y' balance or share, tile "
                             "shape, id custom:{criterion}), withheld (censusRanked, laeiAir while their flags are "
                             "off).",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaSafety": dict(
        response_model=models.AreaSafetyResponse,
        response_description="area-safety.v1: available, period (YYYY-MM), rate, regionPercentile and regionRate "
                             "(within the region of the area), rankScope {code, name} (that region), offences, "
                             "types [{category, offences, rate, regionRate}], trend {from, to, months, "
                             "changePercent, stable (under 15% either way), points [{period, rate}]}, source, "
                             "caveats.",
        responses=errors({400: "invalid-query (neighbourhoods only: uk:lsoa:…)",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaRecentSales": dict(
        response_model=models.AreaRecentSalesResponse,
        response_description="area-recent-sales.v1: basis, months (18), since, until, sort, page, pageSize, total, "
                             "sales [{transactionId, date, address, postcode, propertyType, tenure, newBuild, "
                             "price, distanceMetres}]. Homes hidden by a privacy objection are left out.",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaSince": dict(
        response_model=models.AreaSinceResponse,
        response_description="area-since.v1: date, basis, months (18), newSales, newestSale, pricePerSquareMetre "
                             "{median (the Price tile value), windowEnd (its month), sales (null for a borough or "
                             "MSOA)}, sourceVersion, attribution, caveats. Homes hidden by a privacy objection are "
                             "left out.",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaSchools": dict(
        response_model=models.AreaSchoolsResponse,
        response_description="Reachable and shortlisted schools"),
    "getAreaNoise": dict(
        response_description="area-noise.v1: dwellings, road55Share, rail55Share, any55Share, any65Share, "
                             "roadLdenMedian, dwelling (or null), sourceVersion, caveats",
        responses=errors({400: "invalid-query",
                          404: "area-not-found"})),
    "getAreaNature": dict(
        response_model=models.AreaNatureResponse,
        response_description="area-nature.v1: available; green {share, percentile} or null; trees {count, "
                             "perHectare, percentile, top [{name, count}]} or null; site {name, kind lnr|sssi, "
                             "metres, percentile} or null; score {percentile} or null; ranked; home {uprn, "
                             "greenShare, streetTrees} or null; wildlife {radiusMetres, firstYear, lastYear, "
                             "records, enough, birds, mammals, amphibians, notable[]} or null (species seen, never "
                             "absences; enough false under 200 records); sources [{id, licence, attribution, "
                             "caveats}]",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaPeople": dict(
        response_model=models.AreaPeopleResponse,
        response_description="area-people.v1: population {residents, year, areaKm2, densityPerKm2, "
                             "regionDensityPerKm2, sourceVersion} or null; topics in fixed order (ethnicity, "
                             "religion, qualification, occupation, economic-activity, tenure, accommodation, age, "
                             "household-type, country-of-birth), each {id, total, categories [{id, label, count, "
                             "share, regionShare}]}; total null when the topic has no data; sources [{id, "
                             "attribution, caveats}]",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaPlaces": dict(
        response_description="area-places.v1: origin, available, stations[] (name, modes, zone, lines, "
                             "distanceMetres, bearingDegrees?), parks[] (name, kind, areaHectares, sizeClass, "
                             "distanceMetres, bearingDegrees?), walkRadiusMetres, amenities[] (group: groceries, "
                             "pubs, food, pharmacies, gps, then raw OpenStreetMap counts gyms, pools, cafes, bars "
                             "— cafes and bars also counted in food and pubs; countWithinWalk, nearest[] (name, "
                             "kind, distanceMetres, bearingDegrees?)), connectivity (score 1-10, points, "
                             "stationsCounted, radiusMetres) or null, sources, caveats. bearingDegrees is the "
                             "whole-degree direction from the origin, clockwise from north (0-359); it is left out "
                             "when unknown, e.g. for a park the origin sits inside",
        responses=errors({400: "invalid-query",
                          404: "area-not-found or property-not-found"})),
    "getAreaCivic": dict(
        response_description="civic.v1: subject, available, place {country, region, borough, ward, parish, "
                             "constituency, policeForce, msoa, lsoa} ({code, name} or null), wards and "
                             "constituencies with their share of live postcodes, livePostcodes, councilTax "
                             "{financialYear, bands A-H} or null, councilTaxBand (always null until a licensed "
                             "per-home source is loaded) and withheld, representedWards, "
                             "representedConstituencies, councillors, mps, fetchedOn {councillors, mps}, sources "
                             "(licence, attribution, caveats)",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getPostcodeCivic": dict(
        response_description="civic.v1 with subject {kind: postcode, postcode, introduced YYYY-MM, terminated "
                             "YYYY-MM or null, geographyId of its LSOA}",
        responses=errors({400: "invalid-query",
                          404: "area-not-found (postcode not in the London directory)"})),
    "getAreaRents": dict(
        response_description="area-rents.v1: available, borough {id, name}, period YYYY-MM, rents [{bedrooms "
                             "(oneBedroom|twoBedrooms|threeBedrooms|fourOrMoreBedrooms|all), monthlyRent, "
                             "annualChangePct, regionMonthlyRent}], sourceVersion, attribution, caveats; available "
                             "false for the City of London (no PIPR figure)",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaHpi": dict(
        response_description="Evidence envelope, schemaVersion area-hpi.v1; value: available, borough {id, name}, "
                             "latest YYYY-MM, types [{type (all|detached|semi|terraced|flat), latestPrice, change "
                             "{1y, 5y, 10y}, regionChange {1y, 5y, 10y}, series [{month, price}] quarterly to the "
                             "latest month}], regionPercentile {5y, 10y}; available false before migration 080 is "
                             "loaded",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaRentTrend": dict(
        response_description="area-rent-trend.v1 envelope (value, confidence, evidence, sources, caveats); value: "
                             "available, borough {id, name}, latest YYYY-MM, regionPercentile {rent-change-1y, "
                             "rent-change-5y}, categories [{category "
                             "(all|oneBedroom|twoBedrooms|threeBedrooms|fourOrMoreBedrooms|flat|terraced|semiDetached|"
                             "detached), "
                             "rent, change1yPct, change5yPct, regionRent, regionChange1yPct, regionChange5yPct, "
                             "series [{month, rent}]}]; available false for the City of London (no PIPR figure)",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getNearbyPhotos": dict(
        response_description="nearby-photos.v1: point {lat, lon}, photos [{id, title, photographer, pageUrl, "
                             "profileUrl, taken YYYY-MM-DD or null, metres}] nearest first, licence, licenceUrl, "
                             "sourceVersion, attribution, caveats; photos empty before migration 043 is loaded",
        responses=errors({400: "invalid-query (point outside London, or limit out of range)"})),
    "getAreaFlood": dict(
        response_description="area-flood.v1: available, riversSea and surfaceWater ({shares: {very-low, low, "
                             "medium, high}, highestBand} or null when not loaded), dwelling ({uprn, riversSea, "
                             "surfaceWater} or null), sourceVersion, attribution, caveats",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaKids": dict(
        response_description="area-kids.v1: available (false for boroughs and unloaded areas), nurseries "
                             "({radiusMetres, rated, wellRated, share, regionPercentile, nearest: [{urn, name, "
                             "grade, framework, inspected, wellRated, places, distanceMetres, url}]}), roadSafety "
                             "({radiusMetres, casualties, children, seriousOrFatal, cyclists, pedestrians, byYear: "
                             "[{year, count}], regionPercentile; lower is better}), cycling ({radiusMetres, "
                             "protectedKm, cyclewayKm, regionPercentile}), sources ([{id, url, releaseDate, "
                             "licence, attribution, caveats}])",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaLocation": dict(
        response_description="area-location.v1: available, conservation ({share, presence inside|partly|outside, "
                             "areas [{name, borough, share}]}), ulez and congestionCharge ({share, presence}), "
                             "planning ({applications, householder, full, priorApproval, windowStart, windowEnd, "
                             "regionMedian}), notes, sourceVersions, sources, caveats. Places, never people; "
                             "applications are proposals, not permissions.",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaPipeline": dict(
        response_description="area-pipeline.v1 evidence envelope: value (null before the layers are loaded) "
                             "{notStarted, underConstruction, completed5y, homes, per1000, regionPercentile, "
                             "within1km {radiusMetres, total, notStarted, underConstruction}, growthAreas [{name, "
                             "kind opportunity-area|housing-zone, url, share, presence inside|partly}], notes}, "
                             "confidence, evidence (pipeline-homes-per-1000), sources, caveats. Sites, never "
                             "applicants; permissions are not completions.",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaFutureTransport": dict(
        response_description="area-future-transport.v1 evidence envelope: value {available, nearest ({station, "
                             "scheme, mode, distanceM, status under construction|consented|funded|proposed, "
                             "expectedYear, sourceUrl, withinReach}) or null, note (within 2 km; a proposed scheme "
                             "reads proposed, never coming)}, confidence, evidence, sources, caveats.",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaHealth": dict(
        response_description="area-health.v1: available, air ({no2, pm25, year, regionPercentile, no2Percentile, "
                             "pm25Percentile}), heat ({value, unit, year, regionPercentile}), gp ({patientsPerGp, "
                             "practices, nearestMetres, withinMetres, month, regionPercentile}), notes, "
                             "sourceVersions, withheld, sources, caveats. A part is null before its layer is "
                             "loaded. airEnabled is false while CLOSE_KNIT_AIR_QUALITY is off (FLAGS.md): air is "
                             "then null, \"laeiAir\" is in withheld and the LAEI source and caveat are left out. "
                             "Places and practices, never people.",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaCouncilTax": dict(
        response_description="area-council-tax.v1 evidence envelope: value null before load, else {geographyId, "
                             "period, bands [{band, homes, share}], homes, mostCommon, medianBand, meanBand (A = 1 "
                             "... H = 8, null under 50 homes), regionPercentile, borough {id, name}, typicalBill "
                             "{band, amount, bandD, financialYear} | null, sourceVersions}; confidence, evidence "
                             "(council-tax-band-mean), sources, caveats. Homes on the valuation list, never one "
                             "home's band.",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getGoodValue": dict(
        response_description="good-value.v1: homeType, available, minimumSales (20), peers (50), scoreKeys "
                             "(safety, schools, station, quiet, parks, air), areas [{geographyId, typicalPrice, "
                             "sales, scores {six London ranks 0-100, higher is better, null when missing}, peers, "
                             "peerPrice, valueRatio, valuePercent, outlier}] cheapest for its peers first, "
                             "valueRatioBounds [0.6, 1.67] (outside them outlier is true and My match's Best value "
                             "sort leaves the area out), sources, caveats. Areas under 20 sales of the type are "
                             "left out. Never a figure for one home; price, income and who lives there are never "
                             "in the vector.",
        responses=errors({400: "invalid-query",
                          503: "release-unavailable"})),
    "getAreaHome": dict(
        response_description="area-home.v1: available, borough ({id, name}), extend ({restrictedShare, "
                             "conservationShare, article4Share, listed {gradeI, gradeIIStar, gradeII, total}, "
                             "regionPercentile, regionShare, article4Data published|not-published|null}), "
                             "broadband ({share, regionPercentile, regionShare, premises, boroughFullFibreShare}), "
                             "settled ({share, regionPercentile, regionShare, residents}), notes, sourceVersions, "
                             "sources, caveats. Aggregates about places, never a person or a home."),
    "getAreaOwnership": dict(
        response_description="area-ownership.v1 evidence envelope. value: available (false with reason "
                             "flag-off|not-loaded), company and overseas ({titles, share, regionPercentile, "
                             "regionShare}), homes, unmatched (boroughs), words, notes, sourceVersions. Counts "
                             "only, never a proprietor, title or address.",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaShortLets": dict(
        response_description="EvidenceEnvelope (schemaVersion area-short-lets.v1) whose value is {available, "
                             "listings, entireHome, active12m, homes, per1000Homes, regionPercentile, "
                             "regionPer1000Homes, entireHomeShare, regionEntireHomeShare, activeShare, "
                             "regionActiveShare, snapshot, sourceVersion, notes}; available false before the layer "
                             "is loaded. Counts of listings in an area, never a listing or a host.",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaMobile": dict(
        response_description="area-mobile.v1: available, grain (borough: Ofcom publishes local authorities only, "
                             "so an LSOA or MSOA reads its borough), confidence (medium|null), value ({borough "
                             "{id, name}, premises, indoor4gAll {share, regionPercentile, regionShare}, "
                             "outdoor5gAny {share, regionPercentile, regionShare}, outdoor4gAll, outdoor5gAll, "
                             "notes, sourceVersions} or null), evidence ([{metricId "
                             "mobile-4g-indoor|mobile-5g-outdoor, geographyId, value %, regionPercentile}]), "
                             "notes, sources, caveats. Predicted coverage of places, never a person or a home."),
    "getAreaHmo": dict(
        response_description="area-hmo.v1 EvidenceEnvelope: value {geographyId, available, borough ({id, name}), "
                             "register ({status published|search-only|on-request|not-found|failed, url, page, "
                             "updated, retrieved}), licensedHmos, homes, per1000Homes, regionPer1000, "
                             "regionPercentile (null unless published: never zero), schemes [{kind "
                             "additional|selective, start, until, url, coverage whole|part}], notes, "
                             "sourceVersions}, confidence, evidence, sources, caveats. Counts of licences by area; "
                             "never a name, holder or address.",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaMarket": dict(
        response_model=models.AreaMarketResponse,
        description="12-month standard sales, turnover (share of EPC-linked homes that sold), the leasehold share "
                    "of SALES (not of homes), new-build and resale median £/m² over 36 months with the new-build "
                    "premium (each median needs 10 sales; the premium needs both), and the LSOA's £/m² index "
                    "growth. Aggregates only: no valuation, no listing, no address. Boroughs and areas without "
                    "released depth answer with value.available false. Answers in the EvidenceEnvelope.",
        response_description="EvidenceEnvelope (schemaVersion area-market.v1) whose value is AreaMarket",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getAreaEvidencePack": dict(
        response_model=models.AreaEvidencePackResponse,
        description="Market depth (as /market), the latest recorded crime rate, road and rail noise shares, state "
                    "schools within 1.5 km (latest Ofsted outcome, no admission claim) and, with ?address=, that "
                    "address's building and street sale aggregates (counts and gated medians, no sale rows). The "
                    "address must lie inside the area.",
        response_description="EvidenceEnvelope (schemaVersion area-evidence-pack.v1) whose value is "
                             "AreaEvidencePack",
        responses=errors({400: "invalid-query (malformed id, or the address is not in the area)",
                          404: "area-not-found | address-not-found",
                          503: "release-unavailable"})),
    "getSimilarAreas": dict(
        response_model=models.SimilarAreasResponse,
        description="Up to ten LSOAs whose London percentiles (the personal-match utilities) for crime, "
                    "deprivation, household income, price per m² (market level) and walk to a station sit closest "
                    "to this LSOA's, by root-mean-square percentile distance. Demographic composition is never "
                    "compared; social renting joins only with socialRenting=true. cheaper=true keeps areas with a "
                    "lower market-level price per m². outsideZones carries the profile's zones array as JSON and "
                    "leaves out every LSOA inside those zones (the response is then not cacheable).",
        response_description="similar-areas.v1",
        responses=errors({400: "invalid-query (not an LSOA, or malformed outsideZones)",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "getSearchBrief": dict(
        response_description="area-brief.v1 (areas, ring, schools, sources, caveats). For market=rent, "
                             "estimatedPrice is the borough average monthly rent for the bedroom count (ONS Price "
                             "Index of Private Rents) with estimatedRent {monthly, basis, bedrooms, boroughId, "
                             "period, sourceVersion}; station.zone is the TfL fare zone when known",
        responses=errors({400: "invalid-query",
                          404: "area-not-found",
                          503: "release-unavailable"})),
    "postCommute": dict(
        response_description="area-commute.v1 (places with hub and minutes per mode; empty when no routing release)",
        responses=errors({400: "invalid-profile | invalid-query",
                          404: "area-not-found"})),
    "evaluateCustomCriterion": dict(
        response_description="custom-criterion-pack.v1 (values per LSOA with counts per set, legend, summary: top "
                             "and bottom areas, one per friendly title, and how many areas tie at each end)",
        responses=errors({400: "invalid-criterion",
                          503: "release-unavailable"})),
    "getCustomCriterionPresetPack": dict(
        response_description="custom-criterion-pack.v1",
        responses=errors({404: "preset-not-found",
                          503: "release-unavailable"})),
    "listCustomCriterionPresets": dict(
        response_description="custom-criterion-presets.v1 (custom-criterion.v1 definitions, direction, description)"),
    "searchStations": dict(
        response_model=models.StationSearchResponse,
        response_description="station-search.v1 (at most 10 stations of the active release)",
        responses=errors({400: "invalid-query",
                          503: "release-unavailable"})),
    "listSchools": dict(
        response_model=models.SchoolSearchResponse,
        response_description="School discovery results"),
    "getSchoolIndex": dict(
        response_model=models.SchoolIndexResponse,
        description="URN, name, phase, borough (GIAS local authority), successor URN and hasEvidence (any result "
                    "or inspection in the active release). The sitemap lists /school/{urn} only for schools with "
                    "evidence; a page without any is noindex. /schools?borough= lists one borough's schools from "
                    "it.",
        response_description="A school-index.v1 payload"),
    "getSchoolPoints": dict(
        response_model=models.SchoolPointsResponse,
        description="Each state-funded school without a successor (kind state), then each open mainstream "
                    "independent school once migration 067 is loaded (kind independent), for the map's Show › "
                    "Schools icons and hover popup. stage is primary, secondary or all-through (ages from under 10 "
                    "to 16+). Optional fields are left out when empty: ofsted (state only: the school card's "
                    "standing inspection, so an ungraded visit leaves the grade before it: outstanding, good, "
                    "requires-improvement, inadequate from the legacy overall grade, or report-card; none for "
                    "2024-25 graded areas without an overall grade), topPercent (state only: England rank's top % "
                    "in the phase's latest year, 25 or better), selective, faith (GIAS religious character), "
                    "sixthForm, intake (\"Girls\", \"Boys\", or \"Girls · mixed sixth form\" when the census "
                    "counts the other sex at a single-sex school with a sixth form).",
        response_description="A school-points.v1 payload"),
    "getUniversityPoints": dict(
        response_model=models.UniversityPointsResponse,
        description="OpenStreetMap places tagged amenity university or college with a name (the merged places "
                    "table, migration 034; confidence 0.6 or more), drawn from zoom 13 while Student areas "
                    "(student-share) colours the map. Empty before the places table is loaded. © OpenStreetMap "
                    "contributors, ODbL 1.0.",
        response_description="A university-points.v1 payload"),
    "getSchool": dict(
        response_model=models.SchoolSummaryResponse,
        response_description="School evidence",
        responses=errors({404: "School not found"})),
    "getSchoolCard": dict(
        response_model=models.SchoolCardResponse,
        description="school_summary with topBadge, school_history, percentiles and London medians per measure and "
                    "year (London state schools of the same phase, cohort 30+, suppressed figures left out), KPI "
                    "tiles, short dated Ofsted extracts (whole sentences, 160 characters or fewer, at most three "
                    "each), and every council's last distance offered per year with the council, licence, "
                    "attribution and source link. nationalRank: the school's place among England's state "
                    "mainstream schools (KS2 % at the expected standard in reading, writing and maths, ties broken "
                    "by % at the higher standard; KS4 Attainment 8), latest year as the headline with every loaded "
                    "year in history; equal figures share a rank, top % = ceil(rank / total * 100); null when no "
                    "rank is loaded. profile: GIAS gender, trust and capacity, and the latest census and absence "
                    "shares, each with its academic year and source release (null when not published). "
                    "inspectionCounts: graded areas above / below the bar and \"to improve\" points of the latest "
                    "graded inspection. admissions.byYear: every entry year with first-choice applications not "
                    "offered on offer day (100 × (1 − first-preference offers ÷ first preferences)) and "
                    "applications and offers by preference. Migration 056, each null when the school has no "
                    "published figure (missing[] says why): parentView (Ofsted Parent View, 10+ submissions only: "
                    "the survey in use since 10 November 2025, else the earlier survey, migration 060, surveyEra "
                    "says which; never both), workforce (latest school workforce census), finance (one CFR or AAR "
                    "return, the school's own kind, never both) and destinations (secondaries only: KS4 and 16-18 "
                    "destination measures; null for primaries). Figures are as published, with year and "
                    "sourceRelease; per-pupil money is the published total ÷ FTE pupils of the same return.",
        response_description="A school-card.v1 payload",
        responses=errors({404: "School not found"})),
    "getSchoolRanking": dict(
        response_model=models.SchoolRanking,
        description="KS4 axes (secondary only) rank by value, high to low, using the latest year published for the "
                    "measure (provisional 2024/25; Progress 8 is the 2023/24 figure with its own cohort), drop "
                    "suppressed figures and cohorts under 30. legacy-outstanding lists legacy Outstanding schools "
                    "not since inspected under report cards, newest inspection first. report-card-exceptional "
                    "counts the report-card areas graded exceptional. Report-card and legacy grades are never "
                    "combined.",
        response_description="A SchoolRanking",
        responses=errors({400: "Invalid phase or limit, or a KS4 axis asked for primary schools",
                          404: "Not a school ranking",
                          503: NO_RELEASE})),
    "getValuePack": dict(
        response_model=models.ValuePack | models.CompactValuePack,
        summary="Get metric values for a period",
        response_description="Compact values keyed by stable geography ID",
        responses=errors({400: "Invalid metric or period",
                          404: "Metric or period not found",
                          503: NO_RELEASE})),
    "getMetricValues": dict(
        response_model=models.MetricValuesResponse,
        response_description="{schemaVersion, metricId, productReleaseId, values: {YYYY-MM: [number, ...]}}",
        responses=errors({400: "No periods, too many, or a malformed one",
                          404: "Unknown metric or a month the release does not hold",
                          503: NO_RELEASE})),
    "getAreaHierarchy": dict(
        response_model=models.AreaHierarchyResponse,
        response_description="area-hierarchy.v1: areas [{geographyId, name, carrier, parentId, schools {primary, "
                             "secondary} or null, regionCode}]; LSOAs, and releases without schools, carry null. "
                             "London's areas alone with CLOSE_KNIT_ENGLAND off",
        responses=errors({503: "release-unavailable"})),
    "getAreaTrail": dict(
        response_model=models.AreaTrailResponse,
        description="A page's breadcrumbs without its region's whole list. Empty areas for an area outside the "
                    "served regions (CLOSE_KNIT_ENGLAND off).",
        response_description="area-hierarchy.v1 with the trail's rows in areas (same fields as /api/v1/hierarchy) "
                             "and the area's region",
        responses=errors({404: "area-not-found",
                          503: "release-unavailable"})),
    "getLensValues": dict(
        response_model=models.LensPack,
        description="count presets become places per km² of the summed LSOA areas (MSOAs with fewer than 5 places "
                    "and the City of London among boroughs are suppressed), variety is the union of kinds, nearest "
                    "the median of the LSOAs' walk minutes. Same shape as the crime packs; metricId is "
                    "lens:{preset}.",
        response_description="A LensPack for the carrier asked for",
        responses=errors({400: "Invalid carrier",
                          404: "Not a ranking lens",
                          503: NO_RELEASE})),
    "searchSectors": dict(
        response_description="[{code 'W5 1', slug 'W5-1', name}]"),
    "getSector": dict(
        response_description="sector.v1 envelope; value: sector {code, slug, name, district, borough {id, name}, "
                             "postcodeCount, geometry}, distribution {periodEnd, sector (null under 20 sales), "
                             "district} each {sales, p09, p25, p50, p75, p91, buckets [{from, to, count}]}, index "
                             "{base 2004, series [{zone sector|district|borough-house|borough-flat, points [{year, "
                             "nominal, real, sales}]}]}, returns [{years 1|5|10|20, zone, nominalPa, realPa, "
                             "nominalTotal, realTotal} as fractions], nearby [{code, slug, name, p25, p50, p75, "
                             "sales, isSelf}], streets [{name, sales, medianFloorArea, medianPpm}] (at most 12)",
        responses=errors({404: "area-not-found (unknown or malformed slug)",
                          503: "release-unavailable"})),
    "getAreaValues": dict(
        response_model=models.ValuePack,
        response_description="A ValuePack plus the carrier asked for",
        responses=errors({400: "Invalid carrier or period",
                          404: "Metric or period not found",
                          503: NO_RELEASE})),
    "getAddressHistory": dict(
        response_model=models.AddressHistoryResponse,
        summary="Get recorded sale history for a building address",
        response_description="Actual transactions identified by stable address hash, never a UPRN",
        responses=errors({400: "Invalid address id",
                          404: "Address not found",
                          503: NO_RELEASE})),
    "getNearbySales": dict(
        response_model=models.NearbySalesResponse,
        summary="Other homes' recorded sales in the same building and on the same street",
        description="HM Land Registry Price Paid sales of other addresses sharing the address's building key "
                    "(postcode, house number or name, street) or street key (street within the borough, other "
                    "buildings), last 10 years, newest 50 per list. Rows carry no floor area or £/m²; the median "
                    "£/m² is withheld under 5 standard (category A) sales with an EPC floor area. Homes with a "
                    "confirmed privacy objection are left out. A list is null when the address's own sale record "
                    "has no building or street part to match on.",
        response_description="nearby-sales.v1",
        responses=errors({400: "Invalid address id",
                          404: "Address not found",
                          503: NO_RELEASE})),
    "getProperty": dict(
        response_model=models.PropertyResponse,
        summary="One dwelling's last recorded standard sale, parcel and coordinates (no value for the home itself)",
        response_description="property.v2",
        responses=errors({400: "invalid-query",
                          404: "property-not-found",
                          503: "release-unavailable"})),
    "getPropertyProfile": dict(
        response_model=models.PropertyProfileResponse,
        response_description="property-profile.v2",
        responses=errors({400: "invalid-query",
                          404: "property-not-found",
                          503: "release-unavailable"})),
    "getPostcodeHomes": dict(
        response_model=models.PostcodeHomesResponse,
        response_description="postcode-homes.v1",
        responses=errors({400: "invalid-query",
                          404: "address-not-found",
                          503: "release-unavailable"})),
    "getHomesNear": dict(
        response_model=models.HomesNearResponse,
        response_description="homes-near.v1",
        responses=errors({400: "invalid-query: a point outside London or a limit outside 1 to 10",
                          503: "release-unavailable"})),
    "getStreetHome": dict(
        response_model=models.StreetHomeResponse,
        response_description="One of {uprn} (a recorded home: open its property page), {postcodePage: true} (a "
                             "recorded home with no UPRN: open the postcode page, never a no-sale page) or {label, "
                             "postcode, likelyPostcode, neighbours, areaId, point {lat, lon} | null, withheld} (no "
                             "record, or a hidden home: the same shape and status either way).",
        responses=errors({400: "invalid-query: a malformed postcode",
                          404: "no street-level home there: the street is not at that postcode, or the number is "
                               "outside the street's recorded numbers (lowest to highest)",
                          503: "release-unavailable"})),
    "getHomeIndex": dict(
        response_model=models.HomeIndexResponse,
        description="Postcodes with a recorded home and UPRNs with a property page in the active release, for the "
                    "sitemap's per-sector shard (/postcode/sitemap/{sector}.xml). Hidden homes are left out; their "
                    "pages are 404.",
        response_description="A home-index.v1 payload",
        responses=errors({400: "Not a postcode sector"})),
    "getPropertyTile": dict(
        response_description="Mapbox Vector Tile; blocks carry id, area (m²), dwellings and ppm (median £/m², only "
                             "over three or more homes); parcels/dwellings carry uprn, address_id, latest_sale, "
                             "address (zoom 16+) and, for a sold home (a dwelling or a parcel of one home), band "
                             "(0 = bottom 10% … 5 = top 10% of same-type sales in its area that year), with the "
                             "parcel id / UPRN as feature id. No per-home value, £/m² or floor area (migration 044)",
        responses={**binary("application/vnd.mapbox-vector-tile"),
                   **errors({204: "Nothing valued in this tile",
                             400: "invalid-query (zoom outside 12-19)"})}),
    "getSaleTile": dict(
        response_description="Mapbox Vector Tile; sale_cells carry n (homes, at least 3), median price, ppm, mean "
                             "area growth g1/g3/g5/g10/g20 (%) and the latest sale year, over homes sold in the "
                             "latest five years; no per-sale £/m²; sales carry id (address id), uprn, price, date, "
                             "year, type (D/S/T/F/O), new_build (0/1), tenure (F/L/U), category (A/B), sales "
                             "(count), previous_price, previous_date, growth (annualised repeat-sale %), g1-g20 "
                             "(area growth %), precision (uprn/postcode), area (LSOA id). Homes with a confirmed "
                             "privacy objection are absent.",
        responses={**binary("application/vnd.mapbox-vector-tile"),
                   **errors({204: "No recorded sale in this tile",
                             400: "invalid-query (zoom outside 11-19)"})}),
    "getAreaTile": dict(
        response_description="Mapbox Vector Tile; each feature's id is the area's ONS code as an integer "
                             "(E01000001 -> 1000001), no properties and no values (colours come from the value "
                             "packs). Shapes simplified to 3 units of 4096 per tile.",
        responses={**binary("application/vnd.mapbox-vector-tile"),
                   **errors({204: "No area of this kind in this tile, or zoom below 5",
                             400: "invalid-query (malformed release, kind or tile; no tiles before migration 116 or "
                                  "with CLOSE_KNIT_ENGLAND off)"})}),
    "getPlaceTile": dict(
        response_description="Mapbox Vector Tile; places carry id, name, category, group (coffee, fast_food, "
                             "restaurant, pub, gym, shop, culture, other), brand, sources (comma-separated "
                             "fhrs/overture/osm/fsq), hygiene_rating and score (importance 0-100 from category, "
                             "agreeing sources, confidence, recognised brand and register-rated food; drawn as "
                             "labels, higher first). Zoom 14 keeps landmarks and well-confirmed places (best per "
                             "group in each ~64 px cell), zoom 15 more (~32 px cells), zoom 16+ every place but "
                             "generic one-source entries. Places of worship and religion are never included. "
                             "Contains OpenStreetMap data (ODbL 1.0); FSA register OGL v3.0; Overture "
                             "CDLA-Permissive-2.0; Foursquare Apache 2.0.",
        responses={**binary("application/vnd.mapbox-vector-tile"),
                   **errors({204: "No place in this tile, or zoom below 14",
                             400: "invalid-query (tile outside the zoom 0-22 pyramid)"})}),
    "getCollisionTile": dict(
        response_description="Mapbox Vector Tile; collisions carry n (casualties), severity (1 killed, 2 serious, "
                             "3 slight), road_user (pedestrian, cyclist, escooter, motorcycle, car, bus, goods, "
                             "other) and child (0-15); from zoom 13 also year, dark and age_band. Never a date, "
                             "time or sex. DfT STATS19 last five years, Open Government Licence v3.0.",
        responses={**binary("application/vnd.mapbox-vector-tile"),
                   **errors({204: "No casualty in this tile, or zoom below 10",
                             400: "invalid-query (tile outside the zoom 0-22 pyramid)"})}),
    "getCycleLaneTile": dict(
        response_description="Mapbox Vector Tile; cycle_lanes carry kind (protected = segregated or stepped track, "
                             "lane = painted or shared, cycleway = open TfL Cycleway route) and name (Cycleways "
                             "only). TfL Cycling Infrastructure Database (surveyed 2017-2019) and TfL Cycleways; "
                             "Powered by TfL Open Data.",
        responses={**binary("application/vnd.mapbox-vector-tile"),
                   **errors({204: "No cycle lane in this tile, or zoom below 11",
                             400: "invalid-query (tile outside the zoom 0-22 pyramid)"})}),
    "getStreetTreeTile": dict(
        response_description="Mapbox Vector Tile; street_trees carry n (trees; 1 from zoom 15); from zoom 15 also "
                             "name (common name), height, canopy and girth as the owner recorded them (\"8 m\", "
                             "\"5–10 m\", \"under 3 m\", \"Sapling\"; absent when not recorded), canopy_m (spread "
                             "in metres, for the dot size), age (\"Mature (31-80)\") and owner (borough, TfL, "
                             "Royal Parks). GLA public realm trees, Nov 2025, Open Government Licence v3.0; "
                             "private gardens are not in it.",
        responses={**binary("application/vnd.mapbox-vector-tile"),
                   **errors({204: "No tree in this tile, zoom below 13, or migration 066 not applied",
                             400: "invalid-query (tile outside the zoom 0-22 pyramid)"})}),
    "getGreenStreetTile": dict(
        response_description="Mapbox Vector Tile; green_streets carry name, trees (street trees within 20 m, each "
                             "counted for its nearest link), per_100m (trees per 100 m; a link under 50 m counts "
                             "as 50 m) and canopy (share of the two kerbs under canopy, 0-1, absent unless four in "
                             "five of the link's trees have a canopy recorded). OS Open Roads (contains OS data © "
                             "Crown copyright and database right 2026) and GLA public realm trees, Open Government "
                             "Licence v3.0.",
        responses={**binary("application/vnd.mapbox-vector-tile"),
                   **errors({204: "No road link in this tile, zoom below 13, or migration 066 not applied",
                             400: "invalid-query (tile outside the zoom 0-22 pyramid)"})}),
    "getCanopyTile": dict(
        response_description="256 px palette PNG; each 10 m cell whose highest clear summer NDVI (Sentinel-2, 19 "
                             "June and 11 July 2025) is 0.4 or more is leaf green in four strengths (0.4, 0.5, "
                             "0.6, 0.7+), the rest clear. Trees, gardens (private ones too), grass and parks "
                             "alike. Contains modified Copernicus Sentinel data (2025).",
        responses={**binary("image/png"),
                   **errors({204: "No green in this tile, zoom outside 11-14, or migration 066 not loaded",
                             400: "invalid-query (tile outside the zoom 0-22 pyramid)"})}),
    "downloadPlaces": dict(
        description="Offered because the place tiles and nearby lists are produced from a database that contains "
                    "OpenStreetMap data (ODbL share-alike). Lines starting with \"# \" carry the licence notice "
                    "and the sources' attribution, then a CSV header: id, name, category, group, brand, sources "
                    "(;-joined), confidence, score, specialty_score, hygiene_rating, lsoa_id, lon, lat, osm_id, "
                    "fhrs_id, overture_id, fsq_id, tags (JSON), source_release_id. Built once per place release; "
                    "rate class \"download\" (2/minute, 4/hour, 10/day per client).",
        response_description="Attachment (Content-Disposition), Cache-Control public max-age=86400, Link "
                             "rel=license",
        responses={**text("text/csv"),
                   **errors({429: "rate-limited",
                             503: "release-unavailable | query-timeout"})}),
    "createMatches": dict(
        response_model=models.MatchPack,
        description="One model for every criterion. Each criterion gives an area a fit in [0, 1]: 1 inside its "
                    "range, falling linearly to 0 across its soft edge, 0 beyond. A Must criterion (edges at 0) is "
                    "a filter with no weight: outside it the area is excluded (unmetLimits \"<id>:outside\" or "
                    "\"<id>:missing\", relaxable). The other criteria are ranked by their place in the list: "
                    "weights are the rank-order centroid w_i = 1/n * sum_{k=i..n} 1/k. Score = 100 x the weighted "
                    "geometric mean of the fits (a ranked criterion with no evidence counts as a fit of 0.5); a "
                    "fit of 0 makes the score 0 (scored, never out). Ties break by the criteria in order (better "
                    "fit, then better value). Each scored area gets its rank and percentile among the scored "
                    "areas, its top 2 contributing criteria (reasons) and its 2 weakest; the pack lists the bottom "
                    "10. A preference-profile.v1 is migrated first (weights become the order, Must stays Must, a "
                    "wizard factor becomes a percentile range on its own evidence, zones become the first Where "
                    "criterion). sort=best-value orders the scored areas in the better half by good value for the "
                    "home type (area_good_value, migration 069; value ratios outside 0.6-1.67 are trimmed), the "
                    "rest after them by score. Area level only, never one home.",
        response_description="Complete match pack",
        responses=errors({202: "Route matrices are being calculated",
                          400: "Invalid profile, or an unknown region code"})),
    "createPortalLinks": dict(
        response_model=models.PortalLinksResponse,
        summary="A search's zones as searches on Rightmove, Zoopla and OnTheMarket",
        response_description="portal-links.v1",
        responses=errors({400: "Invalid filter or zones"})),
    "createZoneShapes": dict(
        response_model=models.ZoneShapesResponse,
        summary="Each My match Where zone's outline for the map",
        response_description="zone-shapes.v1",
        responses=errors({400: "Invalid zones"})),
    "getMatchCriterionValues": dict(
        response_model=models.MatchCriterionValues,
        description="The histogram behind a range card: a map metric's latest values, or for a layer with no map "
                    "value pack the My match factor of the same name (noise from area_noise before the Noise map "
                    "layer is loaded, disorder, schools, growth-outlook, epc-share, leasehold-share). Census "
                    "layers and own criteria (custom:) are not criteria here.",
        response_description="The layer's values",
        responses=errors({400: "not a criterion layer",
                          404: "no values for this layer"})),
    "getExtensionConfig": dict(
        response_model=models.ExtensionConfigResponse,
        summary="The browser extension's per-portal kill switch",
        response_description="Modes per portal"),
    "createListingCard": dict(
        response_model=models.ListingCardResponse,
        summary="The browser extension's area card beside a portal listing",
        response_description="Card blocks (status ok or outside-coverage)",
        responses=errors({400: "Invalid profile",
                          422: "Invalid listing facts"})),
    "createListingBadges": dict(
        response_model=models.ListingBadgesResponse,
        summary="The browser extension's line under each search result on a portal",
        response_description="One badge per result, in order",
        responses=errors({400: "Invalid profile",
                          422: "Invalid listing facts"})),
    "listAgentTools": dict(
        response_model=models.ToolIndex,
        response_description="Tool index"),
    "callAgentTool": dict(
        response_model=models.EvidenceEnvelope,
        response_description="Evidence envelope",
        responses=errors({400: "invalid-arguments | invalid-profile | invalid-query",
                          404: "tool-not-found | area-not-found | address-not-found | metric-not-found | "
                               "period-not-found",
                          503: "release-unavailable | request-cancelled"})),
}


def operation(operation_id: str) -> dict[str, Any]:
    """The route decorator's documentation keywords for `operation_id`."""
    return {"operation_id": operation_id, **OPERATIONS[operation_id]}
