# Product analytics

How Close Knit is used, never who uses it. First-party only: events go to our own
API and live in our own Postgres (`product_event`, migration 049). No third-party
script, no advertising cookie, no IP address, user agent, address, budget or search
profile. Code: `web/src/lib/usage.ts` (browser), `api/area_api/usage.py` (store, `/go`,
report). Read it on the server with `deploy/tools/usage.sh report`.

## What we want to know

Close Knit helps a household go from "where should we live?" to looking at real homes.
The **happy path** is: open the site → search → find an area that fits → open the
portals' listings for it.

**North star: people who acted, per week.** These are unique people (or MCP
conversations) who reached at least one of these actions in the week:
- they followed a portal link for an area or home (`portal_click`), or
- they opened the listing watch (`watch_open`), or
- they shared a brief (`brief_share`).

A person counts once, however many links they open. Clicks are not the
measure: a portal visit is not an enquiry to an agent, and the Rightmove sold-prices link
means research rather than intent (`kind=sold` keeps it separate).

## Metrics

The journeys these metrics serve, with their funnels, are in [critical-user-journeys.md](critical-user-journeys.md).

| Metric | Definition |
|---|---|
| DAU / WAU / MAU | distinct `visitor_id` with any web event in the last 1 / 7 / 30 days |
| Stickiness | DAU ÷ MAU |
| Sessions | distinct `session_id`; a new session starts after 30 idle minutes |
| Engaged time | sum of `engagement.seconds` per session. Time counts only while the tab is visible and the reader did something in the last 30 s. We report the median and p90, never the mean |
| Activation | share of new people who reached "found" (an area or home opened) in their first week |
| Funnel (weekly, people) | visited → searched (`search`, `match_run`) → found (`area_open`, or an area, property or postcode page) → clicked out (`portal_click`) / acted |
| Retention | weekly cohorts by first-seen week: the share back in weeks 1, 2 and 4. A home search lasts weeks to months, so a person who clicked out and left may be a success, not churn |
| Search quality | `search_empty` (searches that found nothing, masked) and `match_run` with 0 results |
| Sources | `page_view.source`: invite, a utm_source, or the referring site's name (claude, google…) |
| MCP | tool calls, sessions (one conversation), errors, empty answers (`confidence = none`), p95 latency, client names, and click-outs from chat through `/go` |
| Guardrails | `client_error` by page; API errors and rate limits stay in the access log |

These numbers are a baseline, not insight, while the preview has a handful of people.
Read them next to conversations with users.

## Events

