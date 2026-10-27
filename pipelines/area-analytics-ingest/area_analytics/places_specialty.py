"""Specialty coffee (migration 039): which coffee shops and cafés of the unified place table are coffee-led.

Answers "good coffee or just a café with coffee on the menu?" from open signals only, per place:

* source agreement: OSM cuisine=coffee_shop, Overture coffee_shop, Foursquare "Coffee Shop" count +1 each;
  food-led labels (breakfast, sandwich, restaurant, diner, juice, dessert, bubble tea, tea room...) -1 each;
* roasters and coffee-bean shops (OSM craft=coffee_roaster / shop=coffee, Overture coffee_roastery,
  Foursquare "Coffee Roaster"): +2;
* the name: coffee, espresso, specialty, roast*, brew*, barista +1 (a bare "Coffee Shop" / "Coffee House" is not a
  name); grill, kitchen, breakfast, sandwich, kebab, chicken, pizza, restaurant... -2; "cafe"/"caff"
  without a coffee word -0.5 (the greasy-spoon cue);
* a short hand-made list of London specialty groups (Monmouth, Workshop, Prufrock, WatchHouse...) +3;
  big chains (Costa, Starbucks, Caffè Nero, Pret, Black Sheep...) are never specialty;
* Foursquare closed -3, Foursquare-only and not refreshed in the two years before the snapshot -1.

The FSA hygiene rating was tested and left out (2026-10 register): coffee-led places rate better than
food-led cafés (82% vs 57% rated 5, 2% vs 7% rated 0-2), but so do the big chains (85%, 1%), and either
side of the threshold, where it would have to decide, it barely differs (68% vs 64% rated 5, 6% vs 8%
rated 0-2) while covering only half the places. It reflects a kitchen's food risk and management, not
coffee. The report keeps the comparison.

Places scoring THRESHOLD or more get "specialty_coffee" appended to their cuisine list, so custom criteria
match {"cuisine": "specialty_coffee"} unchanged; specialty_score keeps the points (NULL for places that
are not coffee shops or cafés, and for big chains). Threshold 2.5: two sources calling it a coffee shop
plus a coffee name or a third source, a roaster with a coffee label, or a listed specialty group; at 2.0
about half the extra places were cafés with coffee on the menu.

  uv run --with 'psycopg[binary]' python -m area_analytics.places_specialty apply postgresql://...
  uv run --with 'psycopg[binary]' python -m area_analytics.places_specialty report postgresql://...

apply runs at the end of places_unified load; report writes specialty-report.json, specialty-sample.csv
and specialty-sample.html (a checklist: 50 above the threshold, 25 just below) to $AE_WORK.
"""
from __future__ import annotations

import csv
import glob
import html
import json
import os
import random
import re
import sys
import urllib.parse
from dataclasses import dataclass

from area_analytics.places_unified import WORK, normalise_name

TAG = "specialty_coffee"
THRESHOLD = 2.5
# The places scored: coffee shops, cafés and coffee-bean shops of the unified table.
CANDIDATE_CATEGORIES = ("coffee_shop", "cafe", "coffee_retail")

OSM_FOOD_CUISINES = {"breakfast", "sandwich", "burger", "kebab", "pizza", "chicken", "fish_and_chips", "british",
                     "english", "diner", "bubble_tea", "juice", "ice_cream", "dessert", "tea", "frozen_yogurt",
                     "fast_food", "friture", "crepe", "waffle"}
OVERTURE_COFFEE = {"coffee_shop"}
OVERTURE_ROASTER = {"coffee_roastery"}
# Overture categories of food-led places (any *_restaurant also counts).
OVERTURE_FOOD = {"breakfast_and_brunch_restaurant", "sandwich_shop", "restaurant", "diner", "bubble_tea_shop",
                 "smoothie_juice_bar", "dessert_shop", "tea_room", "bagel_shop", "ice_cream_shop", "burger_restaurant",
                 "fast_food_restaurant", "juice_bar", "delicatessen", "pub", "bar"}
