# Agent tools for Close Knit

One tool registry (`api/area_api/tools.py`) served two ways from the same FastAPI process:

| Surface | Where | For |
|---|---|---|
| MCP, Streamable HTTP | `POST /mcp` | Claude (Desktop/claude.ai connector, Claude Code `http`), ChatGPT, Codex `url` |
| MCP, stdio | `python -m area_api.mcp_stdio` | Claude Code, Codex CLI, any local agent |
| REST mirror | `POST /api/v2/tools/{name}`, index `GET /api/v2/tools` | API-first agents, curl |
| Discovery | `GET /openapi.json`, `GET /llms.txt`, `GET /.well-known/mcp/server.json` | crawlers, connectors, humans |

Coverage: England where the data reaches, London in depth (homes, TfL commutes); `CLOSE_KNIT_ENGLAND` off = London only
(FLAGS.md). Percentiles are within the area's region, named by `rankScope` on area answers.

Every tool answers with the **evidence envelope**:

```json
{"schemaVersion": "tool-area-metric.v1", "productReleaseId": "rel-…", "dataMode": "release",
 "value": {…}, "confidence": "high", "evidence": [{"kind": "metric-observation", …}],
 "sources": [{"release": "src-police-uk-…", "licence": "OGL-3.0", "methodologyPath": "…"}],
 "caveats": ["…"]}
```

## Home search with Claude

A person can now find where to live just by talking to Claude: the `find-a-home` prompt/skill, seven
home-search tools and an MCP Apps widget (shortlist board, area card, listing check). Plugin, local
testing on every Claude surface and publishing steps: [`claude/README.md`](claude/README.md).

## Tools

Area (release-backed): `list_metrics`, `search_areas`, `get_area_metric`, `rank_areas_by_metric`,
`get_address_history`, `match_areas`.
Local market (release-backed): `get_market_depth` (an LSOA's or MSOA's 12-month standard sales,
turnover, leasehold share of sales, new-build premium with medians from 10 sales, growth),
`get_nearby_sales_summary` (building and street counts and gated medians for an address, no rows),
`get_area_evidence_pack` (market depth, crime, noise, schools and, with an address, its nearby-sales
aggregates, each block cited). Aggregates only: no valuation, listing or address list.
Home search (release-backed): `search_places` (stations, boroughs, areas, addresses → ids),
`find_areas` (plain budget/bedrooms/priorities/stations → a varied shortlist with a ballpark price,
budget fit, postcode districts and site links), `find_similar_areas`, `get_area_overview` (market,
£/m² trend, crime, noise, schools), `get_listing_search_links` (Rightmove, Zoopla, OnTheMarket,
OpenRent searches — links only), `assess_listing` (asking price vs local sales, questions to ask),
`build_watch_spec` (a scheduled-task prompt; nothing stored), `list_custom_presets` and
`evaluate_custom_criterion` (the user's own criterion from places on OpenStreetMap — "more cafés than kebab
shops" — for every area, with a map link; `find_areas(custom=[…])` weighs it; places, never people). The four result tools carry
`_meta.ui.resourceUri = ui://close-knit/home-search.html`.
House (release-backed): `get_home_prices` — a home's recorded sales (each with its HM Land Registry
record) and prices in its area today: the same-type middle half adjusted to today, with sample size and
the area used, and the coarse band its last sale fell in that year (UPRN or address fragment). Area
statistics only: no tool says what a home is worth.
Every tool answers from the release; there are no demo fixture tools.

Privacy and limits: a home whose owner/occupier confirmed a privacy objection is absent from
`search_areas`, `get_address_history` and `get_home_prices` (404/empty, not an error in the data).
Every `/api/*` and `/mcp` request is rate limited per client (`CLOSE_KNIT_RATE_LIMIT`, default
120/minute; 429 with `Retry-After`). See `/privacy` and `DATA-LICENCES.md`.

## Setup per platform

