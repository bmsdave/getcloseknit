"""The OpenAPI document of the app: FastAPI's, plus what FastAPI cannot know.

app.openapi() serves it at /openapi.json; deploy/tools/gen_openapi.py writes it to contracts/openapi.yaml (and
gate.sh fails when the committed file differs). Added here:
  - the versioning and coverage policy (info.description);
  - the paths the Next.js BFF serves on fixtures (x-status web-fixture), documented by models like any other;
  - each deprecated old field name beside its new one (contract_aliases.DEPRECATED), as every answer carries both;
  - no `title` on schemas and parameters: pydantic's are the field names again ("Geographyid").
"""
from __future__ import annotations

from typing import Any

from fastapi.openapi.utils import get_openapi
from pydantic.json_schema import models_json_schema

from ..contract_aliases import DEPRECATED
from . import models

POLICY = """
Versioning policy (AE-35): paths carry the major version (/api/v1) and every payload carries a schemaVersion
envelope constant. Within one schemaVersion only optional additive fields may appear; clients MUST ignore unknown
fields and servers MUST keep sending documented required fields. A breaking change mints a new path major or a new
schemaVersion and the previous shape keeps serving until its documented retirement. Optional valuations may be null
or omitted; a missing valuation is unavailable, never zero: clients map missing/null to "not published", never to a
numeric default. Property identity is the UPRN string and clients preserve it verbatim: no numeric coercion, no
trimming. Golden fixtures under contracts/fixtures/golden-v1 pin the shared shapes.

This document is generated from the API (deploy/tools/gen_openapi.py, models in api/area_api/contract). Schemas
list the fields documented so far; an answer may carry more. Paths marked x-status web-fixture are served by the
Next.js BFF on fixtures, not by this API.

Coverage (CLOSE_KNIT_ENGLAND, FLAGS.md): London, or all of England with the flag on. Every regional percentile,
rank, share or median (regionPercentile, regionMedian, regionShare...) is computed within the area's region (ONS
region, E12000001-E12000009), so a London area keeps its London figures. Renamed in step R1
(docs/architecture/global-geography.md): londonPercentile -> regionPercentile, englandPercentile ->
countryPercentile, london<X> -> region<X>, and the kind, carrier and level borough -> lad. For one contract version
every answer also carries each old field name next to the new one with the same value (deprecated; such answers
send the Deprecation header; Sunset once its date is set), and ?carrier= / ?level= still take borough for lad. Step R2
renamed the ids: uk:borough:<code> -> uk:lad:<code>. Answers name uk:lad: ids; every route, body and tool still takes
an old uk:borough: id and answers for its LAD (page URLs /area/borough/... move 301 to /area/lad/...). Area tile URLs
and their layer keep borough. Every /api/v1/areas/{id} route (and its sub-routes) adds rankScope
{code, name}: the region those figures are computed in (null for an area the region table does not know). With the
flag off an area outside London is area-not-found and lists, packs, shapes and searches hold London's areas only.
Places a source covers in London only (TfL, ULEZ, LAEI air, GLA layers, council admissions, HMO registers, Inside
Airbnb) read null elsewhere; reasons say outside-coverage instead of outside-london with the flag on.
""".strip()


def _ref(name: str) -> dict[str, str]:
    return {"$ref": f"#/components/schemas/{name}"}


def _json(description: str, name: str) -> dict[str, Any]:
    return {"description": description, "content": {"application/json": {"schema": _ref(name)}}}


GEOGRAPHY_PATH = {"name": "id", "in": "path", "required": True, "schema": _ref("GeographyId")}
# Served by the Next.js BFF on fixtures (web/src/app/api), not by this API.
WEB_FIXTURE_MODELS = [models.PropertyHistoryResponse, models.FactorCollection, models.MatchPack, models.MatchJob,
                      models.PriceForecast, models.JourneyRequest, models.JourneyResult]