FSQ_COFFEE = "Cafe, Coffee, and Tea House > Coffee Shop"
FSQ_ROASTER = "Coffee Roaster"
FSQ_FOOD = ("Breakfast Spot", "> Restaurant", "Sandwich Spot", "Fast Food", "Diner", "Juice Bar", "Dessert Shop",
            "Bubble Tea Shop", "Tea Room", "Bagel Shop", "Ice Cream", "Fried Chicken", "Kebab", "Pizza", "Burger")

NAME_COFFEE = re.compile(r"\b(coffee|koffee|kaffee?|kaffeine|espresso|specialty|speciality|roast(s|ers?|ery|ing)?|"
                         r"brew(s|ed|ing|ers)?|baristas?)\b")
# A business that calls itself a roaster almost always roasts its own (owner's 75-place review, 2026-10-08).
NAME_ROASTER = re.compile(r"\b(roasters?|roastery|roasting)\b")
# Kiosks, stands and community or sweet-shop cafés: coffee on the side (the review's false positives).
NAME_KIOSK = re.compile(r"\b(express|kiosk|hub|stand|cart|community|church|sweets?|napoli)\b")
# Words of a bare generic name: "Coffee Shop", "The Coffee House", "Coffee Corner" name nothing.
NAME_GENERIC = {"the", "coffee", "shop", "house", "corner", "station", "bar", "cafe", "and", "tea", "time", "break",
                "stop", "point", "express", "lounge", "spot", "place", "room", "co", "company"}
NAME_FOOD = re.compile(r"\b(grill|kitchen|breakfast|sandwich(es)?|kebabs?|chicken|pizz(a|eria)|burgers?|"
                       r"restaurant|diner|fish|chips|takeaway|fry|fryup|snack|snacks|food|foods|bistro|"
                       r"brasserie|canteen|buffet|shisha|juice|bubble|boba|desserts?|creperie|waffles?|"
                       r"bagels?|deli|cafeteria|tea ?rooms?|tea house)\b")
NAME_CAFE = re.compile(r"\b(cafe|caff|cafes)\b")
# Coffee next to cake, gelato or wine ("Cake & Coffee"): a mixed menu, no name bonus.
NAME_MIXED = re.compile(r"\b(cakes?|gelato|gelateria|wine|bake|bakery|bakes|patisserie|pancakes?|crepes?|"
                        r"ice cream|tea|teas|chocolate|vending|catering)\b")

# Big chains: never specialty, whatever the sources say (normalised name or brand prefix). Black Sheep
# (70+ London shops), Blank Street, Mikel, Colicci kiosks and Caffè Nero's roastery count as chains; the small
# groups below count in.
CHAINS = re.compile(r"^(costa|starbucks|caffe nero|cafe nero|nero express|pret\b|greggs|coffee 1\b|esquires|"
                    r"black sheep|blank street|nero\b|colicci|jamaica blue|mikel\b|wfm\b|whole foods|"
                    r"kahve dunya|knot pretzels|joe and the juice|puccinos|amt\b|coffee republic|caffe concerto|"
                    r"soho coffee|benugo|wild bean|gails|t4\b|chaiiwala|crussh|harris (and )?hoole|lavazza|"
                    r"illy\b|benjys|cafepod|krols|creams|mooboo|chatime|yi fang|el and n|whittard|kaspas|"
                    r"muffin break|bagel factory|bubbleology|coco fresh|nespresso|fcb\b|coffee island|tim hortons|"
                    r"paul\b|le pain quotidien|leon\b|patisserie valerie|cafe rouge|caffe latino|asda|tesco|"
                    r"sainsburys|mccolls|morrisons|marks and spencer|m and s\b|waitrose|ikea|john lewis|boots|"
                    r"wh ?smith|mcdonalds|burger king|subway|itsu|wasabi|ole and steen|(caffe )?ritazza|"
                    r"upper crust|krispy kreme|dunkin)")
