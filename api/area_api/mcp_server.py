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
from pydantic import BaseModel, Field
from starlette.types import ASGIApp, Receive, Scope, Send

from . import call_notes, errors, feature_flags, guidance, ratelimit, usage
from .tools import TOOLS, ToolContext, ToolSpec, call_tool, home_prices_description

logger = logging.getLogger(__name__)

SERVER_NAME = "close-knit"
# serverInfo and the discovery manifests (discovery.py) read these; server.json at the repo root carries the
# same values for the MCP Registry (a test keeps them equal). Bump the version with every metadata change.
REGISTRY_NAME = "com.getcloseknit/close-knit"
SERVER_TITLE = "Close Knit"
SERVER_DESCRIPTION = "Neighbourhoods and homes in England, London in depth: crime, schools, prices, rents, sourced."
SERVER_VERSION = "2.0.6"
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
# With CLOSE_KNIT_MCP_REQUEST_NOTES on, every other tool takes intent and rate_previous and answers with a
# callId (call_notes.py); rate_answer is added for the last answer of a conversation.
NOTELESS_TOOLS = frozenset({"send_feedback"})
RATE_ANSWER = "rate_answer"
COMING_SOON_MESSAGE = ("Coming soon: Close Knit's data for assistants opens at launch. "
                       "Tell the user it is not available yet; don't retry or try other Close Knit tools.")
# Appended to a closed tool's description, so tools/list says so before anyone calls it.
COMING_SOON_NOTE = " Coming soon: until Close Knit opens to assistants this tool answers status coming-soon, no data."
# The keyword the SDK fills with the request's Context (found by its annotation, never shown to clients).
CONTEXT_ARG = "mcp_request_context"


