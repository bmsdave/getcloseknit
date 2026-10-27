-- 118: schools by distance (2026-10-25). Safe to run again; apply with psql --single-transaction -v ON_ERROR_STOP=1.
--
-- Every "schools within N metres" read (api/area_api/schools.py AREA_SCHOOLS_SQL, AREA_SCHOOL_COUNTS_SQL, the
-- standouts and places reads) filters on ST_DWithin(s.location::geography, point, metres). school_location_gix
-- indexes the geometry, not that cast, so each read scanned all ~20k schools, and with the area's point inlined
-- from its CTE it recomputed ST_PointOnSurface of the area per school: Northumberland's profile took 1.8 s of its
-- 2.1 s there. Indexed on the same expression, the read is under a millisecond.
CREATE INDEX IF NOT EXISTS school_location_geog_gix ON school USING gist ((location::geography));
ANALYZE school;
