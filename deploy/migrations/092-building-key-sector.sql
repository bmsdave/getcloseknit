-- The building key is the postcode *sector*, not the full unit postcode (B5, #154):
-- a tower whose flats are spread over several unit postcodes (Landmark Pinnacle
-- E14: 9PG, 9GU, 9XZ, 9PR, 9JQ, one LSOA, one point) is one building, not five.
--
--   building_key = md5(postcode sector | PAON | street)  -- e.g. "E14 9|10|MARSH WALL"
--   street_key   = md5(street | borough id)              -- unchanged
--
-- Redefines public.load_sales from migration 013, keeping its shape. PAON is not
-- stored, so existing keys cannot be recomputed in SQL: re-run `etl_sales.py
-- load` and `release` (RELEASE-CHECKLIST "Rebuilding a data release", the
-- building/street keys step) after applying.
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
           CASE WHEN nullif(s.paon, '') IS NOT NULL AND nullif(s.postcode, '') IS NOT NULL
                THEN md5(left(s.postcode, length(s.postcode) - 2) || '|' || s.paon
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
