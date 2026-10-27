"""The response and request models are the API contract's one source (review #23, A13/SE-11).

contracts/openapi.yaml and web/src/lib/api-types.gen.ts are generated from them (deploy/tools/gen_openapi.py);
neither is edited by hand.

The models document, they do not serialize. Every endpoint still returns the dict it builds and the API sends it
as before (AliasedJSONResponse: the deprecated field names added, key order and numbers untouched), so declaring a
model can never change a payload or turn an unexpected value into a 500. ContractRoute makes that so: it gives
OpenAPI the model and leaves FastAPI's runtime handling of the endpoint exactly as without one. The models are
checked against real answers instead (api/tests/test_openapi_contract.py and test_recorded_responses.py).
"""
from __future__ import annotations

from typing import Annotated, Any, Callable, Literal, TypeVar, get_origin

from fastapi import params
from fastapi.datastructures import Default, DefaultPlaceholder
from fastapi.routing import APIRoute
from fastapi.utils import create_model_field
from pydantic import BaseModel, ConfigDict, Field
from typing_extensions import TypeAliasType


class Contract(BaseModel):
    """A documented payload. Clients ignore unknown fields (the versioning policy): a field not modelled yet is simply
    not in the schema. The core answers have every field modelled (test_openapi_contract checks the recordings)."""

    model_config = ConfigDict(populate_by_name=True)


GeographyId = TypeAliasType("GeographyId", Annotated[str, Field(pattern=r"^uk:(lsoa|msoa|lad):E[0-9]{8}$")])
LsoaId = TypeAliasType("LsoaId", Annotated[str, Field(pattern=r"^uk:lsoa:E[0-9]{8}$")])
Period = TypeAliasType("Period", Annotated[str, Field(pattern=r"^[0-9]{4}-[0-9]{2}$")])
Urn = TypeAliasType("Urn", Annotated[str, Field(pattern=r"^[0-9]{6}$")])
LatLon = TypeAliasType("LatLon", tuple[float, float])
Email = Annotated[str, Field(json_schema_extra={"format": "email"})]
Carrier = TypeAliasType("Carrier", Literal["lsoa", "msoa", "lad"])
Quality = TypeAliasType("Quality", Literal["observed", "fallback", "suppressed"])
FactorId = TypeAliasType("FactorId", Literal[
    "affordability", "market-level", "growth-outlook", "crime", "deprivation", "income", "social-renting", "commute",
    "schools", "station-access", "noise", "disorder", "epc-share", "leasehold-share"])
# A metric id as /api/v1/metrics lists it: the catalogue is data (metric_definition rows), not a closed list here.
# The web types it as its own METRIC_IDS union (web/scripts/gen-api-types.mjs maps this pattern to it).
MetricId = TypeAliasType("MetricId", Annotated[str, Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$",
                                                          examples=["price-per-square-metre"])])



NO_RELEASE = "No active product release"


def errors(described: dict[int, str]) -> dict[int | str, dict[str, Any]]:
    """`responses=` for a route's documented error statuses: {400: "why"} -> {400: {"description": "why"}}."""
    return {code: {"description": text} for code, text in described.items()}


_Endpoint = TypeVar("_Endpoint", bound=Callable[..., Any])


def request_body(model: type[BaseModel] | Any) -> Callable[[_Endpoint], _Endpoint]:
    """Document an endpoint's JSON body with `model`. The endpoint keeps reading the raw dict it validates itself
    (its 400s and messages unchanged); the model is what OpenAPI shows. Put it under the route decorator."""
    def mark(endpoint: _Endpoint) -> _Endpoint:
        endpoint.__contract_request__ = model  # type: ignore[attr-defined]
        return endpoint
    return mark


def _documents(model: Any) -> bool:
    return not isinstance(model, DefaultPlaceholder) and model is not None and (
        isinstance(model, type) and issubclass(model, BaseModel) or get_origin(model) is not None
        or isinstance(model, TypeAliasType))


class ContractRoute(APIRoute):
    """An APIRoute whose response_model (and request_body model) only document. FastAPI builds the request handler
    as if neither were given, then OpenAPI reads the models from response_field / body_field."""

    def __init__(self, path: str, endpoint: Callable[..., Any], *, response_model: Any = Default(None),
                 **kwargs: Any) -> None:
        documented = response_model if _documents(response_model) else None
        if documented is None:
            super().__init__(path, endpoint, response_model=response_model, **kwargs)
        else:
            super().__init__(path, endpoint, response_model=Default(None), **kwargs)
            self.response_model = documented
            self.response_field = create_model_field(
                name="Response_" + self.unique_id, type_=documented, mode="serialization")
        request = getattr(endpoint, "__contract_request__", None)
        if request is not None:
            self.body_field = create_model_field(
                name="payload", type_=request, mode="validation",
                field_info=params.Body(annotation=request, default=..., media_type="application/json"))


def binary(media_type: str) -> dict[int | str, dict[str, Any]]:
    """`responses=` for a route answering raw bytes (a tile, an image) with response_class=Response."""
    return {200: {"content": {media_type: {"schema": {"type": "string", "format": "binary"}}}}}


def text(media_type: str) -> dict[int | str, dict[str, Any]]:
    return {200: {"content": {media_type: {"schema": {"type": "string"}}}}}
