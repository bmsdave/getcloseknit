import asyncio
import contextlib
import datetime
import logging
import os
import threading
import time
from typing import Any, AsyncIterator, Callable, Literal

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse

from . import attribution, downloads, errors, invites, map_chunks, map_tiles, market_depth, notify, site_feedback, usage
from .civic import CivicReader
from .contract import models
from .contract.base import ContractRoute, request_body
from .contract.openapi import build as build_openapi
from .contract.operations import operation
from .contract_aliases import AliasedJSONResponse
from .discovery import router as discovery_router
from .evidence import AddressNotFound, AreaNotFound, EvidenceReader
from .matching import InvalidMatchRequest, build_match_pack, validate_match_request
from .mcp_server import McpMount
from .objections import ObjectionStore, objection_summary
from .privacy import private_response_headers
from .id_alias import AreaAliasMiddleware
from .ratelimit import RateLimiter, RateLimitMiddleware
from .repository import evidence_connection, load_match_evidence, load_readiness, load_zone_lsoas
from . import evidence, match_model
from . import repository
from . import area_pages
from . import property_profile
from . import street_home
from . import card_cache, extension_config, feature_flags, home_match, listing_badges, listing_card
from . import portal_zones, regions, school_card, school_links, schools
from .scope import Scope, get_scope
from .matching import validate_zones
from .tools import TOOLS, ToolContext, call_tool

API_DESCRIPTION = (
    "Evidence-backed UK area and property intelligence for people and agents. "
    "v1 serves the map; /api/v2/tools/{name} and the MCP endpoint at /mcp serve agents with "
    "the evidence envelope (value, confidence, evidence[], sources[], caveats[])."
)
logger = logging.getLogger(__name__)

_reader: EvidenceReader | None = None
_objections: ObjectionStore | None = None
_connect: Callable[[], Any] = evidence_connection  # swapped for a fake in tests
_health_loader: Callable[[], dict] | None = None


def get_reader() -> EvidenceReader:
    global _reader
    if _reader is None:
        _reader = EvidenceReader(connect=evidence_connection)
    return _reader


def get_objections() -> ObjectionStore:
    global _objections
    if _objections is None:
        _objections = ObjectionStore(_connect)
    return _objections


def _tool_context(cancel: Callable[[], bool] | None = None, traffic: str = "live") -> ToolContext:
    return ToolContext(reader=get_reader(), cancel=cancel, traffic=traffic)


mcp_mount = McpMount()