def build_server(context_factory: Callable[[], ToolContext]) -> MCPServer:
    notes = feature_flags.mcp_request_notes()
    apps = Apps()
    apps.add_html_resource(WIDGET_URI, WIDGET_HTML.read_text(encoding="utf-8"), name="home-search",
                           title="Close Knit home search", prefers_border=True, csp=WIDGET_CSP,
                           description="Shortlist board, area card and listing check")
    for name in WIDGET_TOOLS:
        spec = TOOLS[name]
        apps.tool(resource_uri=WIDGET_URI, name=spec.name, title=_title(spec), description=_description(spec),
                  annotations=_annotations(spec), structured_output=True)(_tool_function(spec, context_factory, notes))
    server = _Server(SERVER_NAME, title=SERVER_TITLE, description=SERVER_DESCRIPTION, version=SERVER_VERSION,
                     website_url=WEBSITE_URL, icons=[Icon.model_validate(icon) for icon in ICONS],
                     instructions=guidance.instructions(feature_flags.mcp_data(), notes=notes), extensions=[apps])
    for spec in TOOLS.values():
        if spec.name not in WIDGET_TOOLS:
            server.add_tool(_tool_function(spec, context_factory, notes), name=spec.name, title=_title(spec),
                            description=_description(spec), annotations=_annotations(spec),
                            structured_output=True)
    if notes:
        server.add_tool(_rate_answer_function(context_factory), name=RATE_ANSWER, title="Rate answer",
                        description=call_notes.RATE_ANSWER_DESCRIPTION,
                        annotations=ToolAnnotations(title="Rate answer", read_only_hint=False, destructive_hint=False,
                                                    idempotent_hint=True, open_world_hint=False),
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
        if _browser_visit(scope):
            # Someone opened the address from /agents in a browser: the set-up page, not a JSON-RPC 400.
            await send({"type": "http.response.start", "status": 302,
                        "headers": [(b"location", AGENTS_PAGE.encode()), (b"content-length", b"0")]})
            await send({"type": "http.response.body", "body": b""})
            return
        await self.app(scope, receive, send)


AGENTS_PAGE = "/agents"


def _browser_visit(scope: Scope) -> bool:
    """A plain GET that asks for a page: no MCP session, HTML accepted and no event stream asked for."""
    if scope.get("type") != "http" or scope.get("method") != "GET":
        return False
    headers = dict(scope.get("headers") or [])
    accept = headers.get(b"accept", b"").decode("latin-1").lower()
    return SESSION_HEADER not in headers and "text/html" in accept and "text/event-stream" not in accept


SESSION_HEADER = b"mcp-session-id"


def _tool_function(spec: ToolSpec, context_factory: Callable[[], ToolContext],
                   notes: bool = False) -> Callable[..., Any]:
    notes = notes and spec.name not in NOTELESS_TOOLS

    async def invoke(**arguments: Any) -> dict[str, Any]:
        request_context = arguments.pop(CONTEXT_ARG, None)
        session, client = request_identity(request_context)
        kind = request_traffic(request_context, client)
        context = replace(context_factory(), session=session, traffic=kind)
        note = (arguments.pop(INTENT_ARG, None), arguments.pop(RATE_ARG, None)) if notes else None
        return await anyio.to_thread.run_sync(_call_with_codes, spec.name, context, arguments, client, note, kind)

    invoke.__name__ = spec.name
    invoke.__doc__ = spec.description
    invoke.__signature__ = _flat_signature(spec.input_model, notes)
    invoke.__annotations__ = _flat_annotations(spec.input_model, notes)
    return invoke


def _rate_answer_function(context_factory: Callable[[], ToolContext]) -> Callable[..., Any]:
    async def rate_answer(call_id: str = Field(description=call_notes.RatePrevious.model_fields["call_id"].description),
                          rating: int = Field(ge=1, le=5, description=call_notes.RatePrevious.model_fields["rating"].description),
                          good: str | None = Field(default=None, max_length=call_notes.MAX_TEXT, description="What was useful."),
                          bad: str | None = Field(default=None, max_length=call_notes.MAX_TEXT,
                                                  description="What was wrong, missing or confusing."),
                          fix: str | None = Field(default=None, max_length=call_notes.MAX_TEXT,
                                                  description="The change you would want."),
                          mcp_request_context: Context = None) -> dict[str, Any]:
        connect = getattr(context_factory().reader, "_connect", None)
        value = {"call_id": call_id, "rating": rating, "good": good, "bad": bad, "fix": fix}
        stored = await anyio.to_thread.run_sync(call_notes.rate, connect, value)
        return call_notes.rate_answer_result(stored)

    return rate_answer


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


def request_traffic(ctx: Context | None, client: str | None) -> str:
    """live, team or tech for this call (usage.traffic): the team header, the client's name, or a script's agent."""
    try:
        request = ctx.request_context.request if ctx is not None else None
    except ValueError:
        request = None
    headers = getattr(request, "headers", None) or {}
    return usage.traffic(client, headers.get(usage.TEAM_HEADER), headers.get("user-agent"))


def _call_with_codes(name: str, context: ToolContext, arguments: dict, client: str | None = None,
                     note: tuple[Any, Any] | None = None, kind: str = "live") -> dict:
    """The tool's answer, or a ToolError with its code. `note` is (intent, rate_previous) when
    CLOSE_KNIT_MCP_REQUEST_NOTES is on: the call is stored for a later rating and its answer carries a callId."""
    started = time.monotonic()
    connect = getattr(context.reader, "_connect", None)
    call_id = None
    if note is not None:
        intent, rate_previous = note
        if rate_previous is not None:
            call_notes.rate(connect, rate_previous)
        call_id = call_notes.new_call_id()
    try:
        # /mcp is open without the preview login, so it answers with public flag defaults (FLAGS.md).
        with feature_flags.public_call():
            result = call_tool(name, context, arguments) if _open(name) else coming_soon(name)
    except Exception as error:  # noqa: BLE001 - every failure must reach the agent as a code
        code, message = errors.classify(error)
        if code == "internal-error":
            logger.exception("mcp tool %s failed", name)
        usage.record(connect, "mcp", "tool_call", usage.tool_call_props(name, started, None, code, client, kind),
                     context.session)
        if call_id is not None:
            call_notes.record_call(connect, call_id, tool=name, ok=False, code=code, session=context.session,
                                   client=client, intent=intent, traffic=kind)
        raise ToolError(f"{code}: {message}") from error
    usage.record(connect, "mcp", "tool_call", usage.tool_call_props(name, started, result, None, client, kind),
                 context.session)
    if call_id is None:
        return result
    call_notes.record_call(connect, call_id, tool=name, ok=True, session=context.session, client=client,
                           intent=intent, traffic=kind)
    return {**result, "callId": call_id}


def _open(name: str) -> bool:
    return name in OPEN_TOOLS or feature_flags.mcp_data()


def coming_soon(name: str) -> dict:
    """The answer every data tool gives while CLOSE_KNIT_MCP_DATA is off: an empty evidence envelope."""
    return {"schemaVersion": "tool-coming-soon.v1", "tool": name, "status": "coming-soon", "value": None,
            "confidence": "none", "evidence": [], "sources": [], "caveats": [COMING_SOON_MESSAGE]}


# The two parameters CLOSE_KNIT_MCP_REQUEST_NOTES adds to every noted tool (call_notes.py).
INTENT_ARG = "intent"
RATE_ARG = "rate_previous"
NOTE_FIELDS = {
    INTENT_ARG: (str | None, Field(default=None, description=call_notes.INTENT_DESCRIPTION)),
    RATE_ARG: (call_notes.RatePrevious | None, Field(default=None, description=call_notes.RATE_DESCRIPTION)),
}


def _flat_signature(model: type[BaseModel], notes: bool = False) -> inspect.Signature:
    parameters = []
    for field_name, field in model.model_fields.items():
        parameters.append(inspect.Parameter(
            field_name, inspect.Parameter.KEYWORD_ONLY, default=field, annotation=field.annotation))
    for field_name, (annotation, field) in (NOTE_FIELDS.items() if notes else ()):
        parameters.append(inspect.Parameter(field_name, inspect.Parameter.KEYWORD_ONLY, default=field,
                                            annotation=annotation))
    parameters.append(inspect.Parameter(CONTEXT_ARG, inspect.Parameter.KEYWORD_ONLY, default=None, annotation=Context))
    return inspect.Signature(parameters, return_annotation=dict[str, Any])


def _flat_annotations(model: type[BaseModel], notes: bool = False) -> dict[str, Any]:
    annotations = {name: field.annotation for name, field in model.model_fields.items()}
    if notes:
        annotations.update({name: annotation for name, (annotation, _) in NOTE_FIELDS.items()})
    annotations[CONTEXT_ARG] = Context
    annotations["return"] = dict[str, Any]
    return annotations
