-- Brands and leisure places for "an M&S nearby", "a gym", "a public pool", "a tennis club"
-- (pipelines/area-analytics-ingest/area_analytics/places.py). Reloaded with the places release.

ALTER TABLE place_amenity ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE place_amenity ADD COLUMN IF NOT EXISTS sport text;
ALTER TABLE place_amenity DROP CONSTRAINT IF EXISTS place_amenity_amenity_group_check;
ALTER TABLE place_amenity ADD CONSTRAINT place_amenity_amenity_group_check
    CHECK (amenity_group IN ('groceries', 'pubs', 'food', 'pharmacies', 'gps', 'leisure'));
CREATE INDEX IF NOT EXISTS place_amenity_kind_brand_idx ON place_amenity (kind, lower(brand));
