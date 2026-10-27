# Deployment shape

PostGIS is the authoritative store. The API serves the product's vector tiles
(`/api/v1/tiles/properties`, `/api/v1/tiles/sales`) straight from SQL tile functions. The area
boundaries are static PMTiles archives, one per kind of area and release, built from the database by
`tools/area_pmtiles.py` into `/srv/close-knit-tiles` (ship.sh builds them when none is recorded) and
served by Caddy at `/tiles/` with Range requests; the API's `/api/v1/tiles/areas` stays as the fallback
until no cached coverage names it.
The `api` service owns transient profile scoring. Its server starts with access
logging disabled, and the schema has no column capable of holding a raw profile
or exact destination. See `routing/` for the pinned R5/OTP release boundary.

Settings live in an ignored `deploy/.env`: run `./init-env.sh` once (it copies
`.env.example` and generates the database password and objection salt), then
fill in the domain, public URL, controller/contact, and a notification channel.
Never commit the resulting file. `docker compose up --build` gives the local
stack (ports 4180 web, 8080 api, 3000 tiles).

## VPS runbook (single host)

Quick path: `sudo bash deploy/bootstrap-host.sh` once on a fresh Ubuntu 24.04
host (steps 2–3 below), `./init-env.sh` there, then from your machine
`deploy/ship.sh ubuntu@<host> <snapshot.dump>` (steps 6–7: code, restore,
start, preflight). Later code-only updates: `deploy/ship.sh ubuntu@<host>`.

1. **Host.** Ubuntu 24.04 LTS, x86-64 (the PostGIS image has no ARM build),
   ≥ 4 vCPU, **≥ 12 GB RAM**, **≥ 80 GB SSD**. The release database is about
   7.3 GB; `db-restore.sh` copies the ~1.2 GB dump into the container first,
   and the API keeps a tile cache in memory. Measured: a zoomed-out sale tile
   costs 0.3–0.7 s of one core. Hosting research: `docs/hosting-research-2026-10/`.
   - **12 GB hosts** (e.g. OVHcloud VPS-3, London): set
     `CLOSE_KNIT_PG_SHARED_BUFFERS=2GB` and `CLOSE_KNIT_PG_EFFECTIVE_CACHE=6GB`
     in `deploy/.env`, and add 4 GB of swap as a safety net:
     `fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`
     (plus `/swapfile none swap sw 0 0` in `/etc/fstab`).
   - **16 GB+ hosts**: the compose defaults (2 GB / 5 GB) are fine; raise
     `CLOSE_KNIT_PG_EFFECTIVE_CACHE` to about 60% of RAM.
2. **Access.** SSH keys only; firewall allows 22, 80, 443 (tcp) and 443/udp.
   Nothing else is published: the production overlay resets every other port.
3. **Docker.** Docker Engine + compose plugin from Docker's apt repository;
   the daemon's log rotation is set per service in the compose files.
4. **Code and settings.** `git clone` this repository to `/srv/close-knit`,
   `cd deploy && ./init-env.sh`, then fill in `deploy/.env` (domain, https
   public URL, controller, contact, ICO number, SMTP or webhook).
5. **DNS.** Point an A/AAAA record for `CLOSE_KNIT_DOMAIN` at the host
   *before* starting Caddy, so it can obtain the certificate.
6. **Data.** On the ETL machine `tools/db-snapshot.sh close-knit.dump`;
   copy the dump and its `.manifest.json` with `scp`/`rsync`.
7. **Start and load** (block below), then `./preflight.sh` must exit 0.
8. **Backups.** Cron `tools/backup-prod-data.sh` daily and copy the backup
   directory off the host. Release data needs no backup: it is the snapshot.
8a. **Portal link check (weekly, v4 Task 9).** The portals' draw-a-search and region URLs are unofficial.
   Cron, Mondays 06:00: `cd <checkout>/deploy && docker compose -f docker-compose.yml -f docker-compose.prod.yml
   exec -T api python -m area_api.portal_link_check --record`. It stores one row per portal and kind
   (`portal_link_check`, migration 072); a failed one sends that pair to the postcode-district links until a
   later check passes. A non-zero exit is the alert: cron mails its output.
9. **Monitoring.** An external uptime check on `https://<domain>/api/v1/health`
   (expects `"status":"ready"`); `docker compose ps` shows container health.
10. **Upgrades.** `git pull && docker compose -f docker-compose.yml -f
    docker-compose.prod.yml up -d --build`. A new data release is a new
    snapshot restored with `db-restore.sh`, which keeps objections, correction
    reports and analytics rows (and refuses to finish if objections changed).
11. **CDN.** If a CDN caches `/api/v1/tiles/*` (1 h `max-age`), purge it
    after confirming an objection, or the hidden home stays on cached tiles.

## Production: one public door