WEB_FIXTURE_PATHS: dict[str, dict[str, Any]] = {
    "/api/v1/properties/{uprn}/history": {"get": {
        "summary": "Get recorded property history", "operationId": "getPropertyHistory",
        "parameters": [{"name": "uprn", "in": "path", "required": True,
                        "schema": {"type": "string", "pattern": "^[0-9]+$"}}],
        "responses": {"200": _json("Actual transactions and labelled comparisons", "PropertyHistoryResponse"),
                      "404": {"description": "Property not found"}}}},
    "/api/v1/factors": {"get": {
        "summary": "List personal-match factor definitions", "operationId": "listFactors",
        "responses": {"200": _json("Versioned factor definitions", "FactorCollection")}}},
    "/api/v1/matches/jobs/{id}": {"get": {
        "summary": "Poll a route-dependent match job", "operationId": "getMatchJob",
        "parameters": [{"name": "id", "in": "path", "required": True, "schema": {"type": "string"}}],
        "responses": {"200": _json("Completed match pack", "MatchPack"),
                      "202": _json("Job remains in progress", "MatchJob"),
                      "404": {"description": "Job not found"}}}},
    "/api/v1/areas/{id}/price-forecast": {"get": {
        "summary": "Get an area-level price forecast with backtest evidence", "operationId": "getPriceForecast",
        "parameters": [GEOGRAPHY_PATH, {"name": "horizon", "in": "query", "required": True,
                                        "schema": {"type": "string", "enum": ["1y", "5y"]}}],
        "responses": {"200": _json("Forecast or explicit suppression reason", "PriceForecast")}}},
    "/api/v1/journeys": {"post": {
        "summary": "Calculate a detailed OTP itinerary for a selected origin", "operationId": "createJourney",
        "requestBody": {"required": True, "content": {"application/json": {"schema": _ref("JourneyRequest")}}},
        "responses": {"200": _json("Typical-weekday itinerary and variability", "JourneyResult"),
                      "400": {"description": "Invalid journey"}}}},
}


def build(app: Any) -> dict[str, Any]:
    policy = "\n\n".join(" ".join(paragraph.split()) for paragraph in POLICY.split("\n\n"))
    document = get_openapi(
        title=app.title, version=app.version, openapi_version="3.1.0",
        description=f"{app.description}\n\n{policy}", routes=app.routes,
        license_info={"name": "Apache-2.0", "identifier": "Apache-2.0"},
        servers=[{"url": "/"}], separate_input_output_schemas=False)
    schemas = document.setdefault("components", {}).setdefault("schemas", {})
    _, fixture_schemas = models_json_schema([(model, "serialization") for model in WEB_FIXTURE_MODELS],
                                            ref_template="#/components/schemas/{model}")
    for name, schema in fixture_schemas.get("$defs", {}).items():
        schemas.setdefault(name, schema)
    for path, item in WEB_FIXTURE_PATHS.items():
        document["paths"][path] = {"x-status": "web-fixture", **item}
    for schema in schemas.values():
        _add_deprecated_names(schema)
    _strip_titles(document["paths"])
    _strip_titles(document["components"])
    document["components"]["schemas"] = dict(sorted(schemas.items()))
    return document


def _add_deprecated_names(schema: Any) -> None:
    """Beside each renamed field its old name, as AliasedJSONResponse sends it."""
    if isinstance(schema, dict):
        properties = schema.get("properties")
        if isinstance(properties, dict):
            for new, old in DEPRECATED.items():
                if new in properties and old not in properties:
                    properties[old] = {**_without_keys(properties[new], ("description", "default")),
                                       "deprecated": True,
                                       "description": f"Deprecated alias of {new} (same value), removed in the "
                                                      "next contract version"}
        for value in schema.values():
            _add_deprecated_names(value)
    elif isinstance(schema, list):
        for value in schema:
            _add_deprecated_names(value)


def _without_keys(schema: dict[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
    return {key: value for key, value in schema.items() if key not in keys}


def _strip_titles(node: Any, in_properties: bool = False) -> None:
    if isinstance(node, dict):
        if not in_properties and isinstance(node.get("title"), str):
            del node["title"]
        for key, value in node.items():
            _strip_titles(value, in_properties=key == "properties" and isinstance(value, dict))
    elif isinstance(node, list):
        for value in node:
            _strip_titles(value)
