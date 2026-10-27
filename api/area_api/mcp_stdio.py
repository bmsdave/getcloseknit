"""Run the MCP server over stdio for local agents (Claude Code, Codex CLI).

    CLOSE_KNIT_DATABASE_URL=postgres://... python -m area_api.mcp_stdio
"""
from .app import get_reader
from .mcp_server import build_server
from .tools import ToolContext


def main() -> None:
    build_server(lambda: ToolContext(reader=get_reader())).run(transport="stdio")


if __name__ == "__main__":
    main()
