# Close Knit API

This is the production API boundary shared by web, SwiftUI, and Android clients.
Next.js exposes the same contracts with deterministic fixtures for local UI and
contract tests. Production uses FastAPI, PostGIS, precomputed R5 matrices, and
OTP for selected-origin itineraries.

Preference request bodies are excluded from access logs. A raw profile is held
only for the active request. Opt-in analytics contain budget bands, weights,
counts, modes, and school phases; exact coordinates and destination labels are
never persisted.

```sh
python3 -m unittest discover -s tests -v
uvicorn area_api.app:app --host 0.0.0.0 --port 8080
```

## The contract

`area_api/contract` is the API contract's one source: pydantic models (`models.py`) and each operation's
documentation (`operations.py`, `**operation("getAreaSummary")` on the route). The models only document: routes
still send the dict they build (`ContractRoute`), so a model never changes a payload. After changing either, run

```sh
.ae-venv/bin/python deploy/tools/gen_openapi.py   # contracts/openapi.yaml and web/src/lib/api-types.gen.ts (API venv)
```

`gate.sh` fails when either generated file is stale; `tests/test_openapi_contract.py` validates the recorded core
answers (`tests/fixtures/recorded`, re-record with `CLOSE_KNIT_RECORD=1` on the PostGIS fixture) against the models.
