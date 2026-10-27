-- 043: Geograph Britain and Ireland photos in London, loaded by
-- pipelines/area-analytics-ingest/area_analytics/geograph.py from the gridimage_base dump (CC BY-SA 2.0).
--
-- Credit and location only: the dump carries no image file addresses, and Geograph asks that its
-- images are not hotlinked without permission, so postcode pages list the nearest photos as
-- credited links to their Geograph pages. Safe to run again.
CREATE TABLE IF NOT EXISTS geograph_photo (
    id integer PRIMARY KEY,                     -- gridimage_id: https://www.geograph.org.uk/photo/{id}
    title text NOT NULL,
    photographer text NOT NULL,                 -- realname, the credit Geograph asks for
    user_id integer NOT NULL,                   -- https://www.geograph.org.uk/profile/{user_id}
    taken date,                                 -- NULL when the photographer gave no date
    location geometry(Point, 4326) NOT NULL,
    geography_id text NOT NULL REFERENCES area_geography(id),  -- LSOA containing the point
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE INDEX IF NOT EXISTS geograph_photo_location_idx ON geograph_photo USING gist (location);
