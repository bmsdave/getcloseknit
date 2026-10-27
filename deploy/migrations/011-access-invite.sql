-- Counted invite links for the private preview (CLOSE_KNIT_ACCESS=private):
-- each redemption spends one use and gives that browser the access cookie.
-- Production-only like property_objection: db-restore keeps it, backups dump it.
CREATE TABLE IF NOT EXISTS access_invite (
    code text PRIMARY KEY,
    max_uses integer NOT NULL CHECK (max_uses > 0),
    used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
    note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz
);
