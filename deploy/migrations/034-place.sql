-- Unified places: OpenStreetMap (place_poi), the FSA hygiene register (food_business), Overture
-- (overture_place) and Foursquare (fsq_place) merged into one row per place, built by
-- pipelines/area-analytics-ingest/area_analytics/places_unified.py with the taxonomy in
-- area_analytics/places_taxonomy.json. tags uses OSM vocabulary (amenity, shop, leisure, tourism, sport,
-- cuisine, craft, office, healthcare, brand, name), so custom-criteria matchers read it as they read
-- place_poi. Places of worship and religion are never stored. Contains OpenStreetMap data: as a
-- database it is a derivative of OSM under ODbL 1.0 (share-alike).

CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- name similarity during conflation

CREATE TABLE IF NOT EXISTS place (
    id text PRIMARY KEY,                     -- stable: the anchor record, osm:n123 / ovt:<gers> / fsq:<id> / fhrs:<id>
    name text,
    category text NOT NULL,                  -- our key (places_taxonomy.json), e.g. kebab, coffee_shop, pub
    tags jsonb NOT NULL,                     -- OSM vocabulary, e.g. {"amenity": "fast_food", "cuisine": "kebab", "name": "..."}
    confidence real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),  -- source agreement, not a check on the ground
    sources text[] NOT NULL,                 -- which of osm, overture, fsq, fhrs hold the place
    osm_id text,                             -- place_poi.id
    fhrs_id bigint,                          -- food_business.fhrs_id
    overture_id text,                        -- overture_place.id
    fsq_id text,                             -- fsq_place.fsq_place_id
    hygiene_rating text,                     -- the register's published rating when matched
    location geometry(Point, 4326) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS place_tags_gin ON place USING gin (tags);
CREATE INDEX IF NOT EXISTS place_geog_gix ON place USING gist ((location::geography));
CREATE INDEX IF NOT EXISTS place_category ON place (category);
CREATE INDEX IF NOT EXISTS place_fhrs ON place (fhrs_id) WHERE fhrs_id IS NOT NULL;
