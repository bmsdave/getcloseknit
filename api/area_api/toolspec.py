"""Shared types for agent tools (kept apart from the registry so tool
modules can be imported without a cycle)."""
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping

from pydantic import BaseModel, ConfigDict

from .evidence import EvidenceReader
from .repository import load_match_evidence, load_zone_distances, load_zone_lsoas


class ToolNotFound(KeyError):
    pass


class InvalidToolArguments(ValueError):
    pass


@dataclass(frozen=True)
class ToolContext:
    reader: EvidenceReader
    load_match_rows: Callable[[Mapping[str, Any]], list[dict]] = load_match_evidence
    load_zone_lsoas: Callable[[Any], set[str] | None] = load_zone_lsoas
    # Metres from every area to the zones (the Where criterion); None falls back to inside/outside.
    load_zone_distances: Callable[[Any, float], dict | None] = load_zone_distances
    cancel: Callable[[], bool] | None = None
    # The MCP session's usage tag (area_api.usage.session_tag): /go links carry it so a click-out is
    # counted against the conversation that produced it.
    session: str | None = None
    # Whose call this is (area_api.usage.traffic): live, team or tech, stored with any feedback it sends.
    traffic: str = "live"


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NoArguments(StrictInput):
    pass


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_model: type[BaseModel]
    handler: Callable[[ToolContext, Any], dict]
    schema_version: str
    tags: tuple[str, ...] = field(default=())
