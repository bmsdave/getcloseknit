-- Each place's LSOA, so custom criteria ("cafés vs kebab shops") count the places inside each
-- neighbourhood's boundary (the shapes painted on the map) with a plain GROUP BY lsoa_id instead of a
-- point-in-polygon join per request. Filled here once for the places already loaded; the loaders
-- (area_analytics.places_unified for place, area_analytics.places_load for place_poi) fill it on
-- every rebuild. A place on a shared boundary goes to one of the two areas; a place outside London's
-- LSOAs keeps NULL (it still counts for "nearest", which is a distance).
--
-- Safe to run again: the columns and indexes are IF NOT EXISTS and the fill only touches rows
-- without an LSOA.

ALTER TABLE place ADD COLUMN IF NOT EXISTS lsoa_id text;
ALTER TABLE place_poi ADD COLUMN IF NOT EXISTS lsoa_id text;

-- schema.sql has it; re-asserted for databases restored without it (the fill below needs it).
CREATE INDEX IF NOT EXISTS area_geography_geometry_gix ON area_geography USING gist (geometry);

UPDATE place p SET lsoa_id = g.id
FROM area_geography g
WHERE p.lsoa_id IS NULL AND g.kind = 'lsoa' AND ST_Intersects(g.geometry, p.location);

UPDATE place_poi p SET lsoa_id = g.id
FROM area_geography g
WHERE p.lsoa_id IS NULL AND g.kind = 'lsoa' AND ST_Intersects(g.geometry, p.location);

CREATE INDEX IF NOT EXISTS place_lsoa_id ON place (lsoa_id);
CREATE INDEX IF NOT EXISTS place_poi_lsoa_id ON place_poi (lsoa_id);

ANALYZE place;
ANALYZE place_poi;
