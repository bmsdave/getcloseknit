-- 122: the geography kinds above the LAD, step 1 of docs/architecture/global-geography.md (§3.1, §11): region,
-- nation and country. A file of its own: a value added to an enum cannot be used in the transaction that adds it,
-- and migration 123 inserts rows of these kinds. Safe to run again.

ALTER TYPE geography_kind ADD VALUE IF NOT EXISTS 'region';
ALTER TYPE geography_kind ADD VALUE IF NOT EXISTS 'nation';
ALTER TYPE geography_kind ADD VALUE IF NOT EXISTS 'country';
