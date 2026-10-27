-- Friendly area names and map label points, loaded by
-- pipelines/area-analytics-ingest/area_analytics/area_labels.py:
--   area_label  every LSOA and MSOA with the House of Commons Library name of
--               its MSOA ("Alperton East") and the postcode district holding
--               most of its live postcodes ("NW10"); boroughs with their name.
--               The panel shows "Alperton East · NW10" above the official code.
--   map_label   one point per borough and per postcode district for the map's
--               zoomed-out labels ("Bromley", "BR6 · Orpington").
-- Both are reference data outside the product release: a new load replaces
-- every row, and readers treat a missing row as "no friendly name".

CREATE TABLE area_label (
    geography_id text PRIMARY KEY,           -- uk:lsoa:E01..., uk:msoa:E02..., uk:borough:E09...
    friendly_name text,                      -- HoC Library MSOA name, or the borough name
    postcode_district text,                  -- outward code, e.g. "NW10"; NULL for boroughs
    name_source_release_id text NOT NULL REFERENCES source_release(id),
    district_source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX area_label_friendly_name ON area_label (lower(friendly_name));

CREATE TABLE map_label (
    kind text NOT NULL CHECK (kind IN ('borough', 'district')),
    code text NOT NULL,                      -- borough GSS code or postcode district
    label text NOT NULL,                     -- the text drawn on the map
    name text,                               -- borough name, or the district's short neighbourhood name
    postcodes integer,                       -- live postcodes in the district (NULL for boroughs)
    lon double precision NOT NULL,
    lat double precision NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (kind, code)
);