CHAINS_ANYWHERE = re.compile(r"\b(costa coffee|starbucks|caffe nero|pret a manger|black sheep coffee|greggs)\b")
# Hand-made: London specialty groups and roasters with cafés (normalised name prefix).
SPECIALTY = re.compile(r"^(monmouth|workshop coffee|grind\b|kaffeine|prufrock|department of coffee|allpress\b|"
                       r"ozone coffee|watch ?house|origin coffee|square mile|notes\b|redemption roasters|"
                       r"kiss the hippo|(the )?gentlemen baristas|climpson|nude espresso|store street espresso|"
                       r"taylor st|federation coffee|rosslyn|saint espresso|fix coffee|caravan|briki|dark arts|"
                       r"assembly coffee|formative|exmouth coffee|curators coffee|lundenwic|association coffee|"
                       r"attendant|omotesando koffee|fernandez and wells|tap coffee|press coffee|"
                       r"coffee works project|brickwood|batch baby|rag and bone|hagen\b|catalyst\b|urban baristas|"
                       r"noxy brothers|old spike|roasting plant|hermanos|daku\b|klear labs|water cooler coffee|hjem\b)"
                       r"|\bgrind$")


@dataclass
class Signals:
    """Per-place inputs of the score, each from one member source (absent sources are None/empty)."""
    name: str | None = None
    brand: str | None = None
    osm_tags: dict | None = None
    overture_category: str | None = None
    overture_alternates: tuple = ()
    overture_brand: str | None = None
    overture_from_fsq: bool = False  # the Overture record is itself Foursquare data
    fsq_labels: tuple = ()
    fsq_closed: bool = False
    fsq_stale: bool = False
    sources: tuple = ()


def group(name: str | None, *brands: str | None) -> str | None:
    """'chain', 'specialty' or None from the name and brands (the specialty list wins: Notes, WatchHouse
    are small groups some sources tag as brands)."""
    names = [normalise_name(n) for n in (name, *brands) if n]
    if any(SPECIALTY.search(n) for n in names):
        return "specialty"
    if any(CHAINS.search(n) or CHAINS_ANYWHERE.search(n) for n in names):
        return "chain"
    return None


def _name_points(name: str | None) -> tuple[float, list[str]]:
    norm = normalise_name(name)
    if not norm:
        return 0.0, []
    if NAME_FOOD.search(norm) or "cafe and restaurant" in norm:
        return -2.0, ["food name -2"]
    words = set(norm.split())
    if NAME_KIOSK.search(norm):
        return -1.5, ["kiosk or community name -1.5"]
    if NAME_ROASTER.search(norm) and not NAME_MIXED.search(norm):
        return 2.0, ["roaster name +2"]
    if NAME_COFFEE.search(norm) and not words <= NAME_GENERIC:
        if NAME_MIXED.search(norm):
            return 0.0, ["mixed-menu name 0"]
        return 1.0, ["coffee name +1"]
    if NAME_CAFE.search(norm):
        return -0.5, ["cafe name -0.5"]
    return 0.0, []


