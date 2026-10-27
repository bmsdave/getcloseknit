"""Conversation-grade home-search tools.

The area tools in `tools.py` answer one evidence question each. These sit on
top of them for an agent helping a household choose where to live: plain
parameters instead of a preference-profile document, a short shortlist
instead of every scored area, a rough budget fit, and links back to the
website and to the property portals' own searches. Nothing here reads,
stores or ranks listings: the portal links open the portal's search in the
user's browser, and `assess_listing` only compares a listing the user brings
against local evidence.
"""
import hashlib
import math
import re
from typing import Annotated, Any, Literal, Mapping
from urllib.parse import quote

from pydantic import Field

from . import (civic, custom_criteria, envelope, evidence, feature_flags, market_depth, match_model,
               repository, search_text, share_links, usage)
from . import kinds, listing_costs
from .listing_costs import SDLT_IN_FORCE_ON
from .matching import DEFAULT_DIRECTION, MAX_ZONES, build_match_pack, limit_id, validate_match_request
from .toolspec import StrictInput, ToolContext, ToolSpec

AREA_ID_PATTERN = r"^uk:(lsoa|msoa|lad|borough):[A-Z]\d{8}$"  # an old uk:borough: id too (R2)
LSOA_ID_PATTERN = r"^uk:lsoa:E\d{8}$"
BOROUGH_ID_PATTERN = r"^uk:(lad|borough):E\d{8}$"  # an old uk:borough: id too (R2)
STATION_ID_PATTERN = r"^osm:[nwr]\d{1,15}$"
POSTCODE_PATTERN = r"^\s*[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}\s*$"
PRICE_METRIC = "price-per-square-metre"
DEPRIVATION_METRIC = "deprivation"

# Factors the active release can score. Affordability is judged against the budget below;
# schools, commute and growth are not scored yet (the overview lists nearby schools instead).
# Household income and social renting are not priorities here (matching.RETIRED_FACTOR_IDS);
# they rank (rank_areas_by_metric) and are My match ranges on the web. Deprivation is the
# official IMD decile (1 = most deprived).
Priority = Literal["crime", "station-access", "market-level", "deprivation",
                   "noise", "disorder", "epc-share", "leasehold-share"]
# What each quick criterion (migration 028) measures, said once per answer that weighs it.
# The air-no2 key is a layer id (air has no wizard factor); the rest are factor names.
QUICK_CAVEATS = {
    "air-no2": "Clean air is the modelled yearly mean nitrogen dioxide (NO2) at the area's homes, 2022 "
               "(London Atmospheric Emissions Inventory 2022, Greater London Authority and Transport "
               "for London): modelled, not measured. The WHO guideline is 10 µg/m³, the UK legal limit 40.",
    "noise": "Noise is the share of homes at 55 dB Lden or more from road, rail or aircraft (Defra strategic "
             "noise maps, 2022): modelled, not measured, and blind to neighbours or nightlife.",
    "disorder": "Visible disorder counts anti-social behaviour, criminal damage and arson and public order "
                "incidents per 1,000 residents over 12 months (police.uk); busy centres with few residents come out high.",
    "epc-share": "Energy rating is the share of homes with an EPC rated A-C; only homes with a certificate count, "
                 "and a certificate can be up to 10 years old.",
    "leasehold-share": "Leasehold share is the share of last year's sales recorded as leasehold, not the share of "
                       "homes; with mostly leasehold, check the years left on the lease and the service charge.",
}

# Rough London floor areas by bedroom count, used only to turn a local £/m² median into a
# ballpark price. An assumption, stated in every answer that uses it.
TYPICAL_FLOOR_AREA = repository.TYPICAL_FLOOR_AREA
STRETCH = 1.15
IN_LINE = 0.10
CANDIDATE_POOL = 6
# assess_listing safety net (issue #213): a buy-mode asking price below this is almost
# certainly a monthly rent entered as a sale price.
MIN_PLAUSIBLE_BUY_PRICE = 20_000
# assess_listing plausibility: beyond this |differencePercent| the price basis itself is
# suspect (a part share, a weekly rent, an auction price, rent entered as a sale price);
# confidence drops to low and a caveat names the basis to check.
PLAUSIBILITY_DIFFERENCE_PCT = 60
# A week of rent, annualised, in calendar months.
WEEKS_PER_MONTH = 52 / 12
SHARED_OWNERSHIP = "shared-ownership"


class PriorityInput(StrictInput):
    factor: Priority = Field(description=(
        "crime = recorded crime rate; station-access = walk minutes to the nearest station; "
        "market-level = local £/m² price level; deprivation = official deprivation decile (IMD), 1 = most deprived; "
        "noise = share of homes at 55 dB+ from road, rail or aircraft; disorder = anti-social behaviour, "
        "criminal damage and public order per 1,000 residents; epc-share = share of homes rated EPC A-C "
        "(energy efficiency, running costs); leasehold-share = share of recent sales that were leasehold."))
    importance: int = Field(ge=1, le=5, description="1 = nice to have … 5 = essential.")
    direction: Literal["higher", "lower"] | None = Field(default=None, description=(
        "Which end the household prefers. Default: lower crime, shorter walks, lower prices, "
        "a higher deprivation decile, less noise, less disorder, more homes rated A-C, "
        "fewer leasehold sales."))
    must: bool = Field(default=False, description=(
        "True = a filter: only areas in the better half of London for it (no weight). False = ranked by "
        "importance: the better half fits fully, the next quarter of London partly, the rest not at all."))


class RangeInput(StrictInput):
    layer: str = Field(pattern=r"^(custom:)?[a-z0-9][a-z0-9-]{0,59}$", description=(
        "Any map layer from list_metrics (e.g. noise, crime, station-access, nature-score, "
        "price-per-square-metre, food-hygiene), or disorder, schools, epc-share, leasehold-share. Never a "
        "Census (census-*, student-share) layer."))
    scale: Literal["value", "percentile"] = Field(default="percentile", description=(
        "percentile = bounds are percentiles of the value within each area's region (London's areas among "
        "London's), 0 = lowest, 100 = highest (e.g. max 30 = the lowest 30% for noise); value = the layer's own unit."))
    min: float | None = Field(default=None, description="Lowest accepted value (or percentile).")
    max: float | None = Field(default=None, description="Highest accepted value (or percentile).")
    soft_min: float | None = Field(default=None, description="Below min the fit falls to 0 at soft_min (≤ min).")
    soft_max: float | None = Field(default=None, description="Above max the fit falls to 0 at soft_max (≥ max).")
    importance: int = Field(default=3, ge=1, le=5, description="1 nice to have … 5 essential: sets its place in the order.")
    must: bool = Field(default=False, description="True = a filter (no soft edge, no weight).")


class StationZoneInput(StrictInput):
    station_id: str = Field(pattern=STATION_ID_PATTERN, description="Station id from search_places (osm:n…).")
    max_walk_minutes: int = Field(default=15, ge=5, le=30, description="Walking time to the station (5-30).")


class SchoolMeasureInput(StrictInput):
    id: Literal["englandTopPercent", "progress8", "attainment8", "grade5EngMaths", "ks2RwmExpected", "fsm6Share"] = Field(
        description=("englandTopPercent = England top % (lower is better: at most the threshold); progress8, "
                     "attainment8, grade5EngMaths (%), ks2RwmExpected (%) = at least the threshold; fsm6Share = "
                     "free school meals % (at most). Latest published year per school; cohorts under 30 and "
                     "suppressed cells have no value and never pass."))
    threshold: float = Field(description="The threshold in the measure's own unit, e.g. 75 for KS2 RWM 75%.")


class SchoolFilterInput(StrictInput):
    phases: list[Literal["primary", "secondary", "all-through", "private"]] | None = Field(
        default=None, description="Phases kept (absent = all).")
    ofsted: list[Literal["outstanding", "good", "report-card", "requires-improvement", "inadequate", "not-inspected"]] | None = Field(
        default=None, description="Ofsted standing kept, state schools only (absent = any).")
    establishments: list[Literal["academy", "free", "community", "voluntary", "foundation"]] | None = Field(
        default=None, description="Type of establishment (absent = any).")
    gender: Literal["mixed", "girls", "boys"] | None = Field(default=None, description="Intake (absent = any).")
    faith: Literal["faith", "none"] | None = Field(default=None, description="Faith school or not (absent = any).")
    measure: SchoolMeasureInput | None = Field(default=None, description="One results measure and its threshold.")
    a_level_only: bool = Field(default=False, description="Only sixth forms with a combined A-level rank.")

    def compact(self) -> str:
        """The filter as the map's ?schools= text (school_filter.py)."""
        from . import school_filter

        ofsted_ids = {"outstanding": "out", "good": "good", "report-card": "rc", "requires-improvement": "ri",
                      "inadequate": "inad", "not-inspected": "none"}
        value = school_filter.default()
        if self.phases is not None:
            value["phases"] = list(self.phases)
        if self.ofsted is not None:
            value["ofsted"] = [ofsted_ids[grade] for grade in self.ofsted]
        value.update(establishments=list(self.establishments or []), gender=self.gender, faith=self.faith,
                     aLevelOnly=self.a_level_only,
                     measure={"id": self.measure.id, "threshold": self.measure.threshold} if self.measure else None)
        text = school_filter.text(value)
        try:
            school_filter.parse(text)
        except ValueError as error:
            raise evidence.MalformedQuery(f"school filter: {error}") from None
        return text


class SchoolPlaceInput(StrictInput):
    filter: SchoolFilterInput = Field(description="Which schools count (the same filter as the map's Schools filter).")
    within: int | None = Field(default=None, ge=100, le=10_000, description=(
        "Metres: only a matching school this close counts (straight line); beyond it the area has none."))


class PlaceInput(StrictInput):
    label: str = Field(min_length=1, max_length=60, description="What the place is, e.g. 'Office', 'PureGym Angel', 'Any park'.")
    latitude: float | None = Field(default=None, ge=-90, le=90, description=(
        "A pinned place: its latitude (from search_places). For an address, `center` is its area's "
        "centre unless `centerPrecision` is `uprn`; never pin an LSOA centroid as the home."))
    longitude: float | None = Field(default=None, ge=-180, le=180, description="A pinned place: its longitude.")
    category: Literal["park", "cafe", "supermarket", "convenience", "gp", "pharmacy", "pub", "restaurant",
                      "gym", "pool", "sports_club", "step_free_station"] | None = Field(
        default=None, description=(
            "Instead of a point: the nearest place of this kind (pool = public pool; step_free_station = a "
            "station TfL lists with lift access, or any DLR station or tram stop)."))
    brand: str | None = Field(default=None, max_length=40, description=(
        "With a category: only this brand, e.g. 'M&S', 'Waitrose', 'Lidl' (supermarket) or 'PureGym' (gym)."))
    sport: str | None = Field(default=None, max_length=30, description="With sports_club: the sport, e.g. 'tennis', 'football'.")
    top_school: int | None = Field(default=None, ge=1, le=200, description=(
        "Instead of a point or category: near one of London's top N state schools (by published results), "
        "e.g. 10. Living nearby never guarantees a place: say so."))
    school_phase: Literal["primary", "secondary"] = Field(default="secondary", description="With top_school.")
    school_rank_by: Literal["results", "progress8"] = Field(default="results", description=(
        "With top_school: rank by published results (default) or by Progress 8 (secondary only: progress "
        "pupils make from their primary results, latest published year 2023/24)."))
    school: SchoolPlaceInput | None = Field(default=None, description=(
        "Instead of top_school: the nearest school matching a filter (phase, Ofsted, type, intake, faith, one "
        "results measure ≥ a threshold), optionally within N metres; max_minutes still sets the trip."))
    mode: Literal["walk", "cycle", "transit", "car"] | None = Field(default=None, description=(
        "How they get there (default transit for a pin, walk for a kind). car = typical weekday-morning traffic, "
        "no parking or charges: say so."))
    max_minutes: int = Field(default=30, ge=1, le=120, description="The longest trip they accept.")
    importance: int = Field(default=3, ge=1, le=5, description="1 nice to have … 5 essential.")
    must: bool = Field(default=False, description="True when an area beyond max_minutes is out of the question.")


class CustomSetInput(StrictInput):
    label: str = Field(min_length=1, max_length=60, description="What the places are, e.g. 'Kebab shops'.")
    any: list[dict[str, str | list[str] | None]] = Field(min_length=1, max_length=6, description=(
        "OR of matchers; a matcher ANDs OpenStreetMap tag tests over amenity, shop, leisure, tourism, sport, "
        "cuisine, healthcare, craft, office and brand: a value, a list of values, '*' (has the tag) or null "
        "(has no such tag). E.g. [{\"cuisine\": \"kebab\"}], [{\"amenity\": \"cafe\", \"brand\": null}] for "
        "independent cafés, [{\"cuisine\": \"specialty_coffee\"}] for coffee-led shops (specialty coffee, not a café "
        "with coffee on the menu; never a big chain), [{\"brand\": \"Greggs\"}]. religion/denomination are refused: places, not people."))


class CustomCriterionInput(StrictInput):
    id: str = Field(pattern=r"^[a-z0-9-]{1,24}$", description="Short id, e.g. 'kebab-cafe'.")
    label: str = Field(min_length=1, max_length=60, description="Name the user will see: descriptive, no brand or value words, e.g. 'Kebab shops vs cafés'.")
    sets: dict[Literal["a", "b", "c"], CustomSetInput] = Field(description=(
        "Sets of places: a (required), b for balance/share, c optional for count/density."))
    formula: Literal["count", "density", "per_resident", "balance", "share", "variety", "nearest"] = Field(description=(
        "Prefer nearest for 'is one close' (straight-line walk minutes from the area's centre to the nearest A, up "
        "to 5 km) and per_resident for 'how much is around' (places in any set per 1,000 residents; the City of "
        "London is left out). The rest are counted inside each neighbourhood's boundary (the area shape on the map, "
        "not walking distance): count / density (per km² of the area) of places in any set; share A/(A+B); "
        "variety = distinct cuisines/sports among A; balance (A-B)/(A+B+5) from -1 (more B) to +1 (more A), "
        "advanced: few places keep an area near 0."))
    radiusMetres: int = Field(default=800, ge=200, le=2000, description=(
        "Kept for compatibility with saved criteria and share links (200-2000 m); no formula uses it, so leave the "
        "default."))


