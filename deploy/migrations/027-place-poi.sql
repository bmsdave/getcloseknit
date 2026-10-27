-- Custom criteria ("kebabs vs cafés"): every OpenStreetMap place with an amenity, shop, leisure,
-- tourism, craft, healthcare, office or club tag, keeping its raw tags so a criterion can match any
-- whitelisted key (api/area_api/custom_criteria.py). Polygons are stored as a representative point.
-- Loaded by pipelines/area-analytics-ingest/area_analytics/places_load.py with the places release.

CREATE TABLE IF NOT EXISTS place_poi (
    id text PRIMARY KEY,                 -- OSM object, e.g. n780856 or w4242
    tags jsonb NOT NULL,                 -- every OSM tag of the object, e.g. {"amenity": "cafe", "name": "..."}
    location geometry(Point, 4326) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS place_poi_tags_gin ON place_poi USING gin (tags);
CREATE INDEX IF NOT EXISTS place_poi_geog_gix ON place_poi USING gist ((location::geography));
