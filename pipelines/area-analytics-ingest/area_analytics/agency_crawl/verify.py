"""Tie an agency's website to a Companies House company by the company number printed on its own pages.

A site is read at its homepage plus at most two more same-domain pages linked as contact, terms, privacy or
legal. A company is tied to the domain only when one of its known numbers appears on those pages, so a guessed
domain (candidate_domains) that does not carry the number creates nothing. Nothing but the number, the redress
scheme named and one London postcode is kept; page text is never stored.
"""

import re
from html.parser import HTMLParser
from urllib.parse import urljoin, urldefrag, urlsplit

from area_analytics.agency_companies import normalise_postcode

from .urls import homepage, site_domain

MAX_EXTRA_PAGES = 2

_NUMBER = re.compile(r"(?<!\w)(?<!\d )(?:[A-Z]{2}\d{6}|\d(?: ?\d){5,7})(?!\d| \d|\w)")
_NUMBER_CONTEXT = re.compile(r"company|\bco\b|registered|\breg\b|registration|number|\bno\b", re.IGNORECASE)
# VAT, FCA, membership and phone numbers, with the "number"/"no" words that follow the label ("membership number").
_NOT_A_COMPANY = re.compile(r"\b(?:vat|frn|fca|member(?:s|ship)?|tel(?:ephone)?|phone|fax|mobile)\b"
                            r"(?:\W+(?:reg(?:istration|istered)?|number|no)\b)*", re.IGNORECASE)
CONTEXT_CHARS = 40  # "Registered in England and Wales under 05123456" puts the keyword 35 characters back
_POSTCODE = re.compile(r"(?<![A-Za-z0-9])[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}(?![A-Za-z0-9])")
_TPO = re.compile(r"the property ombudsman|\bTPO\b", re.IGNORECASE)
_PRS = re.compile(r"property redress scheme|\bPRS\b", re.IGNORECASE)
_LINK_WORDS = re.compile(r"contact|terms|privacy|legal", re.IGNORECASE)
_CONTACT = re.compile(r"contact", re.IGNORECASE)
_NAME_NOISE = re.compile(r"\bestate agents\b|\b(?:ltd|limited|llp|estates|lettings|property|properties|the|and)\b")


def _labelled_as_company_number(before: str) -> bool:
    """Whether the closest label before a number says company number, not a VAT, FCA, membership or phone one.

    Excluded labels (and the "number" words that belong to them) are blanked; the number is a company number
    only when a company word remains and no excluded label comes after the last of them."""
    blanked, excluded_at = before, []
    for label in _NOT_A_COMPANY.finditer(before):
        excluded_at.append(label.start())
        blanked = blanked[:label.start()] + " " * (label.end() - label.start()) + blanked[label.end():]
    words = list(_NUMBER_CONTEXT.finditer(blanked))
    return bool(words) and not any(start > words[-1].start() for start in excluded_at)


def company_numbers(text: str) -> set[str]:
    """Company numbers labelled company, co, registered, reg, registration, no. or number, padded to 8 digits.

    A VAT, FRN, FCA, membership, telephone, fax or mobile label closer to the number than any company label
    rules it out; one before the company label does not ("Member of TPO. Company no 1234567")."""
    found = set()
    for match in _NUMBER.finditer(text):
        if _labelled_as_company_number(text[max(0, match.start() - CONTEXT_CHARS):match.start()]):
            digits = match.group().replace(" ", "")
            found.add(digits.zfill(8) if digits.isdigit() else digits)
    return found


def uk_postcodes(text: str) -> list[str]:
    """Normalised postcodes in page order (upper case only, so ordinary words are not read as postcodes)."""
    return [normalise_postcode(match.group()) for match in _POSTCODE.finditer(text)]


def redress_scheme(text: str) -> str | None:
    """'TPO' or 'PRS' for the first scheme the text names, else None."""
    tpo, prs = _TPO.search(text), _PRS.search(text)
    if tpo and (not prs or tpo.start() < prs.start()):
        return "TPO"
    return "PRS" if prs else None


