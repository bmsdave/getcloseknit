"""The Close Knit card the browser extension shows beside a portal listing (listing-card.v1).

The extension reads a few public facts from the listing page (portal, id, location, asking
price, bedrooms) and renders the blocks returned here as they are, skipping block types it does
not know. Wording lives on the server so the card can change without a store release.
Nothing about the listing is stored; photos, descriptions and agents are never sent.
"""
from __future__ import annotations

import base64
import datetime
import math
import json
import logging
import re
from datetime import date
from typing import Any, Callable, Literal, Mapping

from pydantic import BaseModel, Field

from . import card_cache, evidence, listing_costs, share_links
from .home_search import (AssessListingInput, POSTCODE_PATTERN, _getting_around, _places, _price_check,
                          postcode_area)
from .matching import describe_unmet_limits, limit_id
from .scope import current as current_scope
from .toolspec import ToolContext

logger = logging.getLogger(__name__)

SCHEMA_VERSION = "listing-card.v1"
# Visits from the card count as page_view source "extension" (web/src/lib/usage.ts trafficSource).
REF = "utm_source=extension"
STRONG, WEAK = 66, 33
FACTOR_LABELS = {
    "affordability": "Within budget", "crime": "Low crime", "station-access": "Station nearby",
    "market-level": "Lower prices", "deprivation": "Less deprivation", "green-space": "Green space",
    "schools": "Schools", "noise": "Quiet", "commute": "Commute",
}


# How a factor reads when the area is weak on it.
CON_LABELS = {
    "affordability": "Over your budget", "crime": "Higher crime", "station-access": "Far from a station",
    "market-level": "Pricier area", "deprivation": "More deprivation", "green-space": "Little green space",
    "schools": "Fewer schools", "noise": "Noisier", "commute": "Longer commute",
}


class PricePoint(BaseModel):
    model_config = {"extra": "forbid"}

    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    price: int = Field(gt=0, lt=100_000_000)


class BuyerAssumptions(BaseModel):
    """The user's own mortgage assumptions, kept on their device."""
    model_config = {"extra": "forbid"}

    depositPct: float = Field(default=10, ge=0, le=100)
    ratePct: float = Field(default=4.5, ge=0, le=20)
    years: int = Field(default=30, ge=1, le=40)
    firstTime: bool = False
    additionalHome: bool = False


class ListingCardRequest(BaseModel):
    model_config = {"extra": "forbid"}

    v: Literal[1] = 1
    portal: Literal["rightmove", "zoopla", "onthemarket", "spareroom", "openrent"]
    listingId: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    url: str = Field(max_length=500,
                     pattern=r"^https://www\.(rightmove\.co\.uk|zoopla\.co\.uk|onthemarket\.com|spareroom\.co\.uk|openrent\.co\.uk)/")
    address: str | None = Field(default=None, max_length=200, description="The listing's display address.")
    lat: float | None = Field(default=None, ge=49, le=61)
    lng: float | None = Field(default=None, ge=-9, le=3)
    postcode: str | None = Field(default=None, pattern=POSTCODE_PATTERN)
    market: Literal["buy", "rent"] = "buy"
    askingPrice: int | None = Field(default=None, gt=0, lt=100_000_000, description="£, or £ a month to rent.")
    bedrooms: int | None = Field(default=None, ge=0, le=10)
    floorAreaSqm: float | None = Field(default=None, gt=5, lt=2000)
    tenure: Literal["freehold", "leasehold", "share-of-freehold", "unknown"] = "unknown"
    locationApproximate: bool = Field(default=False, description="The page gives only an approximate point (SpareRoom).")
    profile: dict | None = Field(default=None, description="The saved preference profile, as POST /api/v1/matches.")
    # Listing facts v2 (docs/superpowers/specs/2026-10-18-extension-gaps.md): all optional, read from the page.
    propertyType: Literal["flat", "terraced", "semi-detached", "detached", "bungalow", "other", "unknown"] = "unknown"
    councilTaxBand: Literal["A", "B", "C", "D", "E", "F", "G", "H", "I"] | None = None
    serviceChargeYearly: int | None = Field(default=None, ge=0, lt=200_000)
    groundRentYearly: int | None = Field(default=None, ge=0, lt=100_000)
    leaseYearsRemaining: int | None = Field(default=None, ge=0, le=999)
    epcRating: Literal["A", "B", "C", "D", "E", "F", "G"] | None = Field(
        default=None, description="As the listing shows it; no EPC lookup.")
    listedOn: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    priceChanges: list[PricePoint] = Field(default_factory=list, max_length=20,
                                           description="Changes the page itself shows, oldest first.")
    firstSeen: PricePoint | None = Field(default=None, description="From the extension's memory on this device.")
    buyer: BuyerAssumptions | None = None


def resolve_area(context: ToolContext, request: ListingCardRequest) -> str | None:
    """The listing's LSOA: from its point when the page gives one (inside the scope: London's alone with
    CLOSE_KNIT_ENGLAND off; a point outside the scope's box is not looked up), else its full postcode."""
    if request.lat is not None and request.lng is not None:
        if not current_scope().contains(request.lat, request.lng):
            return None
        return area_at(context, request.lng, request.lat)
    if request.postcode:
        try:
            return postcode_area(context, request.postcode)[1]
        except evidence.AreaNotFound:
            return None
    return None


# The LSOA of each point a listing gave, per release: a listing seen again (or its results line) asks nothing.
POINT_CACHE = card_cache.TTLCache(limit=20_000)


def area_at(context: ToolContext, lng: float, lat: float) -> str | None:
    release = card_cache.release_id(context.reader)
    if not release:  # without a known release nothing is kept
        return context.reader.area_at(lng, lat, cancel=context.cancel)
    return POINT_CACHE.get_or_build((release, lng, lat, current_scope().regions),
                                    lambda: context.reader.area_at(lng, lat, cancel=context.cancel))


def listing_card(context: ToolContext, request: ListingCardRequest,
                 match_for: Callable[[str], Mapping[str, Any] | None] | None = None) -> dict:
    """The card for one listing; ``match_for`` gives an area's result in the profile's match pack.
    The area's half comes from ``area_part`` (cached); only the listing's own facts are worked out here."""
    area_id = resolve_area(context, request)
    if area_id is None:
        return outside_card()
    area = area_part(context, area_id)
    pack = area["pack"]
    rent = (rent_level(context, area_id, request.bedrooms)
            if request.market == "rent" and request.bedrooms is not None else None)
    resale = ((pack.get("market") or {}).get("resale") or {}).get("medianPricePerSquareMetre")
    # An approximate point may sit in the next area: the card stays about the area, with no price check.
    price = (_price_check(_assess_args(request), resale, rent)
             if request.askingPrice and not request.locationApproximate else None)
    match = match_for(area_id) if match_for and request.profile else None
    return build_card(request, area_id, pack, area["place"], area["around"], price, match,
                      extras=extras_for(area["layers"], request))


def load_extras(context: ToolContext, area_id: str, request: ListingCardRequest) -> dict:
    """Optional layers behind the v2 blocks: sales by type, council tax, flood, location and home."""
    return load_layers(context, area_id, extras_names(request))


