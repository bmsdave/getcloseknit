# ChatGPT (Apps SDK / connectors)

ChatGPT talks to remote MCP servers over Streamable HTTP. The Apps SDK is MCP plus optional
UI metadata, so the same `/mcp` endpoint serves both.

## Developer-mode connector (no directory review, no auth)

1. Expose the API over public HTTPS (tunnel for a smoke test, e.g. `cloudflared tunnel --url http://localhost:8080`).
2. Set `CLOSE_KNIT_PUBLIC_URL=https://<host>` so `/.well-known/mcp/server.json` and `/llms.txt`
   advertise the public origin, and optionally `CLOSE_KNIT_MCP_ALLOWED_HOSTS=<host>`.
3. ChatGPT → Settings → Connectors → Advanced → **Developer mode** → Create → MCP server URL
   `https://<host>/mcp`, authentication *None*.
4. In a chat, enable the connector and ask: "Which London areas have the lowest crime in 2026-06?"
   ChatGPT should call `list_metrics` → `rank_areas_by_metric` and cite `sources[]`.

## Directory submission (later)

The public app directory requires OAuth 2.1 and a privacy policy; both are deferred to roadmap
Unit 9. Widgets (`_meta["openai/outputTemplate"]`) can be added per tool without changing handlers.
