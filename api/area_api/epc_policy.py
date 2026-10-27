"""Whether per-home EPC fields are served (RELEASE-CHECKLIST "Going public": EPC licence).

The EPC open data terms leave unclear whether a home's certificate fields may be republished per
address. Until counsel confirms they may, each home's floor area and certificate facts are served
as null: the keys stay, so clients render "not shown" rather than break. Area-level figures built
from EPC (medians, price bands by type) are unaffected. ``CLOSE_KNIT_EPC_PER_HOME=1`` serves them.
"""
from __future__ import annotations

from typing import Any

from . import feature_flags

PER_HOME_KEYS = ("floorAreaSquareMetres", "energyRating", "potentialEnergyRating", "energyCertificateDate",
                 "epcPropertyType", "builtForm", "constructionAgeBand", "habitableRooms", "floorLevel")


def per_home_epc() -> bool:
    return feature_flags.epc_per_home()


def per_home(item: dict[str, Any]) -> dict[str, Any]:
    """``item`` with its per-home EPC fields set to null unless they may be served."""
    if per_home_epc():
        return item
    return {key: (None if key in PER_HOME_KEYS else value) for key, value in item.items()}


def floor_area_note() -> str:
    """How sale disclaimers describe floor areas."""
    return ("Floor areas come from the latest EPC where matched" if per_home_epc()
            else "Floor areas are not shown per home")
