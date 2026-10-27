"""The browser extension's per-portal kill switch (docs/superpowers/specs/2026-10-18-extension-legal-strategy.md §1, §6).

Each portal is `inline`, `side-panel` or `off`. CLOSE_KNIT_EXTENSION_MODES (a JSON object portal -> mode)
overrides the defaults without a release; unknown portals, unknown modes and bad JSON are ignored and logged.

Features whose legal position is still open (owner decision: on until settled) are switched the same way by
CLOSE_KNIT_EXTENSION_FEATURES (a JSON object feature -> true/false): `resultsLine` (the line under each search result)
and `mapPopup` (the line inside a portal's map popup card).
"""
from __future__ import annotations

import json
import logging
import os

logger = logging.getLogger(__name__)

MODES = ("inline", "side-panel", "off")
DEFAULT_MODES = {"rightmove": "inline", "zoopla": "inline", "onthemarket": "inline",
                 "spareroom": "side-panel", "openrent": "inline"}
NOTICE = ("Close Knit is independent and not affiliated with Rightmove, Zoopla, OnTheMarket, SpareRoom "
          "or OpenRent.")
ENV = "CLOSE_KNIT_EXTENSION_MODES"
DEFAULT_FEATURES = {"resultsLine": True, "mapPopup": True}
FEATURES_ENV = "CLOSE_KNIT_EXTENSION_FEATURES"


def _env_object(name: str, raw: str | None) -> dict:
    if not raw or not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except ValueError:
        logger.warning("%s is not JSON; using the defaults", name)
        return {}
    if not isinstance(parsed, dict):
        logger.warning("%s is not a JSON object; using the defaults", name)
        return {}
    return parsed


def overrides(raw: str | None) -> dict[str, str]:
    """The valid portal -> mode pairs in the env value; everything else is logged and dropped."""
    valid = {}
    for portal, mode in _env_object(ENV, raw).items():
        if portal in DEFAULT_MODES and mode in MODES:
            valid[portal] = mode
        else:
            logger.warning("%s: ignored %r -> %r", ENV, portal, mode)
    return valid


def feature_overrides(raw: str | None) -> dict[str, bool]:
    """The known feature -> true/false pairs in the env value; everything else is logged and dropped."""
    valid = {}
    for feature, on in _env_object(FEATURES_ENV, raw).items():
        if feature in DEFAULT_FEATURES and isinstance(on, bool):
            valid[feature] = on
        else:
            logger.warning("%s: ignored %r -> %r", FEATURES_ENV, feature, on)
    return valid


def extension_config() -> dict:
    modes = DEFAULT_MODES | overrides(os.environ.get(ENV))
    features = DEFAULT_FEATURES | feature_overrides(os.environ.get(FEATURES_ENV))
    return {"v": 1, "portals": {portal: {"mode": mode} for portal, mode in modes.items()}, "features": features,
            "notice": NOTICE}
