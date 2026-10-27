-- Building and street keys on `sale` (sales in the same building and on the
-- same street, GET /api/v1/addresses/{id}/nearby-sales).
--
--   building_key = md5(postcode | PAON | street)  -- same postcode, house number/name, street
--   street_key   = md5(street | borough id)       -- same street within one borough
--
-- PAON and street come from Price Paid (ppd-london.sqlite); etl_sales.py emits
-- them upper-cased with whitespace collapsed, and load_sales() turns them into
-- keys. Only the keys are stored. The borough is the address's LSOA -> MSOA ->
-- borough parent chain; an address outside the loaded geography gets no
-- street key rather than a London-wide "HIGH STREET". A missing PAON or
-- street leaves the matching key NULL.
ALTER TABLE sale ADD COLUMN IF NOT EXISTS building_key text;
ALTER TABLE sale ADD COLUMN IF NOT EXISTS street_key text;
CREATE INDEX IF NOT EXISTS sale_building_key_idx ON sale (building_key, completion_date)
    WHERE building_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS sale_street_key_idx ON sale (street_key, completion_date)
    WHERE street_key IS NOT NULL;

-- Stage -> sale, as migration 008 plus the two keys. `staging_sale` is the
-- temp table etl_sales.py fills (it now carries `paon` and `street`).
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
                THEN md5(s.postcode || '|' || s.paon || '|' || coalesce(s.street, '')) END,
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