def extras_names(request: ListingCardRequest) -> tuple[str, ...]:
    return AREA_LAYERS + (("market", "civic") if request.market == "buy" else ())


def extras_for(layers: Mapping[str, Any], request: ListingCardRequest) -> dict:
    """The listing's layers out of an area's cached ones (a rent card shows no sales or council tax)."""
    return {name: layers[name] for name in extras_names(request) if name in layers}


# Flood, location, home and the People metrics: the layers every card (and the results line) reads.
AREA_LAYERS = ("flood", "location", "home", "profile")
# Every layer a card or the results line may show, read once per area whatever the listing's market.
ALL_LAYERS = AREA_LAYERS + ("market", "civic")
# The area half of the card per (release, area): ~2,000 areas is a busy hour of browsing.
AREA_CACHE = card_cache.TTLCache(limit=2_000)
RENT_CACHE = card_cache.TTLCache(limit=5_000)


def area_part(context: ToolContext, area_id: str) -> dict:
    """What a card says about its area whoever asks: the pack, its place names, getting around and every
    optional layer, read in parallel and kept for an hour per product release. A failing layer (or place
    names, or getting around) is left out; a failing pack raises, and nothing is kept."""
    key = (card_cache.release_id(context.reader), area_id)
    return AREA_CACHE.get_or_build(key, lambda: _read_area_part(context, area_id))


def _read_area_part(context: ToolContext, area_id: str) -> dict:
    loaders = layer_loaders(context, area_id)
    done = card_cache.run_parallel({
        "pack": lambda: context.reader.get_area_pack(area_id, cancel=context.cancel),
        "place": lambda: _places(context, [area_id]).get(area_id, {}),
        "around": lambda: _getting_around(context, area_id),
        **{f"layer:{name}": loaders[name] for name in ALL_LAYERS if name in loaders}})
    ok, pack = done["pack"]
    if not ok:
        raise pack
    return {"pack": pack, "place": _optional_part(done, "place", area_id) or {},
            "around": _optional_part(done, "around", area_id), "layers": _kept_layers(done, area_id)}


def _optional_part(done: Mapping[str, tuple[bool, Any]], name: str, area_id: str) -> Any:
    ok, value = done[name]
    if ok:
        return value
    logger.info("listing card: %s unavailable for %s", name, area_id, exc_info=value)
    return None


def _kept_layers(done: Mapping[str, tuple[bool, Any]], area_id: str) -> dict:
    layers = {}
    for name in ALL_LAYERS:
        ok, value = done.get(f"layer:{name}", (False, None))
        if ok:
            layers[name] = value
        elif value is not None:
            logger.info("listing card: %s layer unavailable for %s", name, area_id, exc_info=value)
    return layers


def rent_level(context: ToolContext, area_id: str, bedrooms: int) -> Any:
    """The borough's average rent for the bedroom count, kept like the area's facts."""
    key = (card_cache.release_id(context.reader), area_id, bedrooms)
    return RENT_CACHE.get_or_build(key, lambda: context.reader.rent_levels(bedrooms, [area_id]).get(area_id))


def clear_caches() -> None:
    AREA_CACHE.clear()
    RENT_CACHE.clear()
    POINT_CACHE.clear()
    card_cache.forget_release()


def layer_loaders(context: ToolContext, area_id: str) -> dict[str, Callable[[], Any]]:
    """How each optional layer is read; each opens its own connection, so they may run in parallel.
    Empty when the reader has no database."""
    from . import civic, flood, home, location, market

    connect = getattr(context.reader, "_connect", None)
    if connect is None:
        return {}
    return {
        "flood": lambda: flood.area_flood(context.reader, area_id, cancel=context.cancel),
        "location": lambda: _with_connection(connect, lambda c: location.location_rows(c, [area_id]).get(area_id)),
        "home": lambda: _with_connection(connect, lambda c: home.home_value(c, area_id)),
        # Deprivation, income (MSOA) and social renting, as the area page's People section reads them.
        "profile": lambda: context.reader.get_profile(area_id, datetime.date.today().strftime("%Y-%m"),
                                                      cancel=context.cancel),
        "market": lambda: market.area_market(context.reader, area_id, cancel=context.cancel),
        "civic": lambda: civic.CivicReader(connect).area(area_id, cancel=context.cancel),
    }


def load_layers(context: ToolContext, area_id: str, names: tuple[str, ...]) -> dict:
    """The named optional layers of an area, read in parallel. A layer that is not loaded (or fails) is left
    out, so the card and the results line never break on it."""
    loaders = layer_loaders(context, area_id)
    done = card_cache.run_parallel({f"layer:{name}": loaders[name] for name in names if name in loaders})
    return {name: value for name, value in _kept_layers(done, area_id).items() if name in names}


def _with_connection(connect: Callable[[], Any], read: Callable[[Any], Any]) -> Any:
    with connect() as connection:
        return read(connection)


def match_result(pack: Mapping[str, Any], area_id: str) -> dict | None:
    """One area's result in a match pack, with ``ranked``: how many areas are ranked at all."""
    values = pack.get("values", [])
    result = next((value for value in values if value["geographyId"] == area_id), None)
    if result is None:
        return None
    return {**result, "ranked": sum(1 for value in values if value.get("rank"))}


def outside_card() -> dict:
    return {"v": 1, "schemaVersion": SCHEMA_VERSION, "status": "outside-coverage", "blocks": [
        {"type": "header", "title": f"Close Knit covers {current_scope().name} only",
         "subtitle": "This home is outside our map."}]}


def build_card(request: ListingCardRequest, area_id: str, pack: Mapping[str, Any], place: Mapping[str, Any],
               around: Mapping[str, Any] | None, price: Mapping[str, Any] | None,
               match: Mapping[str, Any] | None, extras: Mapping[str, Any] | None = None,
               today: date | None = None) -> dict:
    extras = extras or {}
    title = place.get("title") or pack.get("name") or area_id
    subtitle = " · ".join(part for part in (place.get("borough"), pack.get("name") if place.get("title") else None) if part)
    profile = request.profile
    area_href = _with_ref(share_links.area_url(area_id))
    blocks: list[dict] = [{"type": "header", "title": title, "subtitle": subtitle, "href": area_href}]
    if request.locationApproximate:
        blocks.append({"type": "footnote", "text": "Approximate location: facts for the area around it."})
    personalised = bool(profile and match)
    blocks.append(match_block(match, profile) if personalised else
                  {"type": "cta", "text": "See how this area fits your priorities",
                   "label": "Personalise", "href": _with_ref(share_links.site_url() + "/")})
    position = price_position_block(request, extras.get("market"), pack)
    if position:
        blocks.append(position)
    flags = flags_block(request, extras)
    if flags:
        blocks.append(flags)
    blocks.append({"type": "facts", "rows": fact_rows(pack, around, extras.get("profile"))})
    if price:
        blocks.append(price_block(request, price))
    story = price_story_block(request, pack, today or date.today())
    if story:
        blocks.append(story)
    costs = costs_block(request, extras)
    if costs:
        blocks.append(costs)
    sections = sections_block(request, pack, around, extras, position, story, costs, match)
    if sections:
        blocks.append(sections)
    summary = summary_block(request, pack, around, extras, match, price, position, story, costs)
    if summary:
        blocks.append(summary)
    blocks.append({"type": "actions", "items": [
        # One primary action per card (DESIGN.md): Personalise until there is a match, then Save.
        {"kind": "save", "label": "Save to Close Knit", "href": save_href(request, area_id), "primary": personalised},
        {"kind": "link", "label": "Open area in Close Knit", "href": area_href}]})
    blocks.append({"type": "footnote",
                   "text": "Area evidence from official open data, not about this home. Not a valuation.",
                   "href": _with_ref(share_links.pack_url(area_id)), "label": "Sources"})
    return {"v": 1, "schemaVersion": SCHEMA_VERSION, "status": "ok", "geographyId": area_id,
            "productReleaseId": pack.get("productReleaseId"), "blocks": blocks}