class CustomChoiceInput(StrictInput):
    preset_id: str | None = Field(default=None, description="A ready-made criterion from list_custom_presets, e.g. 'kebab-cafe'.")
    criterion: CustomCriterionInput | None = Field(default=None, description="Or the user's own criterion.")
    importance: int = Field(default=3, ge=1, le=5, description="1 nice to have … 5 essential.")
    direction: Literal["higher", "lower"] | None = Field(default=None, description=(
        "higher = more of it (more A for balance/share, closer for nearest); lower = less. Default: the preset's."))


class EvaluateCustomInput(StrictInput):
    preset_id: str | None = Field(default=None, description="A ready-made criterion from list_custom_presets.")
    criterion: CustomCriterionInput | None = Field(default=None, description="Or the user's own criterion.")
    direction: Literal["higher", "lower"] | None = Field(default=None, description="Which end the user wants (for the top list and the map link).")
    area_ids: list[Annotated[str, Field(pattern=LSOA_ID_PATTERN)]] = Field(
        default_factory=list, max_length=10, description="Also report these areas (LSOA ids from search_places).")
    top_n: int = Field(default=5, ge=1, le=5, description="How many top and bottom areas to list.")


class NoPresetArguments(StrictInput):
    pass


class FindAreasInput(StrictInput):
    market: Literal["buy", "rent"] = Field(default="buy", description="Buying or renting.")
    max_budget: int = Field(gt=0, description="Maximum price in £ (buy) or £ per month (rent).")
    target_budget: int | None = Field(default=None, gt=0, description=(
        "Comfortable price; defaults to max less 8% (the site's own rule: £650k max → £600k)."))
    bedrooms: int = Field(default=2, ge=0, le=8, description="Bedrooms needed (0 = studio).")
    priorities: list[PriorityInput] = Field(default_factory=list, max_length=8, description=(
        "What matters, with importance 1-5 (criteria are ranked by importance, then in the order given; "
        "the order sets the weights). Translate the user's words: 'safe' → crime, "
        "'near the tube' → station-access, 'good value' → market-level, 'quiet' → noise, "
        "'no rough streets / graffiti' → disorder, 'low energy bills' → epc-share, 'freehold' → leasehold-share. "
        "must = only areas in London's better half for it."))
    ranges: list[RangeInput] = Field(default_factory=list, max_length=8, description=(
        "Any other map layer as a range with soft edges, e.g. gigabit broadband at 90% of homes or more: "
        "{layer: 'broadband-gigabit', scale: 'value', min: 90}. Bounds are percentiles within each area's region by "
        "default (London's areas among London's; min 90 = the region's top 10%); scale 'value' uses the layer's own "
        "unit. Only layers list_metrics shows."))
    budget_importance: int = Field(default=5, ge=1, le=5, description=(
        "Where the budget sits in the order (5 = first). Fit 1 up to target_budget, falling to 0 at max_budget."))
    budget_must: bool = Field(default=False, description="True = areas whose ballpark is over max_budget are out.")
    near_stations: list[StationZoneInput] = Field(default_factory=list, max_length=MAX_ZONES, description=(
        "Live within walking distance of these stations (e.g. on the user's commute line)."))
    boroughs: list[str] = Field(default_factory=list, max_length=MAX_ZONES, description=(
        "Live in these boroughs (uk:lad:E09…, from search_places). Stations + boroughs ≤ 3."))
    only_in_zones: bool = Field(default=True, description=(
        "With stations/boroughs given: True = only areas inside them (a must Where criterion); False = ranked "
        "first in the order, the fit falling with distance outside (zone_soft_metres)."))
    zone_soft_metres: int = Field(default=match_model.DEFAULT_SOFT_METRES, ge=100, le=5000, description=(
        "Outside the zones the fit falls to 0 over this distance (when only_in_zones is False)."))
    exclude_area_ids: list[str] = Field(default_factory=list, max_length=100, description=(
        "Areas the user already rejected — LSOA, MSOA or borough geography ids (boroughs and MSOAs "
        "expand to their LSOAs) — so they are not suggested again."))
    include_over_budget: bool = Field(default=False, description="Keep areas whose typical home looks over budget.")
    places: list[PlaceInput] = Field(default_factory=list, max_length=8, description=(
        "Where the household goes — work, a gym, a particular school, friends (pinned: latitude/longitude "
        "from search_places) or the nearest of a kind (category). Each becomes a criterion; must = hard limit."))
    liked_area_ids: list[str] = Field(default_factory=list, max_length=50, description=(
        "Areas the user liked: carried into the map link and highlighted there."))
    property_type: Literal["house", "flat", "any"] = Field(default="any", description=(
        "House or flat, for the price comparison on the brief page (sales of similar homes)."))
    top_n: int = Field(default=8, ge=1, le=20, description="How many areas to return.")
    custom: list[CustomChoiceInput] = Field(default_factory=list, max_length=custom_criteria.MAX_CUSTOM, description=(
        "The user's own criteria from places on the map ('more cafés than kebab shops', 'near gyms'): a preset_id "
        "or a criterion, each scored by its percentile within the area's region (London for a London area). Describes "
        "places, never who lives there."))


class SimilarAreasInput(StrictInput):
    area_id: str = Field(pattern=LSOA_ID_PATTERN, description="A neighbourhood (LSOA) the user liked.")
    cheaper: bool = Field(default=False, description="Only areas with a lower £/m² price level.")
    bedrooms: int | None = Field(default=None, ge=0, le=8, description="Adds a ballpark price for this size.")
    top_n: int = Field(default=6, ge=1, le=10, description="How many areas to return.")


class AreaOverviewInput(StrictInput):
    area_id: str = Field(pattern=AREA_ID_PATTERN, description="Geography id, e.g. uk:lsoa:E01000951.")
    bedrooms: int | None = Field(default=None, ge=0, le=8, description="Adds a ballpark price for this size.")


class FloodRiskInput(StrictInput):
    area_id: str = Field(pattern=AREA_ID_PATTERN, description="Geography id, e.g. uk:lsoa:E01000951.")
    uprn: str | None = Field(default=None, pattern=r"^[0-9]+$",
                             description="A home's UPRN for its own bands; without it, only the area's land bands.")


class RentLevelsInput(StrictInput):
    area_ids: list[str] = Field(min_length=1, max_length=50,
                                description="LSOA, MSOA or borough ids, e.g. uk:lsoa:E01000951 or uk:lad:E09000012.")
    bedrooms: int = Field(ge=1, le=8, description="Bedroom count; the site shows rents per bedroom count.")


class SearchPlacesInput(StrictInput):
    q: str = Field(min_length=2, description="A station, borough, neighbourhood, postcode or street.")
    limit: int = Field(default=5, ge=1, le=10, description="Results per kind.")


class ListingLinksInput(StrictInput):
    area_ids: list[str] = Field(min_length=1, max_length=10, description="LSOA ids from find_areas.")
    market: Literal["buy", "rent"] = Field(default="buy", description="Buying or renting.")
    max_price: int = Field(gt=0, description="£ (buy) or £ per month (rent).")
    min_bedrooms: int = Field(default=0, ge=0, le=8, description="Minimum bedrooms.")
    outcodes_per_area: int = Field(default=1, ge=1, le=3, description="Postcode districts per area (busiest first).")


class AssessListingInput(StrictInput):
    postcode: str = Field(pattern=POSTCODE_PATTERN, description="Full postcode of the listing, e.g. W5 2NU.")
    asking_price: int = Field(gt=0, description="£ (buy) or the rent in its rent_period (rent).")
    market: Literal["buy", "rent"] = Field(default="buy", description="For sale or to rent.")
    rent_period: Literal["month", "week"] = Field(default="month", description=(
        "The rent's period: month = £ per calendar month, week = £ per week "
        "(converted ×52/12 for the comparison)."))
    bedrooms: int | None = Field(default=None, ge=0, le=8, description="Bedrooms in the listing.")
    floor_area_sqm: float | None = Field(default=None, gt=5, lt=2000, description="Floor area in m² if the listing states it.")
    floor_area_sqft: float | None = Field(default=None, gt=50, lt=22000,
                                          description="Floor area in sq ft if the listing states it; "
                                                      "converted server-side (1 sq ft = 0.092903 m²).")
    property_type: Literal["detached", "semi-detached", "terraced", "flat"] | None = Field(
        default=None, description="Property type if the listing states it; used for a same-type comparison.")
    tenure: Literal["freehold", "leasehold", "share-of-freehold", "shared-ownership", "unknown"] = Field(
        default="unknown", description="Tenure if the listing states it; lease questions are hedged "
                                       "('If leasehold') when unknown and skipped for freehold.")
    share_percent: float | None = Field(default=None, ge=1, le=100, description=(
        "Shared-ownership share for sale, e.g. 25: the asking price is compared as "
        "asking_price ÷ share against whole-home prices. Omit when the listing does not state it "
        "(the verdict stays unknown)."))
    listing_url: str | None = Field(default=None, max_length=500, description="Echoed back for citation only.")


class WatchSpecInput(StrictInput):
    name: str = Field(min_length=2, max_length=60, description="Short name, e.g. 'Ealing 2-bed'.")
    area_ids: list[str] = Field(min_length=1, max_length=10, description="LSOA ids to watch.")
    market: Literal["buy", "rent"] = Field(default="buy", description="Homes for sale (buy) or to let (rent).")
    max_price: int = Field(gt=0, description="£ (buy) or £ per month (rent).")
    min_bedrooms: int = Field(default=0, ge=0, le=8, description="Fewest bedrooms (0 = studio or any).")
    must_haves: str = Field(default="", max_length=500, description="Free-text requirements the agent checks per listing.")
    frequency: Literal["daily", "weekly"] = Field(default="daily", description="How often the scheduled check runs.")


def build_profile(args: FindAreasInput) -> dict:
    """The preference-profile.v2 document the website and `match_areas` understand: one ordered
    list of criteria, by importance and then as given; a must is a filter."""
    if len({item.factor for item in args.priorities}) != len(args.priorities):
        raise evidence.MalformedQuery("each priority factor may appear once")
    if not args.priorities and not args.ranges and not args.places and not args.custom:
        raise evidence.MalformedQuery("give at least one priority, range, place or custom criterion")
    zones = [{"kind": "station", "stationId": item.station_id, "maxWalkMinutes": item.max_walk_minutes}
             for item in args.near_stations]
    zones += [{"kind": "borough", "id": borough} for borough in args.boroughs]
    if len(zones) > MAX_ZONES:
        raise evidence.MalformedQuery(f"at most {MAX_ZONES} stations and boroughs together")
    ranked: list[tuple[int, dict]] = [(args.budget_importance, {"kind": "budget", "must": args.budget_must})]
    for item in args.priorities:
        factor = {"factorId": item.factor, "direction": item.direction or DEFAULT_DIRECTION[item.factor],
                  "minimumUtility": match_model.DEFAULT_EDGE if item.must else None, "maximumUtility": None}
        criterion = match_model._factor_range(factor, item.must)
        ranked.append((item.importance, {key: value for key, value in criterion.items() if not key.startswith("_")}))
    seen_layers = {criterion["layer"] for _, criterion in ranked if criterion["kind"] == "range"}
    for item in args.ranges:
        if item.layer in seen_layers:
            raise evidence.MalformedQuery(f"{item.layer} is given twice")
        seen_layers.add(item.layer)
        ranked.append((item.importance, {"kind": "range", "layer": item.layer, "scale": item.scale, "min": item.min,
                                         "max": item.max, "softMin": None if item.must else item.soft_min,
                                         "softMax": None if item.must else item.soft_max, "must": item.must}))
    places: list[dict] = []
    for item in args.places:
        place = _place(item, {place["id"] for place in places})
        places.append(place)
        ranked.append((item.importance, {"kind": "place", **{key: place[key] for key in (
            "id", "label", "target", "mode", "targetMinutes")}, "must": item.must}))
    for item in args.custom:
        entry = _custom_entry(item)
        ranked.append((item.importance, {"kind": "custom", "criterion": entry["criterion"],
                                         "direction": entry["direction"], "must": False}))
    order = sorted(range(len(ranked)), key=lambda index: (-ranked[index][0], index))
    criteria = [ranked[index][1] for index in order]
    if zones:
        criteria.insert(0, {"kind": "where", "zones": zones, "softMetres": args.zone_soft_metres,
                            "must": args.only_in_zones})
    profile = {
        "schemaVersion": match_model.SCHEMA_V2, "market": args.market,
        "targetBudget": args.target_budget or default_target_budget(args.max_budget, args.market),
        "maximumBudget": args.max_budget, "bedrooms": args.bedrooms, "criteria": criteria,
    }
    if args.property_type != "any":
        profile["propertyType"] = args.property_type
    if args.liked_area_ids or args.exclude_area_ids:
        profile["marks"] = {"liked": list(args.liked_area_ids), "excluded": list(args.exclude_area_ids), "notes": {}}
    return profile


