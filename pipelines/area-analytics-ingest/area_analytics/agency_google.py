"""Google place ids for agency offices (migration 051, agency_google_place).

Google's terms let a place id be stored indefinitely and nothing else from Places, so this keeps the id and
nothing more: no name, location, photo, rating or phone number is written to the database or the log. For each
agency_office with no agency_google_place row, one Places API (New) Text Search asks for the office's name within
100 m of its location, with the field mask places.id,places.displayName,places.location. The first candidate within
150 m whose name agrees is accepted; its id is stored. Names agree (names_agree) when, ignoring case and
punctuation, one name begins the other ("Property World" and "Propertyworld - Sydenham"); or, after dropping generic
words (estate, agents, lettings, ltd and the like), the rest reads the same without spaces ("JH" and "J H"), every
word of the shorter is in the longer ("Foxtons" and "Foxtons Ealing"), or the rest is trigram-similar (>= 0.5).
Comparing what is left after the generic words keeps "AA Estate Agents" and "J K Estate Agents" apart. No confident match stores NULL, so the office is
not asked again (DELETE FROM agency_google_place WHERE google_place_id IS NULL; asks those offices again). Offices
with no name are skipped. A counts-only progress line is printed every 500 offices, and the summary also on Ctrl-C. A failed request (HTTP error, timeout, bad JSON) writes no row and is retried by the
next run. A rejected key (401/403), quota still exhausted after backoff (429) or five errors in a row stops the
run, naming only the status code or error class, never a response body. Each office is written on its own, so a long run that stops keeps what it matched.

Stages (the key is read from the environment and never printed):
  review URL [--limit N]  ask Google for N offices (default 50, spread across ids) and print one line each: our name,
                          Google's name for the accepted candidate (else its first), distance, accepted yes/no.
                          Writes nothing; the names are shown on screen once for a person to check the rule.
  match URL [--limit N]   look up offices not yet tried and store the ids (psycopg needed)

  CLOSE_KNIT_GOOGLE_PLACES_KEY=... uv run --with 'psycopg[binary]' python -m area_analytics.agency_google review postgresql://...
  CLOSE_KNIT_GOOGLE_PLACES_KEY=... uv run --with 'psycopg[binary]' python -m area_analytics.agency_google match postgresql://... --limit 50

name_similarity, metres, request_body and accept are pure and dependency-free.
"""
from __future__ import annotations

import http.client
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = "places.id,places.displayName,places.location"
BIAS_METRES = 100
MAX_METRES = 150
MIN_SIMILARITY = 0.5
KEY_ENV = "CLOSE_KNIT_GOOGLE_PLACES_KEY"
EARTH_METRES = 6371000.0
TIMEOUT_SECONDS = 20
BACKOFF_SECONDS = (2, 4, 8, 16)  # waits after a 429 before giving up
MAX_CONSECUTIVE_ERRORS = 5
PROGRESS_EVERY = 500
REVIEW_OFFICES = 50
MIN_PREFIX = 6  # a name this long (letters and digits) that begins the other counts as the same name
# Words that say what a business is rather than which one it is; dropped before comparing names word by word.
GENERIC_WORDS = frozenset(("estate", "estates", "agent", "agents", "letting", "lettings", "sales", "property",
                           "properties", "ltd", "limited", "llp", "the", "and", "branch", "office"))

OFFICES_SQL = """
SELECT o.id, o.name, ST_Y(o.location), ST_X(o.location)
FROM agency_office o
WHERE NOT EXISTS (SELECT 1 FROM agency_google_place g WHERE g.place_id = o.id)
  AND nullif(btrim(o.name), '') IS NOT NULL
ORDER BY o.id
"""
# The review spreads its sample across the table instead of taking the first ids (all osm:n... offices).
REVIEW_SQL = OFFICES_SQL.replace("ORDER BY o.id", "ORDER BY md5(o.id)")
INSERT_SQL = """
INSERT INTO agency_google_place (place_id, google_place_id, matched_at) VALUES (%s, %s, now())
ON CONFLICT (place_id) DO UPDATE SET google_place_id = EXCLUDED.google_place_id, matched_at = EXCLUDED.matched_at
"""


