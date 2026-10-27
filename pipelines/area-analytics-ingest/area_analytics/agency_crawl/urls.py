"""Agency website URLs: the bare domain, the homepage and the SQL twin of the domain."""

import re
from urllib.parse import urlsplit

_HOST_LEAD = re.compile(r"[^:/?#@]*")
_OPAQUE_SCHEME = re.compile(r"[a-z][a-z0-9+.-]*:", re.IGNORECASE)

# Same result as site_domain() over a column named website; pasted verbatim into the agency_office view.
SITE_DOMAIN_SQL = (
    "CASE WHEN lower(btrim(website)) ~ '^(https?://|[^:/?#@]*[.][^:/?#@]*([:/?#]|$))' "
    "THEN nullif(regexp_replace(regexp_replace(lower(btrim(website)), '^https?://', ''), "
    "'^www\\.|[:/?#].*$', '', 'g'), '') END"
)

# Portals, social networks, link pages and site builders: many agencies' links point at them, none is an
# agency's own site, so they are never read or tied to a company (a subdomain counts as its parent).
SHARED_HOSTS = frozenset((
    "rightmove.co.uk", "zoopla.co.uk", "onthemarket.com", "primelocation.com", "openrent.co.uk", "spareroom.co.uk",
    "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "linktr.ee", "sites.google.com",
    "google.com", "yell.com", "wixsite.com", "business.site", "tiktok.com", "youtube.com",
))


def is_shared_host(domain):
    """Whether the domain, or any parent of it, is in SHARED_HOSTS."""
    labels = (domain or "").lower().strip(".").split(".")
    return any(".".join(labels[i:]) in SHARED_HOSTS for i in range(len(labels)))


def first_website(value):
    """The first of several websites in one tag ("a.co.uk;b.co.uk"), trimmed; None when it is empty.

    The agency_office view applies the same split_part(..., ';', 1) before its domain rule."""
    first = (value or "").split(";", 1)[0].strip()
    return first or None


def _split(url):
    """urlsplit of an http(s) URL, assuming https when the scheme is missing; None for anything else."""
    text = (url or "").strip()
    if not text:
        return None
    if "://" not in text:
        opaque = _OPAQUE_SCHEME.match(text)
        if opaque and "." not in opaque.group():
            return None
        # Same guard as SITE_DOMAIN_SQL: the text before the first : / ? # @ must hold a dot and end at one of : / ? #
        lead = _HOST_LEAD.match(text)
        if "." not in lead.group() or (lead.end() < len(text) and text[lead.end()] not in ":/?#"):
            return None
        text = "https://" + text
    try:
        parts = urlsplit(text)
    except ValueError:
        return None
    return parts if parts.scheme.lower() in ("http", "https") and parts.hostname else None


def site_domain(url):
    """Lower-case host without www. and port, or None when the input is not a web address."""
    parts = _split(url)
    if parts is None:
        return None
    host = parts.hostname
    return (host[4:] if host.startswith("www.") else host) or None


def homepage(url):
    """scheme://host/ of the address, keeping its scheme and defaulting to https."""
    parts = _split(url)
    return f"{parts.scheme.lower()}://{parts.hostname}/" if parts else None