def _place(item: PlaceInput, taken: set[str]) -> dict:
    if item.category is None and item.top_school is None and item.school is None \
            and (item.latitude is None or item.longitude is None):
        raise evidence.MalformedQuery(f"place '{item.label}' needs latitude and longitude, a category, top_school or school")
    if item.school is not None and item.top_school is not None:
        raise evidence.MalformedQuery(f"place '{item.label}': give top_school or school, not both")
    base = re.sub(r"[^a-z0-9]+", "-", item.label.lower()).strip("-")[:18].strip("-") or "place"
    place_id, n = base, 2
    while place_id in taken:
        place_id, n = f"{base}-{n}", n + 1
    if item.school is not None:
        target = {"kind": "school-filter", "filter": item.school.filter.compact(),
                  **({"within": item.school.within} if item.school.within is not None else {})}
    elif item.top_school is not None:
        if item.school_rank_by == "progress8" and item.school_phase != "secondary":
            raise evidence.MalformedQuery("Progress 8 ranks secondary schools only")
        target = {"kind": "school", "phase": item.school_phase, "top": item.top_school,
                  **({"rankBy": "progress8"} if item.school_rank_by == "progress8" else {})}
    elif item.category:
        target = {"kind": "category", "category": item.category,
                  **({"brand": item.brand} if item.brand else {}), **({"sport": item.sport} if item.sport else {})}
    else:
        target = {"kind": "point", "latitude": item.latitude, "longitude": item.longitude}
    local = target["kind"] != "point"
    mode = item.mode or ("walk" if local else "transit")
    if local and mode == "transit":
        mode = "walk"
    return {"id": place_id, "label": item.label, "target": target, "mode": mode,
            "targetMinutes": item.max_minutes, "weight": item.importance, "must": item.must}


def _custom_criterion(preset_id: str | None, criterion: "CustomCriterionInput | None") -> tuple[dict, str]:
    """(definition, suggested direction) from a preset id or the user's own criterion."""
    if (preset_id is None) == (criterion is None):
        raise evidence.MalformedQuery("give exactly one of preset_id and criterion")
    if criterion is not None:
        definition = criterion.model_dump()
        return custom_criteria.normalise(definition), "higher"
    for preset in custom_criteria.presets()["presets"]:
        if preset["criterion"]["id"] == preset_id:
            return custom_criteria.normalise(preset["criterion"]), preset["direction"]
    raise evidence.MalformedQuery(f"unknown preset '{preset_id}': see list_custom_presets")


def _custom_entry(item: CustomChoiceInput) -> dict:
    definition, direction = _custom_criterion(item.preset_id, item.criterion)
    definition.pop("schemaVersion", None)
    return {"criterion": definition, "weight": item.importance, "direction": item.direction or direction}


# The site's Budget row (web lib/match-search.ts BUDGET_STRETCH): the comfortable end is the maximum less 8%,
# rounded to £5,000 (buy) or £50 a month (rent), so an agent's link and a typed budget read the same figures.
BUDGET_STRETCH = 0.08


def default_target_budget(max_budget: int, market: str) -> int:
    unit = 50 if market == "rent" else 5000
    # Half up, as JavaScript's Math.round (Python's round() would send a .5 to the even step).
    return min(max_budget, max(unit, math.floor(max_budget * (1 - BUDGET_STRETCH) / unit + 0.5) * unit))


def price_estimate(price_per_sqm: float | None, bedrooms: int | None, market: str,
                   max_budget: int | None = None, monthly_rent: Mapping[str, Any] | None = None) -> dict:
    """Ballpark price of a typical home of this size: local £/m² × an assumed floor area.
    For a rental, the borough's average monthly rent for the bedroom count (a rent row from
    repository.rent_rows), or unknown when there is none."""
    if market == "rent":
        return rent_estimate(price_per_sqm, monthly_rent, max_budget)
    if price_per_sqm is None or bedrooms is None:
        return {"pricePerSquareMetre": price_per_sqm, "estimatedPrice": None, "budgetFit": "unknown"}
    floor = TYPICAL_FLOOR_AREA.get(bedrooms, 160)
    estimate = round(price_per_sqm * floor, -3)
    return {"pricePerSquareMetre": round(price_per_sqm), "estimatedPrice": estimate,
            "assumedFloorArea": floor, "budgetFit": _budget_fit(estimate, max_budget)}


def _budget_fit(estimate: float, max_budget: int | None) -> str:
    if not max_budget:
        return "unknown"
    return "within" if estimate <= max_budget else "stretch" if estimate <= max_budget * STRETCH else "over"


def rent_estimate(price_per_sqm: float | None, rent: Mapping[str, Any] | None, max_budget: int | None) -> dict:
    if rent is None:
        return {"pricePerSquareMetre": price_per_sqm, "estimatedPrice": None, "budgetFit": "unknown"}
    monthly = int(rent["raw_value"])
    return {"pricePerSquareMetre": None if price_per_sqm is None else round(price_per_sqm),
            "estimatedPrice": monthly, "estimatedRent": {
                "monthly": monthly, "basis": "borough-average", "bedrooms": rent["bedrooms"],
                "boroughId": rent["carrier_geography_id"], "period": str(rent["period"])[:7],
                "sourceVersion": rent["source_release_id"]},
            "budgetFit": _budget_fit(monthly, max_budget)}


# Rent-mode notes for every answer that quotes a rent (research 2026-10 §3: referencing and the
# Renters' Rights Act, in force in England from 1 May 2026).
RENT_REFERENCING_MULTIPLE = 30
RENT_GUARANTOR_MULTIPLE = 36
RENT_REFERENCING_AS_OF = "Oct 2026"
RENT_CAVEATS = [
    "estimatedPrice for a rental is the borough's average monthly private rent for the bedroom count "
    "(ONS Price Index of Private Rents, new and existing tenancies): the same for every neighbourhood in "
    "a borough, a ballpark for screening and never the rent of a particular home. Studios and the City of "
    "London have no published figure, so their budget fit stays unknown.",
    f"Referencing: letting agents commonly look for a yearly income of about {RENT_REFERENCING_MULTIPLE}× the "
    f"monthly rent (a guarantor about {RENT_GUARANTOR_MULTIPLE}×): a typical agent rule, not law (Close Knit "
    f"research, {RENT_REFERENCING_AS_OF}); practice varies and is not measured.",
    "Renters' Rights Act (from 1 May 2026): a landlord may ask for at most one month's rent in advance and "
    "may not invite or accept offers above the advertised rent; deposits stay capped at five weeks' rent "
    "(six when the rent is £50,000 a year or more).",
]
# First caveat of assess_listing in rent mode: the sales comparison never ran here, so it must
# not be claimed (issue #160).
RENT_FIRST_CAVEAT = ("Compares the asking rent with the borough's average private rent for this many "
                     "bedrooms (ONS Price Index of Private Rents, new and existing tenancies); new lets "
                     "usually ask more. Not the rent of this home.")


def _find_areas(context: ToolContext, args: FindAreasInput) -> dict:
    _validate_find_references(context, args)
    excluded_lsoas = _expand_excluded(context, args.exclude_area_ids)
    return _shortlist(context, build_profile(args), top_n=args.top_n, include_over_budget=args.include_over_budget,
                      only_in_zones=args.only_in_zones, schema_version="tool-find-areas.v1",
                      caveats=_find_caveats(args.market), excluded_lsoas=excluded_lsoas)


def _expand_excluded(context: ToolContext, exclude_ids: list[str]) -> frozenset:
    """Borough and MSOA ids expand to their LSOAs (as Where zones do); unknown ids fail
    fast with a typed invalid-query error. The profile keeps echoing the ids as given (#218)."""
    if not exclude_ids:
        return frozenset()
    with repository.evidence_connection() as connection:
        expanded, unknown = repository.expand_area_ids(connection, exclude_ids)
    if unknown:
        raise evidence.MalformedQuery(
            f"unknown excluded area '{sorted(unknown)[0]}': pass LSOA, MSOA or borough ids")
    return frozenset(expanded)


def _validate_find_references(context: ToolContext, args: FindAreasInput) -> None:
    """Unknown range layers, station ids and borough ids fail fast with a typed
    invalid-query error naming the id, the way unknown custom presets do (#217)."""
    layers = [item.layer for item in args.ranges]
    if layers:
        published = {metric["id"] for metric in
                     context.reader.list_metrics(cancel=context.cancel)["metrics"]}
        presets = {entry["criterion"]["id"] for entry in custom_criteria.presets()["presets"]}
        for layer in layers:
            if layer.startswith("custom:"):
                preset_id = layer.split(":", 1)[1]
                if preset_id not in presets:
                    raise evidence.MalformedQuery(
                        f"unknown preset '{preset_id}': see list_custom_presets")
            elif layer not in match_model.LAYER_FACTORS and layer not in published:
                raise evidence.MalformedQuery(f"unknown range layer '{layer}': see list_metrics")
    station_ids = [item.station_id for item in args.near_stations]
    borough_ids = list(args.boroughs)
    if station_ids or borough_ids:
        with repository.evidence_connection() as connection:
            known_stations, known_boroughs = repository.known_zone_references(
                connection, station_ids, borough_ids)
        for station_id in station_ids:
            if station_id not in known_stations:
                raise evidence.MalformedQuery(f"unknown station '{station_id}': see search_stations")
        for borough_id in borough_ids:
            if borough_id not in known_boroughs:
                raise evidence.MalformedQuery(f"unknown borough '{borough_id}': see search_places")


def _shortlist(context: ToolContext, profile: dict, *, top_n: int, include_over_budget: bool, only_in_zones: bool,
               schema_version: str, caveats: list[str], excluded_lsoas: frozenset = frozenset()) -> dict:
    """Rank areas for a profile and keep a short, varied shortlist with ballpark prices and links."""
    validate_match_request(profile)
    rows = context.load_match_rows(profile)
    if not rows:
        raise evidence.ReleaseUnavailable("No validated factor release is loaded")
    pack = build_match_pack(profile, rows, **repository.match_zones(
        profile, context.load_zone_lsoas, context.load_zone_distances))
    price = _price_levels(context, profile, rows)
    market, bedrooms, max_budget = profile["market"], profile.get("bedrooms", 2), profile["maximumBudget"]
    rents = context.reader.rent_levels(bedrooms) if market == "rent" else {}
    in_zones_only = only_in_zones and bool(match_model.profile_zones(profile))

    def estimate_for(area_id: str) -> dict:
        return price_estimate(price.get(area_id), bedrooms, market, max_budget, monthly_rent=rents.get(area_id))

    candidates = []
    known_over = False  # an area with a known ballpark is over budget
    known_fits = False  # an area with a known ballpark is within budget or a stretch
    for result in sorted(pack["values"], key=lambda item: item["rank"] or 10**9):
        if result["excluded"] or result["geographyId"] in excluded_lsoas:
            continue
        if in_zones_only and not result.get("inZone"):
            continue
        estimate = estimate_for(result["geographyId"])
        fit = estimate["budgetFit"]
        if fit == "over":
            known_over = True
        elif fit != "unknown":
            known_fits = True
        if fit == "over" and not include_over_budget:
            continue
        candidates.append((result, estimate))
        if len(candidates) >= top_n * CANDIDATE_POOL:
            break
    budget_note = None
    if known_over and not known_fits:
        # Every area with a known ballpark is over budget. A missing ballpark
        # (budgetFit "unknown") still scores half a fit and would otherwise win the
        # shortlist; missing data must never lift an area above known data (#216).
        if include_over_budget:
            candidates.sort(key=lambda pair: pair[1]["budgetFit"] == "unknown")
        else:
            candidates = [pair for pair in candidates if pair[1]["budgetFit"] != "unknown"]
        budget_note = _over_budget_note(market, bedrooms, max_budget, price, rents)
    places = _places(context, [result["geographyId"] for result, _ in candidates])
    chosen = _one_per_neighbourhood(candidates, places, top_n)
    areas = [_area_entry(index + 1, result, estimate, places, profile)
             for index, (result, estimate) in enumerate(chosen)]
    emptied = None if areas else _emptied_by(pack, in_zones_only=in_zones_only,
                                              include_over_budget=include_over_budget, estimate_for=estimate_for)
    value = {"market": market, "maxBudget": max_budget, "bedrooms": bedrooms,
             "areas": areas, "emptiedBy": emptied, "profile": profile,
             "criteria": [{key: item[key] for key in ("id", "kind", "priority", "must", "weight")}
                          for item in pack["criteria"]],
             "scoredAreas": pack["scored"], "mapUrl": share_links.map_url(profile),
             "briefUrl": share_links.map_url(profile, areas[0]["geographyId"]) if areas else None,
             # The factor release set behind the match; productReleaseId is the active
             # product release (the contract names match_areas as the only exception). #215.
             "sourceReleaseSet": pack["sourceReleaseSet"]}
    components = [{"kind": "match-component", "geographyId": result["geographyId"], **component}
                  for result, _ in chosen for component in result["components"]]
    catalogue = context.reader.list_metrics(cancel=context.cancel)
    return envelope.wrap(
        value, schema_version=schema_version, release_id=catalogue["productReleaseId"],
        confidence=envelope.combined_confidence(
            envelope.confidence_from_quality(item["quality"]) for item in components) if components else "none",
        evidence=components,
        sources=release_sources(context, _shortlist_releases(pack, chosen), catalogue),
        caveats=caveats + ([budget_note] if budget_note else []) + _emptied_caveats(emptied, bedrooms)
        + _place_caveats(components) + _school_rule_caveats(profile) + _custom_caveats(profile) + _quick_caveats(profile))


def _over_budget_note(market: str, bedrooms: int | None, max_budget: int,
                      price: Mapping[str, float], rents: Mapping[str, Mapping[str, Any]]) -> str | None:
    """The #216 caveat: no known ballpark fits the budget, naming the cheapest known figure."""
    if market == "rent":
        cheapest = min((int(row["raw_value"]) for row in rents.values()), default=None)
        if cheapest is None:
            return None
        rooms = f"{bedrooms}-bed" if bedrooms else "studio"
        return (f"No borough's average {rooms} rent is within £{max_budget:,}/month; "
                f"the cheapest known average is £{cheapest:,}/month.")
    cheapest = min((level * TYPICAL_FLOOR_AREA.get(bedrooms or 2, 160)
                    for level in price.values()), default=None)
    if cheapest is None:
        return None
    return (f"No area's ballpark price is within £{max_budget:,}; "
            f"the cheapest known ballpark is £{int(round(cheapest, -3)):,}.")


