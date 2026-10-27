"""The compact line under each search result on the portals (POST /api/v1/listing-badges).

The extension sends up to 30 results of a search page at once (docs/superpowers/specs/
2026-10-18-extension-gaps.md, "Batch"). Each result's area is resolved as the listing card does;
results in the same area share one lookup (kept for an hour), and the saved profile's match pack is built
at most once per request. Without a profile the score is the area's own /10: the mean of its London
ratings (the site's Overview rule, web/src/lib/rating.ts). Nothing about the listings is stored.

The line is a small copy of the card's summary panel, in three rows, never saying a thing twice:
- ``chips``: what only Close Knit has. The limits the area misses (or, when it fits, one weak factor no pill
  shows), minutes to each of the search's places, the asking price's position, the monthly mortgage, days
  on the market and the area's price change over a year. A chip is {text, band (1-5, bad -> good; None:
  neutral), kind}. Older extensions draw only this row.
- ``pills``: the card's summary pills, worded short (listing_card.summary_pills, compact).
- ``offer``: "Before you offer" in a few words (listing_card.offer_items).
"""
from __future__ import annotations

import logging
import math
from datetime import date
from typing import Any, Callable, Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, create_model

from . import evidence, places, standouts, zones
from .home_search import _getting_around
from . import card_cache
from .listing_card import (plausible_growth, CON_LABELS, WEAK, ListingCardRequest, _short_limit, area_part, clear_caches,
                           offer_items, resolve_area, summary_pills)
from .listing_costs import monthly_repayment
from .matching import describe_unmet_limits
from .toolspec import ToolContext

logger = logging.getLogger(__name__)

MAX_ITEMS = 30
MIN_RATINGS = 3
MIN_TYPE_SALES = 5
CACHE_SECONDS = 60 * 60
CACHE_LIMIT = 5_000
# The listing facts a result carries: the same rules as the card's request.
ITEM_FIELDS = ("listingId", "url", "lat", "lng", "postcode", "market", "askingPrice", "bedrooms", "propertyType",
               "listedOn")
PRICE_PAID_TYPES = {"flat": "F", "terraced": "T", "semi-detached": "S", "detached": "D"}
# The rating -> what the legacy ``flag`` says when the area is weak on it (score 3 or lower).
AREA_FLAGS = {"safety": "Higher crime", "station": "Far from a station", "schools": "Weaker schools nearby",
              "quiet": "Noisy", "green": "Little green space"}
PRICE_WORDS = ("below most sales", "lower middle", "upper middle", "above most")
# The monthly cost chip: a repayment mortgage at 10% deposit, 4.5%, 30 years.
MORTGAGE = {"depositPct": 10, "ratePct": 4.5, "years": 30}
# A weak match factor the pills already show (by their label): its flag would say it twice.
PILL_OF_FACTOR = {"crime": "Safety", "noise": "Quiet", "station-access": "Station", "schools": "Schools",
                  "green-space": "Park", "deprivation": "Deprivation"}
MAX_PLACES = 3
MAX_MISSES = 3
# Station codes Londoners use ("KX"), from the place search's aliases, as a place's short label.
STATION_CODES: dict[str, str] = {}
for _alias, _name in zones.STATION_ALIASES.items():
    key = zones.station_name_key(_name)
    # The shortest code wins: "KX" over "KXSP".
    if len(_alias) <= 4 and " " not in _alias and len(_alias) < len(STATION_CODES.get(key, "?????")):
        STATION_CODES[key] = _alias.upper()
# Londoners say "KX" for King's Cross St Pancras too.
STATION_CODES[zones.station_name_key("King's Cross St Pancras")] = "KX"
SHORT_PLACE = 10

BadgeItem = create_model(  # type: ignore[call-overload]
    "BadgeItem", __config__=ConfigDict(extra="forbid"),
    **{name: (ListingCardRequest.model_fields[name].annotation, ListingCardRequest.model_fields[name])
       for name in ITEM_FIELDS})


class ListingBadgesRequest(BaseModel):
    model_config = {"extra": "forbid"}

    v: Literal[1] = 1
    portal: Literal["rightmove", "zoopla", "onthemarket", "spareroom", "openrent"]
    items: list[BadgeItem] = Field(max_length=MAX_ITEMS)  # type: ignore[valid-type]
    profile: dict | None = Field(default=None, description="The saved preference profile, as POST /api/v1/matches.")