def score(s: Signals) -> tuple[float | None, list[str]]:
    """(points, reasons). None for a big chain: it is never specialty."""
    kind = group(s.name, s.brand, s.overture_brand)
    if kind == "chain":
        return None, ["chain"]
    reasons: list[str] = []
    points = 0.0
    osm = s.osm_tags or {}
    cuisines = set(re.split(r"\s*;\s*", (osm.get("cuisine") or "").lower())) - {""}
    labels = [label for label in s.fsq_labels or ()]
    overture = {s.overture_category, *(s.overture_alternates or ())} - {None}
    votes = [src for src, hit in (("osm", "coffee_shop" in cuisines),
                                  ("overture", s.overture_category in OVERTURE_COFFEE),
                                  ("fsq", any(label.endswith(FSQ_COFFEE) for label in labels))) if hit]
    if votes:
        # An Overture record built from Foursquare repeats the Foursquare label: half a vote.
        gained = len(votes) - (0.5 if s.overture_from_fsq and {"overture", "fsq"} <= set(votes) else 0)
        points += gained
        reasons.append(f"coffee shop on {'+'.join(votes)} +{gained:g}")
    # A roaster or bean shop: +2; only an Overture alternate category says so: +1 (it tags vending firms too).
    if (osm.get("craft") == "coffee_roaster" or osm.get("shop") == "coffee" or s.overture_category in OVERTURE_ROASTER
            or any(label.endswith(FSQ_ROASTER) for label in labels)):
        points += 2
        reasons.append("roaster or bean shop +2")
    elif overture & OVERTURE_ROASTER:
        points += 1
        reasons.append("roaster on Overture (alternate) +1")
    food = [src for src, hit in (
        ("osm", bool(cuisines & OSM_FOOD_CUISINES) or osm.get("amenity") in ("restaurant", "fast_food")),
        ("overture", s.overture_category in OVERTURE_FOOD
         or (s.overture_category or "").endswith("_restaurant")),
        ("fsq", bool(labels) and not any(label.endswith(FSQ_COFFEE) or label.endswith(FSQ_ROASTER)
                                         for label in labels)
         and any(any(f in label for f in FSQ_FOOD) for label in labels))) if hit]
    if food:
        points -= len(food)
        reasons.append(f"food-led on {'+'.join(food)} -{len(food)}")
    name_points, name_reasons = _name_points(s.name)
    points += name_points
    reasons += name_reasons
    if kind == "specialty":
        points += 3
        reasons.append("specialty group +3")
    if s.fsq_closed:
        points -= 3
        reasons.append("closed on Foursquare -3")
    elif s.fsq_stale and tuple(s.sources) == ("fsq",):
        points -= 1
        reasons.append("stale Foursquare only -1")
    return points, reasons


def with_tag(cuisine: str | None, specialty: bool) -> str | None:
    """The cuisine list with "specialty_coffee" added or removed (idempotent; otherwise unchanged)."""
    values = [v for v in re.split(r"\s*;\s*", cuisine or "") if v and v != TAG]
    if (TAG in re.split(r"\s*;\s*", cuisine or "")) == specialty:
        return cuisine or None
    if specialty:
        values.append(TAG)
    return ";".join(values) or None


# --- database ---------------------------------------------------------------------------------

INPUT_SQL = """SELECT p.id, p.name, p.tags, p.sources, p.hygiene_rating, p.fhrs_id, p.confidence,
  ST_Y(p.location) AS lat, ST_X(p.location) AS lon, o.tags AS osm_tags, ov.category AS ov_cat,
  ov.alternate_categories AS ov_alt, ov.brand AS ov_brand,
  'Foursquare' = ANY(coalesce(ov.datasets, '{}')) AS ov_from_fsq, f.category_labels AS fsq_labels,
  f.date_closed IS NOT NULL AS fsq_closed, f.date_refreshed < %(fresh)s::date AS fsq_stale
FROM place p LEFT JOIN place_poi o ON o.id = p.osm_id LEFT JOIN overture_place ov ON ov.id = p.overture_id
LEFT JOIN fsq_place f ON f.fsq_place_id = p.fsq_id
WHERE p.category = ANY(%(categories)s) OR p.tags->>'cuisine' ~ 'coffee' OR p.tags->>'shop' = 'coffee'"""


def signals(row: dict) -> Signals:
    return Signals(name=row["name"], brand=(row["tags"] or {}).get("brand"), osm_tags=row["osm_tags"],
                   overture_category=row["ov_cat"], overture_alternates=tuple(row["ov_alt"] or ()),
                   overture_brand=row["ov_brand"], overture_from_fsq=bool(row["ov_from_fsq"]),
                   fsq_labels=tuple(row["fsq_labels"] or ()),
                   fsq_closed=bool(row["fsq_closed"]), fsq_stale=bool(row["fsq_stale"]),
                   sources=tuple(row["sources"] or ()))


