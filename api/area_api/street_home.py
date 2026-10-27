"""Street-level home: a home with no recorded sale, found through its street (OS Open Names) and the
numbered homes either side of it. The page URL is /property/at/{postcode}/{house-slug}; this is its data.

A number that is a recorded home answers with its UPRN instead (the caller redirects), or with
{"postcodePage": true} when none of its records has a UPRN (the caller opens the postcode page). A
recorded home that is hidden ("Report or hide this home") is answered exactly like a number with no
record: the same generic page, nothing from its record, on any postcode of its street. A number
outside the street's recorded numbers (lowest to highest) is not found. A letter suffix is part of
the number: 12a is never 12B's page. While CLOSE_KNIT_EPC_ADDRESSES is on, a number that is a home known
only from its energy certificate also answers with its UPRN.
"""
from __future__ import annotations

import re
from typing import Any, Callable

from . import feature_flags
from .evidence import STREET_TABLE_SQL, _check_cancelled, street_candidates, street_numbers
from .property_profile import ACTIVE_MEMBERS, EPC_HOME_FILTER, epc_addresses_ready, normalise_postcode

__all__ = ["parse_house_slug", "street_home"]

HOUSE_SLUG = re.compile(r"^(\d{1,5})([a-z]?)-(.+)$", re.I)
HOME_ADDRESS_LIMIT = 50

# The street named in the home's borough (via the postcode) and that postcode's LSOA.
STREET_AT_POSTCODE_SQL = """-- street-home:street
SELECT DISTINCT ON (lower(s.name), s.borough_id) s.name, s.borough_id, p.lsoa_code,
  ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(s.easting, s.northing), 27700), 4326)) AS center_lon,
  ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint(s.easting, s.northing), 27700), 4326)) AS center_lat
FROM postcode_civic p
JOIN street s ON s.borough_id = 'uk:lad:' || p.borough_code
WHERE p.postcode = %s AND p.terminated IS NULL
  AND btrim(regexp_replace(replace(replace(lower(s.name), '''', ''), '’', ''), '[^a-z0-9]+', ' ', 'g')) = %s
ORDER BY lower(s.name), s.borough_id, s.id
LIMIT 1"""

# The recorded homes of the postcode at one street number (%s is an address regex, see house_pattern)
# with their UPRN and whether they are hidden (suppressed_dwelling), so a hidden one is left out and its
# number answered like a never-sold one. Filtering in SQL keeps the rows few; hidden ones come first so no
# limit drops them.
POSTCODE_ADDRESSES_SQL = """-- street-home:postcode-homes
SELECT a.display_address, p.uprn,
  EXISTS (SELECT 1 FROM suppressed_dwelling d
          WHERE d.address_id = a.id OR (p.uprn IS NOT NULL AND d.uprn = p.uprn)) AS hidden
FROM address a
LEFT JOIN LATERAL (
  SELECT p.uprn FROM property p WHERE p.address_id = a.id AND p.source_release_id IN """ + ACTIVE_MEMBERS + """
  ORDER BY p.uprn LIMIT 1) p ON true
WHERE a.postcode = %s AND a.source_release_id IN """ + ACTIVE_MEMBERS + """
  AND a.display_address ~* %s
ORDER BY hidden DESC, p.uprn
LIMIT """ + str(HOME_ADDRESS_LIMIT)


# Homes known only from an energy certificate (migration 089) at one number, read only while
# CLOSE_KNIT_EPC_ADDRESSES is on: such a home has a /property/{uprn} page, so the street URL redirects there.
EPC_HOME_SQL = """-- street-home:epc-homes
SELECT h.display_address, h.uprn,
  EXISTS (SELECT 1 FROM suppressed_dwelling d WHERE d.uprn = h.uprn) AS hidden
FROM property_epc_home h
WHERE h.postcode = %s AND """ + EPC_HOME_FILTER + """ AND h.display_address ~* %s
ORDER BY hidden DESC, h.uprn
LIMIT """ + str(HOME_ADDRESS_LIMIT)


