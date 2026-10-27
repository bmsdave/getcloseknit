-- Street routes for the map (deploy/routing/osrm_routes.py): the bicycle and car path from each MSOA
-- centre to each commute hub, as drawn for the selected area's neighbourhood. Minutes stay in
-- travel_time_matrix; this table only holds the line and its length.

CREATE TABLE IF NOT EXISTS commute_route (
    network_release_id text NOT NULL REFERENCES route_network_release(id) ON DELETE CASCADE,
    origin_geography_id text NOT NULL REFERENCES area_geography(id),
    hub_id text NOT NULL,
    mode text NOT NULL CHECK (mode IN ('cycle', 'car')),
    km real NOT NULL,
    coordinates jsonb NOT NULL,          -- [[lon, lat], ...], simplified, 5 decimals
    PRIMARY KEY (network_release_id, origin_geography_id, hub_id, mode),
    FOREIGN KEY (network_release_id, hub_id) REFERENCES commute_hub(network_release_id, id) ON DELETE CASCADE
);
