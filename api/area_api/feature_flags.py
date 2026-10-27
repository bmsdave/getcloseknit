"""Server flags for features that wait on a privacy, legal or licence review (FLAGS.md).

"1" turns a flag on and "0" turns it off. Unset, a flag follows the site: on while the site is a private
preview (CLOSE_KNIT_ACCESS=private, owner decision, before release), off once it is public or
when CLOSE_KNIT_ACCESS is not set at all (tests, local runs).

Calls anyone can make without the preview login (the open /mcp endpoint) run inside `public_call()`, where
every flag reads as off while the site is a private preview, even one set to "1": a "1" in the preview is a
decision for the logged-in preview, not for strangers (owner decision, CLOSE_KNIT_AIR_QUALITY waits
on the GLA). Once the site is public, "1" is the owner's decision for everyone and applies here too."""
from __future__ import annotations

import contextvars
import os
from contextlib import contextmanager
from typing import Iterator

# True for the length of one public call (see `public_call`); per request, so site requests keep the preview.
_public_call: contextvars.ContextVar[bool] = contextvars.ContextVar("close_knit_public_call", default=False)


def preview() -> bool:
    """The site is a private preview, so withheld features are on unless a flag says "0"."""
    if _public_call.get():
        return False
    return os.environ.get("CLOSE_KNIT_ACCESS", "").strip() == "private"


@contextmanager
def public_call() -> Iterator[None]:
    """Flags read as on the public site inside this block: unset is off, and while the site is a private
    preview a "1" is off too (see the module docstring).
    CLOSE_KNIT_MCP_ACCESS=site lets these calls follow the site instead (local testing only)."""
    token = _public_call.set(os.environ.get("CLOSE_KNIT_MCP_ACCESS", "").strip() != "site")
    try:
        yield
    finally:
        _public_call.reset(token)


def _on(name: str) -> bool:
    if _public_call.get() and os.environ.get("CLOSE_KNIT_ACCESS", "").strip() == "private":
        return False
    value = os.environ.get(name, "").strip()
    if value in ("0", "1"):
        return value == "1"
    return preview()


def mcp_data() -> bool:
    """The open /mcp endpoint answers tool calls with data; off, every data tool answers "coming soon".
    Only "1" turns it on, in the preview too: the flag is about strangers, so it never follows the site
    (FLAGS.md has the owner's decision)."""
    return os.environ.get("CLOSE_KNIT_MCP_DATA", "").strip() == "1"


def address_match() -> bool:
    """Match a portal listing to a full address."""
    return _on("CLOSE_KNIT_ADDRESS_MATCH")


def home_value() -> bool:
    """A value range for a matched home; needs address matching."""
    return address_match() and _on("CLOSE_KNIT_HOME_VALUE")



def epc_per_home() -> bool:
    """Per-home EPC facts (floor area, ratings, certificate fields)."""
    return _on("CLOSE_KNIT_EPC_PER_HOME")


def per_home_price_per_sqm() -> bool:
    """£/m² per home and per sale; needs per-home EPC floor areas."""
    return epc_per_home() and _on("CLOSE_KNIT_PER_HOME_PRICE_PER_SQM")


def per_home_valuation() -> bool:
    """An estimated price for a home."""
    return _on("CLOSE_KNIT_PER_HOME_VALUATION")


def epc_addresses() -> bool:
    """Homes with no recorded sale, addressed from EPC."""
    return _on("CLOSE_KNIT_EPC_ADDRESSES")


def council_tax_band() -> bool:
    """Council tax band per home."""
    return _on("CLOSE_KNIT_COUNCIL_TAX_BAND")


def ownership() -> bool:
    """Company and overseas ownership on the area card (HMLR CCOD/OCOD); off until the owner loads the files."""
    return _on("CLOSE_KNIT_OWNERSHIP")


# The `air-no2` map layer is the LAEI's; hidden with the rest of it while the flag is off.
AIR_METRICS = frozenset({"air-no2"})


def air_quality() -> bool:
    """GLA LAEI air pollution: the Health "Clean air" rating and row, the Air tile and the `air-no2` layer.
    Off until the GLA confirms OGL v3 for LAEI 2022 (FLAGS.md)."""
    return _on("CLOSE_KNIT_AIR_QUALITY")


def hidden_metrics() -> frozenset[str]:
    """Published metrics the API leaves out (metrics list, metric, packs, range criteria)."""
    return frozenset() if air_quality() else AIR_METRICS


def census_ranked() -> bool:
    """Census layers as a London rating (rank, filter, weight or criterion); off, they are descriptive only."""
    return _on("CLOSE_KNIT_CENSUS_RANKED")


def england() -> bool:
    """Coverage is all of England (any English LAD, ranks within the area's region); off, exactly the London
    behaviour of before. London-only sources stay London-only either way (FLAGS.md, area_api.coverage)."""
    return _on("CLOSE_KNIT_ENGLAND")


def school_links_gsg() -> bool:
    """The Good Schools Guide name search under a school's Visit & links (their terms have no linking clause)."""
    return _on("CLOSE_KNIT_SCHOOL_LINKS_GSG")


def school_links_locrating() -> bool:
    """The Locrating school page under a school's Visit & links (their terms have no linking clause)."""
    return _on("CLOSE_KNIT_SCHOOL_LINKS_LOCRATING")


# Each withholding flag under the name clients read in a payload's `withheld` list, in that list's order.
_WITHHELD = (("epc", epc_per_home), ("pricePerSqm", per_home_price_per_sqm), ("valuation", per_home_valuation),
             ("epcAddresses", epc_addresses), ("councilTaxBand", council_tax_band), ("laeiAir", air_quality),
             ("censusRanked", census_ranked))
# What a home's payloads (property profile, postcode list, street home) withhold.
HOME_FEATURES = ("epc", "pricePerSqm", "valuation", "epcAddresses", "councilTaxBand", "laeiAir")


def withheld(names: tuple[str, ...] = HOME_FEATURES) -> list[str]:
    """Which of these features are off, for clients to render a fallback (default: a home's features)."""
    unknown = set(names) - {name for name, _ in _WITHHELD}
    if unknown:
        raise ValueError(f"unknown withheld features: {sorted(unknown)}")
    return [name for name, on in _WITHHELD if name in names and not on()]