def _emptied_by(pack: Mapping[str, Any], *, in_zones_only: bool, include_over_budget: bool,
                estimate_for) -> dict | None:
    """The first constraint that left no area, applied in the shortlist's own order: each must
    criterion, then the exclude list, the zones and the budget; with the count before it (#242)."""
    def meets(limit: str):
        return lambda result: limit not in {limit_id(code) for code in result.get("unmetLimits", [])}

    steps = [(spec["id"], "must", meets(spec["id"])) for spec in pack["criteria"] if spec["must"]]
    steps.append(("exclude_area_ids", "exclude", meets("mark")))
    if in_zones_only:
        steps.append(("only_in_zones", "zone", lambda result: bool(result.get("inZone"))))
    if not include_over_budget:
        steps.append(("budget", "budget", lambda result: estimate_for(result["geographyId"])["budgetFit"] != "over"))
    remaining = list(pack["values"])
    for constraint, kind, keep in steps:
        kept = [result for result in remaining if keep(result)]
        if remaining and not kept:
            return {"constraint": constraint, "kind": kind, "areasBefore": len(remaining)}
        remaining = kept
    return None


def _emptied_caveats(emptied: Mapping[str, Any] | None, bedrooms: int) -> list[str]:
    if not emptied:
        return []
    count, constraint = emptied["areasBefore"], emptied["constraint"]
    areas = f"the last {count} areas" if count != 1 else "the last area"
    if emptied["kind"] == "must":
        return [f"No areas are left: the must filter '{constraint}' ruled out {areas}; relax it or drop must."]
    if emptied["kind"] == "exclude":
        return [f"No areas are left: exclude_area_ids ruled out {areas}."]
    if emptied["kind"] == "zone":
        return [f"No areas are left: only_in_zones ruled out {areas}; pass only_in_zones=false to rank "
                "nearby areas too."]
    return [f"No areas are left: every one of the {count} remaining areas looks over budget for {bedrooms} "
            "bedrooms; raise max_budget or pass include_over_budget=true to see them."]


def _quick_caveats(profile: Mapping[str, Any]) -> list[str]:
    criteria = [item for item in match_model.as_v2(profile)["criteria"] if item["kind"] == "range"]
    layers = {item["layer"] for item in criteria}
    factors = {match_model.LAYER_FACTORS.get(layer) for layer in layers}
    return [QUICK_CAVEATS[key] for key in QUICK_CAVEATS if key in factors or key in layers]


def _criteria(profile: Mapping[str, Any], kind: str) -> list[dict]:
    return [item for item in match_model.as_v2(profile)["criteria"] if item["kind"] == kind]


def _shortlist_releases(pack: Mapping[str, Any], chosen: list) -> list[str]:
    """The match pack's releases plus the rent release behind any rent ballpark (read even when
    affordability is not one of the priorities, so it is not always in the pack)."""
    releases = [release for release in pack["sourceReleaseSet"].split("+") if release]
    rents = {estimate["estimatedRent"]["sourceVersion"] for _, estimate in chosen if estimate.get("estimatedRent")}
    return releases + sorted(rents - set(releases))


def _school_rule_caveats(profile: Mapping[str, Any]) -> list[str]:
    kinds = {place["target"]["kind"] for place in _criteria(profile, "place")}
    if "school-filter" in kinds and "school" not in kinds:
        return ["'Near a school like this' takes the nearest school matching the filter (DfE and Ofsted open data, "
                "latest published year per school; schools without the measure never count). Living nearby is "
                "not a place: grammar schools admit by exam, faith schools by their own criteria, others by "
                "distance that changes every year."]
    if "school" not in kinds:
        return []
    return ["'Near a top school' ranks London state schools by published results (GCSE grade 5+ in English and "
            "maths; SATs expected standard for primaries; Progress 8 when the rule asks for it, latest published "
            "year 2023/24). Living nearby is not a place: grammar schools admit by "
            "exam, faith schools by their own criteria, others by distance that changes every year."]


def _custom_caveats(profile: Mapping[str, Any]) -> list[str]:
    if not _criteria(profile, "custom"):
        return []
    return [custom_criteria.PLACES_NOT_PEOPLE + " Custom criteria are scored by the area's London percentile "
            "(places on the map inside the neighbourhood's boundary, so a café across the road may count for "
            "the neighbouring area)."]


def _list_custom_presets(context: ToolContext, args: "NoPresetArguments") -> dict:
    data = custom_criteria.presets()
    value = [{"id": p["criterion"]["id"], "label": p["criterion"]["label"], "description": p["description"],
              "direction": p["direction"], "formula": p["criterion"]["formula"], "criterion": p["criterion"],
              "mapUrl": share_links.custom_map_url(share_links.FRESH_PROFILE, p["criterion"]["id"])}
             for p in data["presets"]]
    return envelope.wrap(value, schema_version="tool-custom-presets.v1", release_id="custom-criterion-presets",
                         confidence="high", sources=[_osm_place_source()], caveats=data["caveats"])


def _evaluate_custom_criterion(context: ToolContext, args: EvaluateCustomInput) -> dict:
    definition, suggested = _custom_criterion(args.preset_id, args.criterion)
    direction = args.direction or suggested
    # The reader's own connection factory: the criterion is evaluated like any other evidence read.
    titles = repository.area_titles()
    with context.reader._connect() as connection:
        pack = custom_criteria.evaluate(connection, definition, titles=titles, cancel=context.cancel)
    values = {entry["geographyId"]: entry for entry in pack["values"]}
    # No place matched (a typo'd tag value, say): every area is 0, so there is no best or worst (#222).
    matched = pack["summary"]["places"] > 0
    best, worst = (pack["summary"]["top"], pack["summary"]["bottom"]) if matched else ([], [])
    if direction == "lower":
        best, worst = worst, best
    # Requested areas: the pack's rows carry no name, so names come from the area lookup; ids the
    # release does not know are reported, never dropped (#243).
    known = [area_id for area_id in args.area_ids if area_id in values]
    unknown = [area_id for area_id in args.area_ids if area_id not in values]
    names = {area_id: place.get("name") for area_id, place in _places(context, known).items()}

    def entry(item: Mapping[str, Any]) -> dict:
        area_id = item["geographyId"]
        return {"geographyId": area_id, "name": item.get("name") or names.get(area_id), "title": titles.get(area_id),
                "value": item["value"], "regionPercentile": item["percentile"], "counts": item["counts"],
                "links": share_links.area_links(area_id)}
    areas = [entry(values[area_id]) for area_id in known]
    caveats = list(pack["caveats"])
    if not matched:
        caveats.append(f"No place on the map matches this criterion ({_tag_summary(definition)}); check the tag "
                       "values, every area counts 0.")
    if unknown:
        caveats.append(f"Unknown area ids left out of areas: {', '.join(unknown)} (pass LSOA ids from search_places).")
    profile = {**share_links.FRESH_PROFILE, "custom": [{"criterion": {k: v for k, v in definition.items() if k != "schemaVersion"},
                                                         "weight": 3, "direction": direction}]}
    value = {"criterion": pack["criterion"], "direction": direction, "unit": pack["unit"], "legend": pack["legend"],
             "areasEvaluated": pack["summary"]["areas"] if matched else 0,
             "regionMedian": pack["summary"]["regionMedian"] if matched else None,
             "best": [entry(item) for item in best[:args.top_n]], "worst": [entry(item) for item in worst[:args.top_n]],
             "areas": areas, "unknownAreaIds": unknown, "mapUrl": share_links.custom_map_url(profile, definition["id"])}
    sources = release_sources(context, [source["id"] for source in pack["sources"]])
    # The place table's own credit (OSM/FSA/Overture/Foursquare) travels with the pack;
    # keep what the release table does not record. #215.
    credits = {source["id"]: source for source in pack["sources"]}
    for row in sources:
        credit = credits.get(row["release"], {})
        for key, field in (("sourceName", "name"), ("sourceUrl", "url"), ("attribution", "attribution")):
            if credit.get(field) is not None:
                row.setdefault(key, credit[field])
    return envelope.wrap(
        value, schema_version="tool-evaluate-custom-criterion.v1", release_id=pack["productReleaseId"],
        confidence="medium" if matched and pack["summary"]["areas"] else "none",
        sources=sources,
        caveats=caveats + ["best/worst follow the direction asked (lower = least of it); mapUrl opens the "
                           "criterion on its own: find_areas(custom=[…]) weighs it with the budget and priorities."])


def _tag_summary(definition: Mapping[str, Any]) -> str:
    """The criterion's tags in OSM form ("amenity=cafe, cuisine=kebab") for a caveat."""
    tags = [f"{key}={'|'.join(value) if isinstance(value, list) else value}"
            for place_set in definition["sets"].values() for matcher in place_set["any"]
            for key, value in matcher.items()]
    return ", ".join(tags[:6]) + (", …" if len(tags) > 6 else "")


def _place_caveats(components: list[Mapping[str, Any]]) -> list[str]:
    """Say where the minutes to the user's places come from: routed, estimated, or both."""
    qualities = {component["quality"] for component in components if component["factorId"].startswith("place:")}
    caveats = []
    if "observed" in qualities:
        caveats.append("Minutes to places near a commute hub are door-to-door from our route planner (weekday "
                       "08:00-09:00 on TfL timetables, Powered by TfL Open Data); get_commute shows the line and changes.")
    if qualities - {"observed"}:
        caveats.append("Minutes to other places are straight-line estimates (the nearest of a kind is walked, cycled or "
                       "driven; car at a typical morning-traffic speed, no parking): good for screening, not a journey plan.")
    if any(component.get("nationalRailNotModelled") for component in components
           if component["factorId"].startswith("place:")):
        caveats.append("Areas served by National Rail only: National Rail is not in the timetable data yet, so "
                       "their commute minutes are bus and TfL services only and they are scored as unknown, "
                       "not excluded, under commute limits.")
    return caveats


class CommuteInput(StrictInput):
    area_id: str = Field(pattern=LSOA_ID_PATTERN, description="The neighbourhood (LSOA) to travel from.")
    places: list[PlaceInput] = Field(min_length=1, max_length=8, description="Pinned places (latitude/longitude) to reach.")


def commute_confidence(payload: Mapping[str, Any]) -> str:
    """The commute tool's confidence: none without a network or with every place outside London; low where
    National Rail is the area's railway but is not modelled, a place's own mode is over the matrix cap, or
    some places are outside London."""
    if not payload["network"] or payload.get("outsideLondon") == "all":
        return "none"
    if payload.get("nationalRailNotModelled") or payload.get("capped") or payload.get("outsideLondon"):
        return "low"
    return "high"


def _get_commute(context: ToolContext, args: CommuteInput) -> dict:
    places = []
    for item in args.places:
        places.append(_place(item, {place["id"] for place in places}))
    payload = context.reader.get_commute(args.area_id, places, cancel=context.cancel)
    timetable = payload["network"]["timetable_source_release_id"] if payload["network"] else None
    return envelope.wrap(
        payload["places"], schema_version="tool-commute.v1", release_id=payload["productReleaseId"],
        confidence=commute_confidence(payload),
        sources=release_sources(context, [timetable] if timetable else []),
        caveats=payload["caveats"])


class OpenSearchInput(StrictInput):
    link: str = Field(min_length=20, max_length=8000, description=(
        "An Close Knit link the user shared (…#profile=v1.…, v2. or v3.), e.g. from 'Discuss with Claude' on the site."))
    top_n: int = Field(default=8, ge=1, le=20, description="How many areas to return.")


def _open_shared_search(context: ToolContext, args: OpenSearchInput) -> dict:
    try:
        profile = share_links.profile_from_link(args.link)
    except ValueError as error:
        raise evidence.MalformedQuery(str(error)) from error
    dropped = profile.pop("droppedFactors", [])
    out = _shortlist(context, profile, top_n=args.top_n, include_over_budget=True, only_in_zones=False,
                     schema_version="tool-open-shared-search.v1", caveats=_find_caveats(profile["market"]))
    if dropped:
        out["caveats"].append(f"The link also asked for {', '.join(dropped)}: no longer a priority here, so it was "
                              "dropped as the site does when it opens the link.")
    marks = profile.get("marks") or {}
    out["value"]["search"] = {
        "places": [{"label": place["label"], "mustReachWithin": place["targetMinutes"] if place.get("must") else None,
                    "withinMinutes": place["targetMinutes"], "mode": place["mode"]} for place in _criteria(profile, "place")],
        "liked": marks.get("liked", []), "ruledOut": marks.get("excluded", []), "notes": marks.get("notes", {}),
        "custom": [{"label": entry["criterion"]["label"], "direction": entry["direction"], "must": bool(entry.get("must"))}
                   for entry in _criteria(profile, "custom")],
        "criteria": [{"id": item["id"], "priority": item["priority"], "must": item["must"]}
                     for item in out["value"]["criteria"]],
    }
    out["caveats"].append("This is the user's own search from the site: their notes are private context for "
                          "this conversation, not facts about the areas.")
    return out


def _price_levels(context: ToolContext, profile: Mapping[str, Any], rows: list[Mapping[str, Any]]) -> dict:
    """£/m² per LSOA for the budget fit, whether or not price level is one of the priorities
    (the evidence loader only reads factors with a weight)."""
    if not any(row["factor_id"] == "market-level" for row in rows):
        probe = {"schemaVersion": "preference-profile.v1", "market": profile.get("market", "buy"),
                 "targetBudget": profile["targetBudget"], "maximumBudget": profile["maximumBudget"],
                 "factors": [{"factorId": "market-level", "weight": 1, "direction": "lower",
                              "minimumUtility": None, "maximumUtility": None}]}
        rows = context.load_match_rows(probe)
    return {row["geography_id"]: row["raw_value"] for row in rows if row["factor_id"] == "market-level"}


