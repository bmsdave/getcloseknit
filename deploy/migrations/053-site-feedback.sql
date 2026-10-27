-- Feedback people chose to send from the website (area_api/site_feedback.py): a 👍/👎 on an area
-- card or a Find my area shortlist, or a 1-5 star review with reasons and text. Anonymous: no
-- analytics id, session, IP or user agent; contact details in text are removed before storing.
-- The browser makes client_id, so a changed vote or added reasons update the same row.
-- Kept 12 months: purged on each new item and by `python -m area_api.site_feedback purge`.
-- Production-only like mcp_feedback: db-restore keeps it, backups dump it, snapshots leave its
-- rows out. Read it with deploy/tools/feedback.sh web list, or on the Feedback dashboard.
CREATE TABLE IF NOT EXISTS site_feedback (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_id uuid NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    kind text NOT NULL CHECK (kind IN ('vote', 'review')),
    surface text NOT NULL CHECK (surface ~ '^[a-z_]{2,30}$'),
    target text CHECK (target IS NULL OR target ~ '^[a-z_]{2,30}$'),
    area text CHECK (area IS NULL OR char_length(area) <= 40),
    vote smallint CHECK (vote IN (-1, 1)),
    rating smallint CHECK (rating BETWEEN 1 AND 5),
    tags text[] NOT NULL DEFAULT '{}',
    message text CHECK (message IS NULL OR char_length(message) <= 2000),
    path text CHECK (path IS NULL OR char_length(path) <= 120),
    device text CHECK (device IS NULL OR device IN ('mobile', 'tablet', 'desktop')),
    CHECK ((kind = 'vote' AND vote IS NOT NULL AND rating IS NULL)
        OR (kind = 'review' AND rating IS NOT NULL AND vote IS NULL))
);

CREATE INDEX IF NOT EXISTS site_feedback_created_at_idx ON site_feedback (created_at);

GRANT SELECT ON site_feedback TO close_knit_analytics;
