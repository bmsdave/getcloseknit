-- 109: England prices and housing (branch england/d3-prices, after 103).
--
-- The borough-level price tables took London codes only (E09 boroughs, E12000007). The national loads
-- (etl_uk_hpi.py, etl_rent_trend.py with CLOSE_KNIT_ETL_COVERAGE unset = England) write every English
-- local authority district (E06/E07/E08/E09, the 'borough' carrier since 103) and the nine regions, which
-- are the comparison rows ("London" for London, the region elsewhere).
--
-- Safe to run again: each check is dropped and added back.

ALTER TABLE borough_hpi DROP CONSTRAINT IF EXISTS borough_hpi_borough_check;
ALTER TABLE borough_hpi ADD CONSTRAINT borough_hpi_borough_check
    CHECK (borough ~ '^E(0[6-9]|12)[0-9]{6}$');

ALTER TABLE borough_rent_series DROP CONSTRAINT IF EXISTS borough_rent_series_borough_check;
ALTER TABLE borough_rent_series ADD CONSTRAINT borough_rent_series_borough_check
    CHECK (borough ~ '^E(0[6-9]|12)[0-9]{6}$');