def _find_caveats(market: str) -> list[str]:
    caveats = ["Scores rank areas against these priorities only; at most one area per neighbourhood "
               "(MSOA) is shown so the list stays varied.",
               "Schools and price growth are not scored: check them with get_area_overview before "
               "recommending an area."]
    if market == "buy":
        caveats.append("estimatedPrice = the area's median £/m² × an assumed floor area for the bedroom "
                       "count; a ballpark for screening, never a valuation. budgetFit: within ≤ max, "
                       f"stretch ≤ {round((STRETCH - 1) * 100)}% over, over beyond that.")
    else:
        caveats += RENT_CAVEATS
    return caveats


def _one_per_neighbourhood(candidates: list, places: Mapping[str, dict], top_n: int) -> list:
    chosen, seen = [], set()
    for result, estimate in candidates:
        place = places.get(result["geographyId"], {})
        neighbourhood = place.get("parentId") or result["geographyId"]
        if neighbourhood in seen:
            continue
        seen.add(neighbourhood)
        chosen.append((result, estimate))
        if len(chosen) == top_n:
            break
    return chosen


def _area_entry(rank: int, result: Mapping[str, Any], estimate: dict, places: Mapping[str, dict],
                profile: Mapping[str, Any]) -> dict:
    area_id = result["geographyId"]
    place = places.get(area_id, {})
    return {
        "rank": rank, "geographyId": area_id, "name": result["name"], "title": place.get("title"), "borough": place.get("borough"),
        "center": place.get("center"), "outcodes": place.get("outcodes", [])[:3],
        "score": result["score"], "percentile": result.get("percentile"),
        "evidenceCompleteness": result["evidenceCompleteness"], "inZone": result.get("inZone"),
        "why": result.get("reasons", []), "weakest": result.get("weakest", []),
        "factors": [{key: component.get(key) for key in ("factorId", "rawValue", "unit", "fit", "fitKind", "must",
                                                         "priority", "scale")}
                    for component in result["components"]],
        **estimate,
        "links": share_links.area_links(area_id, profile),
    }


def _places(context: ToolContext, area_ids: list[str]) -> dict:
    if not area_ids:
        return {}
    return context.reader.area_lookup(area_ids, cancel=context.cancel)["places"]


def _find_similar_areas(context: ToolContext, args: SimilarAreasInput) -> dict:
    payload = context.reader.get_similar_areas(args.area_id, cheaper=args.cheaper, cancel=context.cancel)
    values = payload["values"][:args.top_n]
    places = _places(context, [args.area_id] + [item["geographyId"] for item in values])
    areas = []
    for index, item in enumerate(values):
        level = next((c["rawValue"] for c in item["components"] if c["factorId"] == "market-level"), None)
        place = places.get(item["geographyId"], {})
        areas.append({
            "rank": index + 1, "geographyId": item["geographyId"], "name": item["name"],
            "borough": place.get("borough"), "center": place.get("center"),
            "outcodes": place.get("outcodes", [])[:3], "similarity": item["similarity"],
            "factors": [{key: c[key] for key in ("factorId", "rawValue", "unit", "utility")}
                        for c in item["components"]],
            **price_estimate(level, args.bedrooms, "buy"),
            "links": share_links.area_links(item["geographyId"]),
        })
    origin = places.get(args.area_id, {})
    caveats = ["Similarity compares crime, deprivation, income, price level and station access "
               "percentiles; never who lives there.",
               "estimatedPrice (when bedrooms is given) is a ballpark from the £/m² level, not a valuation."]
    # The only filter is cheaper: when it empties the list, say how many similar areas it dropped (#242).
    emptied = None
    similar = (payload.get("candidates") or {}).get("similar", 0)
    if not areas and args.cheaper:
        emptied = {"constraint": "cheaper", "kind": "cheaper", "areasBefore": similar}
        caveats.append(f"No areas are left: none of the {similar} similar areas has a lower price level than "
                       f"{payload['name']} (or its price level is unknown); drop cheaper to see them.")
    value = {"like": {"geographyId": args.area_id, "name": payload["name"], "borough": origin.get("borough")},
             "cheaper": args.cheaper, "comparedOn": payload["factors"], "areas": areas, "emptiedBy": emptied}
    catalogue = context.reader.list_metrics(cancel=context.cancel)
    metric_ids = [match_model.FACTOR_LAYERS[factor] for factor in payload["factors"]
                  if factor in match_model.FACTOR_LAYERS]
    return envelope.wrap(
        value, schema_version="tool-find-similar-areas.v1", release_id=payload["productReleaseId"],
        confidence="medium" if areas else "none",
        evidence=[{"kind": "similarity", "geographyId": a["geographyId"], "similarity": a["similarity"]}
                  for a in areas],
        sources=envelope.sources_for(metric_ids, catalogue),
        caveats=caveats)


def _get_area_overview(context: ToolContext, args: AreaOverviewInput) -> dict:
    pack = context.reader.get_area_pack(args.area_id, cancel=context.cancel)
    place = _places(context, [args.area_id]).get(args.area_id, {})
    catalogue = context.reader.list_metrics(cancel=context.cancel)
    trend, trend_versions, trend_aggregated = _price_trend(context, args.area_id, catalogue)
    market = pack.get("market") or {}
    resale = (market.get("resale") or {}).get("medianPricePerSquareMetre")
    # Same £/m² basis as find_areas / find_similar_areas (#209): the latest 12-month index
    # level (the last priceTrend point), not market.resale's 36-month median.
    level = trend[-1]["value"] if trend else resale
    located = _location(context, args.area_id)
    health = _health(context, args.area_id)
    hpi = _hpi(context, args.area_id)
    council_tax = _council_tax(context, args.area_id)
    deprivation = _deprivation(context, args.area_id)
    home = _home(context, args.area_id)
    is_lsoa = args.area_id.startswith("uk:lsoa:")
    value = {
        "geographyId": args.area_id, "name": pack["name"], "title": place.get("title"),
        "borough": place.get("borough"),
        "center": place.get("center"), "outcodes": place.get("outcodes", [])[:3],
        "market": market, "hpi": hpi, "crime": pack.get("crime"), "noise": pack.get("noise"),
        "schools": pack.get("schools"), "priceTrend": trend, "location": located,
        "home": home, "councilTax": council_tax, "deprivation": deprivation,
        "health": health,
        "gettingAround": _getting_around(context, args.area_id),
        "estimate": price_estimate(level, args.bedrooms, "buy") if args.bedrooms is not None else None,
        "links": share_links.area_links(args.area_id),
    }
    sources = release_sources(context, sorted(
        _pack_sources(pack) | set((located or {}).get("sourceVersions", []))
        | set((health or {}).get("sourceVersions", []))
        | _block_sources(hpi, council_tax, home, deprivation)), catalogue)
    if value.get("gettingAround"):
        # gettingAround's stations and park are OpenStreetMap (#215).
        sources.append(_osm_place_source())
    if trend:
        # The £/m² release behind priceTrend (#215).
        sources += envelope.sources_for([PRICE_METRIC], catalogue)
    # "high" needs the market block and an observed £/m² point: a fallback trend is the wider
    # area's series, not this neighbourhood's (#163).
    latest_quality = trend[-1].get("quality") if trend else None
    confidence = "high" if market.get("available") and latest_quality != "fallback" else "medium"
    return envelope.wrap(
        value, schema_version="tool-area-overview.v1", release_id=pack["productReleaseId"],
        confidence=confidence,
        evidence=[{"kind": "metric-observation", "metricId": PRICE_METRIC, **point,
                   **({"sourceVersion": trend_versions[point["period"]]}
                      if point["period"] in trend_versions else {})}
                  for point in trend[-12:]],
        sources=sources,
        caveats=["Crime is per 1,000 residents over 12 months; noise shares are of homes above 55/65 dB "
                 "Lden; schools are state schools within 1.5 km with their standing Ofsted grade"
                 + (", and schools.independent the independent schools in the same radius (no Ofsted grade; most "
                    "are ISI-inspected), outside the state counts" if (pack.get("schools") or {}).get("independent")
                    else "") + ".",
                 *_crime_caveats(pack),
                 *_block_caveats(hpi, council_tax, home, deprivation),
                 *([] if is_lsoa else [
                     "schools and gettingAround are measured from one centre point of this "
                     f"{'borough' if args.area_id.startswith('uk:lad:') else 'neighbourhood (MSOA)'}, not across "
                     "it: pick an LSOA inside it for the schools, stations and parks near a home."]),
                 ("priceTrend is the median £/m² of the area's neighbourhoods (LSOAs) by period, "
                  "not of the area's own sales; a ballpark estimate is never a valuation."
                  if trend_aggregated else
                  "priceTrend is the area's median £/m² of recorded sales by period; a ballpark "
                  "estimate is never a valuation."),
                 "estimate is a ballpark from the latest 12-month £/m² index (the last priceTrend point), "
                 "the same figure find_areas uses; market.resale is the 36-month median.",
                 "location: land in a conservation area, the ULEZ and the Congestion Charge zone, and "
                 "planning applications (proposals, not permissions) in the last 24 months.",
                 "health: " + ("modelled NO2 and PM2.5 at the area's homes (GLA LAEI), " if feature_flags.air_quality() else "")
                 + "summer heat on its land and registered patients per FTE GP at practices "
                 + ("within 1 km; " if is_lsoa else "inside the area; ")
                 + "London percentiles, never anyone's health.",
                 "gettingAround: the nearest stations (TfL zone and lines) and park from the area's centre "
                 "(OpenStreetMap, TfL open data); walk minutes are straight-line at 80 m a minute."])


def _get_flood_risk(context: ToolContext, args: FloodRiskInput) -> dict:
    """Flood bands for the area's land and, with a UPRN, that home's bands (#163)."""
    from . import flood

    payload = flood.area_flood(context.reader, args.area_id, args.uprn, cancel=context.cancel)
    return envelope.wrap(
        payload, schema_version="tool-flood-risk.v1", release_id=payload["productReleaseId"],
        confidence="high" if payload["available"] else "low",
        sources=[{"release": payload["sourceVersion"]}] if payload.get("sourceVersion") else [],
        caveats=payload.get("caveats", []))


def _get_rent_levels(context: ToolContext, args: RentLevelsInput) -> dict:
    """Median monthly rent by bedroom count, the figure the site shows (#163)."""
    rows = context.reader.rent_levels(args.bedrooms, args.area_ids)
    levels = []
    for area_id in args.area_ids:
        row = rows.get(area_id) or {}
        levels.append({"geographyId": area_id,
                       "medianMonthlyRent": None if row.get("raw_value") is None else int(row["raw_value"]),
                       "borough": row.get("borough_name"),
                       "month": str(row["period"])[:7] if row.get("period") else None,
                       "sourceVersion": row.get("source_release_id")})
    release = next((level["sourceVersion"] for level in levels if level["sourceVersion"]), "")
    return envelope.wrap(
        levels, schema_version="tool-rent-levels.v1", release_id=release,
        confidence="high" if any(level["medianMonthlyRent"] is not None for level in levels) else "low",
        sources=[{"release": release}] if release else [],
        caveats=["Borough average monthly rent for the bedroom count (an LSOA or MSOA gets its borough's); "
                 "empty for a studio or before the rents are loaded."])


def _location(context: ToolContext, area_id: str) -> dict | None:
    """The area's location block (conservation, charging zones, planning activity), None before it is loaded."""
    from . import location

    connect = getattr(context.reader, "_connect", None)
    if connect is None:
        return None
    with connect() as connection:
        return location.location_rows(connection, [area_id]).get(area_id)


def _health(context: ToolContext, area_id: str) -> dict | None:
    """The area's health block (air, summer heat, GP access), None before it is loaded."""
    from . import health

    connect = getattr(context.reader, "_connect", None)
    if connect is None:
        return None
    try:
        with connect() as connection:
            return health.health_rows(connection, [area_id]).get(area_id)
    except Exception:  # noqa: BLE001 - an optional layer never breaks the overview
        return None


def _with_connection(context: ToolContext, read):
    """`read(connection)` on the reader's connection; None before the connection or the layer exists."""
    connect = getattr(context.reader, "_connect", None)
    if connect is None:
        return None
    try:
        with connect() as connection:
            return read(connection)
    except evidence.Cancelled:
        raise
    except Exception:  # noqa: BLE001 - an optional layer never breaks the answer
        return None


def _hpi(context: ToolContext, area_id: str) -> dict | None:
    """The borough's official UK HPI (#232): average price by type and its change over 1, 5 and 10 years
    next to London's. None before migration 080 is loaded; the series line is left to the REST route."""
    from . import uk_hpi

    if getattr(context.reader, "_connect", None) is None:
        return None
    try:
        payload = uk_hpi.area_hpi(context.reader, area_id, cancel=context.cancel)
    except evidence.Cancelled:
        raise
    except Exception:  # noqa: BLE001 - an optional layer never breaks the answer
        return None
    value = payload.get("value") or {}
    if not value.get("available"):
        return None
    return {"borough": value["borough"], "latest": value["latest"],
            "types": [{key: kind[key] for key in ("type", "latestPrice", "change", "regionChange")}
                      for kind in value["types"]],
            "regionPercentile": value["regionPercentile"],
            "sourceVersions": [source["release"] for source in payload.get("sources", []) if source.get("release")]}


