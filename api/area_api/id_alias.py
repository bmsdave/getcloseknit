"""Old area ids keep working on every HTTP route (step R2, docs/architecture/global-geography.md).

uk:borough:<code> became uk:lad:<code> (migration 129, which keeps the old id as a row of area_alias). Before routing,
AreaAliasMiddleware reads every old id in the path, the query string and a JSON body as the current one
(`kinds.canonical_text`), so links, saved searches, the extension and API clients holding old ids get the same answer,
which names the new id. MCP and /tools arguments go through `kinds.canonical_value` in tools.call_tool.
"""
from __future__ import annotations

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import kinds

_OLD = kinds.OLD_LAD.encode()
_BODY_METHODS = {"POST", "PUT", "PATCH"}


class AreaAliasMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path, query = scope.get("path", ""), scope.get("query_string", b"")
        if kinds.OLD_LAD in path or _OLD in query:
            scope = dict(scope)
            scope["path"] = kinds.canonical_text(path)
            scope["raw_path"] = kinds.canonical_text(scope.get("raw_path", path.encode()).decode("latin-1")).encode("latin-1")
            scope["query_string"] = kinds.canonical_text(query.decode("latin-1")).encode("latin-1")
        if scope.get("method") in _BODY_METHODS and _is_json(scope):
            receive = _canonical_body(receive)
        await self.app(scope, receive, send)


def _is_json(scope: Scope) -> bool:
    for name, value in scope.get("headers", ()):
        if name == b"content-type":
            return b"json" in value.lower()
    return False


def _canonical_body(receive: Receive) -> Receive:
    """The request body read whole, old ids rewritten, handed on as one message (JSON bodies here are small)."""
    done = False

    async def wrapped() -> Message:
        nonlocal done
        if done:
            return await receive()
        chunks: list[bytes] = []
        while True:
            message = await receive()
            if message["type"] != "http.request":
                return message
            chunks.append(message.get("body", b""))
            if not message.get("more_body", False):
                break
        done = True
        body = b"".join(chunks)
        if _OLD in body:
            body = kinds.canonical_text(body.decode("utf-8", "surrogateescape")).encode("utf-8", "surrogateescape")
        return {"type": "http.request", "body": body, "more_body": False}

    return wrapped