def street_key(name: str) -> str:
    """A street name without case, apostrophes or punctuation: "St John's Road" and "ST-JOHNS-ROAD" agree."""
    return " ".join(re.sub(r"[^a-z0-9]+", " ", re.sub(r"['\u2019]", "", name.lower())).split())


def house_pattern(number: int, street: str) -> str:
    """The address regex for one house number (any letter suffix) on `street`; EPC addresses may put a
    comma after the number ("106, Meadvale Road")."""
    return r"(^|[,\s])" + str(number) + r"[a-z]?,?\s+" + re.escape(street) + r"\s*(,|$)"


def house_suffix(number: int, street: str, address: str) -> str | None:
    """The letter after `number` where `address` names it on `street` ("" for none), or None if it does not."""
    match = re.search(r"(?:^|[,\s])" + str(number) + r"([a-z]?),?\s+" + re.escape(street) + r"\s*(?:,|$)", address, re.I)
    return match[1].lower() if match else None


def parse_house_slug(slug: str) -> tuple[int, str, str] | None:
    """"120-meadvale-road" -> (120, "", "MEADVALE ROAD"); "12a-high-street" -> (12, "a", "HIGH STREET"); no number -> None."""
    match = HOUSE_SLUG.match((slug or "").strip())
    if not match:
        return None
    street = " ".join(re.sub(r"[-_\s]+", " ", match[3]).upper().split())
    return (int(match[1]), match[2].lower(), street) if street else None


def street_home(connect: Callable[[], Any], postcode: str, house_slug: str,
                cancel: Callable[[], bool] | None = None) -> dict | None:
    """The street-level home block, {"uprn": ...} or {"postcodePage": True} when the number is a recorded
    home, or None (404). A hidden home's number gets the generic block, like a never-recorded one."""
    _check_cancelled(cancel)
    code = normalise_postcode(postcode)
    parsed = parse_house_slug(house_slug)
    if parsed is None:
        return None
    number, suffix, street = parsed
    with connect() as connection:
        if not list(connection.execute(STREET_TABLE_SQL))[0]["t"]:
            return None
        row = next(iter(connection.execute(STREET_AT_POSTCODE_SQL, (code, street_key(street)))), None)
        if row is None:
            return None
        _check_cancelled(cancel)
        pattern = house_pattern(number, row["name"])
        visible = [home for home in connection.execute(POSTCODE_ADDRESSES_SQL, (code, pattern))
                   if not home["hidden"] and house_suffix(number, row["name"], home["display_address"]) == suffix]
        uprns = sorted(home["uprn"] for home in visible if home["uprn"])
        if uprns:
            return {"uprn": uprns[0]}
        if visible:
            return {"postcodePage": True}
        if epc_addresses_ready(connection):
            epc = sorted(home["uprn"] for home in connection.execute(EPC_HOME_SQL, (code, pattern))
                         if not home["hidden"] and house_suffix(number, row["name"], home["display_address"]) == suffix)
            if epc:
                return {"uprn": epc[0]}
        # From here a hidden home is as if never recorded: the street's homes leave it out (STREET_HOMES_SQL).
        _check_cancelled(cancel)
        found = street_candidates(connection, number, row["name"], row["borough_id"],
                                    code.split(" ")[0])
    numbers = [n for n, _ in street_numbers(row["name"], found["homes"])]
    if code not in found["postcodes"] or not min(numbers) <= number <= max(numbers):
        return None
    point = None if row["center_lat"] is None or row["center_lon"] is None else \
        {"lat": row["center_lat"], "lon": row["center_lon"]}
    area_id = f"uk:lsoa:{row['lsoa_code']}" if row["lsoa_code"] else None
    return {"label": f"{number}{suffix} {row['name']}", "postcode": code, "likelyPostcode": found["likely"],
            "neighbours": found["neighbours"], "areaId": area_id, "point": point,
            "withheld": feature_flags.withheld()}