def _council_tax(context: ToolContext, area_id: str) -> dict | None:
    """The area's council tax bands and a typical bill (#233): aggregates over homes, never one home's band
    (that stays behind CLOSE_KNIT_COUNCIL_TAX_BAND). None before migration 082 is loaded."""
    from . import council_tax

    value = _with_connection(context, lambda connection: council_tax.council_tax_value(connection, area_id))
    if not value:
        return None
    bill = value.get("typicalBill") or {}
    band_d = bill.get("bandD")
    return {"financialYear": bill.get("financialYear"), "borough": value["borough"], "boroughBandD": band_d,
            "typicalBand": value["medianBand"], "typicalYearlyBill": bill.get("amount"),
            "mostCommonBand": value["mostCommon"], "meanBand": value["meanBand"],
            "regionPercentile": value["regionPercentile"], "homes": value["homes"],
            "bandShares": {row["band"]: row["share"] for row in value["bands"]},
            "yearlyBillByBand": ({band: council_tax.bill(band, float(band_d)) for band in council_tax.BANDS}
                                 if band_d is not None else None),
            "valuationList": value["period"], "sourceVersions": value["sourceVersions"]}


def _home(context: ToolContext, area_id: str) -> dict | None:
    """The area's Home block (#234): conservation and householder Article 4 shares, listed buildings by
    grade, whether the borough publishes Article 4 data, broadband, settledness. None before migration 063."""
    from . import home

    return _with_connection(context, lambda connection: home.home_value(connection, area_id))


def _listed_near(context: ToolContext, postcode: str) -> list[dict] | None:
    """Listed buildings recorded within a few metres of the postcode's homes (#234); None when unknown."""
    from . import home

    return _with_connection(context, lambda connection: home.listed_near_postcode(connection, postcode))


def _deprivation(context: ToolContext, area_id: str) -> dict | None:
    """The area's official IMD decile at its latest period (#233), through the same read as get_area_metric."""
    catalogue = context.reader.list_metrics(cancel=context.cancel)
    metric = next((m for m in catalogue["metrics"] if m["id"] == DEPRIVATION_METRIC), None)
    periods = sorted(metric.get("periods", [])) if metric else []
    if not periods:
        return None
    try:
        summary = context.reader.get_area(area_id, DEPRIVATION_METRIC, periods[-1], cancel=context.cancel)["summary"]
    except (evidence.AreaNotFound, evidence.PeriodNotFound, evidence.MetricNotFound):
        return None
    if summary.get("value") is None:
        return None
    return {"decile": summary["value"], "scale": "IMD decile: 1 = most deprived tenth of England, 10 = least",
            "period": summary["period"], "regionPercentile": summary.get("regionPercentile"),
            "quality": summary.get("quality"), "carrierGeographyId": summary.get("carrierGeographyId"),
            "sourceVersions": [summary["sourceVersion"]] if summary.get("sourceVersion") else []}


def _block_sources(*blocks: Mapping[str, Any] | None) -> set[str]:
    return {release for block in blocks if block for release in block.get("sourceVersions", [])}


def _crime_caveats(pack: Mapping[str, Any]) -> list[str]:
    note = (pack.get("crime") or {}).get("note")
    return [f"crime: {note}"] if note else []


def _block_caveats(hpi, council_tax, home, deprivation) -> list[str]:
    """One line per optional block present, so an agent reads each figure for what it is."""
    caveats = ["market.growth and priceTrend are the area's own £/m² index of recorded sales"
               + ("; hpi is the borough's official UK House Price Index (HM Land Registry): average price by type "
                  "and change over 1, 5 and 10 years next to London's, mix-adjusted, borough-wide, with the latest "
                  "months provisional. Quote hpi for how prices moved." if hpi else ", not the official index.")]
    if council_tax:
        caveats.append("councilTax: homes by 1991 band (VOA) and the middle home's band at the borough's Band D "
                       "for the year, parish precepts included, discounts and exemptions excluded; an area "
                       "aggregate, never one home's band.")
    if deprivation:
        caveats.append("deprivation: the official Index of Multiple Deprivation decile of the area (1 = most "
                       "deprived tenth of England, 10 = least): describes the area, never a household.")
    if home:
        caveats.append("home: shares of the area's land in a conservation area or under a householder Article 4 "
                       "direction, listed buildings by list entry (one entry can be a terrace), whether the borough "
                       "publishes Article 4 data, gigabit broadband availability; the borough's planning team is "
                       "the authority.")
    return caveats


def _getting_around(context: ToolContext, area_id: str) -> dict | None:
    """The nearest stations and park from the area's centre (the site's Getting around), None before places load."""
    from . import places

    connect = getattr(context.reader, "_connect", None)
    if connect is None:
        return None
    try:
        payload = places.area_places(connect, area_id, cancel=context.cancel)
    except evidence.AreaNotFound:
        return None
    if not payload.get("available"):
        return None

    def walk(metres: float) -> int:  # 80 m a minute, as the site's 800 m = 10-minute walk
        return max(1, round(metres / 80))

    park = (payload.get("parks") or [None])[0]
    return {
        "connectivityScore": (payload.get("connectivity") or {}).get("score"),
        "stations": [{"name": s["name"], "modes": s["modes"], "zone": s["zone"], "lines": s["lines"],
                      "walkMinutes": walk(s["distanceMetres"])} for s in payload["stations"][:3]],
        "nearestPark": {"name": park["name"], "sizeClass": park["sizeClass"],
                        "walkMinutes": walk(park["distanceMetres"])} if park else None,
    }


def _pack_sources(pack: Mapping[str, Any]) -> set[str]:
    found = set()
    for block in ("market", "crime", "noise"):
        version = (pack.get(block) or {}).get("sourceVersion")
        if version:
            found.add(version)
    for school in (pack.get("schools") or {}).get("nearest", []):
        if school.get("sourceVersion"):
            found.add(school["sourceVersion"])
    return found


def _price_trend(context: ToolContext, area_id: str,
                 catalogue: Mapping[str, Any] | None = None) -> tuple[list[dict], dict, bool]:
    """The £/m² series for the overview, the source release behind each period (#215), and
    whether the series is the on-the-fly median of the area's LSOAs (a district/borough until
    the release stores their own series, #208)."""
    catalogue = catalogue if catalogue is not None else context.reader.list_metrics(cancel=context.cancel)
    metric = next((m for m in catalogue["metrics"] if m["id"] == PRICE_METRIC), None)
    periods = sorted(metric.get("periods", [])) if metric else []
    if not periods:
        return [], {}, False
    try:
        payload = context.reader.get_area(area_id, PRICE_METRIC, periods[-1], cancel=context.cancel)
    except (evidence.AreaNotFound, evidence.PeriodNotFound, evidence.MetricNotFound):
        return [], {}, False
    rows = [row for row in payload["metricTimeline"] if row.get("value") is not None][-120:]
    versions = {row["period"]: row["sourceVersion"] for row in rows if row.get("sourceVersion")}
    aggregated = (payload.get("summary") or {}).get("areaCount") is not None
    return ([{"period": row["period"], "value": round(row["value"]), "quality": row.get("quality"),
              "carrierGeographyId": row.get("carrierGeographyId"),
              "carrierSampleCount": row.get("carrierSampleCount")} for row in rows],
            versions, aggregated)


def _search_places(context: ToolContext, args: SearchPlacesInput) -> dict:
    stations = context.reader.search_stations(args.q, cancel=context.cancel)
    found = context.reader.search_areas(args.q, limit=args.limit * 2, cancel=context.cancel)
    areas = [row for row in found["results"] if not row.get("addressId")][:args.limit]
    addresses = [row for row in found["results"] if row.get("addressId")][:args.limit]
    # A street hit keeps the kind search_areas gave it (#240); nothing found is confidence none
    # with a typed reason, so an agent stops rewording a Manchester postcode (#230).
    reason = None if stations["results"] or areas or addresses else search_text.empty_reason(args.q)
    value = {"stations": stations["results"][:args.limit],
             "areas": [{**row, "kind": row.get("kind") or kinds.kind_of(row["geographyId"])} for row in areas],
             "addresses": addresses, "reason": reason}
    return envelope.wrap(
        value, schema_version="tool-search-places.v1", release_id=found["productReleaseId"],
        confidence="none" if reason else "high",
        sources=_prefixed_sources(context, ("src-osm-", "src-os-open-names-", "src-hmlr-")),
        caveats=["Lookup only. Station ids feed find_areas.near_stations, borough ids "
                 "find_areas.boroughs, LSOA ids get_area_overview."]
        + ([search_text.reason_text(reason)] if reason else []))


def _prefixed_sources(context: ToolContext, prefixes: tuple[str, ...]) -> list[dict]:
    """Active-release source rows whose id starts with one of the prefixes (#215)."""
    table = _source_release_table(context)
    ids = [release_id for release_id in sorted(table) if release_id.startswith(prefixes)]
    if not ids:
        return []
    return market_depth.release_provenance(ids, context.reader.list_metrics(cancel=context.cancel), table)


def portal_links(outcode: str, market: str, max_price: int, min_bedrooms: int) -> dict:
    """Pre-filtered searches on the portals' public pages (formats checked by hand)."""
    code = outcode.upper()
    lower = code.lower()
    beds = max(0, min_bedrooms)
    if market == "buy":
        return {
            "rightmove": f"https://www.rightmove.co.uk/property-for-sale/{code}.html?maxPrice={max_price}&minBedrooms={beds}",
            "zoopla": f"https://www.zoopla.co.uk/for-sale/property/{lower}/?price_max={max_price}&beds_min={beds}&q={code}",
            "onthemarket": f"https://www.onthemarket.com/for-sale/property/{lower}/?max-price={max_price}&min-bedrooms={beds}",
        }
    return {
        "rightmove": f"https://www.rightmove.co.uk/property-to-rent/{code}.html?maxPrice={max_price}&minBedrooms={beds}",
        "zoopla": (f"https://www.zoopla.co.uk/to-rent/property/{lower}/?price_frequency=per_month"
                   f"&price_max={max_price}&beds_min={beds}&q={code}"),
        "onthemarket": f"https://www.onthemarket.com/to-rent/property/{lower}/?max-price={max_price}&min-bedrooms={beds}",
        "openrent": f"https://www.openrent.co.uk/properties-to-rent/{lower}?prices_max={max_price}&bedrooms_min={beds}",
    }


def home_listing_links(postcode: str) -> dict | None:
    """One home's postcode on the portals: Rightmove's sold-prices page (past listings with their
    photos), homes for sale there on Zoopla and OnTheMarket. Links only, never fetched or hosted.
    web/src/lib/listing-links.ts builds the same (contracts/fixtures/home-listing-links.json)."""
    compact = "".join(postcode.upper().split())
    if not re.fullmatch(POSTCODE_PATTERN, compact):
        return None
    code = f"{compact[:-3]} {compact[-3:]}"
    slug = code.lower().replace(" ", "-")
    return {
        "rightmove": f"https://www.rightmove.co.uk/house-prices/{slug}.html",
        "zoopla": f"https://www.zoopla.co.uk/for-sale/property/{compact[:-3].lower()}/?q={quote(code)}",
        "onthemarket": f"https://www.onthemarket.com/for-sale/property/{slug}/",
    }


def listing_searches(places: Mapping[str, dict], area_ids: list[str], market: str, max_price: int,
                     min_bedrooms: int, per_area: int) -> list[dict]:
    searches: dict[str, dict] = {}
    for area_id in area_ids:
        for outcode in places.get(area_id, {}).get("outcodes", [])[:per_area]:
            entry = searches.setdefault(outcode, {"outcode": outcode, "areaIds": [],
                                                  "links": portal_links(outcode, market, max_price, min_bedrooms)})
            if area_id not in entry["areaIds"]:
                entry["areaIds"].append(area_id)
    return list(searches.values())


def _classify_area_ids(area_ids: list[str], places: Mapping[str, dict]) -> tuple[list[str], list[str], list[str]]:
    """(known ids, unknown ids, known but unsearchable non-LSOA ids): portal searches are
    built from LSOA postcode districts only, so MSOA and borough ids are named, not searched."""
    known = [area_id for area_id in area_ids if area_id in places]
    unknown = [area_id for area_id in area_ids if area_id not in places]
    unsearchable = [area_id for area_id in known if not area_id.startswith("uk:lsoa:")]
    return known, unknown, unsearchable


def _id_coverage_caveats(unknown: list[str], unsearchable: list[str]) -> list[str]:
    caveats = []
    if unknown:
        caveats.append(f"Unknown area ids skipped: {', '.join(unknown)}")
    if unsearchable:
        caveats.append("No portal search for " + ", ".join(unsearchable) + ": only LSOAs build a "
                       "postcode-district search — pass their LSOAs (from search_places) instead.")
    return caveats


def _coverage_confidence(searches: list, unknown: list[str], unsearchable: list[str]) -> str:
    if not searches:
        return "none"
    return "high" if not unknown and not unsearchable else "medium"


def _counted(search: dict, session: str | None, args: ListingLinksInput) -> dict:
    """The same search with links through /go, so a click-out from a conversation is counted;
    portalUrls keeps the direct ones for agents that read the pages."""
    area = search["areaIds"][0] if len(search["areaIds"]) == 1 else None
    links = {portal: usage.go_url(share_links.site_url(), portal, outcode=search["outcode"], market=args.market,
                                  max_price=args.max_price, min_bedrooms=args.min_bedrooms,
                                  source="mcp" if session else "api", session=session, area=area)
             for portal in search["links"]}
    return {**search, "links": links, "portalUrls": search["links"]}