def scored_rows(conn) -> list[dict]:
    fresh = conn.execute("SELECT (max(date_refreshed) - interval '2 years')::date FROM fsq_place").fetchone()
    fresh = list(fresh.values())[0] if isinstance(fresh, dict) else fresh[0]
    rows = conn.execute(INPUT_SQL, {"fresh": fresh, "categories": list(CANDIDATE_CATEGORIES)}).fetchall()
    for row in rows:
        row["score"], row["reasons"] = score(signals(row))
    return rows


def apply(url: str) -> dict:
    """Score every coffee shop / café, set specialty_score and the cuisine tag; returns counts."""
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(url, row_factory=dict_row) as conn:
        rows = scored_rows(conn)
        # Every place a previous run tagged is a candidate again (its cuisine mentions coffee), so the
        # new cuisine list both adds and drops the tag.
        conn.execute("CREATE TEMP TABLE specialty_stage (id text PRIMARY KEY, score real, cuisine text)")
        with conn.cursor().copy("COPY specialty_stage (id, score, cuisine) FROM STDIN") as copy:
            for row in rows:
                cuisine = with_tag((row["tags"] or {}).get("cuisine"),
                                   row["score"] is not None and row["score"] >= THRESHOLD)
                copy.write_row((row["id"], row["score"], cuisine))
        conn.execute("UPDATE place SET specialty_score = NULL WHERE specialty_score IS NOT NULL")
        conn.execute("""UPDATE place p SET specialty_score = s.score,
                          tags = CASE WHEN s.cuisine IS NULL THEN p.tags - 'cuisine'
                                      ELSE jsonb_set(p.tags, '{cuisine}', to_jsonb(s.cuisine)) END
                        FROM specialty_stage s WHERE s.id = p.id""")
        counts = conn.execute("""SELECT count(*) FILTER (WHERE specialty_score IS NOT NULL) AS scored,
                                   count(*) FILTER (WHERE tags->>'cuisine' ~ %(tag)s) AS specialty,
                                   count(*) FILTER (WHERE tags->>'cuisine' ~ %(tag)s AND confidence >= 0.6)
                                     AS specialty_confident FROM place""", {"tag": TAG}).fetchone()
        conn.commit()
    counts["chains"] = sum(1 for row in rows if row["score"] is None)
    print(f"specialty: {json.dumps(counts)} (threshold {THRESHOLD})")
    return counts


# --- report -----------------------------------------------------------------------------------

def fhrs_scores(pattern: str = os.path.join(os.path.expanduser(os.environ.get("AE_DATA", "~/data")),
                                            "fhrs", "*", "*.xml")) -> dict[int, dict]:
    """FHRSID -> {Hygiene, Structural, ConfidenceInManagement} from the register XML (lower is better;
    the table keeps only the rating)."""
    import xml.etree.ElementTree as ET

    scores: dict[int, dict] = {}
    for path in sorted(glob.glob(pattern)):
        for _, element in ET.iterparse(path):
            if element.tag == "EstablishmentDetail":
                found = element.find("Scores")
                if found is not None and len(found):
                    scores[int(element.findtext("FHRSID"))] = {k.tag: int(k.text) for k in found if k.text}
                element.clear()
    return scores


def maps_link(name: str | None, lat: float, lon: float) -> str:
    query = urllib.parse.quote_plus(f"{name or 'cafe'} {lat:.6f},{lon:.6f}")
    return f"https://www.google.com/maps/search/?api=1&query={query}"


