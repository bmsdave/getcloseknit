-- Getting around and nearby (track H): rail, tube, Overground, DLR, Elizabeth
-- line and tram stations with TfL fare zones and lines, public parks and
-- green spaces, and everyday amenities. Locations are OpenStreetMap (ODbL);
-- zones and lines are TfL open data. Loaded by
-- pipelines/area-analytics-ingest/area_analytics/places_load.py, which
-- replaces every row in one transaction.

CREATE TABLE IF NOT EXISTS place_station (
    id text PRIMARY KEY,                 -- first OSM object, e.g. n780856
    osm_ids text[] NOT NULL,
    name text NOT NULL,
    modes text[] NOT NULL CHECK (modes <@ ARRAY['tube', 'elizabeth-line', 'dlr', 'overground', 'tram', 'national-rail']),
    zone text CHECK (zone ~ '^[0-9](/[0-9])?$'),   -- NULL when TfL lists none
    lines jsonb NOT NULL DEFAULT '[]',   -- [{id, name, mode}], empty when TfL has no match
    tfl_ids text[] NOT NULL DEFAULT '{}',
    location geometry(Point, 4326) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id),
    tfl_source_release_id text REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS place_station_geog_gix ON place_station USING gist ((location::geography));

CREATE TABLE IF NOT EXISTS place_park (
    id text PRIMARY KEY,
    name text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('park', 'garden', 'nature-reserve', 'common', 'recreation-ground', 'village-green')),
    area_hectares real NOT NULL CHECK (area_hectares >= 0),
    geometry geometry(MultiPolygon, 4326) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS place_park_geog_gix ON place_park USING gist ((geometry::geography));

CREATE TABLE IF NOT EXISTS place_amenity (
    id text PRIMARY KEY,
    name text,                           -- NULL when OSM has no name
    amenity_group text NOT NULL CHECK (amenity_group IN ('groceries', 'pubs', 'food', 'pharmacies', 'gps')),
    kind text NOT NULL,
    location geometry(Point, 4326) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS place_amenity_geog_gix ON place_amenity USING gist ((location::geography));