def match_block(match: Mapping[str, Any], profile: Mapping[str, Any]) -> dict:
    # Utilities run 0-100, as on the site's My match.
    weighted = [c for c in match.get("components", []) if c.get("weight", 0) > 0 and c.get("utility") is not None]
    strong = sorted((c for c in weighted if c["utility"] >= STRONG), key=lambda c: -c["weight"] * c["utility"])
    weak = sorted((c for c in weighted if c["utility"] <= WEAK), key=lambda c: -c["weight"] * (100 - c["utility"]))
    cons = ([_short_limit(code, text) for code, text in zip(match.get("unmetLimits", []), describe_unmet_limits(match, profile))]
            if match.get("excluded") else [])
    cons += [CON_LABELS.get(c["factorId"]) or f"Weak on {_label(c['factorId']).lower()}" for c in weak][: max(0, 2 - len(cons))]
    block = {"type": "match", "score": match.get("score"), "pros": [_label(c["factorId"]) for c in strong[:2]],
             "cons": cons[:2], "excluded": bool(match.get("excluded"))}
    if match.get("rank") and match.get("ranked"):
        share = max(1, round(match["rank"] / match["ranked"] * 100))
        block["rankText"] = (f"Top {share}% of London for your search" if share <= 50 else
                             f"Ranks {match['rank']:,} of {match['ranked']:,} London areas for your search")
    return block


def fact_rows(pack: Mapping[str, Any], around: Mapping[str, Any] | None,
              profile: Mapping[str, Any] | None = None) -> list[dict]:
    rows = []
    crime = pack.get("crime") or {}
    if crime.get("regionPercentile") is not None:
        p = crime["regionPercentile"]
        value, tone = (("Lower than most of London", "good") if p <= 33 else
                       ("Higher than most of London", "bad") if p >= 67 else ("Around the London middle", "neutral"))
        rows.append({"label": "Crime", "value": value, "tone": tone})
    station = ((around or {}).get("stations") or [None])[0]
    if station:
        zone = f" · zone {station['zone']}" if station.get("zone") else ""
        lines = ", ".join(line["name"] for line in station.get("lines") or [] if line.get("name"))
        rows.append({"label": "Station", "value": f"{station['name']}, {station['walkMinutes']} min walk{zone}"
                     + (f" · {lines}" if lines else ""),
                     "tone": "good" if station["walkMinutes"] <= 10 else "neutral"})
    if (around or {}).get("connectivityScore"):
        score = int(around["connectivityScore"])
        rows.append({"label": "Connectivity", "value": f"{score}/10 for public transport",
                     "tone": "good" if score >= 7 else "bad" if score <= 3 else "neutral"})
    park = (around or {}).get("nearestPark")
    if park:
        size = PARK_SIZES.get(park.get("sizeClass") or "")
        rows.append({"label": "Park", "value": f"{park['name']}{f' ({size})' if size else ''}, {park['walkMinutes']} min walk",
                     "tone": "good" if park["walkMinutes"] <= 10 else "neutral"})
    schools = pack.get("schools") or {}
    if schools.get("count") is not None:
        grades = _ofsted_counts(schools.get("nearest") or [])
        rows.append({"label": "Schools", "value": f"{schools['count']} state schools within 1.5 km"
                     + (f" · {grades}" if grades else ""), "tone": "neutral"})
    noise = pack.get("noise") or {}
    if noise.get("available") and noise.get("any55Share") is not None:
        share = noise["any55Share"]
        value, tone = (("Quiet: few homes above 55 dB", "good") if share <= 0.15 else
                       ("Busy roads or rail: most homes above 55 dB", "bad") if share >= 0.5 else
                       (f"{round(share * 100)}% of homes above 55 dB", "neutral"))
        rows.append({"label": "Noise", "value": value, "tone": tone})
    return rows + people_rows(profile)


PARK_SIZES = {"local": "local park", "district": "district park", "metropolitan": "large park", "regional": "large park",
              "pocket": "small park", "small": "small park"}
OFSTED_GRADES = ("Outstanding", "Good", "Requires improvement", "Inadequate")
# A school on the new framework (from November 2025): a report card has no single grade, so it is
# counted apart from the legacy grades, never blended into them (#226).
REPORT_CARD = "Report card"


def _ofsted_counts(schools: list[Mapping[str, Any]]) -> str:
    """"2 Outstanding, 4 Good, 1 Report card" from the nearest schools' standing inspections."""
    return ", ".join(f"{n} {grade}" for grade, n in _ofsted_grades(schools).items() if n)


def _ofsted_grades(schools: list[Mapping[str, Any]]) -> dict[str, int]:
    counts = {grade: 0 for grade in OFSTED_GRADES + (REPORT_CARD,)}
    for school in schools:
        # The standing grade first; an ungraded visit ("Standards maintained") matches none
        # of the grade words, so the school used to drop out of the counts. latestInspection is the
        # fallback for payloads built without the pack's school_inspection rows.
        standing = school.get("standingInspection") or {}
        text = (standing.get("grade") or school.get("latestInspection") or "").lower()
        if standing.get("framework") == "report-card" or text.startswith("report card"):
            counts[REPORT_CARD] += 1
            continue
        grade = next((g for g in OFSTED_GRADES if g.lower() in text), None)
        if grade:
            counts[grade] += 1
    return counts


def people_rows(profile: Mapping[str, Any] | None) -> list[dict]:
    """Deprivation, income and social renting with London ratings out of 10 (owner decision)."""
    metrics = {m.get("metricId"): m for m in (profile or {}).get("metrics") or []}
    rows = []
    deprivation = metrics.get("deprivation") or {}
    if deprivation.get("regionPercentile") is not None:
        # The index decile runs 1 (most deprived) to 10: a high percentile is less deprived.
        score = _out_of_ten(deprivation["regionPercentile"])
        rows.append({"label": "Deprivation", "value": f"{score}/10 · less deprived than {deprivation['regionPercentile']}% of London",
                     "tone": "good" if score >= 7 else "bad" if score <= 3 else "neutral"})
    income = metrics.get("income") or {}
    if income.get("regionPercentile") is not None and income.get("value"):
        rows.append({"label": "Income", "value": f"{_out_of_ten(income['regionPercentile'])}/10 · £{round(income['value'] / 1000):,}k "
                     "a household a year (wider area)", "tone": "neutral"})
    social = metrics.get("social-renting") or {}
    if social.get("value") is not None:
        rows.append({"label": "Social housing", "value": f"{social['value']:.1f}% of homes"
                     + (f" · more than {social['regionPercentile']}% of London" if social.get("regionPercentile") is not None else ""),
                     "tone": "neutral"})
    return rows