def _get_listing_search_links(context: ToolContext, args: ListingLinksInput) -> dict:
    area_ids = list(dict.fromkeys(args.area_ids))
    places = _places(context, area_ids)
    known, unknown, unsearchable = _classify_area_ids(area_ids, places)
    searches = [_counted(search, context.session, args) for search in listing_searches(
        places, area_ids, args.market, args.max_price, args.min_bedrooms, args.outcodes_per_area)]
    areas = [{"geographyId": area_id, "name": places[area_id]["name"],
              "title": places[area_id].get("displayName") or places[area_id]["name"],
              "borough": places[area_id]["borough"],
              "outcodes": places[area_id]["outcodes"][:args.outcodes_per_area]}
             for area_id in known]
    caveats = ["These links open each portal's own public search filtered by postcode district, price and "
               "bedrooms. Close Knit does not fetch, store or rank listings; a postcode district is "
               "wider than the neighbourhood, so check each listing's postcode with assess_listing.",
               "Give the user `links`: they pass through Close Knit, which counts the visit (nothing about the "
               "user) and opens the portal. To read a portal page yourself, fetch `portalUrls` instead."]
    caveats += _id_coverage_caveats(unknown, unsearchable)
    return envelope.wrap(
        {"market": args.market, "maxPrice": args.max_price, "minBedrooms": args.min_bedrooms,
         "searches": searches, "areas": areas},
        schema_version="tool-listing-search-links.v1", release_id=_release(context),
        confidence=_coverage_confidence(searches, unknown, unsearchable), caveats=caveats)


def postcode_area(context: ToolContext, postcode: str) -> tuple[str, str, str]:
    """(normalised postcode, LSOA id, resolvedBy) via the reader's dedicated lookup (#205)."""
    found = context.reader.postcode_area(postcode, cancel=context.cancel)
    return found["postcode"], found["geographyId"], found["resolvedBy"]


def _assess_listing(context: ToolContext, args: AssessListingInput) -> dict:
    postcode, area_id, resolved_by = postcode_area(context, args.postcode)
    pack = context.reader.get_area_pack(area_id, cancel=context.cancel)
    place = _places(context, [area_id]).get(area_id, {})
    market = pack.get("market") or {}
    resale = (market.get("resale") or {}).get("medianPricePerSquareMetre")
    rent = (context.reader.rent_levels(args.bedrooms, [area_id]).get(area_id)
            if args.market == "rent" and args.bedrooms is not None else None)
    price = _price_check(args, resale, rent)
    located = _location(context, area_id)
    hpi = _hpi(context, area_id)
    council_tax = _council_tax(context, area_id)
    deprivation = _deprivation(context, area_id)
    home = _home(context, area_id)
    listed = _listed_near(context, postcode)
    schools = pack.get("schools") or {}
    value = {
        "listing": {"postcode": postcode, "askingPrice": args.asking_price, "market": args.market,
                    "bedrooms": args.bedrooms, "floorAreaSqm": _effective_floor_area(args),
                    "propertyType": args.property_type,
                    "tenure": args.tenure, "url": args.listing_url,
                    **({"rentPeriod": args.rent_period} if args.market == "rent" else {}),
                    **({"sharePercent": args.share_percent}
                       if args.share_percent is not None else {})},
        "area": {"geographyId": area_id, "name": pack["name"], "borough": place.get("borough"),
                 "center": place.get("center"), "links": share_links.area_links(area_id),
                 "resolvedBy": resolved_by},
        "price": price,
        "localMarket": {key: market.get(key) for key in
                        ("salesCount", "turnoverPercent", "leaseholdShareOfSales", "growth")},
        "hpi": hpi,
        "costs": listing_costs_block(args, council_tax),
        "crime": pack.get("crime"), "noise": pack.get("noise"),
        "schools": {**{key: schools.get(key) for key in ("count", "primary", "secondary")},
                    "independent": (schools.get("independent") or {}).get("count") if schools.get("independent") else None},
        "location": located,
        "home": home,
        "listedNearby": listed,
        "deprivation": deprivation,
        "questions": listing_questions(args, located, home, listed),
    }
    releases = _pack_sources(pack) | _block_sources(hpi, council_tax, home, deprivation)
    if rent is not None:
        releases.add(rent["source_release_id"])
    rent_mode = args.market == "rent"
    caveats = [RENT_FIRST_CAVEAT if rent_mode else
               "Compares the asking price with recorded sales around the postcode's neighbourhood "
               "(median £/m² over 36 months). Not a valuation: condition, floor, outlook and lease "
               "terms are unknown.",
               "Neighbourhood from the postcode's recorded addresses."
               if resolved_by == "recorded-address" else
               "Neighbourhood from the ONS Postcode Directory; no recorded sale at this postcode yet."]
    if args.tenure == SHARED_OWNERSHIP:
        caveats.append(
            "Shared ownership: the asking price is for the share only. Monthly rent is usually due on "
            "the rest of the home, staircasing to a bigger share costs extra, and resale can carry "
            "restrictions — check the housing association's terms.")
    if price.get("assumedFloorArea"):
        difference = price.get("differencePercent")
        against = (f"{difference:+.1f}% is against" if difference is not None else "The verdict is against")
        caveats.append(f"{against} a typical {price['assumedFloorArea']} m² home; give floor_area_sqm "
                       "for a like-for-like check.")
    caveats += _crime_caveats(pack) + _block_caveats(hpi, council_tax, home, deprivation)
    if not rent_mode:
        caveats.append("costs.stampDuty is SDLT for an individual buying in England under the rules in force on "
                       f"{SDLT_IN_FORCE_ON} (first-time buyer relief up to £500,000; 5-point surcharge on an "
                       "additional home); a comparison aid, not a quote or tax advice.")
    if listed:
        caveats.append("listedNearby: a listed building is recorded within 25 m of this postcode's homes (Historic "
                       "England NHLE), which does not mean the home itself is listed: confirm with the agent.")
    difference = price.get("differencePercent")
    if price["verdict"] == "unknown":
        confidence = "low"
    elif difference is not None and abs(difference) > PLAUSIBILITY_DIFFERENCE_PCT:
        confidence = "low"
        caveats.append(
            f"The price is {abs(difference):.0f}% {'above' if difference > 0 else 'below'} the local "
            "figure — check the price basis before trusting the verdict: a shared-ownership part "
            "share, a weekly rent passed as monthly, an auction price, or a rent entered as a sale "
            "price.")
    else:
        confidence = "medium"
    return envelope.wrap(
        value, schema_version="tool-assess-listing.v1", release_id=pack["productReleaseId"],
        confidence=confidence,
        evidence=_assess_evidence(area_id, market, rent, pack),
        sources=release_sources(context, sorted(
            releases | ({civic.ONSPD_SOURCE} if resolved_by == "postcode-directory" else set()))),
        caveats=caveats
        + (["This looks like a monthly rent entered as a sale price "
            f"(£{args.asking_price:,} is far below any plausible London sale price); re-run with "
            "market='rent' if so."]
           if args.market == "buy" and args.asking_price < MIN_PLAUSIBLE_BUY_PRICE else [])
        + (RENT_CAVEATS[1:] if rent_mode else []))


def _assess_evidence(area_id: str, market: Mapping[str, Any], rent: Mapping[str, Any] | None,
                    pack: Mapping[str, Any]) -> list[dict]:
    """The rows behind the listing verdict (#215): market medians, the borough rent, crime, noise."""
    evidence = market_depth.market_evidence(area_id, market)
    if rent is not None:
        evidence.append({"kind": "rent-average", "geographyId": area_id, "bedrooms": rent.get("bedrooms"),
                         "value": rent["raw_value"], "unit": rent.get("unit"), "period": rent.get("period"),
                         "carrierGeographyId": rent.get("carrier_geography_id"), "quality": rent.get("quality"),
                         "sourceVersion": rent.get("source_release_id")})
    crime = pack.get("crime")
    if crime:
        evidence.append({"kind": "metric-observation", "geographyId": area_id, "metricId": "crime",
                         "period": crime.get("period"), "value": crime.get("value"), "unit": crime.get("unit"),
                         "quality": crime.get("quality"), "sourceVersion": crime.get("sourceVersion")})
    noise = pack.get("noise")
    if noise and noise.get("available"):
        evidence.append({"kind": "noise-share", "geographyId": area_id,
                         "any55Share": noise.get("any55Share"), "dwellings": noise.get("dwellings"),
                         "sourceVersion": noise.get("sourceVersion")})
    return evidence


SQFT_TO_SQM = 0.092903


def _effective_floor_area(args: AssessListingInput) -> float | None:
    """The listing's floor area in m², converting sq ft server-side (#163)."""
    if args.floor_area_sqm is not None:
        return args.floor_area_sqm
    if args.floor_area_sqft is not None:
        return round(args.floor_area_sqft * SQFT_TO_SQM, 1)
    return None


def listing_costs_block(args: "AssessListingInput", council_tax: Mapping[str, Any] | None) -> dict:
    """Stamp duty on the asking price (buy) and the borough's council tax by band (#233): comparison aids."""
    stamp = None
    if args.market == "buy":
        standard = listing_costs.stamp_duty(args.asking_price)
        first = listing_costs.stamp_duty(args.asking_price, first_time_buyer=True)
        additional = listing_costs.stamp_duty(args.asking_price, additional_property=True)
        stamp = {"standard": standard["total"],
                 "firstTimeBuyer": first["total"] if first["regime"] == "first-time-buyer" else None,
                 "additionalProperty": additional["total"], "rulesInForceOn": SDLT_IN_FORCE_ON}
        if first["regime"] != "first-time-buyer":
            stamp["note"] = "First-time buyer relief ends above £500,000: a first-time buyer pays the standard rate."
    tax = None
    if council_tax:
        tax = {key: council_tax[key] for key in ("financialYear", "borough", "typicalBand", "typicalYearlyBill",
                                                  "yearlyBillByBand")}
        tax["note"] = "The borough's bill by band for this year; ask the agent for the home's band."
    return {"stampDuty": stamp, "councilTax": tax}


def _price_check(args: AssessListingInput, resale: float | None, rent: Mapping[str, Any] | None = None) -> dict:
    check = {"localResaleMedianPerSqm": resale, "askingPerSqm": None, "typicalEstimate": None,
             "assumedFloorArea": None, "differencePercent": None, "verdict": "unknown"}
    if args.market == "rent":
        return _rent_check(args, rent, check)
    if resale is None:
        check["note"] = "Too few local sales for a median."
        return check
    if args.tenure == SHARED_OWNERSHIP and args.share_percent is None:
        check["note"] = ("Shared-ownership price without the share: a part-share price cannot be "
                         "compared with whole-home prices. Ask for the share %, the rent on the rest, "
                         "staircasing terms and resale restrictions.")
        return check
    asking = args.asking_price
    if args.tenure == SHARED_OWNERSHIP:
        check["sharePercent"] = args.share_percent
        asking = asking / (args.share_percent / 100)
        check["shareImpliedFullPrice"] = round(asking)
    floor = _effective_floor_area(args)
    if floor:
        check["askingPerSqm"] = round(asking / floor)
        reference = resale * floor
    elif args.bedrooms is not None:
        estimate = price_estimate(resale, args.bedrooms, "buy")
        check["typicalEstimate"] = estimate["estimatedPrice"]
        # The bedroom ballpark assumes a typical floor area: say so explicitly (#163).
        check["assumedFloorArea"] = TYPICAL_FLOOR_AREA.get(args.bedrooms)
        reference = estimate["estimatedPrice"]
    else:
        check["note"] = "Give floor_area_sqm or bedrooms to compare the price."
        return check
    difference = (asking - reference) / reference
    check["differencePercent"] = round(difference * 100, 1)
    check["verdict"] = ("above-local" if difference > IN_LINE else
                        "below-local" if difference < -IN_LINE else "in-line")
    return check


def _rent_check(args: AssessListingInput, rent: Mapping[str, Any] | None, check: dict) -> dict:
    """An asking rent against the borough's average for the bedroom count, plus the income a
    referencing check usually looks for."""
    check["localResaleMedianPerSqm"] = None  # a sales figure has no place in a rent answer
    monthly = args.asking_price * WEEKS_PER_MONTH if args.rent_period == "week" else float(args.asking_price)
    if args.rent_period == "week":
        check["askingRentPcm"] = round(monthly)
    check["incomeUsuallyNeeded"] = round(monthly * RENT_REFERENCING_MULTIPLE)
    if rent is None:
        check["note"] = ("No published average rent for this size here (studios and the City of London have "
                         "none, and bedrooms are needed); compare with similar listings.")
        return check
    reference = int(rent["raw_value"])
    difference = (monthly - reference) / reference
    check.update({
        "boroughAverageRent": reference, "rentPeriod": str(rent["period"])[:7],
        "differencePercent": round(difference * 100, 1),
        "verdict": "above-local" if difference > IN_LINE else "below-local" if difference < -IN_LINE else "in-line",
        "note": "Compared with the borough's average rent for this many bedrooms (ONS Price Index of Private "
                "Rents, new and existing tenancies); new lets usually ask more than the average.",
    })
    return check


