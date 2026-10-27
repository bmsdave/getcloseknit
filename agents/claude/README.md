# Close Knit for Claude

Talk to Claude to find where to live in England (London in depth): it interviews you, shortlists neighbourhoods with
evidence, refines them on your likes and dislikes, finds homes on the portals and can watch for
new ones.

| Piece | Where | What it does |
|---|---|---|
| MCP server | `api/area_api/mcp_server.py` (`/mcp`, stdio) | tools + `find-a-home` prompt + server instructions |
| Home-search tools | `api/area_api/home_search.py` | `search_places`, `find_areas`, `find_similar_areas`, `get_area_overview`, `get_listing_search_links`, `assess_listing`, `build_watch_spec`, `list_custom_presets`, `evaluate_custom_criterion` |
| Widget (MCP Apps) | `api/area_api/widgets/home-search.html` | shortlist board, area card, listing check, drawn inside Claude |
| Plugin | `agents/claude/plugin/` + `/.claude-plugin/marketplace.json` | `find-a-home` skill + MCP connection for Claude Code |
| Skill ZIP | `agents/claude/build-skill-zip.sh` | the same skill for claude.ai / Claude Desktop chat uploads |
| Install page | `web/src/app/claude/page.tsx` (`/claude`) | instructions for end users |

What runs where (the legal split): Close Knit serves its own evidence and builds links to the
portals' public search pages; it never fetches, stores or ranks listings. Reading listing pages and
watching for new ones happens in the user's own Claude, on the user's behalf.

## Test locally

Start the API on real data (Docker DB `ae-pgold` on :5434) and, for map links, the web:

```
cd api && CLOSE_KNIT_DATABASE_URL=postgresql://close_knit@127.0.0.1:5434/close_knit \
  CLOSE_KNIT_SITE_URL=http://127.0.0.1:4180 .venv/bin/uvicorn area_api.app:app --port 8080
cd web && CLOSE_KNIT_API_URL=http://127.0.0.1:8080 PORT=4180 npm run dev
python3 agents/smoke_mcp_http.py http://localhost:8080      # whole flow over MCP
```

### Claude Code (CLI or the Desktop app's Code tab)

```
/plugin marketplace add /absolute/path/to/close-knit
/plugin install close-knit@close-knit
```

Restart the session, then say "Help me find a 2-bed to buy in London under £600k" or run
`/close-knit:find-a-home`. One-off without installing: `claude --plugin-dir agents/claude/plugin`.
The plugin connects to `https://getcloseknit.com/mcp` (the directory accepts only a fixed https URL; for a
local API add it yourself with `claude mcp add --transport http close-knit-local http://localhost:8080/mcp`); check it with
`claude mcp list` (`plugin:close-knit:close-knit … ✔ Connected`). Claude Code shows text and
links; the interactive widget appears in the Claude app and claude.ai.

### Claude Desktop chat (widgets, no tunnel)

Add a local server to `~/Library/Application Support/Claude/claude_desktop_config.json` and restart:

```json
{
  "mcpServers": {
    "close-knit": {
      "command": "/absolute/path/to/close-knit/api/.venv/bin/python",
      "args": ["-m", "area_api.mcp_stdio"],
      "env": {
        "CLOSE_KNIT_DATABASE_URL": "postgresql://close_knit@127.0.0.1:5434/close_knit",
        "CLOSE_KNIT_SITE_URL": "http://127.0.0.1:4180"
      }
    }
  }
}
```

Then pick **Find a home in London** from the + menu (MCP prompt), or upload the skill ZIP
(`agents/claude/build-skill-zip.sh` → Settings → Capabilities → Skills) and just ask.

### claude.ai (or Desktop with a remote connector)

Custom connectors are reached from Anthropic's servers, so the API needs a public HTTPS URL:

```
cloudflared tunnel --url http://localhost:8080
```

Settings → Connectors → Add custom connector → `https://<tunnel-host>/mcp`. Set
`CLOSE_KNIT_MCP_ALLOWED_HOSTS=<tunnel-host>` on the API if you enable host checks.

### Scenario to run on each surface

"Buying, £600k, 2 bed, I work at King's Cross, I care about feeling safe and being near a station."
Expect: one or two follow-up questions → shortlist (board in Claude app / claude.ai) → "not for me:
too expensive" removes an area and the next run says what changed → "like Ealing 027B but cheaper"
→ overview of a favourite with schools and the price trend → portal links that open filtered
searches → a real listing checked with `assess_listing` → a watch created as a scheduled task, and
its second run reports only new listings.

## Publish

1. The production `/mcp` must be public: the private-preview Caddy access file puts basic auth in
   front of everything, which custom connectors cannot pass. Serve `/mcp` (and `/claude`) without
   it, or switch to `access-public.caddy`.
2. Set `CLOSE_KNIT_PUBLIC_URL` / `CLOSE_KNIT_SITE_URL` to the public origin; the default URL in
   `agents/claude/plugin/.mcp.json` is already `https://getcloseknit.com/mcp`.
3. Claude Code users add the connector with `claude mcp add --transport http close-knit https://<host>/mcp`
   (the `/claude` page shows the exact command).
4. The site serves the skill as `/downloads/find-a-home.zip` for claude.ai uploads. After editing the skill,
   rebuild it with `agents/claude/build-skill-zip.sh web/public/downloads/find-a-home.zip`
   (`deploy/tests/test_skill_download.py` fails until you do).
5. Later: Anthropic connector directory and ChatGPT app directory (need OAuth 2.1, roadmap Unit 9).
