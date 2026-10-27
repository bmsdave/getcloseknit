-- 072: The weekly check of the portals' unofficial search formats (v4 Task 9; api/area_api/portal_link_check.py).
--
--   portal_link_check  one row per check: the portal, the kind of link (draw = a drawn area, borough = a
--                      borough search), whether its page held, and a short note (the page title, a count,
--                      or why it failed). The API reads the latest row per portal and kind
--                      (portal_zones.format_on): a failed or blocked check sends that pair to the
--                      postcode-district fallback until a later check passes. Nothing about people.
--
-- Safe to run again.

CREATE TABLE IF NOT EXISTS portal_link_check (
    id bigserial PRIMARY KEY,
    portal text NOT NULL CHECK (portal IN ('rightmove', 'zoopla', 'onthemarket')),
    kind text NOT NULL CHECK (kind IN ('draw', 'borough')),
    ok boolean NOT NULL,
    detail text NOT NULL DEFAULT '' CHECK (length(detail) <= 200),
    checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_link_check_latest ON portal_link_check (portal, kind, checked_at DESC);

-- Old checks are history only: keep a year.
DELETE FROM portal_link_check WHERE checked_at < now() - interval '1 year';