def listing_questions(args: AssessListingInput, located: Mapping[str, Any] | None = None,
                      home: Mapping[str, Any] | None = None, listed: list | None = None) -> list[str]:
    """Questions for the agent, built from what the request leaves open, the area's location block (#237)
    and its Home block and nearby listed buildings (#234)."""
    if args.market == "rent":
        # Renters' Rights Act (1 May 2026): tenancies are periodic, so no "minimum term"; one month's rent in advance
        # at most, no payment before the agreement; deposits capped at five weeks' rent (GLA, gov.uk).
        return ["Is the deposit protected, and which scheme? It may not exceed five weeks' rent.",
                "What is included (bills, furniture)? Tenancies are periodic now, so there is no fixed term to agree.",
                "Is any rent or holding deposit asked for before the agreement is signed, or more than one month's "
                "rent in advance? Neither is allowed.",
                "Can I see the EPC and the gas safety certificate?"]
    questions = ["What is the EPC rating?" if _effective_floor_area(args) else "What is the EPC rating and the stated floor area?"]
    if args.bedrooms is None:
        questions.append("How many bedrooms are there, and how many are doubles?")
    questions.append("Why is the seller moving, and how long has it been on the market?")
    conservation = (located or {}).get("conservation") or {}
    if conservation.get("presence") in ("partly", "inside") and conservation.get("areas"):
        questions.append(f"The home may fall in the {conservation['areas'][0]['name']} conservation area: which "
                         "alterations had consent, and does an Article 4 direction limit changes or extensions?")
    if listed:
        questions.append("A listed building is recorded at or near this address: is the home itself listed, and "
                         "which works had listed building consent?")
    extend = (home or {}).get("extend") or {}
    if extend.get("article4Data") == "not-published" and "Article 4" not in " ".join(questions):
        questions.append("The council has not published its Article 4 directions: does one limit extensions or "
                         "changes to this home?")
    if args.tenure == "leasehold":
        questions += ["How many years remain on the lease? Under 80 years makes extending costly and "
                      "many lenders cautious.",
                      "What are the service charge and ground rent? Above ~1% of the price a year deserves "
                      "a closer look.",
                      "For a block over 11 m: is there an EWS1 form or building-safety remediation pending?"]
    elif args.tenure in ("share-of-freehold", "unknown"):
        # Tenure unknown: hedge the lease questions so they are not asked as fact (#163).
        questions += ["If leasehold: how many years remain on the lease? Under 80 years makes extending "
                      "costly and many lenders cautious.",
                      "If leasehold: what are the service charge and ground rent? Above ~1% of the price "
                      "a year deserves a closer look.",
                      "If leasehold: for a block over 11 m, is there an EWS1 form or building-safety "
                      "remediation pending?"]
    if args.tenure == SHARED_OWNERSHIP:
        questions += ["What is the monthly rent on the unowned share, and how is it reviewed?",
                      "What does staircasing to a bigger share cost, and are there resale restrictions "
                      "(the housing association's nomination period or first refusal)?"]
    return questions


def _build_watch_spec(context: ToolContext, args: WatchSpecInput) -> dict:
    area_ids = list(dict.fromkeys(args.area_ids))
    places = _places(context, area_ids)
    known, unknown, unsearchable = _classify_area_ids(area_ids, places)
    searches = listing_searches(places, area_ids, args.market, args.max_price, args.min_bedrooms, 1)
    areas = [{"geographyId": area_id, "name": places[area_id]["name"],
              "title": places[area_id].get("displayName") or places[area_id]["name"],
              "borough": places[area_id]["borough"]}
             for area_id in known]
    slug = "".join(ch if ch.isalnum() else "-" for ch in args.name.lower()).strip("-")
    if not slug:
        # A name with no alphanumerics ('??') still needs a state file of its own: fall back to a
        # stable hash of the name and the watched areas, so two such watches never share a file.
        slug = "watch-" + hashlib.sha1(
            f"{args.name}|{','.join(sorted(area_ids))}".encode()).hexdigest()[:8]
    spec = {"name": args.name, "slug": slug, "market": args.market, "maxPrice": args.max_price,
            "minBedrooms": args.min_bedrooms, "mustHaves": args.must_haves, "frequency": args.frequency,
            "areas": areas, "searches": searches, "stateFile": f"~/.close-knit/watches/{slug}.json",
            "assessArgs": {
                "market": args.market,
                "bedrooms": args.min_bedrooms or None,
                "floorAreaSqm": "from the listing when stated",
                "tenure": "from the listing when stated, else 'unknown'",
                "askingPrice": ("£ per calendar month (a weekly rent × 52 ÷ 12)"
                                if args.market == "rent" else "£"),
            }}
    caveats = ["Nothing is stored on Close Knit: the watch runs in the user's own Claude as a "
               "scheduled task, reading each portal's public search page on the user's behalf."]
    caveats += _id_coverage_caveats(unknown, unsearchable)
    return envelope.wrap(
        {"spec": spec, "schedulePrompt": watch_prompt(spec)},
        schema_version="tool-watch-spec.v1", release_id=_release(context),
        confidence=_coverage_confidence(searches, unknown, unsearchable), caveats=caveats)


def watch_prompt(spec: Mapping[str, Any]) -> str:
    lines = [f"Close Knit watch '{spec['name']}' ({spec['frequency']}).",
             f"Find new {'homes for sale' if spec['market'] == 'buy' else 'homes to rent'} up to "
             f"£{spec['maxPrice']:,}{' a month' if spec['market'] == 'rent' else ''} with at least "
             f"{spec['minBedrooms']} bedrooms.",
             "Open each of these searches (one page each, no bulk crawling) and list the listings:"]
    for search in spec["searches"]:
        for portal, url in search["links"].items():
            lines.append(f"- {search['outcode']} {portal}: {url}")
    if spec["mustHaves"]:
        lines.append(f"Must-haves: {spec['mustHaves']}")
    price_basis = ("in £ per calendar month (a weekly rent × 52 ÷ 12)"
                   if spec["market"] == "rent" else "in £")
    lines += [f"Read {spec['stateFile']} (create it if missing) for listing URLs already reported; skip those.",
              f"For each new listing with a postcode, call the close-knit assess_listing tool with "
              f"market='{spec['market']}', bedrooms from the listing (at least {spec['minBedrooms']} "
              f"when stated), floor_area_sqm from the listing when stated, tenure from the listing "
              f"('unknown' if not stated), and asking_price {price_basis}.",
              "Report only new listings: price, beds, postcode, link and the assess_listing verdict; "
              "then add their URLs to the state file. If nothing is new, say so in one line."]
    return "\n".join(lines)


def _release(context: ToolContext) -> str:
    return context.reader.list_metrics(cancel=context.cancel)["productReleaseId"]


def release_sources(context: ToolContext, release_ids: list[str],
                    catalogue: Mapping[str, Any] | None = None) -> list[dict]:
    """Full release-level provenance for release ids, from the reader's cached source-release
    table over the catalogue (#215); catalogue-only when the reader has no table (stubs)."""
    catalogue = catalogue if catalogue is not None else context.reader.list_metrics(cancel=context.cancel)
    return market_depth.release_provenance(release_ids, catalogue, _source_release_table(context))


def _source_release_table(context: ToolContext) -> dict[str, dict]:
    source_releases = getattr(context.reader, "source_releases", None)
    return source_releases(cancel=context.cancel) if callable(source_releases) else {}


def _osm_place_source() -> dict:
    """The OpenStreetMap credit behind place-based tools (custom criteria), #215."""
    osm = custom_criteria.OSM_SOURCE
    return {"sourceName": osm["name"], "sourceUrl": osm["url"], "licence": osm["licence"],
            "attribution": osm["attribution"]}


def _spec(name: str, description: str, model, handler, version: str) -> ToolSpec:
    return ToolSpec(name, description, model, handler, version, ("home-search",))


TOOLS = [
    _spec("search_places",
          "Resolve a place the user mentions (station, borough, neighbourhood, postcode, street) to ids. "
          "Station lookup forgives spelling (Kings Cross, St James Park, Elephant and Castle) and knows "
          "London codes and nicknames (KX, TCR, LST, E&C, ally pally). Returns "
          "stations (osm:…, with TfL modes, lines and zone; twin stations such as Hammersmith are listed "
          "apart) for find_areas.near_stations, boroughs (uk:lad:…) for find_areas.boroughs, "
          "areas and addresses for get_area_overview and assess_listing.",
          SearchPlacesInput, _search_places, "tool-search-places.v1"),
    _spec("find_areas",
          "Shortlist London neighbourhoods for a household: budget, bedrooms, weighted priorities "
          "(crime, station access, price level, official deprivation decile, noise, disorder, energy rating, "
          "leasehold share) and optional stations/boroughs to "
          "live near. Returns ranked areas with score, factor values, a ballpark price for the bedroom "
          "count and budget fit, postcode districts and website links. Pass rejected areas in "
          "exclude_area_ids when refining after the user's feedback (LSOA, MSOA or borough ids). "
          "The first tool for 'where should we live?'; rank_areas_by_metric sorts by one metric only, "
          "match_areas scores a ready preference-profile.v2, search_areas only turns names into ids.",
          FindAreasInput, _find_areas, "tool-find-areas.v1"),
    _spec("open_shared_search",
          "Open a search the user shared from the Close Knit site (a link with #profile=v1., v2. or v3.): their budget, "
          "priorities, places (gym, work, schools…), liked and ruled-out areas and private notes, re-ranked now "
          "with the same shortlist as find_areas. Use it when the user pastes such a link or says 'discuss my search'.",
          OpenSearchInput, _open_shared_search, "tool-open-shared-search.v1"),
    _spec("get_commute",
          "Door-to-door minutes from one neighbourhood to the user's places on a weekday morning, by public transport "
          "(R5 on TfL timetables), bike (at the speed Santander Cycles riders reach; checked against TfL), car (typical "
          "morning traffic, no parking) and walking, each with a range. Places within 1.5 km of a commute hub (King's "
          "Cross, Bank, Canary Wharf, Oxford Circus…) are routed through it; others in Greater London get a "
          "straight-line estimate (estimate: true); places outside Greater London, and every place from a "
          "neighbourhood outside London (the routing is London only), get no minutes (reason 'outside-london', or "
          "'outside-coverage' where Close Knit covers England). Journeys over 120 minutes are not timed (minutes "
          "null, capped: true).",
          CommuteInput, _get_commute, "tool-commute.v1"),
    _spec("find_similar_areas",
          "Neighbourhoods like one the user liked (crime, deprivation, income, price level and station "
          "access percentiles), optionally only cheaper ones: 'like this but cheaper / elsewhere'.",
          SimilarAreasInput, _find_similar_areas, "tool-find-similar-areas.v1"),
    _spec("get_area_overview",
          "One neighbourhood in detail for a decision: local market (sales, turnover, leasehold share, "
          "£/m² medians, growth), the borough's official UK HPI (hpi: average price by type, 1/5/10-year "
          "change vs London: quote this for how prices moved), £/m² price trend, crime with its offence mix "
          "(topTypes, a busy-centre note), road/rail noise, nearby state schools with their standing Ofsted "
          "grade plus independent schools (schools.independent), planning rules (home: conservation, Article 4, "
          "listed buildings, broadband), council tax bands and a typical bill (councilTax), the IMD decile "
          "(deprivation), a ballpark price for a bedroom count and website links.",
          AreaOverviewInput, _get_area_overview, "tool-area-overview.v1"),
    _spec("get_flood_risk",
          "Flood bands for an area's land (rivers/sea, surface water) and, with a UPRN, that home's "
          "own bands. Bands show the likelihood for an area, not a specific property: send the user "
          "to the Environment Agency check for one address.",
          FloodRiskInput, _get_flood_risk, "tool-flood-risk.v1"),
    _spec("get_rent_levels",
          "Median monthly rent by bedroom count for areas (the figure the site shows). Borough "
          "averages per LSOA; empty for a studio or before the rents are loaded.",
          RentLevelsInput, _get_rent_levels, "tool-rent-levels.v1"),
    _spec("get_listing_search_links",
          "Pre-filtered searches on Rightmove, Zoopla, OnTheMarket (and OpenRent for rentals) for the "
          "postcode districts of shortlisted areas. Links only: open them on the user's behalf to read "
          "listings; Close Knit itself never fetches or stores listings.",
          ListingLinksInput, _get_listing_search_links, "tool-listing-search-links.v1"),
    _spec("assess_listing",
          "Check one listing the user found against local evidence: asking price vs the neighbourhood's "
          "recorded £/m² (with floor area or a bedroom-based ballpark), turnover, growth, the borough's "
          "official HPI, costs (stamp duty on the asking price, the borough's council tax by band), crime "
          "with its offence mix, noise, schools (state and independent counts), planning rules (home: "
          "conservation, Article 4, listed buildings), listed buildings recorded at or near the postcode "
          "(listedNearby), the IMD decile, and the questions to ask the agent (lease, service charge, EWS1, "
          "listing). Not a valuation.",
          AssessListingInput, _assess_listing, "tool-assess-listing.v1"),
    _spec("list_custom_presets",
          "Ready-made custom criteria built from places on OpenStreetMap, with neutral descriptive names: kebab shops "
          "vs cafés, specialty coffee vs kebab shops, sandwich chains vs bakery chains, independent vs chain cafés, the "
          "nearest gym or sports centre, bars, pubs and clubs (more or fewer, per 1,000 residents), cinemas, theatres, "
          "museums and galleries, universities, the nearest playground or nursery, variety of cuisines, bakeries vs "
          "betting shops, takeaways, coworking, bike parking, the nearest EV charging point, the nearest market, the "
          "nearest dog park, vet or pet shop. Each has an id for "
          "evaluate_custom_criterion and find_areas(custom=[…]), a mapUrl (the map coloured by it) and a one-line "
          "definition. Use the names as given: no brand names or value words ('good', 'cheap') in what you tell the user.",
          NoPresetArguments, _list_custom_presets, "tool-custom-presets.v1"),
    _spec("evaluate_custom_criterion",
          "Evaluate a criterion from places on the map for every London neighbourhood ('where are more cafés than "
          "kebab shops', 'most gyms in the area'), counting the places inside each neighbourhood's boundary: a "
          "preset_id or the user's own criterion (sets of OSM tag matchers and a formula). Returns the best and worst areas with place counts and London percentiles, the legend "
          "and a map link that shows it as a layer. Places, never people: religion or who lives there is refused.",
          EvaluateCustomInput, _evaluate_custom_criterion, "tool-evaluate-custom-criterion.v1"),
    _spec("build_watch_spec",
          "Turn a finished search into a watch: portal searches per postcode district, filters, a state "
          "file path for de-duplication and a ready prompt for a scheduled task in the user's Claude that "
          "reports only new listings. Stateless: nothing is stored on Close Knit.",
          WatchSpecInput, _build_watch_spec, "tool-watch-spec.v1"),
]
