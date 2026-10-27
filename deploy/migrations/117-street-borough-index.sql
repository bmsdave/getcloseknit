-- 117: streets by borough (2026-10-25). Safe to run again; apply with psql --single-transaction -v ON_ERROR_STOP=1.
--
-- A street-level home (/property/at/{postcode}/{house}, api/area_api/street_home.py STREET_AT_POSTCODE_SQL) looks up
-- its street by name inside the postcode's borough. With no index on street.borough_id that read scanned all of
-- England's ~760k streets and ran the name normalisation on each: ~630 ms of a ~650 ms answer, and past the web's
-- 2.5 s wait under load the page was a 500. With the index it reads the borough's few thousand streets.
CREATE INDEX IF NOT EXISTS street_borough_id_idx ON street (borough_id);
ANALYZE street;
