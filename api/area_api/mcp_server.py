"""MCP server over the shared tool registry.

Each `ToolSpec` becomes one MCP tool whose input schema is the spec's
pydantic model, flattened so agents see plain named parameters. Handlers
run in a worker thread (the reader is synchronous) and evidence errors
surface as MCP tool errors carrying the same code the REST mirror uses.
"""
import inspect
import logging
import os
import time
from dataclasses import replace
from pathlib import Path
from typing import Any, Callable

import anyio
from mcp.server import MCPServer
from mcp.server.apps import Apps, ResourceCsp
from mcp.server.mcpserver.context import Context
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.mcpserver.prompts import Prompt
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import Icon, ToolAnnotations
from pydantic import BaseModel
from starlette.types import ASGIApp, Receive, Scope, Send

from . import errors, feature_flags, guidance, ratelimit, usage
from .tools import TOOLS, ToolContext, ToolSpec, call_tool, home_prices_description

logger = logging.getLogger(__name__)

SERVER_NAME = "close-knit"
# serverInfo and the discovery manifests (discovery.py) read these; server.json at the repo root carries the
# same values for the MCP Registry (a test keeps them equal). Bump the version with every metadata change.
REGISTRY_NAME = "com.getcloseknit/close-knit"
SERVER_TITLE = "Close Knit"
SERVER_DESCRIPTION = "London neighbourhoods and homes: crime, schools, prices, rents, commute, green space, sourced."
SERVER_VERSION = "2.0.4"
WEBSITE_URL = "https://getcloseknit.com"
# The public install guide and Gemini CLI extension.
REPOSITORY = {"url": "https://github.com/bmsdave/close-knit-mcp", "source": "github"}
# Files outside the preview login, so directories can show them (web/public). The 512 px PNG comes
# first: directories that take one icon (Claude, ChatGPT, the server card) read the first entry.
ICONS = [
    {"src": "https://getcloseknit.com/icon.png", "mimeType": "image/png", "sizes": ["512x512"]},
    {"src": "https://getcloseknit.com/icon.svg", "mimeType": "image/svg+xml", "sizes": ["any"]},
]
MCP_PATH = "/mcp"
INSTRUCTIONS = guidance.INSTRUCTIONS
WIDGET_URI = "ui://close-knit/home-search.html"
WIDGET_HTML = Path(__file__).with_name("widgets") / "home-search.html"
# Tools whose results the home-search widget draws (MCP Apps); every other client gets the
# same structuredContent plus the JSON text block.
# The board's map: MapLibre from jsDelivr, the OpenFreeMap style, tiles, glyphs and sprites (as on the site).
WIDGET_CSP = ResourceCsp(resource_domains=["https://cdn.jsdelivr.net"],
                         connect_domains=["https://tiles.openfreemap.org"])
# ChatGPT needs a dedicated widget origin (`_meta.ui.domain`) to accept the app. Claude checks the field
# against its own `<sha256(connector url)[:32]>.claudemcpcontent.com` and refuses to draw any other value,
# so Claude clients get no domain (it is optional there).
WIDGET_DOMAIN = WEBSITE_URL
WIDGET_TOOLS = ("find_areas", "open_shared_search", "find_similar_areas", "get_area_overview", "assess_listing")
# Every other tool only reads Close Knit's own data; ChatGPT's and Claude's directories require the hints.
WRITE_TOOLS = frozenset({"send_feedback"})
# Tools whose results reach outside Close Knit: portal search links and feedback sent to the team.
OPEN_WORLD_TOOLS = frozenset({"get_listing_search_links", "send_feedback"})
# With CLOSE_KNIT_MCP_DATA off these still work; every other tool answers COMING_SOON (FLAGS.md).
OPEN_TOOLS = frozenset({"send_feedback"})
COMING_SOON_MESSAGE = ("Coming soon: Close Knit's data for assistants opens at launch. "
                       "Tell the user it is not available yet; don't retry or try other Close Knit tools.")
# Appended to a closed tool's description, so tools/list says so before anyone calls it.
COMING_SOON_NOTE = " Coming soon: until Close Knit opens to assistants this tool answers status coming-soon, no data."
# The keyword the SDK fills with the request's Context (found by its annotation, never shown to clients).
CONTEXT_ARG = "mcp_request_context"