| Event | Sent when | Props |
|---|---|---|
| `page_view` | each page (client-side navigation too) | `path` (a property or postcode becomes a template); on the landing page only, `landing`, `source` and `shared` (search / shortlist / brief, when a shared link was opened from outside) |
| `engagement` | when leaving a page or hiding the tab | `path`, `seconds` |
| `search` | a search result is chosen | `kind` (home, area level, page), `results`, `position`, `query` (masked like `search_empty`), `area` and `label` for an area, `district` for a home, street or postcode (never the address) |
| `search_empty` | a search shows nothing for 1.5 s | `query`: words in lower case; a full postcode keeps its district; anything else with a digit becomes `[with digits]` |
| `match_run` | Find my area returns a ranking | `results` (ranked areas) |
| `area_open` | an area is opened from the shortlist | `from`, `area` |
| `portal_click` | a portal link is followed | `portal`, `kind` (listings / sold), `from` (shortlist / area_page / home / mcp), `market`, `outcode`, `area` |
| `brief_share` | a share link is copied or shared | `audience` (the page shared, or "search"), `outcome` |
| `watch_open` | the listing watch dialog opens | `from` (page path) |
| `client_error` | a page fails to render | `path`, `digest` (never the message) |
| `wizard_open` | Find my area opens | `from` (map / area), `first` (nothing asked before) |
| `wizard_review` | the basics pass and the review step opens | — |
| `wizard_show` | "Show areas" (or the example search) | `example` |
| `layer_view` | the map's layer changes (and the one the page opens with) | `layer` (metric id, `personal-match` or `custom`), `custom` (preset / own), `preset` (slug), `label` (an own criterion's label, from neutral place types), `initial` |
| `layer_subview` | a view or scale inside a map topic | `layer` (topic), `view` |
| `layer_time` | leaving or hiding the map | `layer` (as `layer_view`'s key: metric id, `custom:<slug>`, `custom:own`), `seconds` engaged on it |
| `area_select` | an area is chosen on the map, the ranking, search, the shortlist pins or a panel | `area`, `from` (map / ranking / search / match_map / panel) |
| `map_view` | the reader pans or zooms (not programmatic moves), at most every 2 s | `zoom` (to 0.5), `lat`, `lng` (to 2 decimals, about 1 km, Great Britain only), `layer` |
| `zone_change` | a zone is added to or removed from Find my area | `action`, `kind`, `zones` (count after), `place` (station, borough or neighbourhood name), `walk`, `areas`; a drawn shape only as `corners` and a coarse `lat`/`lng` |
| `section_open` | a card on the full area page opens | `section`, `from` (card / tile / link / open_all), `area` |
| `tailor_saved` | the Tailor card's answers are saved | `steps` (how many of the 4 steps were answered; never the answers) |
| `match_edit` | My match's list changes (v4 Tasks 21c/21d) | `action` (add / remove / must / soften / reorder / budget), `criterion` (a chip id such as `safer-streets`, or the kind: budget, place, range, where, custom), `criteria` (how many after), `rank` (a reorder's new place); never a value, a budget or a place |
| `profile_link` | a shared `#profile=` link did not open in full (v4 Task 22) | `result` (not-base64, not-json, no-budget, parts-skipped), `version` (v1, v2, v3), `skipped` (a count); never the link or anything in it |
| `tool_call` (MCP, API) | every agent tool call | `tool`, `ok`, `code`, `ms`, `confidence`, `client` |
| `extension_card` (API) | the browser extension shows a card beside a portal listing (no id: cards, not people) | `portal`, `market`, `status`, `personalised` |
| `extension_badges` (API) | the browser extension asks for the lines under a page of search results (no ids) | `portal`, `items`, `scored`, `personalised` |

Visits from the extension's links arrive as `page_view` with `source` = `extension` (`utm_source`).

Unknown events and props are dropped by the API (`WEB_EVENTS` in `usage.py`), so the
browser and the server can change at different times.

## What people look at

The Grafana dashboard **Close Knit · What people look at** shows:
- **time spent:** engaged hours, minutes per person per day, visit length, and time by page and by map layer;
- **top analytics:** built-in layers, My match, ready-made and people's own custom criteria, sub-views and area page cards;
- **places:** a heat map of where people look on the map, top areas by name (from `area_label`, migration 052), zoom levels, how areas get selected, and the zones people set;
- **searches:** what people type, what they choose, and what found nothing.

## Identity and the law

- **Web.** One random UUID in localStorage (`close-knit.visitor.v1`) and a tab
  session in sessionStorage. Neither is linked to an invite, a search, an IP address or
  a home. This is storage for statistical purposes only, which PECR (as amended by the
  Data (Use and Access) Act 2025, in force 5 February 2026) allows without consent
  under two conditions: it is explained on /privacy, and objecting is simple
  ("Analytics on/off" there). The ICO's April 2026 guidance frames it as "how,
  not who". Never join this id to anything that names a person.
- **EU and EEA time zones** get no id. The visit is still counted, but never as a returning
  person, so no consent banner is needed anywhere.