class _Links(HTMLParser):
    """Anchors as (href, text) and the visible text of the page."""

    def __init__(self):
        super().__init__()
        self.links, self.chunks = [], []
        self._href, self._text, self._skip = None, [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1
        elif tag == "a":
            self._href, self._text = dict(attrs).get("href"), []

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip:
            self._skip -= 1
        elif tag == "a" and self._href is not None:
            self.links.append((self._href, " ".join(self._text)))
            self._href = None

    def handle_data(self, data):
        if not self._skip:
            self.chunks.append(data)
            if self._href is not None:
                self._text.append(data.strip())


def _parse(html: str) -> _Links:
    parser = _Links()
    parser.feed(html or "")
    parser.close()
    return parser


def visible_text(html: str) -> str:
    return " ".join(_parse(html).chunks)


def verification_links(html: str, base_url: str) -> list[str]:
    """At most two same-domain links whose address or text mentions contact, terms, privacy or legal; contact first."""
    domain, picked = site_domain(base_url), []
    for href, text in _parse(html).links:
        if not _LINK_WORDS.search(href) and not _LINK_WORDS.search(text):
            continue
        url = urldefrag(urljoin(base_url, href.strip()))[0]
        if urlsplit(url).scheme not in ("http", "https") or site_domain(url) != domain:
            continue
        if url != urldefrag(base_url)[0] and url not in [u for u, _ in picked]:
            picked.append((url, bool(_CONTACT.search(href) or _CONTACT.search(text))))
    picked.sort(key=lambda item: not item[1])
    return [url for url, _ in picked[:MAX_EXTRA_PAGES]]


def candidate_domains(company_name: str) -> list[str]:
    """Up to four domains a company might use, from its name without legal and generic words."""
    slug = re.sub(r"[^a-z0-9]", "", _NAME_NOISE.sub(" ", (company_name or "").lower().replace("&", " ")))
    if not slug:
        return []
    return [f"{slug}.co.uk", f"{slug}.com", f"{slug}.london", f"{slug}estates.co.uk"]


def check_site(fetcher, url, known_numbers: set[str], london_postcodes: set[str], opted_out=frozenset()):
    """(status, domain, rows): status is verified, none, blocked, robots, dead or opted_out; domain is the final one,
    or None.

    A homepage that redirects to an opted-out domain stops there: no further page is read, nothing is returned.
    robots: robots.txt refuses CloseKnitBot the homepage (an opt-out by robots.txt, not a dead site)."""
    home = fetcher.get(homepage(url))
    if home.outcome == "robots":
        return "robots", home.domain, []
    if home.outcome != "ok":
        return ("blocked" if home.outcome == "blocked" else "dead"), None, []
    if home.domain in opted_out:
        return "opted_out", home.domain, []
    pages = [(home.final_url, home.text)]
    contact = None
    for link in verification_links(home.text, home.final_url):
        page = fetcher.get(link)
        if page.outcome == "ok":
            pages.append((link, page.text))
            if contact is None and _CONTACT.search(link):
                contact = len(pages) - 1
    texts = [(link, visible_text(text)) for link, text in pages]
    numbers = {}
    for link, text in texts:
        for number in company_numbers(text) & known_numbers:
            numbers.setdefault(number, link)
    if not numbers:
        return ("blocked" if home.domain in fetcher.blocked else "none"), home.domain, []
    postcode = next((pc for _, text in ([texts[contact]] if contact is not None else []) + texts
                     for pc in uk_postcodes(text) if pc in london_postcodes), None)
    scheme = next((s for _, text in texts if (s := redress_scheme(text))), None)
    rows = [{"domain": home.domain, "company_number": number, "page_url": link, "redress_scheme": scheme,
             "office_postcode": postcode} for number, link in sorted(numbers.items())]
    return "verified", home.domain, rows


def verify_site(fetcher, url, known_numbers: set[str], london_postcodes: set[str]) -> list[dict]:
    """agency_site_company rows for the site at `url`; [] when none of the known numbers is on its pages."""
    return check_site(fetcher, url, known_numbers, london_postcodes)[2]