def _distribution(rows: list[dict], scores: dict) -> dict:
    ratings = [r["hygiene_rating"] for r in rows if r["hygiene_rating"]]
    numeric = [int(x) for x in ratings if x.isdigit()]
    detail = [scores[r["fhrs_id"]] for r in rows if r["fhrs_id"] in scores]

    def mean(values):
        return round(sum(values) / len(values), 2) if values else None

    return {"places": len(rows), "with_rating": len(numeric),
            "rating_5_share": round(sum(1 for x in numeric if x == 5) / len(numeric), 3) if numeric else None,
            "rating_le3_share": round(sum(1 for x in numeric if x <= 3) / len(numeric), 3) if numeric else None,
            "rating_le2_share": round(sum(1 for x in numeric if x <= 2) / len(numeric), 3) if numeric else None,
            "mean_rating": mean(numeric), "with_scores": len(detail),
            "mean_hygiene": mean([d.get("Hygiene", 0) for d in detail]),
            "mean_structural": mean([d.get("Structural", 0) for d in detail]),
            "mean_management": mean([d.get("ConfidenceInManagement", 0) for d in detail]),
            "management_le5_share": round(sum(1 for d in detail if d.get("ConfidenceInManagement", 30) <= 5)
                                          / len(detail), 3) if detail else None}


BOROUGH_SQL = """SELECT b.name AS borough, count(*) AS specialty FROM place p
JOIN area_geography b ON b.kind = 'lad' AND ST_Intersects(b.geometry, p.location)
WHERE p.tags->>'cuisine' ~ %(tag)s AND p.confidence >= 0.6 GROUP BY b.name ORDER BY 2 DESC"""