```sh
./init-env.sh                                   # once; then edit deploy/.env
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
tools/db-restore.sh /path/to/close-knit.dump -f docker-compose.prod.yml
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart api
./preflight.sh                                  # must exit 0 before DNS goes live
```

`docker-compose.prod.yml` adds Caddy (automatic TLS for `CLOSE_KNIT_DOMAIN`,
`Caddyfile`) and unpublishes every other port. Caddy sends `/mcp`, `/api/v2/*`,
`/.well-known/*`, `/openapi.json`, `/docs` to the API and everything else to
the web app; the web BFF forwards the caller's address, and the API keys its
rate limits and objection quotas on it (`CLOSE_KNIT_TRUST_PROXY=1` — safe
only because nothing else can reach the API). Stock Caddy has no rate limiting;
put Cloudflare or the caddy-ratelimit plugin in front if you want an edge
limit — the application limiter is the guarantee either way.

### Rate limits

`api/area_api/ratelimit.py` keys every client by IPv4 address or IPv6 /64
(the hizoom and detail day quotas also count per /48, at 4× the allowance) and charges layered
windows per class; a request needs room in every window or gets a 429 with
`Retry-After`. Override a class with `CLOSE_KNIT_RATE_<CLASS>` in `deploy/.env`.

| Class | Covers | Default |
|---|---|---|
| default | everything else under `/api` and `/mcp`; `custom-criteria/evaluate`, `matches` and the search/ranking tools cost 10 | 120/minute,2000/hour,10000/day |
| bulk | tiles below z15, place tiles, value packs, price scale, area geometry | 600/minute,6000/hour |
| hizoom | property and sale tiles z15+ (one point per home) | 200/minute,600/hour,1000/day |
| detail | property, address history, nearby sales, postcode homes, recent sales and their tools (profile and postcode homes cost 5) | 30/minute,300/hour,1000/day |
| report | `POST /api/v1/corrections` | 5/minute,20/day |
| render | a server-rendered page: all the web server's reads for one render (the area page makes about 25), when they carry `CLOSE_KNIT_INTERNAL_KEY` | 30/minute,600/hour,3000/day pages |

**Server renders.** The web server sends its reads for one page render with
`X-Close-Knit-Internal: $CLOSE_KNIT_INTERNAL_KEY` and a per-render
`X-Close-Knit-Render` id; the API charges the first read of each id to the
viewer's render class and the rest of that render nothing (ids are remembered
for 2 minutes). Detail reads stay in the detail class. A missing or wrong key
means the headers are ignored and every read is charged as usual, so without
the key quick page views lose their server-rendered sections (the page then
says they are loading and reads them in the browser). The area page also keeps
its section reads for 10 minutes per release in the web process. `init-env.sh`
generates the key; on a server whose `.env` predates it, add (or rotate) it
without printing it, then redeploy so both containers pick it up:

```sh
cd /srv/close-knit/deploy && sed -i '/^CLOSE_KNIT_INTERNAL_KEY=/d' .env && echo "CLOSE_KNIT_INTERNAL_KEY=$(openssl rand -hex 32)" >> .env
```

`/health` is not limited (it is cached for 10 s). MCP batches are refused and
`tools/call` is charged by tool name, like `/api/v2/tools/{name}`. Legacy
`CLOSE_KNIT_RATE_LIMIT` / `CLOSE_KNIT_TILE_RATE_LIMIT` still set the minute
window of default / bulk. Buckets live in the API process: run uvicorn with one
worker (the image does), or each worker grants the full allowance. Queries
stop after `CLOSE_KNIT_DB_STATEMENT_TIMEOUT_MS` (20 s) with 503 `query-timeout`.
With England loaded the cold metric catalogue needs migration 115's
`metric_value_metric_release_period_idx` (preflight checks it); with it the
catalogue reads in well under a second, so the 20 s default stands and the
60 s override production carried on 2026-10-22 can go.

Behind Cloudflare, every request reaches Caddy from a Cloudflare address, so
all visitors would share one bucket. Tell Caddy to trust Cloudflare's ranges
and read the visitor from `CF-Connecting-IP` (global options:
`servers { trusted_proxies static <Cloudflare IPv4/IPv6 ranges>
client_ip_headers CF-Connecting-IP }`), and set `header_up X-Forwarded-For
{client_ip}` in the `(proxy)` snippet: with trusted proxies Caddy passes the
incoming X-Forwarded-For on, and its first hop is whatever the visitor sent.

Who used the site: Caddy writes one JSON line per request (client IP, login
user, method, URI, status, user agent; credentials redacted) to
`/var/log/close-knit/` on the host, a file per day, deleted after 30 days
as `/privacy` states. `sudo tools/access-log.sh [N]` prints the last N
requests; `--ips` totals requests and failed logins (401) per client IP.