# A one-year change beyond this comes from a handful of sales in a small area, not the market.
MAX_SHOWN_GROWTH = 25.0


def plausible_growth(growth: Any) -> bool:
    return isinstance(growth, (int, float)) and abs(growth) <= MAX_SHOWN_GROWTH


def _out_of_ten(percentile: float) -> int:
    return min(10, max(1, math.ceil(percentile / 10)))


def price_block(request: ListingCardRequest, price: Mapping[str, Any]) -> dict:
    verdict = price.get("verdict", "unknown")
    words = {"above-local": "above", "in-line": "in line with", "below-local": "below"}.get(verdict)
    if request.market == "rent":
        text = (f"Asking rent is {words} the borough average for this size (£{price['boroughAverageRent']:,} a month)."
                if words else price.get("note") or "No published average rent to compare with.")
        return {"type": "price", "verdict": verdict, "text": text,
                "detail": f"Referencing usually looks for £{price['incomeUsuallyNeeded']:,} a year of income."}
    median = price.get("localResaleMedianPerSqm")
    text = (f"The asking price is {words} recent sales here for this size." if words
            else price.get("note") or "Too few recorded sales here to compare.")
    detail = f"Area median £{round(median):,}/m² over 36 months of recorded sales." if median else None
    return {"type": "price", "verdict": verdict, "text": text, "detail": detail}


# Land Registry property types the area's sales are split by; a bungalow or "other" has no match.
HOME_TYPES = {"flat": ("F", "flat"), "terraced": ("T", "terraced house"),
              "semi-detached": ("S", "semi-detached house"), "detached": ("D", "detached house")}
TYPE_WORDS = {"flat": "Flat", "terraced": "Terraced", "semi-detached": "Semi-detached", "detached": "Detached",
              "bungalow": "Bungalow", "other": "Other"}
TENURE_WORDS = {"freehold": "Freehold", "leasehold": "Leasehold", "share-of-freehold": "Share of freehold"}
MIN_TYPE_SALES = 5
SHORT_LEASE_YEARS = 80
PRESENCE_WORDS = {"inside": "Inside", "partly": "Partly", "outside": "Outside"}


def price_position_block(request: ListingCardRequest, market: Mapping[str, Any] | None,
                         pack: Mapping[str, Any]) -> dict | None:
    """Where the asking price sits among the last 12 months' sales of the same type here: a coarse bucket of
    the area's spread, never a figure for this home. Omitted under MIN_TYPE_SALES sales."""
    kind = HOME_TYPES.get(request.propertyType)
    if request.market != "buy" or request.locationApproximate or kind is None or not (market or {}).get("available"):
        return None
    code, noun = kind
    entry = next((row for row in market.get("byType") or [] if row["propertyType"] == code), None)
    if (not entry or entry["sales"] < MIN_TYPE_SALES
            or None in (entry.get("p25"), entry.get("medianPrice"), entry.get("p75"))):
        return None
    q1, median, q3 = entry["p25"], entry["medianPrice"], entry["p75"]
    basis = market.get("basis") or {}
    where = f"in the wider {basis['name']} area" if basis.get("widened") and basis.get("name") else "here"
    asking = request.askingPrice
    bucket = None if asking is None else 0 if asking < q1 else 1 if asking < median else 2 if asking <= q3 else 3
    label = (f"{noun.capitalize()} sales {where}: middle half £{q1:,}–£{q3:,}" if bucket is None else
             ["Below most", "Lower middle of", "Upper middle of", "Above most"][bucket] + f" {noun} sales {where}")
    block = {"type": "pricePosition", "homeType": request.propertyType, "bucket": bucket, "label": label,
             "sales": entry["sales"], "q1": q1, "median": median, "q3": q3}
    area = ((pack.get("market") or {}).get("resale") or {}).get("medianPricePerSquareMetre")
    if asking and request.floorAreaSqm and area:
        per_sqm = asking / request.floorAreaSqm
        block["perSqm"] = {"asking": round(per_sqm), "area": round(area), "band": per_sqm_band(per_sqm / area - 1)}
    return block


def per_sqm_band(difference: float) -> str:
    """The asking £/m² against the area's resale median, as a share above (+) or below (-)."""
    size = abs(difference)
    if size <= 0.10:
        return "in-line"
    side = "above" if difference > 0 else "below"
    return f"10-25-{side}" if size <= 0.25 else f"over-25-{side}"


def price_story_block(request: ListingCardRequest, pack: Mapping[str, Any], today: date) -> dict | None:
    """How long the listing has been up and how its price moved, from the page and the device's own memory."""
    changes, seen = request.priceChanges, request.firstSeen
    if not (request.listedOn or changes or seen):
        return None
    block: dict[str, Any] = {"type": "priceStory", "changes": [change.model_dump() for change in changes]}
    parts = []
    if request.listedOn:
        days = (today - date.fromisoformat(request.listedOn)).days
        if days >= 0:
            block["listedOn"], block["daysOnMarket"] = request.listedOn, days
            parts.append("Listed today" if days == 0 else f"On the market {days} day{'' if days == 1 else 's'}")
    if changes:
        count = len(changes)
        parts.append(f"Price changed {'once' if count == 1 else f'{count} times'}, last on {_day(changes[-1].date)}")
    if seen:
        block["firstSeen"] = seen.model_dump()
        delta = (request.askingPrice or seen.price) - seen.price
        parts.append(f"Same price since you first saw it on {_day(seen.date)}" if delta == 0 else
                     f"{'Down' if delta < 0 else 'Up'} £{abs(delta):,} since you first saw it on {_day(seen.date)}")
    turnover = (pack.get("market") or {}).get("turnoverPercent")
    if turnover is not None:
        block["areaTurnoverPct"] = turnover
        parts.append(f"About {turnover:.1f}% of recorded homes here sell each year")
    block["text"] = ". ".join(parts) + "."
    return block


def costs_block(request: ListingCardRequest, extras: Mapping[str, Any]) -> dict | None:
    """Monthly and upfront costs on the user's own assumptions (buying only)."""
    if request.market != "buy" or not request.askingPrice:
        return None
    assumptions = (request.buyer or BuyerAssumptions()).model_dump()
    council_tax = listing_costs.council_tax_yearly(extras.get("civic"), request.councilTaxBand)
    block = listing_costs.costs_block(request.askingPrice, assumptions, council_tax, request.serviceChargeYearly,
                                      request.groundRentYearly, cost_chips(extras))
    return {**block, "councilTaxByBand": listing_costs.council_tax_by_band(extras.get("civic"))}


