-- Search uses ILIKE '%term%' on addresses (2M rows) and area names; without
-- trigram indexes each keystroke was a sequential scan (4-5 s on the VPS).
-- Safe to run again on an existing database.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS address_display_trgm_idx
    ON address USING gin (display_address gin_trgm_ops);
CREATE INDEX IF NOT EXISTS address_postcode_nospace_trgm_idx
    ON address USING gin ((replace(postcode, ' ', '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS area_geography_name_trgm_idx
    ON area_geography USING gin (name gin_trgm_ops);
