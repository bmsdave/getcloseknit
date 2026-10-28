"""Smoke: MCP over Streamable HTTP must answer identically to the REST mirror.

    python3 agents/smoke_mcp_http.py http://localhost:8080
"""
import json, sys, urllib.request
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
# X-Close-Knit-Team marks these calls as ours, so the dashboards leave them out of live use (usage.traffic).
HDR = {"content-type": "application/json", "accept": "application/json, text/event-stream", "x-close-knit-team": "1"}
session = None
def rpc(method, params=None, id=1):
    global session
    body = {"jsonrpc": "2.0", "method": method, "params": params or {}}
    if id is not None: body["id"] = id
    h = dict(HDR); 
    if session: h["mcp-session-id"] = session
    r = urllib.request.urlopen(urllib.request.Request(f"{BASE}/mcp", json.dumps(body).encode(), h))
    session = r.headers.get("mcp-session-id", session)
    raw = r.read()
    return json.loads(raw) if raw else None
def rest(name, args):
    r = urllib.request.urlopen(urllib.request.Request(f"{BASE}/api/v2/tools/{name}", json.dumps(args).encode(), {"content-type": "application/json", "x-close-knit-team": "1"}))
    return json.loads(r.read())
init = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "ck-smoke", "version": "0"}})
print("initialize:", init["result"]["serverInfo"]["name"], "session", session[:8])
rpc("notifications/initialized", id=None)
print("tools/list:", [t["name"] for t in rpc("tools/list", id=2)["result"]["tools"]])
args = {"area_id": "uk:lad:E09000009", "metric_id": "crime", "period": "2026-06"}
mcp = rpc("tools/call", {"name": "get_area_metric", "arguments": args}, id=3)["result"]["structuredContent"]
via_rest = rest("get_area_metric", args)
print("parity get_area_metric:", "IDENTICAL" if mcp == via_rest else "DIFF", "| value", mcp["value"]["value"], mcp["value"]["quality"], "| evidence rows", len(mcp["evidence"]), "| source", mcp["sources"][0]["release"])
stock = rpc("tools/call", {"name": "get_home_prices", "arguments": {"property_ref": "100a Baker Street EN1"}}, id=4)["result"]
print("get_home_prices:", stock["content"][0]["text"] if stock.get("isError") else (stock["structuredContent"]["dataMode"], stock["structuredContent"]["confidence"]))
err = rpc("tools/call", {"name": "get_area_metric", "arguments": {**args, "area_id": "uk:lsoa:E01999999"}}, id=5)["result"]
print("error:", err["isError"], err["content"][0]["text"])

# Home search: the guided flow an agent runs, over MCP, with the widget and prompt it relies on.
listed = {t["name"]: t for t in rpc("tools/list", id=6)["result"]["tools"]}
print("widget tools:", sorted(n for n, t in listed.items() if (t.get("_meta") or {}).get("ui")))
widget = rpc("resources/read", {"uri": "ui://close-knit/home-search.html"}, id=7)["result"]["contents"][0]
print("widget resource:", widget["mimeType"], len(widget["text"]), "bytes")
print("prompts:", [p["name"] for p in rpc("prompts/list", id=8)["result"]["prompts"]])
def tool(name, arguments, id):
    result = rpc("tools/call", {"name": name, "arguments": arguments}, id=id)["result"]
    if result.get("isError"):
        raise SystemExit(f"{name} failed: {result['content'][0]['text']}")
    return result["structuredContent"]
station = tool("search_places", {"q": "King's Cross"}, 9)["value"]["stations"][0]
found = tool("find_areas", {"max_budget": 600000, "bedrooms": 2, "priorities": [
    {"factor": "crime", "importance": 4}, {"factor": "station-access", "importance": 3}],
    "near_stations": [{"station_id": station["stationId"], "max_walk_minutes": 30}], "top_n": 4}, 10)
areas = found["value"]["areas"]
print("find_areas near", station["name"] + ":", [(a["name"], a["borough"], a["estimatedPrice"], a["budgetFit"]) for a in areas])
refined = tool("find_areas", {"max_budget": 600000, "bedrooms": 2, "priorities": [{"factor": "crime", "importance": 4}],
    "near_stations": [{"station_id": station["stationId"], "max_walk_minutes": 30}],
    "exclude_area_ids": [areas[0]["geographyId"]], "top_n": 4}, 11)["value"]["areas"]
print("refined without", areas[0]["name"] + ":", [a["name"] for a in refined])
overview = tool("get_area_overview", {"area_id": areas[0]["geographyId"], "bedrooms": 2}, 12)["value"]
print("overview:", overview["name"], "| schools", overview["schools"]["count"], "| trend points", len(overview["priceTrend"]))
links = tool("get_listing_search_links", {"area_ids": [a["geographyId"] for a in areas[:2]], "max_price": 600000, "min_bedrooms": 2}, 13)["value"]
print("portal searches:", [(s["outcode"], sorted(s["links"])) for s in links["searches"]])
check = tool("assess_listing", {"postcode": "W5 2NU", "asking_price": 575000, "bedrooms": 2, "tenure": "leasehold"}, 14)["value"]
print("assess_listing:", check["area"]["name"], check["price"]["verdict"], check["price"]["differencePercent"], "%")
watch = tool("build_watch_spec", {"name": "Kings Cross 2-bed", "area_ids": [a["geographyId"] for a in areas[:2]], "max_price": 600000, "min_bedrooms": 2}, 15)["value"]
print("watch:", watch["spec"]["stateFile"], "|", len(watch["schedulePrompt"].splitlines()), "prompt lines")