Pre-launch privacy: `CLOSE_KNIT_ACCESS=private` in `.env` puts one shared
login in front of everything but `/api/v1/health`, the legal pages
(`/privacy`, `/terms`, `/about`, with `/_next/static/*`) and the few paths
listed above `@locked` (`access-private.caddy`, noindex header and meta
robots); set it to `public` and redeploy to open
the site: an explicit `public` is also what lets search engines index it (no
noindex meta robots, robots.txt names the sitemap, no X-Robots-Tag). Left
unset, Caddy opens the site without a login but the web container still says
noindex (its compose default is `private`); preflight flags that mismatch.
Per-address pages (`/postcode/*`, `/property/*`) stay noindex even when public.
With `CLOSE_KNIT_INVITE_TOKEN` set, `tools/invite.sh create 20 "friends"`
prints a link that opens the site 20 times: each visitor presses one button,
which spends a use and leaves a 30-day cookie that skips the login. A used-up
link asks for a new one; `tools/invite.sh list` shows uses, and a new token
revokes every cookie.

Other names for the site (`CLOSE_KNIT_REDIRECT_DOMAINS`, e.g. `www.` and
short domains) answer with a 301 to `CLOSE_KNIT_DOMAIN`, path kept; point
their DNS at the host too.

Other sites on the same host live on the server's own name
(`CLOSE_KNIT_SITES_HOST`), not the public domain, under their own path with
their own login, outside this repo: one Caddy snippet per site in
`/srv/caddy-sites/*.caddy` (imported by that host's block in `Caddyfile`; every
other path there redirects to `CLOSE_KNIT_DOMAIN`), files in
`/srv/sites/<site>`, app sockets in `/run/caddy-upstreams`. Today that is `/muse/`: one agent's projects
(`/muse/radar/`, …) behind one login, uploaded by the rsync-only user
`muse-deploy`, with its Node app `muse-ada` sandboxed by systemd. fail2ban jail
`caddy-auth` (`/etc/fail2ban/jail.d/caddy-auth.conf`, filter in `filter.d/`)
reads `/var/log/close-knit/access.log` and bans an IP for a day (doubling on
repeat) after 5 wrong passwords in an hour on any login: the site lock and
every site under `/srv/caddy-sites`. Run `sudo fail2ban-client reload` after
moving that log, and check `fail2ban-client status caddy-auth` lists it.

The database boots with the full schema (`schema.sql`, then `migrate.sh init` applies
every file of `migrations/` and starts the `schema_migrations` journal; ship.sh runs
`migrate.sh apply` on an existing database, RELEASE-CHECKLIST.md) but no data. Production data is the validated local
release shipped as a snapshot: `tools/db-snapshot.sh out.dump` on the machine
that ran the ETL (REAL-DATA.md), `tools/db-restore.sh out.dump` on the server
(verifies the sha256 manifest, restores, checks the active release and the
suppression view). Production should pin image digests.
Migration 057 (postcode sectors) needs ONS CPIH and a rebuild on an existing database: apply it, run
`tools/etl_cpih.py download <csv>` and `tools/etl_cpih.py load <db url> <csv>`, then
`SELECT rebuild_zone_analytics('<latest sale.source_release_id>')` (about 3 minutes on London);
`etl_sales.py load` runs the same rebuild after every sales load.
The upstream PostGIS image is currently pinned to `linux/amd64`; Docker Desktop
uses emulation on Apple Silicon. Override `CLOSE_KNIT_DATABASE_PLATFORM` when
the chosen PostGIS image publishes a native image for the deployment platform.

Run `./smoke-test.sh` to initialize a disposable database, validate the schema
and check that the API and web come up on it. The script removes its dedicated
containers, network, and volume afterward.

## Basemap and ODbL release checklist

OpenFreeMap is the zero-key prototype default. Before a production release,
set `CLOSE_KNIT_BASEMAP_STYLE_URL` to an immutable, versioned style URL owned
by the deployment. That style may point at self-hosted OSM-derived tiles or a
provider whose terms allow the expected traffic; clients must remain ordinary
MapLibre style/TileJSON consumers.

Every public map must keep a legible `OpenStreetMap` attribution beside the map
and link it to `https://www.openstreetmap.org/copyright`, which explains the
ODbL. Preserve the notice in screenshots and other public produced works. If a
modified or derived OSM database is publicly used, publish it under ODbL and
offer the database or the transformation needed to recreate it. Keep OSM data
in a separately identified database/layer so the Apache-2.0 licence on application
code and the licences on analytics data are not presented as relicensing OSM.

For each basemap release, record the OSM extract date, source URL, style version,
tile checksum or image digest, attribution text, and the URL where any derived
database or transformation is offered. Review the OSM Foundation attribution
guidelines when the presentation or data combination changes.