@contextlib.asynccontextmanager
async def _lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Nothing is warmed here: what a release derives is built once at its activation (area_api.release_build into
    # release_artifact, migration 128) and read by every worker, so a start or a restart is not cold.
    server = mcp_mount.start(_tool_context)
    async with server.session_manager.run():
        yield


# Every JSON answer also carries the deprecated old field names (contract_aliases, step R1).
app = FastAPI(title="London Close Knit API", version="2.0.0", description=API_DESCRIPTION,
              lifespan=_lifespan, default_response_class=AliasedJSONResponse)
# Response and request models document the contract only (contract/base.py): every answer is the dict as built.
app.router.route_class = ContractRoute
app.include_router(discovery_router)
rate_limiter = RateLimiter.from_env()
app.add_middleware(RateLimitMiddleware, limiter=rate_limiter)
# Old area ids (uk:borough:..., step R2) read as the current ones before routing: id_alias.
app.add_middleware(AreaAliasMiddleware)
app.add_route("/mcp", mcp_mount, methods=["GET", "POST", "DELETE"])


@app.get("/access/invite", include_in_schema=False)
def invite_page(code: str = "") -> HTMLResponse:
    """Landing page of a counted invite link (deploy/access-private.caddy)."""
    if invites.access_secret() is None:
        return HTMLResponse(invites.page("Invites are off", invites.INVALID), status_code=404)
    left = invites.remaining(_connect, code)
    if left is None:
        return HTMLResponse(invites.page("Invite not found", invites.INVALID), status_code=404)
    if left <= 0:
        return HTMLResponse(invites.page("Invite used up", invites.USED_UP), status_code=410)
    return HTMLResponse(invites.page(
        "You're invited", "A preview of London Close Knit: sold prices, crime, "
        "schools and noise for every London neighbourhood on one map.", code))


@app.post("/access/redeem", include_in_schema=False)
async def redeem_invite(request: Request) -> Response:
    """Spend one use of an invite and give this browser the access cookie."""
    from urllib.parse import parse_qs

    secret = invites.access_secret()
    code = parse_qs((await request.body()).decode("utf-8", "replace")).get("code", [""])[0]
    if secret is None:
        return HTMLResponse(invites.page("Invites are off", invites.INVALID), status_code=404)
    if invites.redeem(_connect, code):
        response = RedirectResponse("/", status_code=303)
        response.headers["set-cookie"] = invites.cookie_header(secret)
        return response
    used_up = invites.remaining(_connect, code) is not None
    return HTMLResponse(
        invites.page("Invite used up", invites.USED_UP) if used_up
        else invites.page("Invite not found", invites.INVALID),
        status_code=410 if used_up else 404)


@app.post("/api/v1/usage", status_code=204, include_in_schema=False)
async def post_usage(request: Request) -> Response:
    """A page's batch of usage events (area_api.usage); always 204, never an error a page would show."""
    try:
        payload = await request.json()
    except ValueError:
        payload = None
    team_header = request.headers.get(usage.TEAM_HEADER)
    rows = usage.clean_batch(payload, team_header)
    if rows and not usage.is_bot(request.headers.get("user-agent")):
        asyncio.get_running_loop().run_in_executor(None, _store_usage, rows, usage.team_visitor(payload, team_header))
    return Response(status_code=204, headers=private_response_headers())


def _store_usage(rows: list[tuple], team_visitor: str | None = None) -> None:
    try:
        usage.store(_connect, rows)
        if team_visitor:
            usage.mark_team(_connect, team_visitor)
    except Exception:  # noqa: BLE001 - usage must never fail a page
        logger.warning("usage batch of %s events not stored", len(rows), exc_info=True)


@app.post("/api/v1/feedback", status_code=204, include_in_schema=False)
async def post_feedback(request: Request) -> Response:
    """A vote or review someone chose to send (area_api.site_feedback): 204 when kept, 422 when it is not
    feedback this site asks for, 503 when it could not be stored so the form can say so."""
    headers = private_response_headers()
    try:
        row = site_feedback.clean(await request.json(), request.headers.get(usage.TEAM_HEADER))
    except ValueError:  # not JSON, or site_feedback.InvalidFeedback
        return JSONResponse({"error": "invalid-feedback"}, status_code=422, headers=headers)
    if not usage.is_bot(request.headers.get("user-agent")):
        try:
            await asyncio.get_running_loop().run_in_executor(None, site_feedback.store, _connect, row)
        except Exception:  # noqa: BLE001 - the form shows "couldn't send"
            logger.warning("feedback not stored", exc_info=True)
            return JSONResponse({"error": "feedback-unavailable"}, status_code=503, headers=headers)
    return Response(status_code=204, headers=headers)


@app.get("/go/{portal}", include_in_schema=False)
def go_to_portal(portal: str, request: Request) -> Response:
    """A counted click-out from an agent's listing links (area_api.usage.go_url) to the portal search
    it names. The target is rebuilt from the parameters, so /go can only ever open the portals."""
    params = dict(request.query_params)
    target = _school_go_target(portal, params) if portal in school_links.GO_PORTALS else usage.go_target(portal, params)
    if target is None:
        raise HTTPException(status_code=404, detail={"error": "unknown-link", "message": "This link is not valid"})
    # The site's own pages count their click-outs themselves (lib/usage.ts, honouring Analytics off), so a
    # from=web link only validates and redirects here: counting it again would count every click twice.
    if params.get("from") != "web" and not usage.is_bot(request.headers.get("user-agent")):
        session = params.get("s") if usage.SESSION.match(params.get("s") or "") else None
        source = params.get("from")
        usage.record(_connect, source if source in usage.GO_SOURCES else "mcp", "portal_click",
                     {**usage.go_props(portal, params), "traffic": usage.traffic_prop(usage.request_traffic(request.headers))},
                     session)
    return RedirectResponse(target, status_code=302, headers=private_response_headers())


def _school_go_target(portal: str, params: dict[str, str]) -> str | None:
    """A school's Visit & links destination, rebuilt from its URN and the database (never from the request)."""
    urn = params.get("urn") or ""
    if not school_links.URN.match(urn):
        return None
    with _connect() as connection:
        row = next(iter(connection.execute(schools.scoped(school_card.LINKS_ROW_SQL), (urn,))), None)
    return school_links.destination(portal.removeprefix("school-"), dict(row)) if row else None


HEALTH_TTL_SECONDS = 10.0
_health_cache: tuple[float, Callable[[], dict] | None, dict] | None = None


def get_health_report() -> dict:
    """Memoised for HEALTH_TTL_SECONDS: /health is not rate limited, so a flood
    of probes must not become a flood of readiness queries."""
    global _health_cache
    now = time.monotonic()
    cached = _health_cache
    if cached and cached[1] is _health_loader and now - cached[0] < HEALTH_TTL_SECONDS:
        return cached[2]
    report = _health_loader() if _health_loader is not None else load_readiness(evidence_connection)
    _health_cache = (now, _health_loader, report)
    return report


@app.get("/health")
def health() -> JSONResponse:
    report = repository.log_health_report(get_health_report())
    return JSONResponse(
        status_code=repository.health_http_status(report), content=report)


@app.post("/api/v1/corrections",
          summary="Report a wrong number (publisher-error, transformation-error) or ask to hide your "
                  "home (privacy-objection: uprn or addressId + email; confirmed by e-mail link)",
          **operation("reportCorrection"))
@request_body(models.CorrectionRequest)
async def corrections(payload: dict, request: Request) -> dict:
    if payload.get("kind") == "privacy-objection":
        ip = rate_limiter.client(request.scope)
        return await _run_evidence(request, lambda cancel: _request_objection(payload, ip))
    prepared = _map_errors(lambda: repository.prepare_correction_report(payload))
    report_id = await _run_evidence(
        request, lambda cancel: {"id": repository.store_correction_report(_connect, prepared)})
    stored = {**prepared, "id": report_id["id"]}
    logger.info("correction-report code=received id=%s kind=%s observation=%s product=%s source=%s",
                stored["id"], stored["kind"], stored.get("observationId"),
                stored.get("productReleaseId"), stored.get("sourceReleaseId"))
    stored["notified"] = notify.deliver(stored)
    return stored


def _request_objection(payload: dict, client_ip: str) -> dict:
    result = get_objections().request(
        uprn=payload.get("uprn"), address_id=payload.get("addressId"), email=payload.get("email"),
        reason=payload.get("description"), client_ip=client_ip)
    confirm_url = f"{_public_url()}/api/v1/objections/confirm?token={result['token']}"
    channel = notify.send_confirmation(result["email"], confirm_url)
    report = {"kind": "privacy-objection", "route": "privacy", "id": result["id"], "status": "pending",
              "uprn": result["uprn"], "addressId": result["address_id"],
              "confirmationSent": channel is not None, "confirmationChannel": channel}
    logger.info("correction-report code=received id=%s kind=privacy-objection confirmation-channel=%s",
                result["id"], channel)
    report["notified"] = notify.deliver(report)
    return report


def _public_url() -> str:
    return (os.environ.get("CLOSE_KNIT_PUBLIC_URL") or "http://localhost:4180").rstrip("/")


@app.get("/api/v1/objections/confirm",
         summary="Confirm a hide-my-home request with the token from the e-mail; the home is hidden from then on",
         **operation("confirmObjection"))
async def confirm_objection(request: Request, token: str = "") -> dict:
    row = await _run_evidence(request, lambda cancel: get_objections().confirm(token))
    logger.info("objection code=confirmed id=%s", row["id"])
    return {"status": "active", "objection": objection_summary(row)}


@app.get("/api/v1/metrics", **operation("listMetrics"))
async def list_metrics(request: Request) -> dict:
    return await _run_evidence(request, lambda cancel: get_reader().list_metrics(cancel=cancel))


@app.get("/api/v1/search", **operation("searchAreas"))
async def search_areas(request: Request, q: str = "", limit: int | None = None,
                       scope: Literal["areas", "all"] = "areas") -> dict:
    # scope=all is the site's one Search: schools, stations and parks join the areas and homes.
    reader = get_reader()
    search = reader.search_site if scope == "all" else reader.search_areas
    return await _run_evidence(request, lambda cancel: search(q, limit=limit, cancel=cancel))


@app.get("/api/v1/areas/boxes",
         summary="The box index of a map chunk (area-boxes.v1): each area's [id, west, south, east, north] for a "
                 "carrier, in a region or LAD chunk (?chunk=, map-coverage.v1) or every area. The shapes are the "
                 "area vector tiles (/api/v1/tiles/areas)",
         **operation("getAreaBoxes"))
async def get_area_boxes(request: Request, response: Response, carrier: str = "lsoa", chunk: str | None = None,
                         v: str | None = None) -> dict:
    body = await _run_evidence(request, lambda cancel: get_reader().area_boxes(carrier, cancel=cancel, chunk=chunk))
    # Boxes change only with an ONS release: a day's browser cache, for good with the release in the URL (?v=).
    response.headers["cache-control"] = _release_cache(body, v, "public, max-age=86400")
    return body


@app.get("/api/v1/map/coverage",
         summary="Where the map can go and the chunks it loads its shapes and colours in (map-coverage.v1): "
                 "England's regions and LADs behind CLOSE_KNIT_ENGLAND, else London's bounds and no chunks",
         **operation("getMapCoverage"))
async def get_map_coverage(request: Request, response: Response) -> dict:
    body = await _run_evidence(request, lambda cancel: get_reader().map_coverage(cancel=cancel))
    response.headers["cache-control"] = "public, max-age=300"
    return body


@app.get("/api/v1/scope",
         summary="The places this channel serves (scope.v1): London, or England behind CLOSE_KNIT_ENGLAND (the MCP "
                 "and the extension read it as off while the site is private); its regions, box and the reason "
                 "code for a place outside it",
         **operation("getScope"))
def get_served_scope(served: Scope = Depends(get_scope)) -> dict:
    return served.payload()


# A map chunk's URL names the release it was built for (?v=<productReleaseId>, from map-coverage.v1):
# while that release is active the answer never changes, so the browser keeps it for good.
IMMUTABLE = "public, max-age=31536000, immutable"
# A map payload without the release in its URL: fresh for 5 minutes, then stale-while-revalidate for a day.
PACK_CACHE = "public, max-age=300, stale-while-revalidate=86400"


def _release_cache(body: dict, version: str | None, otherwise: str) -> str:
    return IMMUTABLE if version and version == body.get("productReleaseId") else otherwise


@app.get("/api/v1/labels",
         summary="Map label points: one per borough and per postcode district (GeoJSON)",
         **operation("getMapLabels"))
async def get_map_labels(request: Request, response: Response) -> dict:
    from . import labels

    body = await _run_evidence(request, lambda cancel: labels.map_labels(get_reader(), cancel=cancel))
    # Every map open loads them (0.45 MB): kept like a map payload, not fetched again each time (perf/layer-load).
    response.headers["cache-control"] = PACK_CACHE
    return body


@app.get("/api/v1/areas/names",
         summary="The name to show for each area id (?ids=comma list, at most 50): its friendly title "
                 "(\"Alperton East · HA0\"), else the official name; unknown ids are left out (area-names.v1)",
         **operation("getAreaNames"))
async def get_area_names(request: Request, ids: str = "") -> dict:
    area_ids = list(dict.fromkeys(item.strip() for item in ids.split(",") if item.strip()))
    return await _run_evidence(request, lambda cancel: get_reader().area_names(area_ids, cancel=cancel))


@app.get("/api/v1/areas/{area_id}", **operation("getAreaSummary"))
async def get_area(area_id: str, request: Request, metric: str, period: str) -> dict:
    return await _run_evidence(
        request,
        _scoped(area_id, lambda cancel: get_reader().get_area(area_id, metric, period, cancel=cancel)))


@app.get("/api/v1/areas/{area_id}/profile",
         summary="Every area metric but stock value at its latest period on or before ?period=, "
                 "state schools within 1 km by phase and the road/rail noise share",
         **operation("getAreaProfile"))
async def get_area_profile(area_id: str, request: Request, period: str) -> dict:
    return await _run_evidence(
        request, _scoped(area_id, lambda cancel: get_reader().get_profile(area_id, period, cancel=cancel)))


@app.get("/api/v1/areas/{area_id}/market-by-type",
         summary="Local market by property type: latest 12 months, percentiles and a 10-year trend "
                 "(Price Paid category A; widened to MSOA or borough when sales are few)",
         **operation("getAreaMarketByType"))
async def get_area_market_by_type(area_id: str, request: Request) -> dict:
    from . import market
    return await _run_evidence(request, lambda cancel: market.area_market(get_reader(), area_id, cancel=cancel))


@app.get("/api/v1/areas/{area_id}/standouts",
         summary="A neighbourhood's, wider neighbourhood's (MSOA) or borough's 12 fixed tiles (each with its London standing), up to three pros and two "
                 "cons from London's best and worst 10% (deprivation as a tag only) and a one-line verdict; never "
                 "people, income or social housing",
         **operation("getAreaStandouts"))
async def get_area_standouts(area_id: str, request: Request) -> dict:
    from . import standouts
    return await _run_evidence(request, _scoped(area_id, lambda cancel: standouts.area_standouts(get_reader(), area_id, cancel=cancel)))


@app.get("/api/v1/areas/{area_id}/layers",
         summary="Every map metric for an area in one call, as rating tiles (London standing, newest value, "
                 "trend over a year), the three ready-made criteria it rates highest on, and flood, air and "
                 "broadband band chips; ?scope=overview keeps the home page's Overview layers only. Census "
                 "layers descriptive only while CLOSE_KNIT_CENSUS_RANKED is off",
         **operation("getAreaLayers"))
async def get_area_layers(area_id: str, request: Request, scope: str | None = None) -> dict:
    from . import layers
    return await _run_evidence(request, _scoped(area_id, lambda cancel: layers.area_layers(get_reader(), area_id, cancel=cancel, scope=scope)))


@app.get("/api/v1/areas/{area_id}/safety",
         summary="A neighbourhood's recorded crime per 1,000 residents, its top offence types beside London's rate "
                 "for each, and the three-year change (police.uk, ONS population)",
         **operation("getAreaSafety"))
async def get_area_safety(area_id: str, request: Request) -> dict:
    from . import safety
    return await _run_evidence(request, _scoped(area_id, lambda cancel: safety.area_safety(get_reader(), area_id, cancel=cancel)))


@app.get("/api/v1/areas/{area_id}/recent-sales",
         summary="Standard sales of the last 18 months in the area the market summary uses, paged",
         **operation("getAreaRecentSales"))
async def get_area_recent_sales(area_id: str, request: Request, page: int = 1, pageSize: int = 20,
                                sort: str = "nearest") -> dict:
    from . import market
    return await _run_evidence(request, lambda cancel: market.recent_sales(
        get_reader(), area_id, page=page, page_size=pageSize, sort=sort, cancel=cancel))


@app.get("/api/v1/areas/{area_id}/since",
         summary="What changed after ?date=YYYY-MM-DD (a saved area's line): standard sales completed since then, "
                 "in the area the market summary uses (same widening), and the area's Price tile £ per m²",
         **operation("getAreaSince"))
async def get_area_since(area_id: str, request: Request, date: str) -> dict:
    from . import market
    return await _run_evidence(request, lambda cancel: market.area_since(get_reader(), area_id, date, cancel=cancel))


@app.get("/api/v1/areas/{area_id}/schools",
         summary="State-funded primary and secondary schools within 1.5 km of the area (Ofsted, DfE KS4)",
         **operation("getAreaSchools"))
async def get_area_schools(area_id: str, request: Request) -> dict:
    return await _run_evidence(request, lambda cancel: get_reader().area_schools(area_id, cancel=cancel))


@app.get("/api/v1/areas/{area_id}/noise",
         summary="Share of the area's dwellings at or above 55 / 65 dB Lden from road and rail "
                 "(Defra strategic noise mapping 2022); with ?uprn= also that home's modelled levels",
         **operation("getAreaNoise"))
async def get_area_noise(area_id: str, request: Request, uprn: str | None = None) -> dict:
    return await _run_evidence(request, lambda cancel: get_reader().area_noise(area_id, uprn, cancel=cancel))


@app.get("/api/v1/areas/{area_id}/nature",
         summary="Green share (Sentinel-2), street trees (GLA), nearest nature reserve or SSSI and a nature "
                 "score as London percentiles, plus wildlife recorded within 1 km (GBIF, open-licence records); "
                 "with ?uprn= also the green share and street trees around that home",
         **operation("getAreaNature"))
async def get_area_nature(area_id: str, request: Request, uprn: str | None = None) -> dict:
    from . import nature

    return await _run_evidence(request, _scoped(area_id, lambda cancel: nature.area_nature(get_reader()._connect, area_id, uprn, cancel)))


@app.get("/api/v1/areas/{area_id}/people",
         summary="Residents and density (ONS mid-year estimates) and Census 2021 counts by ethnic group, "
                 "religion, qualifications, occupation, economic activity, tenure and home type, with London shares",
         **operation("getAreaPeople"))
async def get_area_people(area_id: str, request: Request) -> dict:
    from . import people

    return await _run_evidence(request, _scoped(area_id, lambda cancel: people.area_people(get_reader()._connect, area_id, cancel)))


@app.get("/api/v1/areas/{area_id}/places",
         summary="Nearest stations (TfL zone and lines), parks with size class, everyday amenities by group "
                 "and a 1-10 connectivity score, from the area's centroid or with ?uprn= from that home "
                 "(OpenStreetMap, TfL open data)",
         **operation("getAreaPlaces"))
async def get_area_places(area_id: str, request: Request, uprn: str | None = None) -> dict:
    from . import places
    return await _run_evidence(
        request, _scoped(area_id, lambda cancel: places.area_places(get_reader()._connect, area_id, uprn, cancel=cancel)))


# Civic context (track J): tests swap _civic for a reader over a fake connection.
_civic: CivicReader | None = None


def get_civic() -> CivicReader:
    global _civic
    if _civic is None:
        _civic = CivicReader(connect=evidence_connection)
    return _civic


@app.get("/api/v1/areas/{area_id}/civic",
         summary="Where the area sits (region, borough, wards, constituencies, police force, ONS codes), "
                 "its borough's council tax bands A-H, and its ward councillors and MP",
         **operation("getAreaCivic"))
async def get_area_civic(area_id: str, request: Request) -> dict:
    return await _run_evidence(request, lambda cancel: get_civic().area(area_id, cancel=cancel))


@app.get("/api/v1/postcodes/{postcode}/civic",
         summary="One London postcode's ONS codes, date introduced, council tax bands and representatives",
         **operation("getPostcodeCivic"))
async def get_postcode_civic(postcode: str, request: Request) -> dict:
    return await _run_evidence(request, lambda cancel: get_civic().postcode(postcode, cancel=cancel))


@app.get("/api/v1/areas/{area_id}/rents",
         summary="The area's borough's latest average private rents by bedroom count (ONS PIPR), "
                 "with London's alongside; borough level, never one home's rent",
         **operation("getAreaRents"))
async def get_area_rents(area_id: str, request: Request) -> dict:
    from . import area_rents

    return await _run_evidence(request, _scoped(area_id, lambda cancel: area_rents.area_rents(get_reader(), area_id, cancel=cancel)))


@app.get("/api/v1/areas/{area_id}/hpi",
         summary="The borough's official house price index (HM Land Registry UK HPI): price line since 1995 by "
                 "type of home, change over 1, 5 and 10 years against London, and its London rank",
         **operation("getAreaHpi"))
async def get_area_hpi(area_id: str, request: Request) -> dict:
    from . import uk_hpi

    return await _run_evidence(request, _scoped(area_id, lambda cancel: uk_hpi.area_hpi(get_reader(), area_id, cancel=cancel)))


@app.get("/api/v1/areas/{area_id}/rent-trend",
         summary="The area's borough's private rents since 2015 by bedroom count and type of home (ONS PIPR), "
                 "change over 1 and 5 years next to London's, and the borough's London percentile",
         **operation("getAreaRentTrend"))
async def get_area_rent_trend(area_id: str, request: Request) -> dict:
    from . import rent_trend

    return await _run_evidence(request, _scoped(area_id, lambda cancel: rent_trend.area_rent_trend(get_reader(), area_id, cancel=cancel)))


@app.get("/api/v1/photos/nearby",
         summary="Geograph photos nearest a London point: titles, photographers and links (CC BY-SA 2.0), "
                 "never the images themselves",
         **operation("getNearbyPhotos"))
async def get_nearby_photos(request: Request, lat: float, lon: float, limit: int = 4) -> dict:
    from . import photos

    return await _run_evidence(request, lambda cancel: photos.nearby_photos(get_reader(), lat, lon, limit, cancel=cancel))


@app.get("/api/v1/areas/{area_id}/flood",
         summary="Share of the area's land in each Environment Agency flood risk band (rivers and sea; "
                 "surface water) and the highest band; with ?uprn= also that home's bands",
         **operation("getAreaFlood"))
async def get_area_flood(area_id: str, request: Request, uprn: str | None = None) -> dict:
    from . import flood

    return await _run_evidence(request, lambda cancel: flood.area_flood(get_reader(), area_id, uprn, cancel=cancel))


@app.get("/api/v1/areas/{area_id}/kids",
         summary="Kids: well-rated nurseries within 1 km (Ofsted, nearest named), pedestrians and cyclists "
                 "hurt within 500 m over five years (DfT STATS19) and km of protected lane and TfL Cycleway "
                 "within 1 km (TfL), each with its London percentile among areas of the same kind",
         **operation("getAreaKids"))
async def get_area_kids(area_id: str, request: Request) -> dict:
    from . import kids

    return await _run_evidence(request, _scoped(area_id, lambda cancel: kids.area_kids(get_reader(), area_id, cancel=cancel)))


@app.get("/api/v1/areas/{area_id}/location",
         summary="Share of the area's land in a conservation area, the ULEZ and the Congestion Charge zone, "
                 "planning applications in the last 24 months, and short card notes",
         **operation("getAreaLocation"))
async def get_area_location(area_id: str, request: Request) -> dict:
    from . import location

    return await _run_evidence(request, _scoped(area_id, lambda cancel: location.area_location(get_reader(), area_id, cancel=cancel)))


@app.get("/api/v1/areas/{area_id}/pipeline",
         summary="New homes on the way: London Development Database permissions not started, under construction "
                 "and completed in five years, homes still to come within 1 km, the rate per 1,000 homes with its "
                 "London percentile, and the Opportunity Areas and Housing Zones the area sits in",
         **operation("getAreaPipeline"))
async def get_area_pipeline(area_id: str, request: Request) -> dict:
    from . import pipeline

    return await _run_evidence(request, _scoped(area_id, lambda cancel: pipeline.area_pipeline(get_reader(), area_id, cancel=cancel)))


@app.get("/api/v1/areas/{area_id}/future-transport",
         summary="The nearest new station (under construction, consented, funded or proposed) from TfL, GLA "
                 "and DfT scheme pages, with a short card note",
         **operation("getAreaFutureTransport"))
async def get_area_future_transport(area_id: str, request: Request) -> dict:
    from . import future_transport

    return await _run_evidence(
        request, lambda cancel: future_transport.area_future_transport(get_reader(), area_id, cancel=cancel))


@app.get("/api/v1/areas/{area_id}/health",
         summary="Modelled air pollution (NO2, PM2.5) at the area's homes, summer heat on its land and patients "
                 "per GP at practices within 1 km, each with its London percentile and short card notes",
         **operation("getAreaHealth"))
async def get_area_health(area_id: str, request: Request) -> dict:
    from . import health

    return await _run_evidence(request, _scoped(area_id, lambda cancel: health.area_health(get_reader(), area_id, cancel=cancel)))


@app.get("/api/v1/areas/{area_id}/council-tax",
         summary="Homes by council tax band A-H (VOA), the most common and middle band, the mean band against "
                 "London and a typical bill from the borough's Band D",
         **operation("getAreaCouncilTax"))
async def get_area_council_tax(area_id: str, request: Request) -> dict:
    from . import council_tax

    return await _run_evidence(request, _scoped(area_id, lambda cancel: council_tax.area_council_tax(get_reader(), area_id, cancel=cancel)))


@app.get("/api/v1/good-value",
         summary="Good value inputs for the Best value sort: per LSOA with 20+ sales of the home type, its typical "
                 "price, score vector (six London ranks) and how that price compares with the 50 areas whose "
                 "ranks are closest (valueRatio, cheapest for its peers first). Area level only",
         **operation("getGoodValue"))
async def get_good_value(request: Request, homeType: str = "all", areas: str | None = None) -> dict:
    from . import good_value

    return await _run_evidence(request, lambda cancel: good_value.good_value(get_reader(), homeType, areas,
                                                                             cancel=cancel))


@app.get("/api/v1/areas/{area_id}/home",
         summary="Can I extend (land in a conservation area or under Article 4, listed buildings), gigabit "
                 "broadband and how settled residents are, each ranked against London, with card notes",
         **operation("getAreaHome"))
async def get_area_home(area_id: str, request: Request) -> dict:
    from . import home

    return await _run_evidence(request, _scoped(area_id, lambda cancel: home.area_home(get_reader(), area_id, cancel=cancel)))


@app.get("/api/v1/areas/{area_id}/ownership",
         summary="Land titles held by UK and overseas companies per home (HMLR CCOD/OCOD), ranked against "
                 "London (evidence envelope; behind CLOSE_KNIT_OWNERSHIP)",
         **operation("getAreaOwnership"))
async def get_area_ownership(area_id: str, request: Request) -> dict:
    from . import ownership

    return await _run_evidence(request, _scoped(area_id, lambda cancel: ownership.area_ownership(get_reader(), area_id, cancel=cancel)))


@app.get("/api/v1/areas/{area_id}/short-lets",
         summary="Airbnb listings per 1,000 homes, the share that are entire homes and the share reviewed in the "
                 "last 12 months, against London (Inside Airbnb, CC BY 4.0); counts, never a listing or host",
         **operation("getAreaShortLets"))
async def get_area_short_lets(area_id: str, request: Request) -> dict:
    from . import short_lets

    return await _run_evidence(request, _scoped(area_id, lambda cancel: short_lets.area_short_lets(get_reader(), area_id, cancel=cancel)))


@app.get("/api/v1/areas/{area_id}/mobile",
         summary="Predicted mobile coverage (Ofcom, per borough): 4G indoors from all four networks and 5G outdoors "
                 "from any, each ranked against London, in the evidence envelope with card notes",
         **operation("getAreaMobile"))
async def get_area_mobile(area_id: str, request: Request) -> dict:
    from . import mobile

    return await _run_evidence(request, _scoped(area_id, lambda cancel: mobile.area_mobile(get_reader(), area_id, cancel=cancel)))


@app.get("/api/v1/areas/{area_id}/hmo",
         summary="Licensed HMOs per 1,000 homes against London from the borough's public register (or \"not "
                 "published\"), and the additional or selective licensing schemes in force there",
         **operation("getAreaHmo"))
async def get_area_hmo(area_id: str, request: Request) -> dict:
    from . import hmo

    return await _run_evidence(request, _scoped(area_id, lambda cancel: hmo.area_hmo(get_reader(), area_id, cancel=cancel)))


@app.get("/api/v1/areas/{area_id}/market",
         summary="Local market depth of an LSOA or MSOA: 12-month standard sales, turnover, leasehold "
                 "share of sales, new-build premium and growth (evidence envelope; no valuation)",
         **operation("getAreaMarket"))
async def get_area_market(area_id: str, request: Request) -> dict:
    def call(cancel: Callable[[], bool]) -> dict:
        reader = get_reader()
        payload = reader.get_market_depth(area_id, cancel=cancel)
        return market_depth.wrap_market(payload, reader.list_metrics(cancel=cancel))
    return await _run_evidence(request, call)


@app.get("/api/v1/areas/{area_id}/pack",
         summary="Area evidence pack: market depth, crime, noise, nearby schools and growth; with "
                 "?address= also that address's building and street sale aggregates (evidence envelope)",
         **operation("getAreaEvidencePack"))
async def get_area_pack(area_id: str, request: Request, address: str | None = None) -> dict:
    def call(cancel: Callable[[], bool]) -> dict:
        reader = get_reader()
        payload = reader.get_area_pack(area_id, address, cancel=cancel)
        return regions.with_rank_scope(market_depth.wrap_pack(payload, reader.list_metrics(cancel=cancel)),
                                       reader._connect, area_id)
    return await _run_evidence(request, call)


@app.get("/api/v1/areas/{area_id}/similar",
         summary="Up to ten LSOAs with the closest London percentiles for crime, deprivation, income, "
                 "price level and walk to a station (never demographic composition); ?cheaper=true keeps "
                 "a lower price per m², ?outsideZones=<zones JSON> leaves out areas inside those zones, "
                 "?socialRenting=true also compares the social-renting share",
         **operation("getSimilarAreas"))
async def get_similar_areas(area_id: str, request: Request, response: Response, cheaper: bool = False,
                            outsideZones: str | None = None, socialRenting: bool = False) -> dict:
    if outsideZones:
        response.headers.update(private_response_headers())

    def run(cancel: Callable[[], bool]) -> dict:
        payload = get_reader().get_similar_areas(
            area_id, cheaper=cheaper, outside_zones=outsideZones, social_renting=socialRenting, cancel=cancel)
        # Friendly titles ("Pitshanger · W5") for the rows; the official name stays in "name".
        _with_titles(payload["values"])
        return payload
    return await _run_evidence(request, run)


@app.get("/api/v1/brief",
         summary="Search brief for /brief (area-brief.v1): recommended LSOAs (?areas=comma list, ranked) "
                 "with their ring of touching neighbours, sale prices of similar homes against "
                 "?budgetMin/?budgetMax, graded nearby schools and the nearest station",
         **operation("getSearchBrief"))
async def get_brief(request: Request, response: Response, areas: str = "", budgetMin: int | None = None,
                    budgetMax: int | None = None, bedrooms: int = 2, market: str = "buy",
                    propertyType: str = "any") -> dict:
    # A budget is part of a household's private profile: never cached.
    response.headers.update(private_response_headers())
    area_ids = [item.strip() for item in areas.split(",") if item.strip()]
    return await _run_evidence(request, lambda cancel: get_reader().get_brief(
        area_ids, (budgetMin, budgetMax), bedrooms, market, propertyType, cancel=cancel))


@app.post("/api/v1/commute",
          summary="Door-to-door minutes (transit, walk, cycle, car) from one LSOA to the household's pinned places via "
                  "the commute hubs (area-commute.v1); POST because places are exact locations. Never cached.",
          **operation("postCommute"))
@request_body(models.CommuteRequest)
async def post_commute(body: dict, request: Request, response: Response) -> dict:
    response.headers.update(private_response_headers())
    area_id = str(body.get("areaId", ""))
    places = body.get("places") or []
    from .matching import validate_places
    _map_errors(lambda: validate_places(places))
    return await _run_evidence(request, lambda cancel: get_reader().get_commute(
        area_id, places, cancel=cancel))


@app.post("/api/v1/custom-criteria/evaluate",
          summary="A custom criterion from places on OpenStreetMap (custom-criterion.v1, e.g. kebab shops vs "
                  "cafés) for every London LSOA: values, London percentiles, legend and top areas "
                  "(custom-criterion-pack.v1). POST and never cached: a criterion is part of a household's search.",
          **operation("evaluateCustomCriterion"))
@request_body(models.CustomCriterionRequest)
async def post_custom_criterion(body: dict, request: Request, response: Response) -> dict:
    response.headers.update(private_response_headers())
    from . import custom_criteria

    criterion = body.get("criterion")
    _map_errors(lambda: custom_criteria.validate_definition(criterion))

    def run(cancel: Callable[[], bool]) -> dict:
        # Titles go in before the ends are picked, so two LSOAs with one friendly title make one line.
        titles = repository.area_titles()
        with _connect() as connection:
            return custom_criteria.evaluate(connection, criterion, titles=titles, cancel=cancel)
    return await _run_evidence(request, run)


@app.get("/api/v1/custom-criteria/presets/{criterion_id}/pack",
         summary="A ready-made criterion (custom:<id> on the map: gyms, cafés, ...) for every LSOA, or with "
                 "?level=msoa rolled up to MSOAs (custom-criterion-pack.v1). The same for everyone, so cached: "
                 "immutable with ?v=<release>.",
         **operation("getCustomCriterionPresetPack"))
async def get_custom_preset_pack(criterion_id: str, request: Request, response: Response, v: str | None = None,
                                 level: str | None = None) -> dict:
    pack = await _run_evidence(request, lambda cancel: get_reader().preset_pack(
        criterion_id, repository.area_titles, cancel=cancel, level=level))
    if pack is None:
        raise HTTPException(status_code=404, detail={"error": "preset-not-found"})
    response.headers["cache-control"] = _release_cache(pack, v, PACK_CACHE)
    return pack


@app.get("/api/v1/custom-criteria/presets",
         summary="Ready-made custom criteria (Kebab shops vs cafés, Gyms and sports centres, Bars, pubs and clubs, ...) as "
                 "custom-criterion.v1 definitions with a suggested direction",
         **operation("listCustomCriterionPresets"))
def get_custom_presets() -> JSONResponse:
    from . import custom_criteria

    return JSONResponse(custom_criteria.presets(), headers={"cache-control": "public, max-age=3600"})


@app.get("/api/v1/stations",
         summary="Search rail, Underground, Overground, DLR and tram stations by name (zone picker)",
         **operation("searchStations"))
async def search_stations(request: Request, q: str = "") -> dict:
    return await _run_evidence(request, lambda cancel: get_reader().search_stations(q, cancel=cancel))


@app.get("/api/v1/schools", summary="Search London state-funded schools by name", **operation("listSchools"))
async def search_schools(request: Request, q: str = "") -> dict:
    return await _run_evidence(request, lambda cancel: get_reader().search_schools(q, cancel=cancel))


# Registered before /schools/{urn}, which would otherwise read "index" as a URN.
@app.get("/api/v1/schools/index",
         summary="Every school's URN, name, phase and whether any result or inspection is published (sitemap)",
         **operation("getSchoolIndex"))
async def get_school_index(request: Request) -> dict:
    return await _run_evidence(request, lambda cancel: get_reader().school_index(cancel=cancel))


@app.get("/api/v1/schools/points",
         summary="Every open London state school's URN, name, phase and point (the map's Show › Schools)",
         **operation("getSchoolPoints"))
async def get_school_points(request: Request, response: Response) -> dict:
    points = await _run_evidence(request, lambda cancel: get_reader().school_points(cancel=cancel))
    # Fixed within a release; the map asks once per visit.
    response.headers["cache-control"] = "public, max-age=3600"
    return points


@app.get("/api/v1/universities/points",
         summary="Universities and colleges from OpenStreetMap: the map's points under Student areas (zoom 13+)",
         **operation("getUniversityPoints"))
async def get_university_points(request: Request, response: Response) -> dict:
    points = await _run_evidence(request, lambda cancel: get_reader().university_points(cancel=cancel))
    # Fixed within a release; the map asks once per visit.
    response.headers["cache-control"] = "public, max-age=3600"
    return points


@app.get("/api/v1/schools/{urn}", summary="One school's inspection and results evidence",
         **operation("getSchool"))
async def get_school(urn: str, request: Request) -> dict:
    return await _run_evidence(request, lambda cancel: get_reader().get_school(urn, cancel=cancel))


@app.get("/api/v1/schools/{urn}/card",
         summary="One school's card: results by year against London (percentiles, medians), Top school badge, "
                 "dated Ofsted extracts and every council's last distance offered with its source",
         **operation("getSchoolCard"))
async def get_school_card(urn: str, request: Request) -> dict:
    return await _run_evidence(request, lambda cancel: get_reader().school_card(urn, cancel=cancel))


@app.get("/api/v1/school-rankings/{axis}",
         summary="One phase's state schools ranked on one KS4 measure (cohort of 30+, latest year) or filtered "
                 "by one Ofsted framework's grade; report-card and legacy grades are never combined",
         **operation("getSchoolRanking"))
async def get_school_ranking(axis: str, request: Request, phase: str = "secondary", limit: int = 100) -> dict:
    return await _run_evidence(
        request, lambda cancel: get_reader().school_ranking(axis, phase, limit, cancel=cancel))


@app.get("/api/v1/value-packs/{metric_id}/{period}", **operation("getValuePack"))
async def get_value_pack(metric_id: str, period: str, request: Request, response: Response,
                         chunk: str | None = None, level: Literal["lsoa", "msoa", "lad", "borough"] | None = None,
                         v: str | None = None, region: str = "",
                         format: Literal["full", "compact"] = "full") -> dict:
    # ?chunk= (a region or LAD code) and ?level= (a coarser carrier, as medians): England's map asks for
    # the chunks in view at a level for its zoom (map_chunks); without them, every area as always.
    # ?region= (a region code or area id) cuts the pack to one region (area guide pages).
    # ?format=compact: rows of only what the map paints (map_chunks.compact_pack), a tenth of the size.
    pack = await _run_evidence(
        request,
        lambda cancel: area_pages.in_region(
            get_reader(), get_reader().get_value_pack(metric_id, period, cancel=cancel, chunk=chunk, level=level),
            region, cancel))
    if format == "compact":
        pack = map_chunks.compact_pack(pack)
    # Immutable within a release: without the release in the URL (London whole) a short fresh window, then served
    # from the browser's cache while it revalidates, so switching back to a layer never waits on the network.
    response.headers["cache-control"] = _release_cache(pack, v, PACK_CACHE)
    return pack


@app.get("/api/v1/metric-values/{metric_id}",
         summary="Every area's value for each month in ?periods= (comma list of YYYY-MM, at most 40), numbers "
                 "only, in one read: the price layer's fixed colour scale is computed from these (metric-values.v1)",
         **operation("getMetricValues"))
async def get_metric_values(metric_id: str, request: Request, response: Response, periods: str = "") -> dict:
    wanted = [period.strip() for period in periods.split(",") if period.strip()]
    body = await _run_evidence(
        request, lambda cancel: get_reader().metric_values(metric_id, wanted, cancel=cancel))
    response.headers["cache-control"] = "public, max-age=300"
    return body


@app.get("/api/v1/hierarchy",
         summary="Every borough, MSOA and LSOA with its parent and region, and state schools inside each borough "
                 "and MSOA; ?region= (E12000002, or an area id: its region) and ?carrier= narrow it",
         **operation("getAreaHierarchy"))
async def get_hierarchy(request: Request, region: str = "", carrier: str = "") -> dict:
    return await _run_evidence(
        request, lambda cancel: area_pages.hierarchy(get_reader(), cancel=cancel, region=region, carrier=carrier))


@app.get("/api/v1/areas/{area_id}/trail",
         summary="An area and every area above it (borough › MSOA › LSOA), root first, as /api/v1/hierarchy "
                 "rows: a page's breadcrumbs without its region's whole list",
         **operation("getAreaTrail"))
async def get_area_trail(area_id: str, request: Request) -> dict:
    return await _run_evidence(request, lambda cancel: area_pages.trail(get_reader(), area_id, cancel=cancel))


# Registered before the metric route below, which would otherwise read "lens" as a metric id.
@app.get("/api/v1/area-values/lens/{preset}",
         summary="A ranking lens (a custom-criterion preset such as family or gyms) for every MSOA or borough "
                 "(?carrier=msoa|lad): places per km², kinds of cuisine or median walk minutes, rolled up "
                 "from LSOAs once per release",
         **operation("getLensValues"))
async def get_lens_values(preset: str, request: Request, response: Response, carrier: str, region: str = "") -> dict:
    from . import custom_criteria

    def run(cancel: Callable[[], bool]) -> dict:
        with _connect() as connection:
            pack = custom_criteria.lens_pack(connection, preset, carrier)
        return area_pages.in_region(get_reader(), pack, region, cancel)
    pack = await _run_evidence(request, run)
    # Immutable within a release.
    response.headers["cache-control"] = "public, max-age=300"
    return pack


@app.get("/api/v1/sectors",
         summary="Postcode sectors whose code starts with ?q= ('W5', 'W5-1'; at most 20), or every "
                 "sector without q (?homes=1: only those with recorded homes): [{code, slug, name}], with "
                 "center [lon, lat] (a point inside the sector) for a q search",
         **operation("searchSectors"))
async def search_sectors(request: Request, q: str = "", homes: bool = False) -> list:
    from . import zones_sector

    return await _run_evidence(request, lambda cancel: zones_sector.search(get_reader()._connect, q, cancel=cancel,
                                                                            homes=homes))


@app.get("/api/v1/sectors/{slug}",
         summary="One postcode sector (slug 'W5-1'): £/m² distribution against its district, £/m² index "
                 "since 2004 (nominal and CPIH-real), returns, nearby sectors and streets; aggregates only",
         **operation("getSector"))
async def get_sector(slug: str, request: Request) -> dict:
    from . import zones_sector

    return await _run_evidence(request, lambda cancel: zones_sector.sector(get_reader()._connect, slug, cancel=cancel))


@app.get("/api/v1/area-values/{metric_id}/{period}",
         summary="One metric for every area of one carrier (?carrier=lsoa|msoa|lad) in one month",
         **operation("getAreaValues"))
async def get_area_values(metric_id: str, period: str, request: Request, carrier: str, region: str = "") -> dict:
    return await _run_evidence(
        request, lambda cancel: area_pages.in_region(
            get_reader(), area_pages.carrier_values(get_reader(), metric_id, period, carrier, cancel=cancel),
            region, cancel))


@app.get("/api/v1/addresses/{address_id}/history", **operation("getAddressHistory"))
async def get_address_history(address_id: str, request: Request) -> dict:
    return await _run_evidence(
        request,
        lambda cancel: _with_home_sources(get_reader().get_address_history(address_id, cancel=cancel)))


@app.get("/api/v1/addresses/{address_id}/nearby-sales", **operation("getNearbySales"))
async def get_nearby_sales(address_id: str, request: Request) -> dict:
    return await _run_evidence(
        request,
        lambda cancel: get_reader().get_nearby_sales(address_id, cancel=cancel))


@app.get("/api/v1/properties/{uprn}", **operation("getProperty"))
async def get_property(uprn: str, request: Request) -> dict:
    return await _run_evidence(
        request, lambda cancel: _with_home_sources(get_reader().get_property(uprn, cancel=cancel)))


@app.get("/api/v1/properties/{uprn}/profile",
         summary="One home: recorded sales (with HM Land Registry links), EPC facts, the other homes at "
                 "its postcode, and prices in its area today (same-type middle half, adjusted to today, and "
                 "the coarse band of its last sale); never a figure for the home itself",
         **operation("getPropertyProfile"))
async def get_property_profile(uprn: str, request: Request) -> dict:
    return await _run_evidence(
        request, lambda cancel: _with_home_sources(
            property_profile.property_profile(get_reader()._connect, uprn, cancel=cancel)))


@app.get("/api/v1/postcodes/{postcode}/homes",
         summary="Every recorded home in a postcode: type, tenure, floor area, energy rating, last sale",
         **operation("getPostcodeHomes"))
async def get_postcode_homes(postcode: str, request: Request, sales: bool = False) -> dict:
    """With sales=true each home also lists its recorded sales (one call for a whole postcode page)."""
    return await _run_evidence(
        request, lambda cancel: _with_home_sources(property_profile.postcode_homes(
            get_reader()._connect, postcode, cancel=cancel, include_sales=sales)))


@app.get("/api/v1/homes/near",
         summary="The postcodes with recorded homes nearest a point (within 800 m, nearest first): each with "
                 "how many of its homes have a page and how far their middle is; postcodes, never addresses",
         **operation("getHomesNear"))
async def get_homes_near(request: Request, latitude: float, longitude: float, limit: int = 4) -> dict:
    from . import homes_near

    return await _run_evidence(
        request, lambda cancel: homes_near.homes_near(get_reader()._connect, latitude, longitude, limit, cancel=cancel))


@app.get("/api/v1/homes/at/{postcode}/{house_slug}",
         summary="A home with no recorded sale, found at street level: likely postcode, neighbouring "
                 "numbers and area; a recorded home answers with its uprn (or postcodePage); a hidden home "
                 "reads like an unrecorded number; 404 outside the street's recorded numbers",
         **operation("getStreetHome"))
async def get_street_home(postcode: str, house_slug: str, request: Request) -> dict:
    def call(cancel: Callable[[], bool]) -> dict:
        home = street_home.street_home(get_reader()._connect, postcode, house_slug, cancel=cancel)
        if home is None:
            raise AddressNotFound(f"no street-level home: {house_slug} in {postcode}")
        return home

    return await _run_evidence(request, call)


@app.get("/api/v1/homes/index",
         summary="One postcode sector's postcodes and homes with a page, hidden homes left out (sitemap)",
         **operation("getHomeIndex"))
async def get_home_index(request: Request, sector: str = "") -> dict:
    return await _run_evidence(
        request, lambda cancel: property_profile.home_index(get_reader()._connect, sector, cancel=cancel))


def _with_home_sources(payload: dict) -> dict:
    """Per-home payloads name their publishers, licences and attribution text (sources[])."""
    return attribution.with_home_sources(get_reader()._connect, payload)


@app.get("/api/v1/tiles/properties/{z}/{x}/{y}.pbf", response_class=Response,
         summary="Vector tile of homes: street blocks (`blocks`, zoom 12-14: parcels merged between "
                 "OpenStreetMap roads), freehold parcels (`parcels`) and parcel-less dwellings (`dwellings`) "
                 "from zoom 15; blocks carry ppm (median £/m² over three or more homes); a sold home "
                 "(a dwelling or a parcel of one home) carries band, its last sale's coarse band 0-5 "
                 "against same-type sales in its area that year; no per-home value or £/m² "
                 "(migration 044)",
         **operation("getPropertyTile"))
async def get_property_tile(z: int, x: int, y: int, request: Request) -> Response:
    tile = await _run_evidence(
        request, lambda cancel: {"tile": get_reader().property_tile(z, x, y, cancel=cancel)})
    if not tile["tile"]:
        return Response(status_code=204, headers={"cache-control": "public, max-age=3600"})
    return Response(content=tile["tile"], media_type="application/vnd.mapbox-vector-tile",
                    headers={"cache-control": "public, max-age=3600"})


@app.get("/api/v1/tiles/sales/{z}/{x}/{y}.pbf", response_class=Response,
         summary="Vector tile of recorded sales (HM Land Registry Price Paid): `sale_cells` (zoom 11-14, "
                 "medians of homes sold in the latest five years, three or more per cell) and `sales` "
                 "(zoom 15+, one point per home with its last sale's price, previous sale and "
                 "area growth g1/g3/g5/g10/g20 in percent; no per-sale £/m²)",
         **operation("getSaleTile"))
async def get_sale_tile(z: int, x: int, y: int, request: Request) -> Response:
    tile = await _run_evidence(
        request, lambda cancel: {"tile": get_reader().sale_tile(z, x, y, cancel=cancel)})
    if not tile["tile"]:
        return Response(status_code=204, headers={"cache-control": "public, max-age=3600"})
    return Response(content=tile["tile"], media_type="application/vnd.mapbox-vector-tile",
                    headers={"cache-control": "public, max-age=3600"})


@app.get("/api/v1/tiles/areas/{release}/{kind}/{z}/{x}/{y}.mvt", response_class=Response,
         summary="Vector tile of area boundaries (map_tiles, migrations 116, 125): one layer named after the kind "
                 "(lsoa, msoa, borough), each feature's id its ONS code as an integer (E01000001 -> 1000001), no "
                 "properties; zoom 5-12 (the map overzooms 12). The release is map-coverage.v1's areaTiles.release: "
                 "while it is the current one the tile never changes (immutable). With CLOSE_KNIT_ENGLAND off, "
                 "London's areas alone (the London map's own release)",
         **operation("getAreaTile"))
async def get_area_tile(release: str, kind: str, z: int, x: int, y: int, request: Request) -> Response:
    reader = get_reader()
    tile = await _run_evidence(request, lambda cancel: {
        "tile": reader.area_tile(release, kind, z, x, y, cancel=cancel),
        "current": map_tiles.immutable(reader.area_tile_info(cancel), release, feature_flags.england())})
    cache = IMMUTABLE if tile["current"] else "public, max-age=300"
    if not tile["tile"]:
        return Response(status_code=204, headers={"cache-control": cache})
    return Response(content=tile["tile"], media_type="application/vnd.mapbox-vector-tile",
                    headers={"cache-control": cache})


@app.get("/api/v1/tiles/places/{z}/{x}/{y}.pbf", response_class=Response,
         summary="Vector tile of places (`places`, zoom 14+, empty below): cafés, restaurants, pubs, gyms, "
                 "shops, culture and other places merged from OpenStreetMap, the FSA hygiene register, "
                 "Overture and Foursquare, confidence 0.6 or more; properties id, name, category, group, "
                 "brand, sources (comma-separated), hygiene_rating and score (importance 0-100: category, "
                 "agreeing sources, confidence, recognised brand, register-rated food; the web draws "
                 "higher scores first as labels). Zoom 14 keeps landmarks and well-confirmed places, the "
                 "best per group in each ~64 px cell; zoom 15 more (~32 px cells); zoom 16+ every place "
                 "but generic one-source entries. ODbL 1.0 (contains OpenStreetMap data)",
         **operation("getPlaceTile"))
async def get_place_tile(z: int, x: int, y: int, request: Request) -> Response:
    tile = await _run_evidence(
        request, lambda cancel: {"tile": get_reader().place_tile(z, x, y, cancel=cancel)})
    if not tile["tile"]:
        return Response(status_code=204, headers={"cache-control": "public, max-age=3600"})
    return Response(content=tile["tile"], media_type="application/vnd.mapbox-vector-tile",
                    headers={"cache-control": "public, max-age=3600"})


@app.get("/api/v1/tiles/collisions/{z}/{x}/{y}.pbf", response_class=Response,
         summary="Vector tile of road casualties (`collisions`, zoom 10+, empty below): below zoom 13 counts n "
                 "per ~1.2 km-150 m cell by severity (1 killed, 2 serious, 3 slight), road_user (pedestrian, "
                 "cyclist, escooter, motorcycle, car, bus, goods, other) and child (0-15); from zoom 13 one point per "
                 "casualty with year, dark (light) and age_band too. No date, time or sex. DfT STATS19, last five "
                 "years (OGL v3)",
         **operation("getCollisionTile"))
async def get_collision_tile(z: int, x: int, y: int, request: Request) -> Response:
    from . import kids

    tile = await _run_evidence(
        request, lambda cancel: {"tile": kids.collision_tile(get_reader(), z, x, y, cancel=cancel)})
    if not tile["tile"]:
        return Response(status_code=204, headers={"cache-control": "public, max-age=3600"})
    return Response(content=tile["tile"], media_type="application/vnd.mapbox-vector-tile",
                    headers={"cache-control": "public, max-age=3600"})


@app.get("/api/v1/tiles/cycle-lanes/{z}/{x}/{y}.pbf", response_class=Response,
         summary="Vector tile of cycle lanes (`cycle_lanes`, zoom 11+, empty below; painted lanes from zoom "
                 "13): kind protected (segregated or stepped track), lane or cycleway (TfL Cycleways) and "
                 "name. TfL Cycling Infrastructure Database and Cycleways; Powered by TfL Open Data",
         **operation("getCycleLaneTile"))
async def get_cycle_lane_tile(z: int, x: int, y: int, request: Request) -> Response:
    from . import kids

    tile = await _run_evidence(
        request, lambda cancel: {"tile": kids.cycle_lane_tile(get_reader(), z, x, y, cancel=cancel)})
    if not tile["tile"]:
        return Response(status_code=204, headers={"cache-control": "public, max-age=3600"})
    return Response(content=tile["tile"], media_type="application/vnd.mapbox-vector-tile",
                    headers={"cache-control": "public, max-age=3600"})


@app.get("/api/v1/tiles/street-trees/{z}/{x}/{y}.pbf", response_class=Response,
         summary="Vector tile of street trees (`street_trees`, zoom 12+, empty below): below zoom 15 counts n per "
                 "cell (a 64th of the tile), for a heat map; from zoom 15 one point per tree with name (common name), height, "
                 "canopy, girth and age as the owner recorded them (null when not), canopy_m (spread in metres, "
                 "for the dot size) and owner (borough, TfL, Royal Parks). GLA public realm trees, Nov 2025 "
                 "(OGL v3): council, TfL and park trees only, no private gardens",
         **operation("getStreetTreeTile"))
async def get_street_tree_tile(z: int, x: int, y: int, request: Request) -> Response:
    from . import street_trees

    tile = await _run_evidence(
        request, lambda cancel: {"tile": street_trees.street_tree_tile(get_reader(), z, x, y, cancel=cancel)})
    if not tile["tile"]:
        return Response(status_code=204, headers={"cache-control": "public, max-age=3600"})
    return Response(content=tile["tile"], media_type="application/vnd.mapbox-vector-tile",
                    headers={"cache-control": "public, max-age=3600"})


@app.get("/api/v1/tiles/green-streets/{z}/{x}/{y}.pbf", response_class=Response,
         summary="Vector tile of green streets (`green_streets`, zoom 13+, empty below): OS Open Roads links "
                 "(OGL v3) with name, trees (street trees within 20 m, each counted for its nearest link), "
                 "per_100m (trees per 100 m; links under 50 m count as 50 m) and canopy (share of the two kerbs "
                 "under canopy, 0-1, null unless most of the link's trees have a canopy recorded); from zoom 14 "
                 "also `green_street_bands`, a 35 m buffer each side of every link with trees (per_100m), the "
                 "homes along it. Contains OS data © Crown copyright and database right 2026; GLA public realm "
                 "trees (OGL v3)",
         **operation("getGreenStreetTile"))
async def get_green_street_tile(z: int, x: int, y: int, request: Request) -> Response:
    from . import street_trees

    tile = await _run_evidence(
        request, lambda cancel: {"tile": street_trees.green_street_tile(get_reader(), z, x, y, cancel=cancel)})
    if not tile["tile"]:
        return Response(status_code=204, headers={"cache-control": "public, max-age=3600"})
    return Response(content=tile["tile"], media_type="application/vnd.mapbox-vector-tile",
                    headers={"cache-control": "public, max-age=3600"})


@app.get("/api/v1/tiles/canopy/{z}/{x}/{y}.png", response_class=Response,
         summary="PNG map tile of green cover (Canopy, zoom 8-14, empty elsewhere or where a tile has no green): "
                 "each 10 m cell whose highest clear summer NDVI is 0.4 or more, in four shades of green (0.4, "
                 "0.5, 0.6, 0.7+): trees, gardens (private ones too), grass and parks. Contains modified "
                 "Copernicus Sentinel data (2025). Zoom 8-10: the share of green 10 m cells under each pixel, in the "
                 "same four shades",
         **operation("getCanopyTile"))
async def get_canopy_tile(z: int, x: int, y: int, request: Request) -> Response:
    from . import street_trees

    tile = await _run_evidence(
        request, lambda cancel: {"tile": street_trees.canopy_tile(get_reader(), z, x, y, cancel=cancel)})
    if not tile["tile"]:
        return Response(status_code=204, headers={"cache-control": "public, max-age=86400"})
    return Response(content=tile["tile"], media_type="image/png", headers={"cache-control": "public, max-age=86400"})


@app.get("/api/v2/downloads/places.csv", response_class=FileResponse, tags=["downloads"],
         summary="The unified places database as CSV under ODbL 1.0 (share-alike: it contains OpenStreetMap "
                 "data): every place behind the place tiles with id, name, category, group, brand, sources, "
                 "confidence, score, specialty_score, hygiene_rating, lsoa_id, lon, lat, the OSM / FSA / "
                 "Overture / Foursquare ids, tags (JSON) and source release; '#' notice lines precede the "
                 "header. Rate limited to a few downloads per hour",
         **operation("downloadPlaces"))
async def download_places(request: Request) -> FileResponse:
    built = await _run_evidence(request, lambda cancel: downloads.places_csv(get_reader()._connect, cancel=cancel))
    return FileResponse(built["path"], media_type="text/csv; charset=utf-8", filename=built["filename"],
                        headers={"cache-control": downloads.CACHE_CONTROL,
                                 "link": f'<{downloads.ODBL_URL}>; rel="license"',
                                 "x-source-release": built["release"]})


@app.post("/api/v1/matches",
          summary="My match: every area scored against an ordered list of criteria (preference-profile "
                  "v2, or v1 migrated): fit per criterion with soft edges, weights from the order, Musts as filters, "
                  "rank and percentile among scored areas, the top 2 reasons, the 2 weakest criteria and the bottom 10. "
                  "sort=best-value orders the better half by good value for the home type (area level only). "
                  "?regions=E12000007,E12000008 scores the areas of those regions only (CLOSE_KNIT_ENGLAND; "
                  "default all of England, London alone with the flag off), filtered in the database",
          **operation("createMatches"))
@request_body(models.MatchRequest)
def matches(profile: dict, sort: Literal["score", "best-value"] = "score",
            homeType: str | None = None, served: Scope = Depends(get_scope)) -> Response:
    _validate_profile(profile)
    rows = load_match_evidence(profile, served)
    if not rows:
        raise HTTPException(status_code=503, detail="No validated factor release is loaded")
    home_type = homeType or match_model.value_home_type(profile)
    # Score sort too: the pack says how many areas Best value would list (valueAreas), so the UI hides it at 0.
    value_rows = _good_value_rows(home_type) if sort == "best-value" else _value_rows_or_none(home_type)
    pack = build_match_pack(profile, rows, sort=sort, value_rows=value_rows,
                            region_of=regions.area_regions(get_reader()._connect), **_match_zones(profile))
    _with_titles(pack["values"])
    # Rendered here, not by FastAPI: its jsonable_encoder walk over every area's components took about 1 s of an
    # England pack (33,754 areas, 22 MB) before the bytes were written.
    return AliasedJSONResponse(pack, headers=private_response_headers())


@app.post("/api/v1/portal-links", **operation("createPortalLinks"))
@request_body(models.PortalLinksRequest)
def portal_links_route(body: dict, response: Response) -> dict:
    """Each My match zone as a search on Rightmove, Zoopla and OnTheMarket (portal_zones.py),
    with the search's budget and bedrooms. Links go through /go; the budget makes the answer private."""
    response.headers.update(private_response_headers())
    market = body.get("market")
    max_price, beds, zones = body.get("maxPrice"), body.get("minBedrooms"), body.get("zones") or []
    price_ok = isinstance(max_price, int) and 100 <= max_price <= 100_000_000
    beds_ok = isinstance(beds, int) and 0 <= beds <= 10
    if market not in ("buy", "rent") or not price_ok or not beds_ok:
        raise HTTPException(status_code=400, detail="market, maxPrice (100 to 100,000,000) and minBedrooms (0 to 10) are needed")
    try:
        validate_zones(zones)
    except InvalidMatchRequest as error:
        raise HTTPException(status_code=400, detail=str(error))
    with _connect() as connection:
        found = portal_zones.zone_links(connection, zones, market, max_price, beds, repository.zone_lsoas, _connect)
    return {"schemaVersion": "portal-links.v1", "market": market, "maxPrice": max_price, "minBedrooms": beds, "zones": found}

@app.post("/api/v1/zone-shapes", **operation("createZoneShapes"))
@request_body(models.ZoneShapesRequest)
def zone_shapes_route(body: dict, response: Response) -> dict:
    """Each My match Where zone's outline for the map (a borough's boundary; a station's walk or a list of
    areas as the union of its LSOAs); null for a drawn polygon, which the client draws from its corners. The
    zones are part of the household's search: private, never cached."""
    response.headers.update(private_response_headers())
    zones = body.get("zones") if isinstance(body, dict) else None
    if not isinstance(zones, list) or not zones:
        raise HTTPException(status_code=400, detail="zones are needed")
    try:
        validate_zones(zones)
    except InvalidMatchRequest as error:
        raise HTTPException(status_code=400, detail=str(error))
    with _connect() as connection:
        shapes = repository.zone_shapes(connection, zones)
    return {"schemaVersion": "zone-shapes.v1",
            "zones": [{"kind": zone["kind"], "geometry": shape} for zone, shape in zip(zones, shapes)]}


def _match_zones(profile: dict) -> dict:
    return repository.match_zones(profile, lambda zones: load_zone_lsoas(zones, _connect),
                                  lambda inside, soft: repository.load_zone_distances(inside, soft, _connect))


GOOD_VALUE_TTL_SECONDS = 600.0
_good_value_cache: dict[str, tuple[float, dict]] = {}


def _good_value_rows(home_type: str) -> dict:
    """area_good_value rows for the home type by area id; {} before migration 069 or without a release.
    Memoised for GOOD_VALUE_TTL_SECONDS per home type: every My match request reads them (valueAreas) and the
    table only changes with a data load."""
    from . import good_value

    try:
        code = good_value.home_type_code(home_type)
    except Exception as error:  # noqa: BLE001 - evidence.MalformedQuery: a 400 like any bad parameter
        raise HTTPException(status_code=400, detail=str(error)) from error
    cached = _good_value_cache.get(code)
    now = time.monotonic()
    if cached and now - cached[0] < GOOD_VALUE_TTL_SECONDS:
        return cached[1]
    with _connect() as connection:
        found = {row["geography_id"]: row for row in good_value.rows(connection, code, None)}
    _good_value_cache[code] = (now, found)
    return found


def _value_rows_or_none(home_type: str) -> dict | None:
    """The good-value rows for a score-sorted pack's valueAreas; None (no valueAreas) when they cannot be read,
    so a good-value outage never fails the match itself."""
    try:
        return _good_value_rows(home_type)
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 - logged; the match answers without valueAreas
        logger.warning("good-value rows unavailable for valueAreas", exc_info=True)
        return None


@app.get("/api/v1/match-criteria/{layer}",
         summary="Every London area's value of one My match criterion layer and its London percentile: the "
                 "histogram behind a range card, for layers without a map value pack (noise from area_noise, "
                 "disorder, schools, EPC and leasehold shares) as well as map metrics",
         **operation("getMatchCriterionValues"))
def match_criterion_values(layer: str) -> dict:
    from .matching import RANGE_LAYER_RE, is_descriptive_layer

    if not RANGE_LAYER_RE.match(layer) or layer.startswith("custom:") or is_descriptive_layer(layer):
        raise HTTPException(status_code=400, detail="not a criterion layer")
    values = repository.criterion_values(layer)
    if not values["values"]:
        raise HTTPException(status_code=404, detail="no values for this layer")
    return values


def _with_titles(values: list[dict]) -> None:
    """Friendly titles ("Pitshanger · W5") for result rows, and the one name to show:
    the title, else the official name, which stays in "name"."""
    titles = repository.area_titles()
    for value in values:
        value["title"] = titles.get(value["geographyId"])
        value["displayName"] = value["title"] or value.get("name")


@app.get("/api/v1/extension-config", **operation("getExtensionConfig"))
def extension_config_route(response: Response) -> dict:
    """The browser extension's per-portal mode (inline, side-panel or off), feature flags and not-affiliated notice."""
    response.headers["Cache-Control"] = "public, max-age=300"
    return extension_config.extension_config()


# Built match packs per (release, profile hash) for the extension's card and results line: a pack ranks every
# London area (1-2 s), and the same saved search asks for it on every listing. Up to ~5 MB each.
MATCH_PACKS = card_cache.TTLCache(limit=32)


def _extension_match_pack(profile: dict) -> dict | None:
    """The validated profile's match pack, built once an hour per release; None without a factor release."""
    def build() -> dict | None:
        rows = load_match_evidence(profile)
        if not rows:
            return None
        return build_match_pack(profile, rows, **_match_zones(profile))

    key = (card_cache.release_id(get_reader()), card_cache.profile_key(profile))
    return MATCH_PACKS.get_or_build(key, build)


@app.post("/api/v1/listing-card", **operation("createListingCard"))
@request_body(models.ListingCardRequest)
def listing_card_route(request: listing_card.ListingCardRequest, http: Request, response: Response) -> dict:
    """The browser extension's card beside a Rightmove, Zoopla, OnTheMarket, SpareRoom or OpenRent listing."""
    response.headers.update(private_response_headers())
    profile = request.profile
    if profile is not None:
        _validate_profile(profile)

    def match_for(area_id: str) -> dict | None:
        pack = _extension_match_pack(profile)
        return listing_card.match_result(pack, area_id) if pack else None

    try:
        card = listing_card.listing_card(_tool_context(), request, match_for if profile else None)
    except AreaNotFound:
        card = listing_card.outside_card()
    card = _flagged_home_blocks(card, request)
    if not usage.is_bot(http.headers.get("user-agent")) and http.headers.get("x-close-knit-analytics") != "off":
        usage.record(_connect, "api", "extension_card", {"portal": request.portal, "market": request.market,
                                                          "status": card["status"], "personalised": profile is not None,
                                                          "traffic": usage.traffic_prop(usage.request_traffic(http.headers))})
    return card


def _flagged_home_blocks(card: dict, request: listing_card.ListingCardRequest) -> dict:
    """Home-level blocks behind feature_flags (all off until the privacy / legal review): the matched home
    before the card's actions. A failure leaves the card as it was."""
    if card.get("status") != "ok":
        return card
    today = datetime.date.today()
    if feature_flags.address_match() and request.market == "buy" and not request.locationApproximate:
        facts = {"floorAreaSqm": request.floorAreaSqm, "propertyType": request.propertyType,
                 "epcRating": request.epcRating, "bedrooms": request.bedrooms}
        try:
            home = home_match.home_block(_connect, facts, postcode=request.postcode, area_id=card.get("geographyId"),
                                         address=request.address, with_value=feature_flags.home_value(), today=today)
        except Exception:  # noqa: BLE001 - the card is served without the home
            logger.warning("listing not matched to a home", exc_info=True)
            home = None
        if home:
            blocks = card["blocks"]
            at = next((i for i, block in enumerate(blocks) if block.get("type") == "actions"), len(blocks))
            card = {**card, "blocks": [*blocks[:at], home, *blocks[at:]]}
    return card


@app.post("/api/v1/listing-badges", **operation("createListingBadges"))
@request_body(models.ListingBadgesRequest)
def listing_badges_route(request: listing_badges.ListingBadgesRequest, http: Request, response: Response) -> dict:
    """The browser extension's line under each search result on the portals (up to 30 per request)."""
    response.headers.update(private_response_headers())
    profile = request.profile
    if profile is not None:
        _validate_profile(profile)
    def match_for(area_id: str) -> dict | None:
        pack = _extension_match_pack(profile)  # one pack per saved search, whatever the number of areas
        return listing_card.match_result(pack, area_id) if pack else None

    result = listing_badges.listing_badges(_tool_context(), request, match_for if profile else None)
    if not usage.is_bot(http.headers.get("user-agent")) and http.headers.get("x-close-knit-analytics") != "off":
        usage.record(_connect, "api", "extension_badges", {
            "portal": request.portal, "items": len(request.items), "personalised": profile is not None,
            "scored": sum(1 for item in result["items"] if item["score"] is not None),
            "traffic": usage.traffic_prop(usage.request_traffic(http.headers))})
    return result


@app.get("/api/v2/tools", tags=["agent-tools"], summary="List agent tools and their input schemas",
         **operation("listAgentTools"))
def list_tools() -> dict:
    return {"schemaVersion": "tool-index.v1", "tools": [
        {"name": spec.name, "description": spec.description, "tags": list(spec.tags),
         "schemaVersion": spec.schema_version, "inputSchema": spec.input_model.model_json_schema()}
        for spec in TOOLS.values()]}


# Tools whose arguments carry a household's budget, preferences, places or a listing: never cached.
PRIVATE_TOOLS = {"match_areas", "find_areas", "get_listing_search_links", "assess_listing", "build_watch_spec",
                 "get_commute", "open_shared_search", "evaluate_custom_criterion", "send_feedback"}


@app.post("/api/v2/tools/{tool_name}", tags=["agent-tools"],
          summary="Call an agent tool; the body is the tool's arguments object",
          **operation("callAgentTool"))
@request_body(models.AgentToolArguments)
async def call_agent_tool(tool_name: str, arguments: dict, request: Request, response: Response) -> dict:
    if tool_name in PRIVATE_TOOLS:
        response.headers.update(private_response_headers())
    started, result, code = time.monotonic(), None, "internal-error"
    kind = usage.request_traffic(request.headers)
    try:
        result = await _run_evidence(
            request, lambda cancel: call_tool(tool_name, _tool_context(cancel, kind), arguments))
        code = None
        return result
    except HTTPException as error:
        code = error.detail.get("error") if isinstance(error.detail, dict) else str(error.status_code)
        raise
    finally:
        if tool_name in TOOLS:
            asyncio.get_running_loop().run_in_executor(
                None, usage.record, _connect, "api", "tool_call",
                usage.tool_call_props(tool_name, started, result, code, traffic_kind=kind))


def _scoped(area_id: str, call: Callable[[Callable[[], bool]], dict]) -> Callable[[Callable[[], bool]], dict]:
    """An area route's call with rankScope {code, name} added: the region its percentiles are computed in. An area
    outside the coverage (outside London with CLOSE_KNIT_ENGLAND off) is not found, as before England was loaded."""
    def run(cancel: Callable[[], bool]) -> dict:
        connect = get_reader()._connect
        if not evidence.in_scope(connect, area_id):
            raise AreaNotFound(f"unknown area: {area_id}")
        return regions.with_rank_scope(call(cancel), connect, area_id)
    return run


async def _run_evidence(request: Request, call: Callable[[Callable[[], bool]], dict]) -> dict:
    if await request.is_disconnected():
        raise asyncio.CancelledError()
    cancel = threading.Event()
    watcher = asyncio.create_task(_watch_disconnect(request, cancel))
    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, lambda: _map_errors(lambda: call(cancel.is_set)))
    finally:
        cancel.set()
        watcher.cancel()


