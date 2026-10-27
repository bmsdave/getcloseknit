-- Notes on open /mcp tool calls behind CLOSE_KNIT_MCP_REQUEST_NOTES (area_api/call_notes.py): the
-- summary an agent writes of what the user is looking for with the call (intent), and the agent's
-- rating of the answer, sent with a later call (rate_previous) or with rate_answer. call_id is the
-- callId the answer carried. No IP or user agent; session_id is usage.session_tag's one-way tag.
-- Contact details and full postcodes are removed before storing.
-- Kept 90 days: purged at most hourly on new rows and by `python -m area_api.call_notes purge`.
-- Production-only like mcp_feedback: db-restore keeps it, backups dump it, snapshots leave its
-- rows out. Read it on the Grafana "Close Knit · Agents" dashboard.
CREATE TABLE IF NOT EXISTS mcp_call_note (
    call_id text PRIMARY KEY CHECK (call_id ~ '^[0-9a-f]{16}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    session_id text CHECK (session_id IS NULL OR char_length(session_id) <= 40),
    client text CHECK (client IS NULL OR char_length(client) <= 60),
    tool text NOT NULL CHECK (tool ~ '^[a-z_]{2,40}$'),
    ok boolean NOT NULL,
    code text CHECK (code IS NULL OR char_length(code) <= 60),
    intent text CHECK (intent IS NULL OR char_length(intent) <= 500),
    rating smallint CHECK (rating BETWEEN 1 AND 5),
    good text CHECK (good IS NULL OR char_length(good) <= 500),
    bad text CHECK (bad IS NULL OR char_length(bad) <= 500),
    fix text CHECK (fix IS NULL OR char_length(fix) <= 500),
    rated_at timestamptz
);

CREATE INDEX IF NOT EXISTS mcp_call_note_created_at_idx ON mcp_call_note (created_at);

GRANT SELECT ON mcp_call_note TO close_knit_analytics;