def build_server(context_factory: Callable[[], ToolContext]) -> MCPServer:
    apps = Apps()
    apps.add_html_resource(WIDGET_URI, WIDGET_HTML.read_text(encoding="utf-8"), name="home-search",
                           title="Close Knit home search", prefers_border=True, csp=WIDGET_CSP,
                           description="Shortlist board, area card and listing check")
    for name in WIDGET_TOOLS:
        spec = TOOLS[name]
        apps.tool(resource_uri=WIDGET_URI, name=spec.name, title=_title(spec), description=_description(spec),
                  annotations=_annotations(spec), structured_output=True)(_tool_function(spec, context_factory))
    server = _Server(SERVER_NAME, title=SERVER_TITLE, description=SERVER_DESCRIPTION, version=SERVER_VERSION,
                     website_url=WEBSITE_URL, icons=[Icon.model_validate(icon) for icon in ICONS],
                     instructions=guidance.instructions(feature_flags.mcp_data()), extensions=[apps])
    for spec in TOOLS.values():
        if spec.name not in WIDGET_TOOLS:
            server.add_tool(_tool_function(spec, context_factory), name=spec.name, title=_title(spec),
                            description=_description(spec), annotations=_annotations(spec),
                            structured_output=True)
    server.add_prompt(Prompt.from_function(
        guidance.find_a_home, name="find-a-home", title=f"Find a home in {guidance.served_scope().covers}",
        description="Start a guided search: questions, area shortlist, feedback, listings, a watch."))
    return server


class _Server(MCPServer):
    async def read_resource(self, uri, context: Context | None = None):
        """The widget gets `ui.domain` for every client but Claude's (see WIDGET_DOMAIN)."""
        results = await super().read_resource(uri, context)
        if str(uri) != WIDGET_URI or not isinstance(results, list) or _is_claude(client_name(context)):
            return results
        return [replace(item, meta={**item.meta, "ui": {**item.meta["ui"], "domain": WIDGET_DOMAIN}})
                for item in results]


def _is_claude(client: str | None) -> bool:
    return (client or "").lower().startswith("claude")


def _description(spec: ToolSpec) -> str:
    """The tool's description as the public site would word it (get_home_prices' text depends on a flag),
    plus COMING_SOON_NOTE while the tool is closed (CLOSE_KNIT_MCP_DATA off)."""
    if spec.name == "get_home_prices":
        with feature_flags.public_call():
            description = home_prices_description()
    else:
        description = spec.description
    return description if _open(spec.name) else description + COMING_SOON_NOTE


def _title(spec: ToolSpec) -> str:
    return spec.name.replace("_", " ").capitalize()


def _annotations(spec: ToolSpec) -> ToolAnnotations:
    writes = spec.name in WRITE_TOOLS
    return ToolAnnotations(title=_title(spec), read_only_hint=not writes, destructive_hint=False,
                           idempotent_hint=not writes, open_world_hint=spec.name in OPEN_WORLD_TOOLS)


def transport_security() -> TransportSecuritySettings:
    """Host allow-list for the HTTP transport.

    CLOSE_KNIT_MCP_ALLOWED_HOSTS="api.example.com,localhost:8080" enables DNS-rebinding
    protection for those hosts; unset leaves it off (the server is public and unauthenticated,
    so rebinding gives an attacker nothing they cannot already fetch)."""
    hosts = [h.strip() for h in os.environ.get("CLOSE_KNIT_MCP_ALLOWED_HOSTS", "").split(",") if h.strip()]
    return TransportSecuritySettings(enable_dns_rebinding_protection=bool(hosts), allowed_hosts=hosts)


class McpMount:
    """ASGI shim so the MCP app can be (re)built inside the parent lifespan.

    `MCPServer.session_manager.run()` may only run once per instance, and Starlette does not run
    a mounted app's lifespan, so the parent creates a fresh server per lifespan and swaps it in.
    Registered as `Route(MCP_PATH)` rather than `Mount` so `/mcp` answers without a slash redirect."""

    def __init__(self) -> None:
        self.app: ASGIApp | None = None

    def start(self, context_factory: Callable[[], ToolContext]) -> MCPServer:
        server = build_server(context_factory)
        self.app = server.streamable_http_app(
            streamable_http_path=MCP_PATH, json_response=True, transport_security=transport_security())
        return server

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if self.app is None:
            raise RuntimeError("MCP server is not running: the application lifespan has not started")
        await self.app(scope, receive, send)