def request_body(name: str, lat: float, lon: float) -> dict:
    return {"textQuery": name,
            "locationBias": {"circle": {"center": {"latitude": lat, "longitude": lon},
                                        "radius": float(BIAS_METRES)}},
            "maxResultCount": 3}


def trigrams(text: str) -> set[str]:
    """pg_trgm's trigrams: lower-cased words (runs of letters and digits), each padded with two leading spaces and one trailing."""
    grams: set[str] = set()
    for word in re.findall(r"[^\W_]+", text.lower()):
        padded = f"  {word} "
        grams.update(padded[i:i + 3] for i in range(len(padded) - 2))
    return grams


def name_similarity(a: str, b: str) -> float:
    left, right = trigrams(a), trigrams(b)
    union = left | right
    return len(left & right) / len(union) if union else 0.0


def core_words(name: str) -> list[str]:
    """Lower-case runs of letters and digits, in order, without GENERIC_WORDS."""
    return [word for word in re.findall(r"[a-z0-9]+", name.lower()) if word not in GENERIC_WORDS]


def name_words(name: str) -> set[str]:
    return set(core_words(name))


def names_agree(a: str, b: str) -> bool:
    """True when the two names are taken to be the same business (rules in the module docstring)."""
    short, long = sorted(("".join(re.findall(r"[a-z0-9]+", a.lower())), "".join(re.findall(r"[a-z0-9]+", b.lower()))),
                         key=len)
    if len(short) >= MIN_PREFIX and long.startswith(short):
        return True
    core_a, core_b = core_words(a), core_words(b)
    if not core_a or not core_b:  # all generic ("Sales & Lettings"): only the whole names can be compared
        return name_similarity(a, b) >= MIN_SIMILARITY
    if "".join(core_a) == "".join(core_b):
        return True
    smaller, larger = sorted((set(core_a), set(core_b)), key=len)
    return smaller <= larger or name_similarity(" ".join(core_a), " ".join(core_b)) >= MIN_SIMILARITY


