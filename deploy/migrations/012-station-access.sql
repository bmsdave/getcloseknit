-- Walking access to rail, Underground, Overground, DLR and tram stations,
-- built from OpenStreetMap (ODbL) by deploy/tools/etl_station_access.py.
-- Only the station list and area aggregates are stored, never OSM geometry.
-- The headline (median minutes per area, share within 10 minutes) lives in
-- metric_value / metric_value_breakdown / factor_utility as `station-access`.

CREATE TABLE IF NOT EXISTS station (
    id text PRIMARY KEY,                -- osm:n<id> or osm:w<id> of the first merged feature
    name text NOT NULL,
    modes text[] NOT NULL CHECK (modes <@ ARRAY['rail', 'underground', 'light_rail', 'tram']::text[]),
    geom geometry(Point, 4326) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE INDEX IF NOT EXISTS station_geom_gix ON station USING gist (geom);

-- Stations whose median walk from the LSOA's homes is 20 minutes or less.
CREATE TABLE IF NOT EXISTS lsoa_station_walk (
    geography_id text NOT NULL REFERENCES area_geography(id),
    station_id text NOT NULL REFERENCES station(id) ON DELETE CASCADE,
    median_minutes real NOT NULL CHECK (median_minutes >= 0 AND median_minutes <= 20),
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (geography_id, station_id)
);

CREATE INDEX IF NOT EXISTS lsoa_station_walk_station_idx ON lsoa_station_walk (station_id);
