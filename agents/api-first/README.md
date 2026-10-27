# API-first agents

Some agents have built-in connectors and can integrate any service that exposes a public API. There is no SDK to package; the surface is the documented HTTP API:

- `GET /openapi.json` – OpenAPI 3.1 generated from the running app; `contracts/openapi.yaml` is the same document,
  committed (`deploy/tools/gen_openapi.py`, models in `api/area_api/contract`).
- `GET /api/v2/tools` – tool index with JSON input schemas (the same schemas MCP advertises).
- `POST /api/v2/tools/{name}` – call a tool; the body is the arguments object, the response is
  an evidence envelope (`value`, `confidence`, `evidence[]`, `sources[]`, `caveats[]`).
- `GET /llms.txt` – plain-text guide (endpoints, tools, workflow) for agents and crawlers.
- `GET /.well-known/mcp/server.json` – MCP manifest for clients that do speak MCP.

Give the agent `https://<host>/llms.txt` (or `/openapi.json`) as the integration document.
Answers with `dataMode: "demo"` are illustrative fixtures and must not be presented as facts.