- **Claude Code** – `claude mcp add --transport http close-knit https://getcloseknit.com/mcp`
  (setup for every Claude surface: [getcloseknit.com/agents](https://getcloseknit.com/agents)).
- **Claude Desktop / claude.ai** – Settings → Connectors → add custom connector with the public
  `https://<host>/mcp` URL (no auth in this slice).
- **Codex CLI** – append [`codex/config.toml`](codex/config.toml) to `~/.codex/config.toml`.
- **ChatGPT** – see [`chatgpt/README.md`](chatgpt/README.md) (developer-mode connector).
- **API-first agents** – see [`api-first/README.md`](api-first/README.md); hand the agent `/llms.txt`.
- **Gemini** – Gemini CLI: `gemini extensions install https://github.com/bmsdave/getcloseknit` (root
  `gemini-extension.json`: the `/mcp` server plus the find-a-home skill as context), or just the server with
  `gemini mcp add --transport http close-knit https://<host>/mcp`; elsewhere hand it `/llms.txt`. From Gemini
  CLI's docs, not tested here.
- **Grok** – a custom connector with the `/mcp` URL where the plan offers one, or a remote MCP tool
  (`server_url`) through the xAI API; otherwise `/llms.txt`. From xAI's docs, not tested here.
- **Any other agent** – remote MCP (Streamable HTTP) → `/mcp`; web APIs → `/openapi.json`; neither → `/llms.txt`.

End-user steps for each of these: [getcloseknit.com/agents](https://getcloseknit.com/agents) (`web/src/app/agents/`).

Environment: `CLOSE_KNIT_DATABASE_URL` (required), `CLOSE_KNIT_PUBLIC_URL` (advertised origin
in discovery documents), `CLOSE_KNIT_MCP_ALLOWED_HOSTS` (comma list; enables DNS-rebinding
protection). Run a single uvicorn worker: MCP sessions live in process memory.

## Smoke transcript (2026-09-11, real release `rel-2026-09-london-5m-v1`)

Recorded before the demo property tools were removed; the smoke now calls `get_home_prices` in
their place (it replaced `get_stock_value` on 2026-10-11).

```
$ python3 agents/smoke_mcp_http.py http://localhost:8080
initialize: close-knit session e90fb5f8
tools/list: ['list_metrics', 'search_areas', 'get_area_metric', 'rank_areas_by_metric', 'get_address_history', 'match_areas', 'analyse_property', 'get_valuation', 'get_comparables', 'get_flood_risk', 'get_transport', 'get_planning_potential', 'get_school_admission_evidence', 'rank_properties']
parity get_area_metric: IDENTICAL | value 9.643 observed | evidence rows 12 | source src-police-uk-crime-2025-08-2026-07
demo get_valuation: demo none estimate 862000 gap% 3.8
error: True Error executing tool get_area_metric: area-not-found: unknown area: uk:lsoa:E01999999
```

stdio (official `mcp` client spawning `python -m area_api.mcp_stdio`):

```
stdio tools: 14
search_areas: False rel-2026-09-london-5m-v1 ['Camden', 'Camden 001']
rank £/m2: False [('Kensington and Chelsea 012A', 21232.88, '£/m²'), ('Kensington and Chelsea 012B', 21232.88, '£/m²')]
```

REST mirror: `curl -s -X POST localhost:8080/api/v2/tools/search_areas -H 'content-type: application/json' -d '{"q":"Ealing","limit":3}'`
→ `{"schemaVersion":"tool-search-areas.v1","productReleaseId":"rel-2026-09-london-5m-v1","dataMode":"release","confidence":"high",…}`

## Tests

```
cd api && pip install ".[test]" && python -m unittest discover -s tests -v
```
`test_tools`, `test_mcp_http` (MCP `structuredContent` must deep-equal the
REST body), `test_discovery`, `test_openapi_contract` (`contracts/openapi.yaml` is generated from the app; recorded answers validate against
its models).
