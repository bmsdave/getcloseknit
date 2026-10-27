-- 097: building_key tells a building's flats from a house's separate dwellings (issue #163).
--
-- Migrations 013 and 092 keyed a building as md5(postcode sector | PAON | street), so "1A"
-- and "1" on the same street (two houses) shared a key, while a flat's SAON was ignored
-- (correct: the block's flats belong under one key). load_sales() now reads the staged
-- SAON too:
--
--   building_key = md5(postcode sector | PAON | SAON | street), except a flat's SAON
--                  ("FLAT 1", "APARTMENT 2") names its unit, not its building, so it is
--                  dropped and the building's flats share one key; a house's SAON ("1A")
--                  names a separate dwelling and is kept, so houses split.
--   street_key   = md5(street | borough id), unchanged.
--
-- etl_sales.py emits `saon` (upper-cased, whitespace collapsed) next to `paon` and `street`
-- and creates `staging_sale` with the column; only the keys are stored. 013 and 092 are
-- left as applied; this file redefines the function in full (apply after 092). Safe to run
-- again. On an existing database apply it, then re-run `etl_sales.py emit` and
-- `etl_sales.py load` so every sale gets the new key.
CREATE OR REPLACE FUNCTION public.load_sales(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM sale;
    INSERT INTO sale (transaction_id, address_id, completion_date, sale_month, price, property_type,
        new_build, tenure, ppd_category, postcode, floor_area_square_metres, price_per_square_metre,
        building_key, street_key, source_release_id)
    SELECT s.transaction_id, s.address_id, s.completion_date, date_trunc('month', s.completion_date)::date,
           s.price, s.property_type, s.new_build, s.tenure, s.ppd_category, s.postcode,
           s.floor_area_square_metres,
           CASE WHEN s.floor_area_square_metres BETWEEN 15 AND 1000
                 AND s.price / s.floor_area_square_metres BETWEEN 500 AND 40000
                THEN round((s.price / s.floor_area_square_metres)::numeric, 2) END,
           -- A flat's SAON ("FLAT 1", "APARTMENT 2") names its unit: drop it so the
           -- building's flats stay under one key. A house's SAON ("1A") names a separate
           -- dwelling: keep it, so houses split (#163).
           CASE WHEN nullif(s.paon, '') IS NOT NULL AND nullif(s.postcode, '') IS NOT NULL
                THEN md5(left(s.postcode, length(s.postcode) - 2) || '|' || s.paon || '|'
                         || CASE WHEN s.saon ~* 'flat|apartment|maisonette|studio|penthouse|duplex|annexe?'
                                 THEN '' ELSE coalesce(s.saon, '') END
                         || '|' || coalesce(s.street, '')) END,
           CASE WHEN nullif(s.street, '') IS NOT NULL AND msoa.parent_id IS NOT NULL
                THEN md5(s.street || '|' || msoa.parent_id) END,
           p_source_release_id
    FROM staging_sale s
    LEFT JOIN address a ON a.id = s.address_id
    LEFT JOIN area_geography lsoa ON lsoa.id = a.geography_id
    LEFT JOIN area_geography msoa ON msoa.id = lsoa.parent_id
    ON CONFLICT (transaction_id) DO NOTHING;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;