# The line's facts per (release, area), built on the card's cached area part (listing_card.area_part).
_cache = card_cache.TTLCache(limit=CACHE_LIMIT, seconds=CACHE_SECONDS)
# Areas of one results page read at once (each reads its layers on up to card_cache.LAYER_WORKERS connections).
AREA_WORKERS = 2
RESOLVE_WORKERS = 4


def clear_cache() -> None:
    _cache.clear()
    clear_caches()


def rating(percentile: Any, higher_is_better: bool) -> int | None:
    """clamp(ceil(p/10), 1, 10) of the percentile, flipped when lower is better; None without one."""
    if not isinstance(percentile, (int, float)) or not 0 <= percentile <= 100:
        return None
    share = percentile if higher_is_better else 100 - percentile
    return min(10, max(1, math.ceil(share / 10)))


def area_ratings(crime: Mapping[str, Any] | None, ranks: Mapping[str, Any] | None) -> dict[str, int]:
    ranks = ranks or {}

    def percentile(key: str) -> Any:
        return (ranks.get(key) or {}).get("percentile")

    found = {"safety": rating((crime or {}).get("regionPercentile"), False),
             "station": rating(percentile("gettingAround"), False),
             "schools": rating(percentile("bestPrimary"), True),
             "quiet": rating(percentile("quiet"), False),
             "green": rating(percentile("greenSpace"), False)}
    return {key: value for key, value in found.items() if value is not None}


# The area card's standout tiles (standing: London percentile, higher is better) for each rating.
STANDOUT_TILES = {"safety": "safety", "station": "station-walk", "schools": "schools", "quiet": "noise", "green": "nature"}


def standout_ratings(tiles: list[Mapping[str, Any]]) -> dict[str, int]:
    """Ratings from the standout tiles the area page shows, used where London ranks are missing."""
    standing = {tile.get("id"): tile.get("standing") for tile in tiles}
    found = {key: rating(standing.get(tile), True) for key, tile in STANDOUT_TILES.items()}
    return {key: value for key, value in found.items() if value is not None}


def _optional(name: str, area_id: str, read: Callable[[], Any]) -> Any:
    try:
        return read()
    except Exception:  # noqa: BLE001 - an optional reader never breaks the line
        logger.info("listing badges: %s unavailable for %s", name, area_id, exc_info=True)
        return None


def area_facts(context: ToolContext, area_id: str) -> dict:
    """What the line says about an area, cached for an hour per release: its London ratings, the latest 12 months
    of sales by type, the price change over a year, the summary pills and "Before you offer". Built on the card's
    area part (pack, getting around, flood, location, home, profile, market), shared with the card."""
    key = (card_cache.release_id(context.reader), area_id)
    return _cache.get_or_build(key, lambda: _read_area_facts(context, area_id))


def _read_area_facts(context: ToolContext, area_id: str) -> dict:
    area = _optional("area", area_id, lambda: area_part(context, area_id)) or {}
    pack = area.get("pack") or {}
    around = area.get("around")
    layers = area.get("layers") or {}

    def ranks() -> Any:
        with context.reader._connect() as connection:
            return places.london_ranks(connection, area_id)

    ratings = area_ratings(pack.get("crime"), _optional("london ranks", area_id, ranks))
    if len(ratings) < MIN_RATINGS:
        tiles = _optional("standouts", area_id, lambda: standouts.area_standouts(context.reader, area_id)["tiles"])
        ratings = {**standout_ratings(tiles or []), **ratings}
    return {"ratings": ratings,
            "byType": {row["propertyType"]: row for row in (layers.get("market") or {}).get("byType") or []},
            "growth1y": ((pack.get("market") or {}).get("growth") or {}).get("growth1y"),
            "pills": summary_pills(pack, around, layers, compact=True),
            "offer": offer_items(layers)}


def area_score(ratings: Mapping[str, int]) -> int | None:
    if len(ratings) < MIN_RATINGS:
        return None
    return min(10, max(1, round(sum(ratings.values()) / len(ratings))))


def price_bucket(item: Any, by_type: Mapping[str, Mapping[str, Any]]) -> int | None:
    """0 below the middle half of same-type sales, 1 lower half, 2 upper half, 3 above; None with < 5 sales."""
    code = PRICE_PAID_TYPES.get(item.propertyType)
    stats = by_type.get(code) if code else None
    if item.market != "buy" or not item.askingPrice or not stats or (stats.get("sales") or 0) < MIN_TYPE_SALES:
        return None
    q1, median, q3 = stats.get("p25"), stats.get("medianPrice"), stats.get("p75")
    if q1 is None or median is None or q3 is None:
        return None
    price = item.askingPrice
    return 0 if price < q1 else 1 if price < median else 2 if price <= q3 else 3