- **Global Privacy Control or Do Not Track**, or "Analytics off": nothing is sent.
- **MCP.** The session header is stored only as a one-way 16-hex tag. `/go` links carry
  that tag so a click-out counts against its conversation. A client that sends no
  `Mcp-Session-Id` gets a `d-` tag instead: a salted one-way hash of address, user agent
  and UTC day (#274), so `session_id LIKE 'd-%'` is a conversation inferred, not reported.
- **Retention.** 180 days for raw events, purged hourly by the API. Backups dump the
  table; snapshots leave its rows out; db-restore keeps it.

## /go

`/go/<portal>?kind=listings&outcode=E8&market=buy&max_price=650000&beds=2&from=mcp&s=<tag>`
counts the click and then redirects (302) to the portal search, which it rebuilds from the
parameters, so it can only ever open Rightmove, Zoopla, OnTheMarket or OpenRent. Link
previews, crawlers and agents fetching the page (Claude-User, ChatGPT-User) are not
counted. `get_listing_search_links` returns these links as `links` and the direct ones as
`portalUrls` (for agents that read the pages). The website links straight to the portals
and sends `portal_click` itself, so there is no extra hop for people.

## Where to read it

Only from the server. No public HTTP route reads `product_event`, and the database is not published.

- **Grafana** (the "Close Knit · Product", "Close Knit · Journeys", "Close Knit · Feedback" and "Close Knit · Claude and agents" dashboards) runs
  with `COMPOSE_PROFILES=analytics` in `deploy/.env`. It listens only on the host's
  `127.0.0.1:3300`. Open a tunnel with
  `ssh -N -L 3300:127.0.0.1:3300 ubuntu@<host>`, then go to http://localhost:3300 and log in
  as `admin` with `CLOSE_KNIT_GRAFANA_ADMIN_PASSWORD` from the server's `deploy/.env`.
- Grafana reads the database as `close_knit_analytics` (migration 050). That role can only
  `SELECT` from `product_event`, `profile_analytics_event`, `mcp_feedback` and `site_feedback` (053), its transactions
  are read-only, and its statements stop after 30 s. Sign-up, anonymous access, snapshots,
  public dashboards, plugin installs and phoning home are all off.
- Dashboards are generated by `deploy/tools/grafana_dashboards.py` into
  `deploy/grafana/dashboards`. A test checks that the files are up to date, and edits made in
  the UI are not kept.
- `deploy/tools/usage.sh report` prints the same numbers as text.

Setting it up on a server: add `COMPOSE_PROFILES=analytics` and two random passwords
(`CLOSE_KNIT_GRAFANA_ADMIN_PASSWORD` and `CLOSE_KNIT_GRAFANA_DB_PASSWORD`, `openssl rand -hex 32`)
to `deploy/.env`. Apply migration 050, run `tools/grafana-role.sh`, then run `ship.sh`. The admin
password only takes effect when Grafana starts for the first time. To change it later, run
`grafana cli admin reset-admin-password` in the container.

## Feedback

Votes (thumbs up or down on each area-page card and under a Find my area shortlist) and reviews
(1-5 stars, reasons that follow the rating, free text) from `/feedback` and the prompt after a
first action. They are not analytics: people choose to send them, so they are stored with
"Analytics off" too, and they carry no visitor or session id. Table `site_feedback` (migration 053),
kept 12 months. Read it on the **Close Knit · Feedback** dashboard or with
`deploy/tools/feedback.sh web list`. Design: [the spec](superpowers/specs/2026-10-14-user-feedback-design.md).

## Deploy

Migrations 049 and 050 are schema only. On a database that already exists, back it up with
`pg_dump -Fc`, apply `deploy/migrations/049-product-event.sql` through
`psql -v ON_ERROR_STOP=1 --single-transaction` (then 050 the same way), then run `ship.sh`. Until the table
exists the API logs a warning per event and carries on; nothing fails for people.
Check the result with `deploy/tools/usage.sh report`.

Migration 053 (`site_feedback`) is schema only too, and grants the Grafana role: apply it the same
way, after 052. Until it exists, votes are lost quietly and the form says it couldn't send.
