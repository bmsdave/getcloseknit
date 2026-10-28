"""Deprecated field names kept for one contract version (docs/architecture/global-geography.md §10, step R1).

The "London" fields always held the area's region (London for a London area) and the "England" percentile the
country's, so they were renamed: londonPercentile -> regionPercentile, englandPercentile -> countryPercentile and
london<X> -> region<X>. Code builds payloads with the new names only; every JSON answer (HTTP and MCP) passes through
`with_aliases`, which adds the old name beside each new one with the same value, so the extension, the iOS app and
MCP clients that still read the old names keep working. Answers that carry an old name also get the RFC 9745
Deprecation header. Removal (owner decision): 30 days after the browser extension release that reads the
new names is published. Until then the date is unknown, so no RFC 8594 Sunset header is sent; once it ships, set
CLOSE_KNIT_ALIAS_SUNSET=YYYY-MM-DD (publication + 30 days, RELEASE-CHECKLIST.md) and every such answer says Sunset.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from email.utils import format_datetime
from typing import Any, Mapping

from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from starlette.background import BackgroundTask

# new name -> old (deprecated) name
DEPRECATED: dict[str, str] = {
    "regionPercentile": "londonPercentile",
    "countryPercentile": "englandPercentile",
    "regionActiveShare": "londonActiveShare",
    "regionChange": "londonChange",
    "regionChange1yPct": "londonChange1yPct",
    "regionChange5yPct": "londonChange5yPct",
    "regionDensityPerKm2": "londonDensityPerKm2",
    "regionEntireHomeShare": "londonEntireHomeShare",
    "regionMedian": "londonMedian",
    "regionMonthlyRent": "londonMonthlyRent",
    "regionPer1000": "londonPer1000",
    "regionPer1000Homes": "londonPer1000Homes",
    "regionPool": "londonPool",
    "regionRank": "londonRank",
    "regionRanks": "londonRanks",
    "regionRate": "londonRate",
    "regionRent": "londonRent",
    "regionShare": "londonShare",
}
# RFC 9745: the time the old names were deprecated (2026-10-26T00:00:00Z) as a structured-field date.
DEPRECATION_HEADER = "@1792972800"
SUNSET_ENV = "CLOSE_KNIT_ALIAS_SUNSET"


def sunset_header() -> str | None:
    """RFC 8594 Sunset for the old names: CLOSE_KNIT_ALIAS_SUNSET (YYYY-MM-DD) as an HTTP date; None while unset."""
    raw = os.environ.get(SUNSET_ENV, "").strip()
    if not raw:
        return None
    try:
        day = datetime.strptime(raw, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return format_datetime(day, usegmt=True)


def with_aliases(value: Any) -> Any:
    """`value` with each renamed field's old name added beside it (same value). Never mutates `value`: dicts and
    lists on the way to an added name are copied, everything else is shared."""
    return _alias(value)[0]


def has_aliases(value: Any) -> tuple[Any, bool]:
    """(with_aliases(value), whether any old name was added)."""
    return _alias(value)


def _alias(value: Any) -> tuple[Any, bool]:
    if isinstance(value, dict):
        out: dict | None = None
        added = False
        for key, item in value.items():
            new_item, item_added = _alias(item)
            added = added or item_added
            if new_item is not item:
                if out is None:
                    out = dict(value)
                out[key] = new_item
        for key in value:
            old = DEPRECATED.get(key) if isinstance(key, str) else None
            if old is not None and old not in value:
                if out is None:
                    out = dict(value)
                out[old] = out[key]
                added = True
        return (value if out is None else out), added
    if isinstance(value, list):
        copied: list | None = None
        added = False
        for index, item in enumerate(value):
            if not isinstance(item, (dict, list)):
                continue
            new_item, item_added = _alias(item)
            added = added or item_added
            if new_item is not item:
                if copied is None:
                    copied = list(value)
                copied[index] = new_item
        return (value if copied is None else copied), added
    return value, False


def _dumps(content: Any) -> bytes:
    return json.dumps(content, ensure_ascii=False, allow_nan=False, indent=None, separators=(",", ":"),
                      default=jsonable_encoder).encode("utf-8")


class AliasedJSONResponse(JSONResponse):
    """The API's JSON response: old field names added (`with_aliases`), with the Deprecation header (and Sunset, once
    set) when any was."""

    def render(self, content: Any) -> bytes:
        # A route may return this response with its payload as built (the 22 MB England match pack skips FastAPI's
        # jsonable_encoder walk): a value json cannot write (a database Decimal, a date) goes through it here.
        body = _dumps(content)
        # Every new name starts "region" or "country": a body without either key needs no alias, so a big answer
        # (the England match pack, ~2 million values) skips the walk (0.2 s locally) for two scans of its bytes.
        if b'"region' not in body and b'"country' not in body:
            return body
        content, self._deprecated_names = has_aliases(content)
        return _dumps(content) if self._deprecated_names else body

    def __init__(self, content: Any, status_code: int = 200, headers: Mapping[str, str] | None = None,
                 media_type: str | None = None, background: BackgroundTask | None = None) -> None:
        self._deprecated_names = False
        super().__init__(content, status_code, headers, media_type, background)
        if self._deprecated_names:
            self.headers["Deprecation"] = DEPRECATION_HEADER
            sunset = sunset_header()
            if sunset:
                self.headers["Sunset"] = sunset
