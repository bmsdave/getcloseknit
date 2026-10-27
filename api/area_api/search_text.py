"""One normal form for what people type into search, and safe LIKE patterns (#228, #229, #230, #239).

normalise_query() is the Python side; NAME_KEY_SQL is its SQL twin for the name columns the
area search compares against (tests pin the two together). Address text is matched through the
trigram index on display_address (migrations 010/037), so only the needle is normalised there.
"""
import re
import unicodedata

from .scope import current as current_scope

QUOTES = re.compile(r"['‘’`]")

# Postgres twin of normalise_query() for a name column: lower case, & → and, apostrophes (straight
# and curly) dropped, dots dropped, hyphens and commas to spaces, double spaces collapsed. Plain
# replace() chains so the same text runs under SQLite in tests.
NAME_KEY_SQL = ("replace(replace(replace(replace(replace(replace(replace(lower({column}), "
                "'&', ' and '), '''', ''), '’', ''), '.', ''), '-', ' '), ',', ' '), '  ', ' ')")

# ^N1, E14, SW1A, EC2$: a bare postcode district (outcode) with no inward code.
DISTRICT = re.compile(r"^([A-Z]{1,2})\d[A-Z\d]?$")
FULL_POSTCODE = re.compile(r"^([A-Z]{1,2})\d[A-Z\d]?\s*\d[A-Z]{2}$")
# Postcode areas with at least one postcode inside Greater London.
LONDON_POSTCODE_AREAS = frozenset(
    "E EC N NW SE SW W WC BR CR DA EN HA IG KT RM SM TW UB WD CM SL TN".split())
# Postcode areas with at least one postcode in England (ONSPD Aug 2026, ctry26cd E92000001; GIR left out):
# CLOSE_KNIT_ENGLAND's coverage. Border areas (CH, DG, LD, LL, NP, SY, TD) are partly Welsh or Scottish.
ENGLAND_POSTCODE_AREAS = frozenset(
    "AL B BA BB BD BH BL BN BR BS CA CB CH CM CO CR CT CV CW DA DE DG DH DL DN DT DY E EC EN EX FY GL GU "
    "HA HD HG HP HR HU HX IG IP KT L LA LD LE LL LN LS LU M ME MK N NE NG NN NP NR NW OL OX PE PL PO PR "
    "RG RH RM S SE SG SK SL SM SN SO SP SR SS ST SW SY TA TD TF TN TQ TR TS TW UB W WA WC WD WF WN WR WS "
    "WV YO".split())
# Portal-style address: the words, then an optional "London", then a district with an optional
# inward code, comma or not ("Kings Grove SE15", "10 Borwick Avenue, E17 6RA"; #149).
ADDRESS_TAIL = re.compile(
    r"^(.*?[a-z].*?)[,\s]+(?:london[,\s]+)?([a-z]{1,2}\d[a-z\d]?)(?:\s*(\d[a-z]{2}))?\s*$", re.I)

EMPTY_REASONS = {
    "outside-london": "Nothing found: that postcode is outside Close Knit's London coverage.",
    "outside-coverage": "Nothing found: that postcode is outside Close Knit's coverage (England).",
    "unknown-postcode": "Nothing found: a London postcode, but not a current one with any home or "
                        "area in Close Knit's data.",
    "no-match": "Nothing found: no station, area, postcode or street matches; try another "
                "spelling or a nearby place.",
}


UNKNOWN_ENGLAND_POSTCODE = ("Nothing found: an English postcode, but not a current one with any home or area in "
                            "Close Knit's data.")


def reason_text(reason: str) -> str:
    """The caveat for an empty search's reason (EMPTY_REASONS, worded for the call's scope: what it covers)."""
    served = current_scope()
    if reason == "unknown-postcode" and served.level == "nation":
        return UNKNOWN_ENGLAND_POSTCODE
    if reason == "outside-coverage":
        return f"Nothing found: that postcode is outside Close Knit's coverage ({served.covers})."
    return EMPTY_REASONS[reason]


def normalise_query(text: str | None, *, keep: str = "") -> str:
    """"St. John’s Wood", "ST JOHNS WOOD" and "st-johns-wood" all become "st johns wood".

    Accents are stripped, "&" reads "and", "saint" reads "st", apostrophes vanish (so a possessive
    keeps its s: "King's" → "kings"), and every other non-alphanumeric run becomes one space.
    `keep` lists punctuation to leave in place: address search keeps the comma that separates a
    flat from its building, and with "'" apostrophes stay (curly ones straightened) for a stored
    address that spells "St Mary's Road" with one.
    """
    key = unicodedata.normalize("NFKD", text or "")
    key = "".join(ch for ch in key if not unicodedata.combining(ch)).lower()
    key = QUOTES.sub("'" if "'" in keep else "", key.replace("&", " and "))
    key = re.sub(r"\bsaint\b", "st", key)
    kept = re.escape(keep) if keep else ""
    key = re.sub(rf"[^a-z0-9{kept}]+", " ", key)
    return " ".join(key.split())


def like_escape(needle: str) -> str:
    """The needle as a LIKE literal: \\, % and _ no longer act as wildcards (pair with ESCAPE '\\')."""
    return needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def split_address_tail(text: str) -> tuple[str, str | None, str | None]:
    """(address words, district, full postcode): "10 Borwick Avenue E17 6RA" -> ("10 Borwick Avenue",
    "E17", "E17 6RA"); "Montague Road E8" -> (..., "E8", None). A query with no trailing postcode
    comes back whole, so "A1 Road" and a bare "NW5 1AA" keep their meaning."""
    match = ADDRESS_TAIL.match(text.strip())
    if match is None:
        return text.strip(), None, None
    head, district, inward = match[1].rstrip(", "), match[2].upper(), match[3]
    return head, district, f"{district} {inward.upper()}" if inward else None


def postcode_like(district: str | None, postcode: str | None) -> str:
    """The `postcode LIKE %s` pattern for a parsed tail: the postcode, "E17 %" for a district, else "%"."""
    return postcode or (f"{district} %" if district else "%")


def postcode_district(text: str | None) -> str | None:
    """"n1" / "SW1A" → "N1" / "SW1A"; None unless the whole query is a bare district."""
    key = normalise_query(text).upper()
    return key if DISTRICT.match(key) else None


def empty_reason(query: str | None) -> str:
    """Why a search found nothing: outside-london (outside-coverage with CLOSE_KNIT_ENGLAND),
    unknown-postcode or no-match (#230)."""
    key = normalise_query(query).upper()
    match = DISTRICT.match(key) or FULL_POSTCODE.match(key)
    if match is None:
        return "no-match"
    served = current_scope()
    areas = ENGLAND_POSTCODE_AREAS if served.level == "nation" else LONDON_POSTCODE_AREAS
    return "unknown-postcode" if match[1] in areas else served.outside_reason