def cost_chips(extras: Mapping[str, Any]) -> list[str]:
    chips = []
    ulez = (((extras.get("location") or {}).get("ulez")) or {}).get("presence")
    if ulez in ("inside", "partly"):
        chips.append("Inside ULEZ" if ulez == "inside" else "Partly in ULEZ")
    broadband = (extras.get("home") or {}).get("broadband") or {}
    if broadband.get("share") is not None:
        chips.append(f"Gigabit for {_pct(broadband['share'])} of homes")
    return chips


def flags_block(request: ListingCardRequest, extras: Mapping[str, Any]) -> dict | None:
    """Things the listing does not say: flood, a short lease, conservation rules, the ULEZ. Bad ones first."""
    items = []
    lease = request.leaseYearsRemaining
    if lease is not None and lease < SHORT_LEASE_YEARS:
        items.append({"text": f"Lease has {lease} years left: under 80 makes extending it dearer and "
                              "some lenders say no", "tone": "bad"})
    flood = extras.get("flood") or {}
    for key, source in (("riversSea", "rivers or the sea"), ("surfaceWater", "surface water")):
        bands = flood.get(key) if flood.get("available") else None
        band = (bands or {}).get("highestBand")
        if band in ("high", "medium"):
            items.append({"text": f"{_pct(bands['shares'][band])} of the land here is at {band} risk of "
                                  f"flooding from {source}", "tone": "bad" if band == "high" else "neutral"})
    location = extras.get("location") or {}
    conservation = location.get("conservation") or {}
    if conservation.get("presence") in ("inside", "partly"):
        names = [area["name"] for area in conservation.get("areas") or []]
        named = f" ({names[0]})" if names else ""
        items.append({"text": (f"In a conservation area{named}: extensions are limited"
                               if conservation["presence"] == "inside" else
                               f"{_pct(conservation['share'])} of the area is in a conservation area{named}"),
                      "tone": "neutral"})
    ulez = (location.get("ulez") or {}).get("presence")
    if ulez in ("inside", "partly"):
        items.append({"text": ("Inside the ULEZ: older petrol and diesel cars pay a daily charge" if ulez == "inside"
                               else "On the ULEZ boundary: part of the area is inside the charge"), "tone": "neutral"})
    items.sort(key=lambda item: item["tone"] != "bad")
    return {"type": "flags", "items": items} if items else None


def sections_block(request: ListingCardRequest, pack: Mapping[str, Any], around: Mapping[str, Any] | None,
                   extras: Mapping[str, Any], position: Mapping[str, Any] | None, story: Mapping[str, Any] | None,
                   costs: Mapping[str, Any] | None, match: Mapping[str, Any] | None = None) -> dict | None:
    """The "everything" panel: what the card already knows, in five columns."""
    columns = [
        {"title": "This home", "rows": home_rows(request)},
        {"title": "Costs", "rows": cost_rows(request, costs)},
        {"title": "Getting around", "rows": place_rows(match, request.profile) + around_rows(around, extras.get("location"))},
        {"title": "The area", "rows": area_rows(pack, extras)},
        {"title": "Before you offer", "rows": offer_rows(request, position, story, extras)},
    ]
    columns = [column for column in columns if column["rows"]]
    return {"type": "sections", "columns": columns} if columns else None


def home_rows(request: ListingCardRequest) -> list[dict]:
    rows = []
    if request.propertyType in TYPE_WORDS:
        rows.append({"label": "Type", "value": TYPE_WORDS[request.propertyType]})
    if request.bedrooms is not None:
        rows.append({"label": "Bedrooms", "value": "Studio" if request.bedrooms == 0 else str(request.bedrooms)})
    if request.floorAreaSqm:
        per = (f" · £{request.askingPrice / request.floorAreaSqm:,.0f}/m² asking"
               if request.askingPrice and request.market == "buy" else "")
        rows.append({"label": "Floor area", "value": f"{request.floorAreaSqm:,.0f} m²{per}"})
    if request.tenure in TENURE_WORDS:
        rows.append({"label": "Tenure", "value": TENURE_WORDS[request.tenure]})
    if request.leaseYearsRemaining is not None:
        rows.append({"label": "Lease", "value": f"{request.leaseYearsRemaining} years left",
                     "tone": "bad" if request.leaseYearsRemaining < SHORT_LEASE_YEARS else "neutral"})
    if request.epcRating:
        rows.append({"label": "EPC", "value": f"{request.epcRating} (as listed)",
                     "tone": "bad" if request.epcRating in ("F", "G") else "neutral"})
    if request.councilTaxBand:
        rows.append({"label": "Council tax", "value": f"Band {request.councilTaxBand}"})
    return rows


def cost_rows(request: ListingCardRequest, costs: Mapping[str, Any] | None) -> list[dict]:
    if request.market == "rent":
        return [{"label": "Rent", "value": f"£{request.askingPrice:,} a month"}] if request.askingPrice else []
    if not costs:
        return []
    rows = [{"label": "Each month", "value": f"£{costs['monthly']:,}"}]
    rows += [{"label": part["label"], "value": f"£{part['amount']:,} a month"} for part in costs["parts"]]
    rows += [{"label": part["label"], "value": f"£{part['amount']:,} upfront"} for part in costs["upfront"]]
    return rows


def place_rows(match: Mapping[str, Any] | None, profile: Mapping[str, Any] | None) -> list[dict]:
    """Minutes from this area to each place in the search (work, school, gym), against the limit set for it."""
    rows = []
    for label, minutes, target in _place_minutes(match, profile):
        rows.append({"label": label, "value": f"{round(minutes)} min" + (f" (you said {target})" if target else ""),
                     "tone": "good" if target and minutes <= target else "bad" if target else "neutral"})
    return rows


def _place_minutes(match: Mapping[str, Any] | None, profile: Mapping[str, Any] | None) -> list[tuple[str, float, Any]]:
    """(label, minutes, the limit set for it or None) for each place in the search."""
    labels = {f"place:{place['id']}": place.get("label") for place in (profile or {}).get("places") or []}
    out = []
    for component in (match or {}).get("components") or []:
        label = labels.get(component.get("factorId"))
        minutes = component.get("rawValue")
        if label and component.get("unit") == "minutes" and minutes is not None:
            out.append((label, minutes, component.get("targetMinutes")))
    return out


def around_rows(around: Mapping[str, Any] | None, location: Mapping[str, Any] | None) -> list[dict]:
    rows = []
    for station in ((around or {}).get("stations") or [])[:3]:
        zone = f" · zone {station['zone']}" if station.get("zone") else ""
        lines = ", ".join(line["name"] for line in station.get("lines") or [] if line.get("name"))
        rows.append({"label": station["name"], "value": f"{station['walkMinutes']} min walk{zone}" + (f" · {lines}" if lines else ""),
                     "tone": "good" if station["walkMinutes"] <= 10 else "neutral"})
    if (around or {}).get("connectivityScore"):
        rows.append({"label": "Connectivity", "value": f"{int(around['connectivityScore'])}/10 for public transport"})
    park = (around or {}).get("nearestPark")
    if park:
        size = PARK_SIZES.get(park.get("sizeClass") or "")
        rows.append({"label": "Park", "value": f"{park['name']}{f' ({size})' if size else ''}, {park['walkMinutes']} min walk"})
    for key, label in (("ulez", "ULEZ"), ("congestionCharge", "Congestion charge")):
        presence = ((location or {}).get(key) or {}).get("presence")
        if presence in PRESENCE_WORDS:
            rows.append({"label": label, "value": PRESENCE_WORDS[presence]})
    return rows


