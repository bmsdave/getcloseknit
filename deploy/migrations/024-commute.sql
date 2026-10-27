-- Commute hubs and typical itineraries for the routing release (deploy/routing/README.md).
-- travel_time_matrix (schema.sql) holds R5 minutes from every LSOA to each hub, with the hub id
-- as destination_cell; these tables name the hubs and, per MSOA, the typical transit legs.

CREATE TABLE IF NOT EXISTS commute_hub (
    network_release_id text NOT NULL REFERENCES route_network_release(id),
    id text NOT NULL,                    -- e.g. kings-cross; stable across releases
    name text NOT NULL,
    station_id text,                     -- station.id it stands for
    location geometry(Point, 4326) NOT NULL,
    PRIMARY KEY (network_release_id, id)
);

CREATE INDEX IF NOT EXISTS commute_hub_location_gix ON commute_hub USING gist ((location::geography));

CREATE TABLE IF NOT EXISTS commute_itinerary (
    network_release_id text NOT NULL REFERENCES route_network_release(id),
    origin_geography_id text NOT NULL REFERENCES area_geography(id),
    hub_id text NOT NULL,
    option smallint NOT NULL,
    total_minutes smallint NOT NULL,
    transfers smallint NOT NULL,
    walking_minutes smallint NOT NULL,
    legs jsonb NOT NULL,                 -- [{mode, line, from, to, minutes, waitMinutes}]
    PRIMARY KEY (network_release_id, origin_geography_id, hub_id, option),
    FOREIGN KEY (network_release_id, hub_id) REFERENCES commute_hub(network_release_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS travel_time_matrix_destination_idx ON travel_time_matrix (destination_cell, mode);

-- Driving times (OSRM free-flow slowed to DfT morning speeds): shown beside the other modes, never scored.
ALTER TABLE travel_time_matrix DROP CONSTRAINT IF EXISTS travel_time_matrix_mode_check;
ALTER TABLE travel_time_matrix ADD CONSTRAINT travel_time_matrix_mode_check
    CHECK (mode IN ('transit', 'walk', 'cycle', 'car'));
