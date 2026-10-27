-- Feedback about Close Knit from an AI client's send_feedback tool, sent only after the
-- user agreed and describing the product, never the person (area_api/feedback.py).
-- Kept 12 months: purged on each new item and by `python -m area_api.feedback purge`.
-- Production-only like access_invite: db-restore keeps it, backups dump it, snapshots
-- leave its rows out. Read it with deploy/tools/feedback.sh.
CREATE TABLE IF NOT EXISTS mcp_feedback (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('bug', 'missing-data', 'wrong-data', 'idea', 'praise', 'other')),
    message text NOT NULL CHECK (char_length(message) BETWEEN 10 AND 2000),
    rating smallint CHECK (rating BETWEEN 1 AND 5),
    tools text[] NOT NULL DEFAULT '{}',
    client text CHECK (client IS NULL OR char_length(client) <= 60),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_feedback_created_at_idx ON mcp_feedback (created_at);
