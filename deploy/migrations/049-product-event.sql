-- How Close Knit is used, never who uses it (area_api/usage.py, docs/product-analytics.md):
-- page events with an anonymous random browser id (none for EU time zones or after "Analytics
-- off"), MCP and agent-API tool calls, and click-outs to the portals through /go. No IP address,
-- user agent, address, budget or search profile. Kept 180 days: purged hourly by the API and by
-- `python -m area_api.usage purge`. Production-only like mcp_feedback: db-restore keeps it,
-- backups dump it, snapshots leave its rows out. Read it with deploy/tools/usage.sh report.
CREATE TABLE IF NOT EXISTS product_event (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    channel text NOT NULL CHECK (channel IN ('web', 'mcp', 'api')),
    name text NOT NULL CHECK (name ~ '^[a-z_]{2,40}$'),
    visitor_id uuid,
    session_id text CHECK (session_id IS NULL OR char_length(session_id) <= 40),
    device text CHECK (device IS NULL OR device IN ('mobile', 'tablet', 'desktop')),
    props jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS product_event_occurred_at_idx ON product_event (occurred_at);
CREATE INDEX IF NOT EXISTS product_event_name_idx ON product_event (name, occurred_at);
CREATE INDEX IF NOT EXISTS product_event_visitor_idx ON product_event (visitor_id, occurred_at) WHERE visitor_id IS NOT NULL;