def area_rows(pack: Mapping[str, Any], extras: Mapping[str, Any]) -> list[dict]:
    rows = fact_rows(pack, None, extras.get("profile"))
    market = pack.get("market") or {}
    if market.get("turnoverPercent") is not None:
        rows.append({"label": "Homes sold",
                     "value": f"{market['turnoverPercent']:.1f}% a year of recorded homes"})
    if market.get("leaseholdShareOfSales") is not None:
        rows.append({"label": "Leasehold", "value": f"{_pct(market['leaseholdShareOfSales'])} of sales"})
    broadband = (extras.get("home") or {}).get("broadband") or {}
    if broadband.get("share") is not None:
        rows.append({"label": "Gigabit", "value": f"{_pct(broadband['share'])} of homes"})
    conservation = ((extras.get("location") or {}).get("conservation")) or {}
    if conservation.get("share") is not None:
        rows.append({"label": "Conservation", "value": f"{_pct(conservation['share'])} of the land"})
    flood = extras.get("flood") or {}
    for key, label in (("riversSea", "Flood: rivers"), ("surfaceWater", "Flood: surface")):
        band = ((flood.get(key) if flood.get("available") else None) or {}).get("highestBand")
        if band:
            rows.append({"label": label, "value": band.replace("-", " ").capitalize(),
                         "tone": "bad" if band == "high" else "neutral"})
    return rows


def offer_rows(request: ListingCardRequest, position: Mapping[str, Any] | None, story: Mapping[str, Any] | None,
               extras: Mapping[str, Any]) -> list[dict]:
    rows = []
    if position and position.get("bucket") is not None:
        rows.append({"label": "Asking price", "value": position["label"]})
    if story and story.get("daysOnMarket") is not None:
        rows.append({"label": "On the market", "value": f"{story['daysOnMarket']} days"})
    if story and story.get("changes"):
        rows.append({"label": "Price changes", "value": str(len(story["changes"]))})
    asks = []
    if request.market == "buy" and request.tenure == "unknown":
        asks.append("Tenure")
    if request.tenure in ("leasehold", "share-of-freehold"):
        if request.leaseYearsRemaining is None:
            asks.append("Years left on the lease")
        if request.serviceChargeYearly is None:
            asks.append("Service charge")
        if request.groundRentYearly is None:
            asks.append("Ground rent")
    if request.councilTaxBand is None:
        asks.append("Council tax band")
    if request.epcRating is None:
        asks.append("EPC rating")
    rows += [{"label": "Ask", "value": ask} for ask in asks]
    extend = (extras.get("home") or {}).get("extend") or {}
    listed = (extend.get("listed") or {}).get("total")
    if listed is not None:
        rows.append({"label": "Listed buildings", "value": f"{listed} in the area" if listed else "None in the area"})
    if extend.get("article4Data") == "not-published":
        rows.append({"label": "Article 4", "value": "Not published by the council: ask"})
    elif extend.get("article4Share") is not None:
        rows.append({"label": "Article 4", "value": f"{_pct(extend['article4Share'])} of the area" if extend["article4Share"] else "None"})
    planning = (extras.get("location") or {}).get("planning") or {}
    if planning.get("applications") is not None:
        median = f" (London {planning['regionMedian']})" if planning.get("regionMedian") is not None else ""
        rows.append({"label": "Planning", "value": f"{planning['applications']} applications in 2 years{median}"})
    if (extras.get("flood") or {}).get("available"):
        rows.append({"label": "Check", "value": "This home's own flood risk (gov.uk)"})
    return rows


BUCKET_WORDS = ("Below most", "Lower middle of", "Upper middle of", "Above most")


def summary_block(request: ListingCardRequest, pack: Mapping[str, Any], around: Mapping[str, Any] | None,
                  extras: Mapping[str, Any], match: Mapping[str, Any] | None, price: Mapping[str, Any] | None,
                  position: Mapping[str, Any] | None, story: Mapping[str, Any] | None,
                  costs: Mapping[str, Any] | None) -> dict | None:
    """The compact panel the extension puts in the page under the portal's price: up to four groups led by what
    only Close Knit has ("only"), then shared basics as pills with a band from 1 (weak) to 5 (strong) or null."""
    groups = [
        {"title": "For your search", "only": True, "rows": search_rows(match, request.profile)},
        {"title": "The price", "only": True, "rows": summary_price_rows(request, pack, price, position, story)},
        {"title": "The money", "only": False, "rows": money_rows(request, costs)},
        {"title": "Before you offer", "only": True, "rows": before_offer_rows(extras)},
    ]
    groups = [group for group in groups if group["rows"]]
    pills = summary_pills(pack, around, extras)
    return {"type": "summary", "groups": groups, "pills": pills} if groups or pills else None


def search_rows(match: Mapping[str, Any] | None, profile: Mapping[str, Any] | None) -> list[dict]:
    """The verdict for the saved search, then minutes to each of its places. Empty without a profile."""
    if not (match and profile):
        return []
    if match.get("excluded"):
        count = len(match.get("unmetLimits") or [])
        verdict = {"value": f"Misses {count} of your limits" if count else "Misses your limits", "tone": "bad"}
    elif match.get("rank") and match.get("ranked"):
        share = max(1, round(match["rank"] / match["ranked"] * 100))
        verdict = ({"value": f"Top {share}% of London for your search", "tone": "good"} if share <= 50 else
                   {"value": f"Ranks {match['rank']:,} of {match['ranked']:,} in London", "tone": "neutral"})
    elif match.get("score") is not None:
        verdict = {"value": f"{round(match['score'])}/100 for your search", "tone": "neutral"}
    else:
        verdict = None
    rows = [{"label": "Fit", **verdict}] if verdict else []
    for label, minutes, target in _place_minutes(match, profile):
        met = target is not None and minutes <= target
        rows.append({"label": label, "value": f"{round(minutes)} min" + (f" · you said {target} {'✓' if met else '✕'}"
                                                                         if target else ""),
                     "tone": "good" if met else "bad" if target else "neutral"})
    return rows


