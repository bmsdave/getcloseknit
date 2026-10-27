"""The API contract is generated from the app and checked against real answers (review #23, A13/SE-11).

- contracts/openapi.yaml is what deploy/tools/gen_openapi.py makes of app.openapi(): never edited by hand.
- Every served /api operation is documented (contract/operations.py); the core ones by a response model.
- The recorded core answers (test_recorded_responses.py) validate against their models with no field left
  undocumented, and the golden fixtures validate (the malformed ones must not).
- A model only documents: the bytes, headers and status a route sends are the same with or without it.
"""
import decimal
import importlib.util
import json
import re
import unittest
from pathlib import Path
from typing import Any

try:
    from fastapi import FastAPI, Request
    from fastapi.testclient import TestClient
    from pydantic import TypeAdapter, ValidationError
    from starlette.routing import Match

    import area_api.app as app_module
    from area_api.contract import models
    from area_api.contract.base import Contract, ContractRoute, request_body
    from area_api.contract.operations import OPERATIONS
    from area_api.contract_aliases import AliasedJSONResponse
except ImportError:  # pragma: no cover
    app_module = None

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "contracts" / "openapi.yaml"
RECORDED = Path(__file__).resolve().parent / "fixtures" / "recorded"
GOLDEN = ROOT / "contracts" / "fixtures" / "golden-v1"
# The core public answers: each documented by a model, every field of it.
CORE = {"listMetrics", "searchAreas", "getAreaSummary", "getAreaProfile", "getAreaEvidencePack", "getMetricValues",
        "getValuePack", "getAreaValues", "getMapCoverage", "getScope", "getAreaBoxes", "getAreaNames",
        "listSchools", "getSchool", "getSchoolCard", "getAreaSchools", "getAreaHierarchy", "getAreaTrail",
        "getPostcodeHomes", "searchStations"}