def metres(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * EARTH_METRES * math.asin(math.sqrt(a))


def accept(places: list[dict], name: str, lat: float, lon: float) -> str | None:
    """The id of the first candidate within MAX_METRES whose name agrees (names_agree), else None."""
    for candidate in places:
        found = (candidate.get("displayName") or {}).get("text") or ""
        where = candidate.get("location") or {}
        if "latitude" not in where or "longitude" not in where or not candidate.get("id"):
            continue
        if (metres(lat, lon, where["latitude"], where["longitude"]) <= MAX_METRES
                and names_agree(name, found)):
            return candidate["id"]
    return None


def post_json(url: str, headers: dict, body: dict) -> dict:
    request = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return json.load(response)


def connect(url: str):
    import psycopg
    return psycopg.connect(url, autocommit=True)


def ask(post, headers: dict, body: dict, sleep) -> dict:
    """One search; a 429 is retried after BACKOFF_SECONDS waits, then the run stops. Other failures are raised."""
    for wait in (*BACKOFF_SECONDS, None):
        try:
            return post(SEARCH_URL, headers, body)
        except urllib.error.HTTPError as error:
            if error.code != 429:
                raise
            if wait is None:
                sys.exit("Google Places quota exhausted (HTTP 429) after retries; stopping")
            sleep(wait)


def match(url: str, post=None, limit: int | None = None, sleep=time.sleep) -> dict:
    """Look up offices with no agency_google_place row; return counts of matched, unmatched and errors.

    Also returns statuses: how many failures per HTTP status code or error class name (nothing else from Google).
    Prints a counts-only progress line every PROGRESS_EVERY offices, and the summary when stopped with Ctrl-C."""
    headers, post = _headers(), post or post_json
    counts = _counts()
    with connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(OFFICES_SQL)
            offices = cur.fetchall()[:limit]
        try:
            for (place_id, name, lat, lon), places in _answers(offices, post, headers, sleep, counts):
                google_id = accept(places, name, lat, lon)
                with conn.cursor() as cur:
                    cur.execute(INSERT_SQL, (place_id, google_id))
                counts["matched" if google_id else "unmatched"] += 1
        except KeyboardInterrupt:
            print("google: stopped: " + summary(counts), flush=True)
            raise
    return counts


def review(url: str, post=None, limit: int = REVIEW_OFFICES, sleep=time.sleep) -> dict:
    """Ask Google for `limit` offices and print one line each for a person to check the rule; writes nothing."""
    headers, post = _headers(), post or post_json
    counts = _counts()
    with connect(url) as conn, conn.cursor() as cur:
        cur.execute(REVIEW_SQL)
        offices = cur.fetchall()[:limit]
    print("our name | Google's name | distance | accepted")
    for (_, name, lat, lon), places in _answers(offices, post, headers, sleep, counts):
        found, distance, accepted = review_row(places, name, lat, lon)
        shown = "-" if distance is None else f"{distance} m"
        print(f"{name} | {found or '-'} | {shown} | {'yes' if accepted else 'no'}")
        counts["matched" if accepted else "unmatched"] += 1
    return counts


def review_row(places: list[dict], name: str, lat: float, lon: float) -> tuple[str | None, int | None, bool]:
    """(Google's name, metres away, accepted) for the accepted candidate, else for Google's first one."""
    chosen_id = accept(places, name, lat, lon)
    shown = next((p for p in places if p.get("id") == chosen_id), None) if chosen_id else (places or [None])[0]
    if not shown:
        return None, None, False
    where = shown.get("location") or {}
    distance = (round(metres(lat, lon, where["latitude"], where["longitude"]))
                if "latitude" in where and "longitude" in where else None)
    return (shown.get("displayName") or {}).get("text"), distance, chosen_id is not None


def _headers() -> dict:
    key = os.environ.get(KEY_ENV)
    if not key:
        sys.exit(f"{KEY_ENV} is not set; the Google Places key is required to match offices.")
    return {"X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELD_MASK, "Content-Type": "application/json"}


def _counts() -> dict:
    return {"matched": 0, "unmatched": 0, "errors": 0, "statuses": {}}


def _answers(offices, post, headers, sleep, counts):
    """Yield (office, places) per office Google answered. Failures are counted; a rejected key, quota still
    exhausted or MAX_CONSECUTIVE_ERRORS in a row stops the run. Prints a counts-only line every PROGRESS_EVERY."""
    in_a_row = 0
    for done, office in enumerate(offices):
        if done and done % PROGRESS_EVERY == 0:
            print(f"google: {done}/{len(offices)} offices so far: {summary(counts)}", flush=True)
        _, name, lat, lon = office
        try:
            answer = ask(post, headers, request_body(name, lat, lon), sleep)
            places = answer.get("places") or []
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                sys.exit(f"Google Places rejected the request (HTTP {error.code}); stopping")
            label = f"HTTP {error.code}"
        except (OSError, http.client.HTTPException, ValueError, TypeError, AttributeError, KeyError) as error:
            label = type(error).__name__
        else:
            in_a_row = 0
            yield office, places
            continue
        counts["errors"] += 1
        counts["statuses"][label] = counts["statuses"].get(label, 0) + 1
        in_a_row += 1
        if in_a_row >= MAX_CONSECUTIVE_ERRORS:
            sys.exit(f"Google Places failed {in_a_row} times in a row ({summary(counts)}); stopping")


def summary(counts: dict) -> str:
    statuses = ", ".join(f"{label} x{n}" for label, n in sorted(counts["statuses"].items())) or "none"
    return (f"{counts['matched']} matched, {counts['unmatched']} unmatched, {counts['errors']} errors; "
            f"error kinds: {statuses}")


def parse_limit(options: list[str]) -> int | None:
    if "--limit" not in options:
        return None
    at = options.index("--limit") + 1
    if at >= len(options) or not options[at].isdigit():
        sys.exit("--limit needs a whole number of offices, 0 or more\n\n" + __doc__)
    return int(options[at])


def main(argv: list[str]) -> None:
    if len(argv) >= 3 and argv[1] == "match":
        print("google: " + summary(match(argv[2], limit=parse_limit(argv[3:]))))
    elif len(argv) >= 3 and argv[1] == "review":
        limit = parse_limit(argv[3:])
        print("google review: " + summary(review(argv[2], limit=REVIEW_OFFICES if limit is None else limit)))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