def report(url: str, seed: int = 39) -> None:
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(url, row_factory=dict_row) as conn:
        rows = scored_rows(conn)
        boroughs = conn.execute(BOROUGH_SQL, {"tag": TAG}).fetchall()
    scores = fhrs_scores()
    scored = [r for r in rows if r["score"] is not None]
    confident = [r for r in scored if r["confidence"] >= 0.6]
    # Hygiene test (it is not in the score): the hand-made specialty groups and coffee-led places
    # the sources agree on, against cafés whose names or labels say food first; and either side of the
    # threshold, where it would have to decide.
    clear_specialty = [r for r in scored if group(r["name"], (r["tags"] or {}).get("brand"), r["ov_brand"]) ==
                       "specialty" or (r["score"] >= 4 and not any("food" in x for x in r["reasons"]))]
    clear_generic = [r for r in scored if r["score"] <= -1.5 and not any("coffee" in x for x in r["reasons"])]
    just_above = [r for r in scored if THRESHOLD <= r["score"] <= THRESHOLD + 1]
    just_below = [r for r in scored if THRESHOLD - 1 <= r["score"] < THRESHOLD]
    histogram: dict = {}
    for r in confident:
        histogram[r["score"]] = histogram.get(r["score"], 0) + 1
    out = {"threshold": THRESHOLD, "scored": len(scored), "chains": len(rows) - len(scored),
           "specialty": sum(1 for r in scored if r["score"] >= THRESHOLD),
           "specialty_confident": sum(1 for r in confident if r["score"] >= THRESHOLD),
           "old_rule_unbranded_coffee_confident": sum(1 for r in confident if not (r["tags"] or {}).get("brand") and (
               "coffee_shop" in ((r["tags"] or {}).get("cuisine") or "") or (r["tags"] or {}).get("shop") == "coffee")),
           "score_histogram_confident": dict(sorted(histogram.items())),
           "top_boroughs": boroughs[:10],
           "hygiene": {"clear_specialty": _distribution(clear_specialty, scores),
                       "clear_generic": _distribution(clear_generic, scores),
                       "chains": _distribution([r for r in rows if r["score"] is None], scores),
                       "just_above_threshold": _distribution(just_above, scores),
                       "just_below_threshold": _distribution(just_below, scores),
                       "all_scored": _distribution(scored, scores)}}
    rng = random.Random(seed)
    named = [r for r in confident if r["name"]]
    above = [r for r in named if r["score"] >= THRESHOLD]
    below = [r for r in named if THRESHOLD - 1.5 <= r["score"] < THRESHOLD]
    sample = ([("above", r) for r in rng.sample(above, min(50, len(above)))]
              + [("below", r) for r in rng.sample(below, min(25, len(below)))])
    os.makedirs(WORK, exist_ok=True)
    with open(os.path.join(WORK, "specialty-report.json"), "w") as handle:
        json.dump(out, handle, indent=1, default=str)
    fields = ["group", "id", "name", "sources", "score", "reasons", "hygiene_rating", "google_maps"]
    lines = []
    with open(os.path.join(WORK, "specialty-sample.csv"), "w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(fields)
        for kind, r in sample:
            line = [kind, r["id"], r["name"], "+".join(r["sources"]), r["score"], "; ".join(r["reasons"]),
                    r["hygiene_rating"], maps_link(r["name"], r["lat"], r["lon"])]
            writer.writerow(line)
            lines.append(dict(zip(fields, line)))
    with open(os.path.join(WORK, "specialty-sample.html"), "w") as handle:
        handle.write(checklist_html(lines, out))
    print(json.dumps({k: v for k, v in out.items() if k != "score_histogram_confident"}, default=str))
    print(f"report: wrote specialty-report.json, specialty-sample.csv, specialty-sample.html to {WORK}")


SOURCE_NAMES = {"osm": "OpenStreetMap", "overture": "Overture", "fsq": "Foursquare", "fhrs": "hygiene register"}


def checklist_html(lines: list[dict], out: dict) -> str:
    """The owner's spot check: a Yes / No per place, a running precision and a "copy results" button
    (answers are kept in this browser only, so the button is how they come back)."""
    def item(line: dict) -> str:
        sources = ", ".join(SOURCE_NAMES.get(s, s) for s in line["sources"].split("+") if s)
        return (f'<li data-id="{html.escape(line["id"])}"><a href="{html.escape(line["google_maps"])}" '
                f'target="_blank" rel="noopener">{html.escape(line["name"] or "(no name)")}</a>'
                f'<span class="ask"><button type="button" data-v="yes">Coffee-led</button>'
                f'<button type="button" data-v="no">Just a café</button></span>'
                f'<span class="meta">listed by {html.escape(sources)} · hygiene rating '
                f'{html.escape(str(line["hygiene_rating"] or "none"))} · score {line["score"]:g}</span>'
                f'<span class="why">{html.escape(line["reasons"])}</span></li>')

    above = [line for line in lines if line["group"] == "above"]
    below = [line for line in lines if line["group"] == "below"]
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Specialty coffee check</title>
<style>
:root {{ --bg: #fbfaf8; --fg: #1f1d1a; --muted: #6b665e; --line: #e4e0d8; --accent: #7a4a2a; --yes: #2f6b3a;
  --no: #9a3b2e; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg: #171513; --fg: #ece8e1; --muted: #a39d93; --line: #2d2a26;
  --accent: #d9a27a; --yes: #7fc28c; --no: #e08a7c; }} }}
body {{ background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, sans-serif; margin: 0 auto;
  max-width: 760px; padding: 24px 16px 64px; }}
h1 {{ font-size: 22px; margin: 0 0 8px; }} h2 {{ font-size: 17px; margin: 28px 0 4px; }}
p {{ color: var(--muted); margin: 0 0 8px; }} ol {{ padding-left: 22px; }}
li {{ border-bottom: 1px solid var(--line); padding: 10px 0; }}
li a {{ color: var(--accent); font-weight: 600; }}
.ask {{ float: right; display: flex; gap: 6px; }}
.ask button {{ font: inherit; font-size: 13px; padding: 4px 10px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--line); background: transparent; color: var(--fg); }}
li[data-v=yes] [data-v=yes] {{ background: var(--yes); border-color: var(--yes); color: var(--bg); }}
li[data-v=no] [data-v=no] {{ background: var(--no); border-color: var(--no); color: var(--bg); }}
.meta, .why {{ display: block; color: var(--muted); font-size: 13px; clear: both; }}
.why {{ font-size: 12px; }}
.tally {{ position: sticky; top: 0; background: var(--bg); padding: 10px 0; border-bottom: 1px solid var(--line);
  display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; z-index: 1; }}
.tally button {{ font: inherit; font-size: 13px; padding: 4px 10px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--accent); background: transparent; color: var(--accent); }}
@media (max-width: 520px) {{ .ask {{ float: none; margin: 6px 0 2px; }} }}
</style></head><body>
<h1>Specialty coffee: spot check</h1>
<p>Open each place on Google Maps (photos, menu, reviews) and answer: is it <b>coffee-led</b> (espresso bar,
filter coffee, beans for sale, a named roaster) or <b>just a café</b> that mainly sells breakfasts, sandwiches
or meals with coffee on the side?</p>
<p>The map currently counts {out['specialty_confident']} London places as specialty coffee. Answers stay in
this browser; press <b>Copy results</b> and paste them back to us when you are done.</p>
<div class="tally"><span id="tally"></span><button type="button" id="copy">Copy results</button></div>
<h2>Counted as specialty ({len(above)})</h2>
<p>Each “Just a café” here is a place the map should not count.</p>
<ol id="above">{''.join(item(line) for line in above)}</ol>
<h2>Just missed ({len(below)})</h2>
<p>Each “Coffee-led” here is a place the map misses.</p>
<ol id="below">{''.join(item(line) for line in below)}</ol>
<script>
const KEY = 'specialty-check-v2';
let saved = {{}}; try {{ saved = JSON.parse(localStorage.getItem(KEY) || '{{}}'); }} catch (e) {{}}
const items = [...document.querySelectorAll('li[data-id]')];
function count(list) {{
  const rows = [...document.querySelectorAll('#' + list + ' li')];
  const done = rows.filter(li => li.dataset.v);
  return {{ total: rows.length, done: done.length, yes: done.filter(li => li.dataset.v === 'yes').length }};
}}
function tally() {{
  const a = count('above'), b = count('below');
  const pct = a.done ? Math.round(100 * a.yes / a.done) + '% coffee-led' : 'not started';
  document.getElementById('tally').textContent = 'Counted: ' + a.done + ' of ' + a.total + ' checked, ' + pct
    + ' · Just missed: ' + b.done + ' of ' + b.total + ' checked, ' + b.yes + ' coffee-led';
}}
items.forEach(li => {{
  if (saved[li.dataset.id]) li.dataset.v = saved[li.dataset.id];
  li.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {{
    const v = li.dataset.v === button.dataset.v ? '' : button.dataset.v;
    if (v) li.dataset.v = v; else delete li.dataset.v;
    saved[li.dataset.id] = v;
    try {{ localStorage.setItem(KEY, JSON.stringify(saved)); }} catch (e) {{}}
    tally();
  }}));
}});
document.getElementById('copy').addEventListener('click', async () => {{
  const rows = items.filter(li => li.dataset.v).map(li =>
    [li.closest('ol').id, li.dataset.id, li.querySelector('a').textContent, li.dataset.v].join('\\t'));
  const text = document.getElementById('tally').textContent + '\\n' + rows.join('\\n');
  try {{ await navigator.clipboard.writeText(text); document.getElementById('copy').textContent = 'Copied'; }}
  catch (e) {{ window.prompt('Copy these results:', text); }}
}});
tally();
</script></body></html>
"""


def main(argv: list[str]) -> None:
    stage = argv[1] if len(argv) > 1 else ""
    if stage == "apply" and len(argv) == 3:
        apply(argv[2])
    elif stage == "report" and len(argv) == 3:
        report(argv[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
