"""Discovery surface for agents that are not MCP clients (Meta Muse, crawlers):
where the tools are, what they return, and where the OpenAPI document lives."""
import os

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from . import mcp_server
from .tools import TOOLS

router = APIRouter(tags=["discovery"])

# Proves to the official MCP Registry that we own getcloseknit.com (namespace com.getcloseknit). Public key
# only; the private key stays on the publisher's machine. Rotate by replacing this line and logging in again.
MCP_REGISTRY_AUTH = "v=MCPv1; k=ed25519; p=AxbViCXYKJr92/WMBVxV9okfd66OtnrBPvf8yoyv3po="
# Proves getcloseknit.com to Glama, which lists the connector from the registry. The token is bound to the owner's
# Glama account and holds no personal data; it must stay published to keep the claim.
GLAMA_CLAIM = {"$schema": "https://glama.ai/mcp/schemas/connector.json",
               "claim": "glama_claim_jkUVTyKxOvUPG6_kpbnxivMlW9Z7XMw1"}


def public_base_url(request: Request) -> str:
    return os.environ.get("CLOSE_KNIT_PUBLIC_URL", str(request.base_url)).rstrip("/")


@router.get("/.well-known/mcp/server.json", summary="MCP server manifest (registry server.json shape)")
def mcp_manifest(request: Request) -> dict:
    """The repo's server.json (registry schema), with the remote on this host. Only schema keys: the
    registry has no tools, openapi or llms fields, and there is no published package."""
    return {
        "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
        "name": mcp_server.REGISTRY_NAME,
        "title": mcp_server.SERVER_TITLE,
        "description": mcp_server.SERVER_DESCRIPTION,
        "version": mcp_server.SERVER_VERSION,
        "websiteUrl": mcp_server.WEBSITE_URL,
        "repository": mcp_server.REPOSITORY,
        "icons": [mcp_server.ICON],
        "remotes": [{"type": "streamable-http", "url": f"{public_base_url(request)}{mcp_server.MCP_PATH}"}],
    }


@router.get("/.well-known/mcp/server-card.json", summary="MCP server card (SEP-1649 draft)")
def mcp_server_card() -> JSONResponse:
    """What initialize and tools/list would say, for clients and crawlers that read before they connect."""
    card = {
        "serverInfo": {"name": mcp_server.SERVER_NAME, "title": mcp_server.SERVER_TITLE,
                       "version": mcp_server.SERVER_VERSION},
        "description": mcp_server.SERVER_DESCRIPTION,
        "iconUrl": mcp_server.ICON["src"],
        "transport": {"type": "streamable-http", "endpoint": mcp_server.MCP_PATH},
        "tools": "dynamic",  # SEP-1649: full Tool objects or "dynamic"; tools/list has them
    }
    return JSONResponse(card, headers={"Access-Control-Allow-Origin": "*"})


@router.get("/.well-known/mcp-registry-auth", response_class=PlainTextResponse,
            summary="Domain proof for the official MCP Registry")
def mcp_registry_auth() -> str:
    return MCP_REGISTRY_AUTH + "\n"


@router.get("/.well-known/glama.json", summary="Domain proof for Glama's connector directory")
def glama_claim() -> dict:
    return GLAMA_CLAIM


@router.get("/llms.txt", response_class=PlainTextResponse, summary="Plain-text guide for agents")
def llms_txt(request: Request) -> str:
    base = public_base_url(request)
    lines = [
        "# Close Knit — UK property intelligence tools",
        "",
        "> Evidence-backed area and property facts for London. Every answer is an evidence "
        "envelope: value, confidence (high|medium|low|none), evidence[], sources[] (named "
        "releases with licence and methodology), caveats[]. dataMode=demo marks illustrative "
        "fixtures that must not be presented as facts.",
        "",
        "## Endpoints",
        f"- MCP (Streamable HTTP): {base}/mcp",
        f"- REST mirror: POST {base}/api/v2/tools/{{name}} with the tool arguments as JSON body",
        f"- Tool index with JSON schemas: {base}/api/v2/tools",
        f"- OpenAPI 3.1: {base}/openapi.json",
        f"- MCP manifest: {base}/.well-known/mcp/server.json",
        "",
        "## Downloads",
        f"- Unified places database (CSV, ODbL 1.0, contains OpenStreetMap data; a few per hour): "
        f"{base}/api/v2/downloads/places.csv",
        "",
        "## Tools",
    ]
    lines += [f"- {spec.name} [{', '.join(spec.tags)}]: {spec.description}" for spec in TOOLS.values()]
    lines += ["", "## Workflow", "1. list_metrics  2. search_areas  3. get_area_metric / "
              "rank_areas_by_metric / get_address_history  4. match_areas for a household profile.",
              "", "## Helping someone choose where to live",
              "search_places → find_areas → (feedback: exclude_area_ids, find_similar_areas) → "
              "get_area_overview → get_listing_search_links → assess_listing → build_watch_spec. "
              "The MCP prompt find-a-home starts this flow; MCP Apps clients render the results as an "
              "interactive board."]
    return "\n".join(lines) + "\n"