def _tool_function(spec: ToolSpec, context_factory: Callable[[], ToolContext]) -> Callable[..., Any]:
    async def invoke(**arguments: Any) -> dict[str, Any]:
        session, client = request_identity(arguments.pop(CONTEXT_ARG, None))
        context = replace(context_factory(), session=session)
        return await anyio.to_thread.run_sync(_call_with_codes, spec.name, context, arguments, client)

    invoke.__name__ = spec.name
    invoke.__doc__ = spec.description
    invoke.__signature__ = _flat_signature(spec.input_model)
    invoke.__annotations__ = _flat_annotations(spec.input_model)
    return invoke


def request_identity(ctx: Context | None) -> tuple[str | None, str | None]:
    """The MCP session as a non-reversible tag (it groups one conversation's calls) and the client's
    name from initialize, e.g. "claude-ai"; (None, None) outside an HTTP session."""
    try:
        request_context = ctx.request_context if ctx is not None else None
    except ValueError:
        return None, None
    if request_context is None:
        return None, None
    request = request_context.request
    headers = getattr(request, "headers", None)
    session = usage.session_tag(headers.get("mcp-session-id")) if headers is not None else None
    if session is None and headers is not None:
        # A client that never echoes Mcp-Session-Id gets a throwaway server session per call (mcp 2.x
        # opens one for each header-less request), so its calls are grouped by address + agent + day.
        client_address = ratelimit.client_key(getattr(request, "scope", {}),
                                              os.environ.get("CLOSE_KNIT_TRUST_PROXY") == "1")
        if client_address != "unknown":
            session = usage.derived_session_tag(client_address, headers.get("user-agent"))
    return session, client_name(ctx)


def client_name(ctx: Context | None) -> str | None:
    """The client's name from initialize, e.g. "claude-ai"; None outside a session."""
    try:
        request_context = ctx.request_context if ctx is not None else None
    except ValueError:
        return None
    params = getattr(getattr(request_context, "session", None), "client_params", None)
    return params.client_info.name if params is not None and params.client_info is not None else None


def _call_with_codes(name: str, context: ToolContext, arguments: dict, client: str | None = None) -> dict:
    started = time.monotonic()
    connect = getattr(context.reader, "_connect", None)
    try:
        # /mcp is open without the preview login, so it answers with public flag defaults (FLAGS.md).
        with feature_flags.public_call():
            result = call_tool(name, context, arguments) if _open(name) else coming_soon(name)
    except Exception as error:  # noqa: BLE001 - every failure must reach the agent as a code
        code, message = errors.classify(error)
        if code == "internal-error":
            logger.exception("mcp tool %s failed", name)
        usage.record(connect, "mcp", "tool_call", usage.tool_call_props(name, started, None, code, client),
                     context.session)
        raise ToolError(f"{code}: {message}") from error
    usage.record(connect, "mcp", "tool_call", usage.tool_call_props(name, started, result, None, client),
                 context.session)
    return result


def _open(name: str) -> bool:
    return name in OPEN_TOOLS or feature_flags.mcp_data()


def coming_soon(name: str) -> dict:
    """The answer every data tool gives while CLOSE_KNIT_MCP_DATA is off: an empty evidence envelope."""
    return {"schemaVersion": "tool-coming-soon.v1", "tool": name, "status": "coming-soon", "value": None,
            "confidence": "none", "evidence": [], "sources": [], "caveats": [COMING_SOON_MESSAGE]}


def _flat_signature(model: type[BaseModel]) -> inspect.Signature:
    parameters = []
    for field_name, field in model.model_fields.items():
        parameters.append(inspect.Parameter(
            field_name, inspect.Parameter.KEYWORD_ONLY, default=field, annotation=field.annotation))
    parameters.append(inspect.Parameter(CONTEXT_ARG, inspect.Parameter.KEYWORD_ONLY, default=None, annotation=Context))
    return inspect.Signature(parameters, return_annotation=dict[str, Any])


def _flat_annotations(model: type[BaseModel]) -> dict[str, Any]:
    annotations = {name: field.annotation for name, field in model.model_fields.items()}
    annotations[CONTEXT_ARG] = Context
    annotations["return"] = dict[str, Any]
    return annotations