async def _watch_disconnect(request: Request, cancel: threading.Event) -> None:
    while not cancel.is_set():
        if await request.is_disconnected():
            cancel.set()
            return
        await asyncio.sleep(0.05)


def _map_errors(call: Callable[[], dict]) -> dict:
    try:
        return call()
    except Exception as error:
        status, code = errors.status_and_code(error)
        if code == "internal-error":
            raise
        raise _http_error(status, code, error) from error


def _http_error(status: int, code: str, error: Exception) -> HTTPException:
    logger.warning("area-api error code=%s status=%s message=%s", code, status, error)
    detail: dict = {"error": code, "message": str(error)}
    # An ambiguous home lookup carries its candidates so the caller can ask, not guess.
    if getattr(error, "candidates", None):
        detail["candidates"] = error.candidates
    return HTTPException(status_code=status, detail=detail)


def _validate_profile(profile: dict) -> None:
    try:
        validate_match_request(profile)
    except InvalidMatchRequest as error:
        raise HTTPException(status_code=400, detail=str(error))


def _openapi() -> dict:
    """/openapi.json: the contract as contracts/openapi.yaml holds it (contract/openapi.py)."""
    if app.openapi_schema is None:
        app.openapi_schema = build_openapi(app)
    return app.openapi_schema


app.openapi = _openapi  # type: ignore[method-assign]