def summary_price_rows(request: ListingCardRequest, pack: Mapping[str, Any], price: Mapping[str, Any] | None,
                       position: Mapping[str, Any] | None, story: Mapping[str, Any] | None) -> list[dict]:
    rows = []
    if position and position.get("bucket") is not None:
        bucket = position["bucket"]
        noun = TYPE_WORDS[position["homeType"]].lower()
        rows.append({"label": "Vs sales", "value": f"{BUCKET_WORDS[bucket]} {position['sales']} {noun} sales",
                     "tone": "good" if bucket == 0 else "bad" if bucket == 3 else "neutral"})
    if request.market == "rent" and price and price.get("boroughAverageRent"):
        words = {"above-local": "Above", "in-line": "In line with", "below-local": "Below"}.get(price.get("verdict"))
        if words:
            rows.append({"label": "Vs borough", "value": f"{words} average £{price['boroughAverageRent']:,}",
                         "tone": "neutral"})
    per_sqm = (position or {}).get("perSqm") or _per_sqm(request, pack)
    if per_sqm:
        band = per_sqm["band"]
        rows.append({"label": "£/m²", "value": f"£{per_sqm['asking']:,} asking · area £{per_sqm['area']:,}",
                     "tone": "bad" if band == "over-25-above" else "good" if band.endswith("below") else "neutral"})
    market_row = _on_market_value(request, story)
    if market_row:
        rows.append({"label": "On the market", "value": market_row, "tone": "neutral"})
    growth = ((pack.get("market") or {}).get("growth") or {}).get("growth1y")
    if plausible_growth(growth):
        rows.append({"label": "Area prices", "value": f"{growth:+.1f}% in a year", "tone": "neutral"})
    return rows


def _per_sqm(request: ListingCardRequest, pack: Mapping[str, Any]) -> dict | None:
    area = ((pack.get("market") or {}).get("resale") or {}).get("medianPricePerSquareMetre")
    if request.market != "buy" or request.locationApproximate or not (request.askingPrice and request.floorAreaSqm and area):
        return None
    per_sqm = request.askingPrice / request.floorAreaSqm
    return {"asking": round(per_sqm), "area": round(area), "band": per_sqm_band(per_sqm / area - 1)}


def _on_market_value(request: ListingCardRequest, story: Mapping[str, Any] | None) -> str | None:
    """"17 days · down £25,000": days listed and the change from the first known price to the asking price."""
    if not story:
        return None
    parts = []
    if story.get("daysOnMarket") is not None:
        parts.append(f"{story['daysOnMarket']} day{'' if story['daysOnMarket'] == 1 else 's'}")
    known = request.priceChanges[:1] + ([request.firstSeen] if request.firstSeen else [])
    if known:
        first = min(known, key=lambda point: point.date)
        latest = request.askingPrice or (request.priceChanges[-1].price if request.priceChanges else first.price)
        delta = latest - first.price
        if delta:
            parts.append(f"{'down' if delta < 0 else 'up'} £{abs(delta):,}")
    return " · ".join(parts) if parts else None


def money_rows(request: ListingCardRequest, costs: Mapping[str, Any] | None) -> list[dict]:
    """A month all in, the upfront money, council tax and the assumptions behind them (buying only)."""
    if request.market != "buy" or not costs:
        return []
    upfront = {part["label"]: part["amount"] for part in costs["upfront"]}
    rows = [{"label": "A month", "value": f"£{costs['monthly']:,} all in", "tone": "neutral"},
            {"label": "Upfront", "value": f"£{upfront['Deposit']:,} deposit · £{upfront['Stamp duty']:,} stamp duty",
             "tone": "neutral"}]
    tax = next((part["amount"] for part in costs["parts"] if part["label"] == "Council tax"), None)
    band = request.councilTaxBand
    rows.append({"label": "Council tax", "tone": "neutral", "value": (
        f"£{tax:,} a month (band {band})" if tax else f"Band {band}" if band else "Band not listed: ask")})
    a = costs.get("assumptions") or {}
    if a:
        who = [w for w, on in (("first-time buyer", a.get("firstTime")), ("additional home", a.get("additionalHome"))) if on]
        rows.append({"label": "Assumes", "tone": "neutral", "value": " · ".join(
            [f"{a['depositPct']:g}% deposit", f"{a['ratePct']:g}% over {a['years']} years", *who])})
    return rows


def _offer_facts(extras: Mapping[str, Any]) -> dict:
    """The facts behind "Before you offer": flood (medium or high only), conservation, listed buildings,
    Article 4 and planning; shared by the card's rows and the results line's short items."""
    flood = extras.get("flood") or {}
    floods = []
    for key, source in (("surfaceWater", "surface"), ("riversSea", "rivers")):
        bands = flood.get(key) if flood.get("available") else None
        band = (bands or {}).get("highestBand")
        if band in ("high", "medium"):
            floods.append((source, band, bands["shares"][band]))
    location = extras.get("location") or {}
    conservation = location.get("conservation") or {}
    extend = (extras.get("home") or {}).get("extend") or {}
    planning = location.get("planning") or {}
    return {
        "floods": floods,
        "conservation": ((conservation["presence"], conservation.get("share"),
                          next((area["name"] for area in conservation.get("areas") or []), None))
                         if conservation.get("presence") in ("inside", "partly") else None),
        "listed": (extend.get("listed") or {}).get("total"),
        "article4": "ask" if extend.get("article4Data") == "not-published" else extend.get("article4Share"),
        "planning": ((planning["applications"], planning.get("regionMedian"))
                     if planning.get("applications") is not None else None),
    }


def before_offer_rows(extras: Mapping[str, Any]) -> list[dict]:
    """What the listing does not say: flood (medium or high only), conservation, listed buildings and Article 4,
    planning against the London median."""
    facts = _offer_facts(extras)
    rows = [{"label": f"Flood: {source}", "value": f"{_pct(share)} of land at {band} risk",
             "tone": "bad" if band == "high" else "neutral"} for source, band, share in facts["floods"]]
    if facts["conservation"]:
        presence, share, name = facts["conservation"]
        where = "Inside" if presence == "inside" else f"{_pct(share)} of the area"
        rows.append({"label": "Conservation", "value": where + (f" · {name}" if name else ""), "tone": "neutral"})
    parts = []
    if facts["listed"] is not None:
        parts.append(f"{facts['listed']} listed" if facts["listed"] else "None listed")
    if facts["article4"] == "ask":
        parts.append("Article 4: ask")
    elif facts["article4"] is not None:
        parts.append(f"Article 4 on {_pct(facts['article4'])}" if facts["article4"] else "No Article 4")
    if parts:
        rows.append({"label": "Listed · Art. 4", "value": " · ".join(parts), "tone": "neutral"})
    if facts["planning"]:
        applications, median = facts["planning"]
        rows.append({"label": "Planning", "value": f"{applications} in 2 years"
                     + (f" · London {median}" if median is not None else ""), "tone": "neutral"})
    return rows


def offer_items(extras: Mapping[str, Any]) -> list[dict]:
    """"Before you offer" in a few words for the results line, only what is there (no "None listed").
    Bands as the pills: high flood 1, medium 2, the rest neutral."""
    facts = _offer_facts(extras)
    items = [{"label": "Flood", "value": f"{source} {band}", "band": 1 if band == "high" else 2}
             for source, band, _ in facts["floods"]]
    if facts["conservation"]:
        presence, share, name = facts["conservation"]
        where = "inside" if presence == "inside" else _pct(share)
        items.append({"label": "Conservation", "value": where + (f" · {name}" if name else ""), "band": None})
    if facts["listed"]:
        items.append({"label": "Listed", "value": str(facts["listed"]), "band": None})
    if facts["article4"] == "ask":
        items.append({"label": "Article 4", "value": "ask", "band": None})
    elif facts["article4"]:
        items.append({"label": "Article 4", "value": _pct(facts["article4"]), "band": None})
    if facts["planning"]:
        applications, median = facts["planning"]
        items.append({"label": "Planning", "value": f"{applications}" + (f" · London {median}" if median is not None else ""),
                      "band": None})
    return items


