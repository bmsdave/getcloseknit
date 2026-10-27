"""A school's onward links ("Visit & links" on /school/{urn}), every one a counted /go click-out.

The card carries `/go/school-<target>?urn=<urn>&from=web` links; /go rebuilds the destination from the URN and
the database (the GIAS website, name, phase and local authority), never from the request, so it can only open
these hosts. The phone is a `tel:` link the page counts itself (no redirect).

  * Official (no flag): the school's website (GIAS SchoolWebsite), admissions (the same website: no open dataset
    has admissions or open-day pages; the council's page when GIAS lists no website), Ofsted reports, DfE
    performance tables, GIAS, Ofsted Parent View (a name search: results pages use an internal id), the borough's
    GOV.UK school-place page and eAdmissions (the common portal of the 33 London councils).
  * Guides behind default-off flags (FLAGS.md): Good Schools Guide (a name search; the review is paid) and
    Locrating (URN page). Off, the key stays with a null href and the page draws no tile.
"""
from __future__ import annotations

import re
from typing import Any, Mapping
from urllib.parse import quote_plus, urlsplit

from . import feature_flags

# The gov.uk "apply for a school place" slug of each London local authority (all 33 return 200).
COUNCIL_SLUGS = frozenset({
    "barking-and-dagenham", "barnet", "bexley", "brent", "bromley", "camden", "city-of-london", "croydon",
    "ealing", "enfield", "greenwich", "hackney", "hammersmith-and-fulham", "haringey", "harrow", "havering",
    "hillingdon", "hounslow", "islington", "kensington-and-chelsea", "kingston-upon-thames", "lambeth",
    "lewisham", "merton", "newham", "redbridge", "richmond-upon-thames", "southwark", "sutton", "tower-hamlets",
    "waltham-forest", "wandsworth", "westminster",
})
GOV_UK_APPLY = {"primary": "https://www.gov.uk/apply-for-primary-school-place",
                "secondary": "https://www.gov.uk/apply-for-secondary-school-place"}
EADMISSIONS = "https://www.eadmissions.org.uk/"

# Card key -> /go target (portal "school-<target>"), in the page's fixed order: official first, guides last.
TARGETS = {
    "website": "website", "admissions": "admissions", "ofstedReport": "ofsted", "dfePerformance": "dfe-performance",
    "parentView": "parent-view", "councilAdmissions": "council-admissions", "gias": "gias",
    "eAdmissions": "eadmissions", "goodSchoolsGuide": "gsg", "locrating": "locrating",
}
FLAGGED = {"gsg": feature_flags.school_links_gsg, "locrating": feature_flags.school_links_locrating}
GO_PORTALS = tuple(f"school-{target}" for target in TARGETS.values())

URN = re.compile(r"^[0-9]{6}$")
HOST = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$")


def website(raw: str | None) -> str | None:
    """GIAS SchoolWebsite as an absolute http(s) URL ("www.x.org.uk" -> "https://www.x.org.uk"), or None."""
    text = (raw or "").strip()
    if not text or re.search(r"\s", text):
        return None
    if not re.match(r"^https?://", text, re.I):
        text = f"https://{text}"
    parts = urlsplit(text)
    host = (parts.hostname or "").lower()
    if parts.scheme.lower() not in ("http", "https") or not HOST.match(host) or parts.username or parts.password:
        return None
    return text


def website_host(url: str) -> str:
    """"thealdgateschool.org" for the tile's second line."""
    return (urlsplit(url).hostname or "").lower().removeprefix("www.")


def phone(raw: str | None) -> dict | None:
    """GIAS TelephoneNum as {href: "tel:+44…", number: "020 7123 4567"}; None unless a UK number of 10-11 digits."""
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("44"):
        digits = "0" + digits[2:]
    if not digits.startswith("0") or len(digits) not in (10, 11):
        return None
    if digits.startswith("02") and len(digits) == 11:
        number = f"{digits[:3]} {digits[3:7]} {digits[7:]}"
    elif len(digits) == 11:
        number = f"{digits[:5]} {digits[5:]}"
    else:
        number = digits
    return {"href": f"tel:+44{digits[1:]}", "number": number}


def council_slug(local_authority: str | None) -> str | None:
    slug = re.sub(r"[^a-z0-9]+", "-", (local_authority or "").lower().replace("&", " and ")).strip("-")
    return slug if slug in COUNCIL_SLUGS else None


def council_url(phase: str | None, local_authority: str | None) -> str:
    """The borough's GOV.UK page (it names the council's admissions site), else GOV.UK's postcode step."""
    base = GOV_UK_APPLY["secondary" if phase == "secondary" else "primary"]
    slug = council_slug(local_authority)
    return f"{base}/{slug}" if slug else base


def destination(target: str, row: Mapping[str, Any]) -> str | None:
    """Where /go/school-<target> leads for one school row (urn, name, phase, local_authority, website), or None."""
    urn = row.get("urn") or ""
    if target not in TARGETS.values() or not URN.match(urn):
        return None
    if target in FLAGGED and not FLAGGED[target]():
        return None
    site = website(row.get("website"))
    name = (row.get("name") or "").strip()
    match target:
        case "website":
            return site
        case "admissions":
            return site or council_url(row.get("phase"), row.get("local_authority"))
        case "ofsted":
            return f"https://reports.ofsted.gov.uk/provider/ELS/{urn}"
        case "dfe-performance":
            return f"https://www.compare-school-performance.service.gov.uk/school/{urn}"
        case "gias":
            return f"https://get-information-schools.service.gov.uk/Establishments/Establishment/Details/{urn}"
        case "parent-view":
            return f"https://parentview.ofsted.gov.uk/parent-view-results?name={quote_plus(name)}" if name else None
        case "council-admissions":
            return council_url(row.get("phase"), row.get("local_authority"))
        case "eadmissions":  # the 33 London councils' common portal: London's schools only
            return EADMISSIONS if council_slug(row.get("local_authority")) else None
        case "gsg":
            return (f"https://www.goodschoolsguide.co.uk/uk-schools/search?name={quote_plus(name.lower())}"
                    if name else None)
        case "locrating":
            return f"https://www.locrating.com/schools-0urn{urn}.aspx"
    return None


def go_href(target: str, urn: str) -> str:
    return f"/go/school-{target}?urn={urn}&from=web"


def links(row: Mapping[str, Any], telephone: str | None = None) -> dict:
    """The card's `links`: every key always present. A link is {href, portal} (+ host / via / council / phase);
    href is a /go click-out, null when its flag is off; a key is null when the data is missing (no website,
    no phone)."""
    urn = row["urn"]
    out: dict[str, Any] = {}
    for key, target in TARGETS.items():
        url = destination(target, row)
        href = go_href(target, urn) if url else None
        out[key] = {"href": href, "portal": f"school-{target}"}
    site = website(row.get("website"))
    out["website"] = {**out["website"], "host": website_host(site)} if site else None
    out["admissions"]["via"] = "website" if site else "council"
    slug = council_slug(row.get("local_authority"))
    out["councilAdmissions"].update({"council": row.get("local_authority") if slug else None,
                                     "phase": "secondary" if row.get("phase") == "secondary" else "primary"})
    out["phone"] = phone(telephone)
    return out
