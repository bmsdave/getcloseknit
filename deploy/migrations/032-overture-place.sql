-- Places in London from Overture Maps (places theme, release 2026-09-23.1, CDLA-Permissive-2.0),
-- loaded by pipelines/area-analytics-ingest/area_analytics/overture_places.py. The Greater
-- London bbox is read from Overture's public S3 bucket and clipped to the 33 boroughs.
-- Places, never people: addresses, phones, emails and socials are not stored. Websites are kept for
-- estate agents only, since migration 051.
-- category is Overture's taxonomy primary, alternate_categories its alternates and
-- basic_category the coarse level. confidence is Overture's match score (0..1), not a check
-- on the ground; operating_status is unset for most places.

CREATE TABLE overture_place (
    id text PRIMARY KEY,                     -- Overture GERS id
    name text,
    category text,
    alternate_categories text[],
    basic_category text,
    brand text,
    brand_wikidata text,
    confidence real,
    operating_status text,                   -- 'open', 'permanently_closed', ... or NULL
    datasets text[],                         -- upstream datasets merged into the place (meta, Foursquare, ...)
    location geometry(Point, 4326) NOT NULL,
    source_release_id text REFERENCES source_release(id)
);
CREATE INDEX overture_place_location_gix ON overture_place USING gist ((location::geography));
CREATE INDEX overture_place_category ON overture_place (category);
