-- Postcode page and address search: trigram indexes for the ILIKE '%term%' address search.
--
-- EXPLAIN on a release database restored from a snapshot taken before migration 010 showed
-- evidence:address-search as a sequential scan of the 2.08M-row address table (1.74 s for
-- "N1 0AA", 1.8 s per /api/v1/search call), so the postcode page's address lookup outran the
-- web's 2.5 s fetch timeout together with the rest of the page and rendered empty. With these
-- indexes the same query is a bitmap index scan (milliseconds). The postcode page now lists its
-- homes by exact postcode (/api/v1/postcodes/{postcode}/homes, address_postcode_idx) and only
-- falls back to this search for postcodes with no recorded homes.
--
-- Same definitions as 010, re-asserted so any database missing them gets them; a no-op where
-- 010 already ran. Safe to run again.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS address_display_trgm_idx
    ON address USING gin (display_address gin_trgm_ops);
CREATE INDEX IF NOT EXISTS address_postcode_nospace_trgm_idx
    ON address USING gin ((replace(postcode, ' ', '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS area_geography_name_trgm_idx
    ON area_geography USING gin (name gin_trgm_ops);