OFSTED_SHORT = {"Outstanding": "Out", "Good": "Good", "Requires improvement": "RI", "Inadequate": "Inad",
                "Report card": "RC"}


def summary_pills(pack: Mapping[str, Any], around: Mapping[str, Any] | None, extras: Mapping[str, Any],
                  compact: bool = False) -> list[dict]:
    """Shared basics as pills. Scores are out of 10 against London (band = half the score, rounded up);
    walking minutes band as 5 (≤5), 4 (≤10), 3 (≤15), 2 (≤20), else 1. ``compact`` is the results line's
    wording ("1 Out · 9 Good", "9′ West Hampstead TL") with the same pills and bands."""
    pills = []
    crime = pack.get("crime") or {}
    if crime.get("regionPercentile") is not None:
        # The percentile ranks crime (high = more), so safety is its flip.
        pills.append(_score_pill("Safety", _out_of_ten(100 - crime["regionPercentile"])))
    schools = pack.get("schools") or {}
    grades = _ofsted_grades(schools.get("nearest") or [])
    graded = sum(n for g, n in grades.items() if g != REPORT_CARD)
    if sum(grades.values()):
        # The band reads the legacy grades only: a report card has no single grade (#226).
        good = (grades["Outstanding"] + grades["Good"]) / graded if graded else None
        pills.append({"label": "Schools", "band": None if good is None else 5 if good >= 0.9 else 4 if good >= 0.75 else 3 if good >= 0.5 else 2 if good >= 0.25 else 1,
                      "value": " · ".join(f"{n} {OFSTED_SHORT[g] if compact else g}" for g, n in grades.items() if n)})
    elif schools.get("count") is not None:
        pills.append({"label": "Schools", "value": f"{schools['count']} {'in' if compact else 'within'} 1.5 km", "band": None})
    station = ((around or {}).get("stations") or [None])[0]
    if station:
        pills.append(_minutes_pill("Station", station["walkMinutes"], compact,
                                   short_station(station.get("name") or "") if compact else ""))
    noise = pack.get("noise") or {}
    if noise.get("available") and noise.get("any55Share") is not None:
        # Quiet: the share of homes under 55 dB of road and rail noise, in tenths (rounded up).
        pills.append(_score_pill("Quiet", _out_of_ten((1 - noise["any55Share"]) * 100)))
    park = (around or {}).get("nearestPark")
    if park:
        pills.append(_minutes_pill("Park", park["walkMinutes"], compact))
    if (around or {}).get("connectivityScore"):
        pills.append(_score_pill("Connectivity", min(10, max(1, int(around["connectivityScore"])))))
    metrics = {m.get("metricId"): m for m in (extras.get("profile") or {}).get("metrics") or []}
    for metric_id, label in (("deprivation", "Deprivation"), ("income", "Income")):
        percentile = (metrics.get(metric_id) or {}).get("regionPercentile")
        if percentile is not None:
            pills.append(_score_pill(label, _out_of_ten(percentile)))
    social = (metrics.get("social-renting") or {}).get("value")
    if social is not None:
        pills.append({"label": "Social housing", "value": f"{social:.0f}%", "band": None})
    broadband = ((extras.get("home") or {}).get("broadband") or {}).get("share")
    if broadband is not None:
        pills.append({"label": "Gigabit", "value": _pct(broadband), "band": None})
    return pills


# What a station's name can lose on a chip.
STATION_SUFFIX = re.compile(r"\s+(?:(?:underground|overground|rail|dlr|tram)\s+)?station$", re.IGNORECASE)


def short_station(name: str) -> str:
    """"West Hampstead Thameslink" -> "West Hampstead TL"; "Bank Underground Station" -> "Bank"."""
    return re.sub(r"\bThameslink\b", "TL", STATION_SUFFIX.sub("", name.strip()))


def _score_pill(label: str, score: int) -> dict:
    return {"label": label, "value": f"{score}/10", "band": max(1, math.ceil(score / 2))}


def _minutes_pill(label: str, minutes: float, compact: bool = False, where: str = "") -> dict:
    band = 5 if minutes <= 5 else 4 if minutes <= 10 else 3 if minutes <= 15 else 2 if minutes <= 20 else 1
    value = (f"{round(minutes)}′" + (f" {where}" if where else "")) if compact else f"{round(minutes)} min"
    return {"label": label, "value": value, "band": band}


def _day(value: str) -> str:
    day = date.fromisoformat(value)
    return f"{day.day} {day:%b %Y}"


def _pct(share: float) -> str:
    return f"{round(share * 100)}%"


def save_href(request: ListingCardRequest, area_id: str) -> str:
    """A link that saves the listing as an unverified candidate on the site (AE-29)."""
    payload = {"url": request.url, "address": request.address, "market": request.market,
               "askingPrice": request.askingPrice, "bedrooms": request.bedrooms,
               "floorAreaSqm": request.floorAreaSqm, "geographyId": area_id, "portal": request.portal}
    body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{share_links.site_url()}/save-listing?{REF}#listing=v1.{body}"


def _assess_args(request: ListingCardRequest) -> AssessListingInput:
    return AssessListingInput.model_construct(
        postcode=request.postcode or "", asking_price=request.askingPrice, market=request.market,
        bedrooms=request.bedrooms, floor_area_sqm=request.floorAreaSqm, tenure=request.tenure,
        listing_url=request.url)


def _label(factor_id: str) -> str:
    if factor_id.startswith("place:"):
        kind = _place_kind(factor_id)
        return f"{kind.capitalize()} nearby" if kind else "Commute"
    return FACTOR_LABELS.get(factor_id) or factor_id.replace("-", " ").capitalize()


# Kinds of "nearest" place a profile can pin; any other place: id is a named place (a commute).
PLACE_KINDS = ("school", "gym", "park", "pool", "supermarket", "cafe", "station")


def _place_kind(factor_id: str) -> str | None:
    rest = factor_id.split(":", 1)[1]
    return next((kind for kind in PLACE_KINDS if kind in rest), None)


def _short_limit(code: str, text: str) -> str:
    """A chip-sized name for an unmet limit; the full sentence stays on the site."""
    factor = limit_id(code)
    if factor == "zone":
        return "Outside your zones"
    if factor.startswith("place:"):
        kind = _place_kind(factor) or ("school" if "school" in text.lower() else None)
        return f"{kind.capitalize()} too far" if kind else "Long commute"
    return CON_LABELS.get(factor) or (text if len(text) <= 32 else f"Misses your {_label(factor).lower()} limit")


def _with_ref(url: str) -> str:
    base, hash_mark, fragment = url.partition("#")
    joined = f"{base}{'&' if '?' in base else '?'}{REF}"
    return joined + (hash_mark + fragment if hash_mark else "")