def _generator():
    spec = importlib.util.spec_from_file_location("gen_openapi", ROOT / "deploy" / "tools" / "gen_openapi.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _normalise(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "{}", path)


def _route(path: str, method: str = "GET"):
    scope = {"type": "http", "path": path.split("?")[0], "method": method}
    return next(route for route in app_module.app.routes if route.matches(scope)[0] == Match.FULL)


class Undocumented:
    """The keys of an answer its OpenAPI schema does not name (an object schema without additionalProperties)."""

    def __init__(self, document: dict):
        self.schemas = document["components"]["schemas"]

    def resolve(self, schema: dict) -> dict:
        while "$ref" in schema:
            schema = self.schemas[schema["$ref"].rsplit("/", 1)[-1]]
        return schema

    def branches(self, schema: dict) -> list[dict]:
        schema = self.resolve(schema)
        options = schema.get("anyOf") or schema.get("oneOf")
        return [branch for option in options for branch in self.branches(option)] if options else [schema]

    def keys(self, schema: dict, value: Any, path: str = "") -> set[str]:
        found: set[str] = set()
        if isinstance(value, dict):
            objects = [branch for branch in self.branches(schema) if "properties" in branch]
            if not objects:
                return found if any(b.get("additionalProperties") or not b for b in self.branches(schema)) \
                    else {path or "."}
            best = max(objects, key=lambda branch: len(set(value) & set(branch["properties"])))
            extra = best.get("additionalProperties")
            for key, item in value.items():
                if key in best["properties"]:
                    found |= self.keys(best["properties"][key], item, f"{path}.{key}")
                elif isinstance(extra, dict):
                    found |= self.keys(extra, item, f"{path}.*")
                elif not extra:
                    found.add(f"{path}.{key}")
        elif isinstance(value, list):
            for branch in self.branches(schema):
                if "items" in branch:
                    for item in value:
                        found |= self.keys(branch["items"], item, f"{path}[]")
                    break
        return found


@unittest.skipIf(app_module is None, "fastapi is not installed")
class GeneratedContractTests(unittest.TestCase):
    def test_the_committed_contract_is_generated_from_the_app(self):
        self.assertEqual(CONTRACT.read_text(), _generator().openapi_yaml(),
                         "contracts/openapi.yaml is stale: run deploy/tools/gen_openapi.py")

    def test_every_served_api_operation_is_documented_and_named(self):
        document = app_module.app.openapi()
        served = {(path, method): operation for path, item in document["paths"].items() if path.startswith("/api/")
                  and "x-status" not in item for method, operation in item.items()}
        self.assertEqual({operation["operationId"] for operation in served.values()}, set(OPERATIONS))
        for (path, method), operation in served.items():
            with self.subTest(path=path, method=method):
                self.assertTrue(operation.get("summary"), "no summary")
                success = next(code for code in operation["responses"] if code.startswith("2"))
                self.assertNotEqual(operation["responses"][success]["description"], "Successful Response")

    def test_the_core_operations_document_their_answer_with_a_model(self):
        operations = {operation["operationId"]: operation for item in app_module.app.openapi()["paths"].values()
                      for operation in item.values() if isinstance(operation, dict) and "operationId" in operation}
        self.assertLessEqual(CORE, set(operations))
        for operation_id in sorted(CORE):
            with self.subTest(operation_id):
                schema = operations[operation_id]["responses"]["200"]["content"]["application/json"]["schema"]
                self.assertTrue("$ref" in schema or "anyOf" in schema, schema)

    def test_paths_served_elsewhere_are_labelled_and_not_served_here(self):
        document = app_module.app.openapi()
        labelled = {_normalise(path) for path, item in document["paths"].items() if item.get("x-status")}
        self.assertIn("/api/v1/journeys", labelled)
        served = {_normalise(route.path) for route in app_module.app.routes if hasattr(route, "methods")}
        self.assertEqual(labelled & served, set())

    def test_renamed_fields_document_their_deprecated_old_names(self):
        summary = app_module.app.openapi()["components"]["schemas"]["AreaSummary"]["properties"]
        self.assertTrue(summary["londonPercentile"]["deprecated"])
        self.assertIn("regionPercentile", summary["londonPercentile"]["description"])


@unittest.skipIf(app_module is None, "fastapi is not installed")
class RecordedAnswerTests(unittest.TestCase):
    """The recordings are the API's own answers on the PostGIS fixture: no database is needed to check them."""

    def test_recorded_core_answers_validate_with_every_field_documented(self):
        document = app_module.app.openapi()
        undocumented = Undocumented(document)
        recordings = sorted(RECORDED.glob("*.json"))
        self.assertGreater(len(recordings), 20)
        for recording in recordings:
            record = json.loads(recording.read_text())
            if record["status"] != 200:
                continue
            route = _route(record["path"])
            with self.subTest(recording.name, operation=route.operation_id):
                self.assertIn(route.operation_id, CORE)
                TypeAdapter(route.response_model).validate_json(record["body"])
                schema = document["paths"][route.path]["get"]["responses"]["200"]["content"]["application/json"]
                self.assertEqual(undocumented.keys(schema["schema"], json.loads(record["body"])), set())

    def test_golden_answers_validate_and_the_malformed_ones_do_not(self):
        # area-old-client, area-suppressed and property-history pin what clients must still decode (older or
        # partial shapes), not what this API sends: they are not checked against its models.
        for name in ("area-real.json", "area-demo.json"):
            with self.subTest(name):
                models.AreaResponse.model_validate_json((GOLDEN / name).read_text())
        for name, model in (("malformed-area.json", models.AreaResponse),
                            ("malformed-property.json", models.PropertyHistoryResponse)):
            with self.subTest(name), self.assertRaises(ValidationError):
                model.model_validate_json((GOLDEN / name).read_text())


class Pair(Contract):
    a: float
    z: int


class Body(Contract):
    required: str


@unittest.skipIf(app_module is None, "fastapi is not installed")
class DocumentingOnlyTests(unittest.TestCase):
    """A route's model changes its OpenAPI entry, never its answer."""

    PAYLOAD = {"z": 1, "extra": [1, 2.50], "a": decimal.Decimal("1.50"), "regionPercentile": 7}

    def apps(self):
        plain = FastAPI(default_response_class=AliasedJSONResponse)
        documented = FastAPI(default_response_class=AliasedJSONResponse)
        documented.router.route_class = ContractRoute

        @plain.get("/x")
        @documented.get("/x", response_model=Pair)
        def answer() -> dict:
            return dict(self.PAYLOAD)

        @plain.post("/y")
        @documented.post("/y", response_model=Pair)
        @request_body(Body)
        async def echo(payload: dict, request: Request) -> dict:
            return {"z": len(payload), "a": 0.5}

        return plain, documented

    def test_answers_are_byte_identical_with_and_without_a_model(self):
        plain, documented = (TestClient(app) for app in self.apps())
        for call in (lambda client: client.get("/x"), lambda client: client.post("/y", json={"not": "the model"})):
            before, after = call(plain), call(documented)
            self.assertEqual((before.status_code, before.content, dict(before.headers)),
                             (after.status_code, after.content, dict(after.headers)))
        self.assertEqual(json.loads(TestClient(self.apps()[1]).get("/x").content)["londonPercentile"], 7)

    def test_the_model_is_what_openapi_shows(self):
        document = self.apps()[1].openapi()
        operation = document["paths"]["/y"]["post"]
        self.assertEqual(operation["responses"]["200"]["content"]["application/json"]["schema"],
                         {"$ref": "#/components/schemas/Pair"})
        self.assertEqual(operation["requestBody"]["content"]["application/json"]["schema"],
                         {"$ref": "#/components/schemas/Body"})
        self.assertTrue(operation["requestBody"]["required"])


if __name__ == "__main__":
    unittest.main()