def area_badge(facts: Mapping[str, Any]) -> dict:
    ratings = facts["ratings"]
    score = area_score(ratings)
    badge = {"score": score, "band": min(5, max(1, math.ceil(score / 2))) if score else None, "excluded": False}
    weakest = min(ratings.items(), key=lambda item: item[1], default=None)
    if score and weakest and weakest[1] <= 3:
        badge["flag"] = AREA_FLAGS[weakest[0]]
    return badge


def _weak_factors(match: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """The weighted factors the area is weak on (utility 33 or lower), the costliest first."""
    return sorted((c for c in match.get("components", [])
                   if c.get("weight", 0) > 0 and c.get("utility") is not None and c["utility"] <= WEAK),
                  key=lambda c: -c["weight"] * (100 - c["utility"]))


def match_badge(match: Mapping[str, Any] | None, profile: Mapping[str, Any]) -> dict:
    if match is None:
        return {"score": None, "band": None, "excluded": False}
    excluded = bool(match.get("excluded"))
    score = None if excluded or match.get("score") is None else round(match["score"])
    badge = {"score": score, "band": min(5, max(1, math.ceil(score / 20))) if score is not None else None,
             "excluded": excluded}
    flags = (_misses(match, profile) if excluded else []) + [CON_LABELS.get(c["factorId"]) or "" for c in _weak_factors(match)]
    flag = next((text for text in flags if text), None)
    if flag:
        badge["flag"] = flag
    return badge


def _misses(match: Mapping[str, Any], profile: Mapping[str, Any]) -> list[str]:
    """The short names of the limits the area misses ("School too far"), each once."""
    texts = [_short_limit(code, text) for code, text in
             zip(match.get("unmetLimits") or [], describe_unmet_limits(match, profile))]
    return list(dict.fromkeys(text for text in texts if text))


def short_place(label: str) -> str:
    """A chip-sized name for a place: its station code ("KX"), the label when short, else its first word."""
    code = STATION_CODES.get(zones.station_name_key(zones.STATION_FILLER.sub("", label.lower())))
    if code:
        return code
    label = label.strip()
    if len(label) <= SHORT_PLACE:
        return label
    words = [w.rstrip(",;:") for w in label.split()]
    # "A top-50 primary school" names a kind of place, not a place: say "School".
    kind = next((k for k in ("school", "nursery", "park", "gym", "pool", "station", "supermarket") if k in label.lower()), None)
    if words[0].lower() in ("a", "an", "any", "the", "nearest") and kind:
        return kind.capitalize()
    first = words[0]
    return first if len(first) <= SHORT_PLACE else first[:SHORT_PLACE - 1] + "…"


def place_chips(match: Mapping[str, Any] | None, profile: Mapping[str, Any] | None) -> list[dict]:
    """Minutes to each of the search's places (up to three, the most important first), toned by its limit."""
    timed = {c.get("factorId"): c for c in (match or {}).get("components") or []
             if c.get("unit") == "minutes" and c.get("rawValue") is not None}
    found = [(place, timed[f"place:{place.get('id')}"]) for place in (profile or {}).get("places") or []
             if f"place:{place.get('id')}" in timed and place.get("label")]
    found.sort(key=lambda pair: -(pair[0].get("weight") or 0))
    chips = []
    for place, component in found[:MAX_PLACES]:
        minutes, target = round(component["rawValue"]), component.get("targetMinutes")
        band = (None if not target else 5 if minutes <= target * 0.75 else 4 if minutes <= target
                else 2 if minutes <= target * 1.25 else 1)
        chips.append({"text": f"{short_place(place['label'])} {minutes}′", "band": band, "kind": "commute"})
    return chips


def money_per_month(amount: float) -> str:
    if amount < 1000:
        return f"£{round(amount)}/mo"
    return f"£{amount / 1000:.1f}k/mo".replace(".0k", "k")


def cost_chip(item: Any) -> dict | None:
    if item.market != "buy" or not item.askingPrice:
        return None
    deposit = round(item.askingPrice * MORTGAGE["depositPct"] / 100)
    monthly = monthly_repayment(item.askingPrice - deposit, MORTGAGE["ratePct"], MORTGAGE["years"])
    return {"text": money_per_month(monthly), "band": None, "kind": "cost"}


def days_chip(item: Any, today: date) -> dict | None:
    """Days since the portal first listed the home, when its results page says."""
    if not getattr(item, "listedOn", None):
        return None
    days = (today - date.fromisoformat(item.listedOn)).days
    if days < 0:
        return None
    return {"text": "Listed today" if days == 0 else f"{days}d on market", "band": None, "kind": "days"}


def growth_chip(growth: Any) -> dict | None:
    if not plausible_growth(growth):
        return None
    return {"text": f"{growth:+.1f}% 1y", "band": None, "kind": "trend"}


def flag_chips(match: Mapping[str, Any] | None, profile: Mapping[str, Any] | None, pills: set[str],
               has_places: bool) -> list[dict]:
    """The limits the area misses; when it fits, its costliest weak factor unless a pill or a place's
    minutes already show it (no "Higher crime" beside a red Safety pill)."""
    if not (match and profile):
        return []
    if match.get("excluded") or match.get("unmetLimits"):
        return [{"text": text, "band": 1, "kind": "miss"} for text in _misses(match, profile)[:MAX_MISSES]]
    for component in _weak_factors(match):
        factor = component["factorId"]
        shown = PILL_OF_FACTOR.get(factor) in pills or (has_places and factor == "commute")
        if CON_LABELS.get(factor) and not shown:
            return [{"text": CON_LABELS[factor], "band": 1 if component["utility"] <= 20 else 2, "kind": "flag"}]
    return []


def line_chips(item: Any, facts: Mapping[str, Any], match: Mapping[str, Any] | None,
               profile: Mapping[str, Any] | None, today: date | None = None) -> list[dict]:
    """Row 1 after the ring, in order; a chip without data is left out."""
    bucket = price_bucket(item, facts["byType"])
    places_ = place_chips(match, profile) if profile else []
    pills = {pill["label"] for pill in facts.get("pills") or []}
    chips = [*flag_chips(match, profile, pills, bool(places_)), *places_,
             {"text": PRICE_WORDS[bucket], "band": None, "kind": "price"} if bucket is not None else None,
             cost_chip(item), days_chip(item, today or date.today()), growth_chip(facts.get("growth1y"))]
    return [chip for chip in chips if chip]


def listing_badges(context: ToolContext, request: ListingBadgesRequest,
                   match_for: Callable[[str], Mapping[str, Any] | None] | None = None,
                   facts_for: Callable[[ToolContext, str], dict] | None = None, today: date | None = None) -> dict:
    """The badges for a page of results; ``match_for`` gives an area's result in the profile's match pack."""
    facts_for = facts_for or area_facts
    personalised = bool(request.profile and match_for)

    def resolve(item: Any) -> str | None:
        try:
            return resolve_area(context, item)
        except evidence.AreaNotFound:
            return None

    # Each result's area, then each distinct area's facts once, a few at a time.
    area_ids = _in_parallel(resolve, request.items, RESOLVE_WORKERS)
    distinct = list(dict.fromkeys(area_id for area_id in area_ids if area_id is not None))
    facts = dict(zip(distinct, _in_parallel(lambda area_id: facts_for(context, area_id), distinct, AREA_WORKERS)))
    items = []
    for item, area_id in zip(request.items, area_ids):
        if area_id is None:
            items.append({"listingId": item.listingId, "score": None, "band": None, "excluded": False, "bucket": None,
                          "chips": [], "pills": [], "offer": []})
            continue
        area = facts[area_id]
        match = match_for(area_id) if personalised and match_for else None
        badge = match_badge(match, request.profile) if personalised else area_badge(area)
        items.append({"listingId": item.listingId, **badge, "bucket": price_bucket(item, area["byType"]),
                      "chips": line_chips(item, area, match, request.profile if personalised else None, today),
                      "pills": area.get("pills") or [], "offer": area.get("offer") or []})
    return {"v": 1, "scale": "match" if personalised else "area", "items": items}


def _in_parallel(work: Callable[[Any], Any], inputs: list, workers: int) -> list:
    """``work`` of each input in order, on up to ``workers`` threads; the first failure is raised."""
    done = card_cache.run_parallel({str(i): (lambda value=value: work(value)) for i, value in enumerate(inputs)}, workers)
    results = []
    for i in range(len(inputs)):
        ok, value = done[str(i)]
        if not ok:
            raise value
        results.append(value)
    return results
