-- Foursquare Open Source Places inside the London boroughs (Apache 2.0), loaded by
-- pipelines/area-analytics-ingest/area_analytics/fsq_places.py from the Fused GeoParquet copy
-- on Source Cooperative. The loaded release is a dated snapshot (2025-02-06 at first): places
-- opened since are missing and many have closed; date_closed marks the closures Foursquare
-- knows of and an old date_refreshed one it has not confirmed lately. Places, never people:
-- addresses, phone numbers, websites and social handles are left out. The snapshot has no
-- chain field. A fresher copy is loaded as its own source_release and replaces only its rows.

CREATE TABLE IF NOT EXISTS fsq_place (
    fsq_place_id text PRIMARY KEY,
    name text,
    category_ids text[],                     -- Foursquare category ids, e.g. {4bf58dd8d48988d16e941735}
    category_labels text[],                  -- full paths, e.g. {"Dining and Drinking > Restaurant > Kebab Restaurant"}
    date_created date,
    date_refreshed date,                     -- last time Foursquare confirmed the place
    date_closed date,                        -- set when Foursquare has marked it closed
    location geometry(Point, 4326) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS fsq_place_geog_gix ON fsq_place USING gist ((location::geography));
CREATE INDEX IF NOT EXISTS fsq_place_category_ids_gin ON fsq_place USING gin (category_ids);
CREATE INDEX IF NOT EXISTS fsq_place_release ON fsq_place (source_release_id);
