-- 020: property profile (track K).
--
-- `property_epc` keeps the facts of each dwelling's latest Energy Performance
-- Certificate (matched by the certificate's UPRN): rating, type, built form,
-- age band, floor area, habitable rooms and floor level. Nothing about the
-- occupant (EPC tenure, names) and no running costs are stored. Loaded by
-- deploy/tools/etl_epc.py from the MHCLG bulk download (OGL v3.0).
--
-- `area_type_price` holds sale-price medians by property type per area so a
-- property page can compare itself with its borough (12-month windows going
-- back up to 30 years, for the same-type annual change) and with its MSOA
-- (one 36-month window of £/m² quartiles). Standard market sales only
-- (Price Paid category A). Rebuilt by rebuild_area_type_prices() after a
-- sales load. Neither table changes any existing table.

CREATE TABLE IF NOT EXISTS property_epc (
    uprn text PRIMARY KEY CHECK (uprn ~ '^[0-9]+$'),
    lodgement_date date NOT NULL,
    current_rating char(1) CHECK (current_rating ~ '^[A-G]$'),
    potential_rating char(1) CHECK (potential_rating ~ '^[A-G]$'),
    property_type text,
    built_form text,
    construction_age_band text,
    total_floor_area double precision CHECK (total_floor_area IS NULL OR total_floor_area > 0),
    habitable_rooms smallint CHECK (habitable_rooms IS NULL OR habitable_rooms BETWEEN 0 AND 100),
    floor_level text,
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE INDEX IF NOT EXISTS property_epc_release_idx ON property_epc (source_release_id);

-- Stage -> property_epc. `staging_epc` is the temp table etl_epc.py fills.
-- Only UPRNs the property spine knows are kept.
CREATE OR REPLACE FUNCTION public.load_property_epc(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM property_epc WHERE source_release_id = p_source_release_id;
    INSERT INTO property_epc (uprn, lodgement_date, current_rating, potential_rating, property_type,
        built_form, construction_age_band, total_floor_area, habitable_rooms, floor_level, source_release_id)
    SELECT s.uprn, s.lodgement_date, s.current_rating, s.potential_rating, s.property_type, s.built_form,
           s.construction_age_band, s.total_floor_area, s.habitable_rooms, s.floor_level, p_source_release_id
    FROM staging_epc s
    WHERE EXISTS (SELECT 1 FROM property p WHERE p.uprn = s.uprn)
    ON CONFLICT (uprn) DO UPDATE SET
        lodgement_date = excluded.lodgement_date, current_rating = excluded.current_rating,
        potential_rating = excluded.potential_rating, property_type = excluded.property_type,
        built_form = excluded.built_form, construction_age_band = excluded.construction_age_band,
        total_floor_area = excluded.total_floor_area, habitable_rooms = excluded.habitable_rooms,
        floor_level = excluded.floor_level, source_release_id = excluded.source_release_id
    WHERE excluded.lodgement_date >= property_epc.lodgement_date;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;

CREATE TABLE IF NOT EXISTS area_type_price (
    geography_id text NOT NULL REFERENCES area_geography(id),
    -- Price Paid type (D/S/T/F/O), or '*' for every type together.
    property_type char(1) NOT NULL CHECK (property_type IN ('D', 'S', 'T', 'F', 'O', '*')),
    -- Window k covers the window_months months ending 12*k months before window_end.
    years_back smallint NOT NULL CHECK (years_back >= 0),
    window_months smallint NOT NULL CHECK (window_months IN (12, 36)),
    window_end date NOT NULL,
    sales integer NOT NULL CHECK (sales > 0),
    median_price integer,
    ppm_sales integer NOT NULL,
    p25_ppm real,
    median_ppm real,
    p75_ppm real,
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (geography_id, property_type, window_months, years_back)
);

CREATE OR REPLACE FUNCTION public.rebuild_area_type_prices(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    latest date;
    affected integer;
BEGIN
    SELECT max(sale_month) INTO latest FROM sale WHERE source_release_id = p_source_release_id;
    IF latest IS NULL THEN
        RETURN 0;
    END IF;
    DELETE FROM area_type_price;
    WITH located AS (
        SELECT s.price, s.price_per_square_metre AS ppm, s.property_type,
               m.id AS msoa_id, m.parent_id AS borough_id,
               ((EXTRACT(YEAR FROM latest) - EXTRACT(YEAR FROM s.sale_month)) * 12
                + EXTRACT(MONTH FROM latest) - EXTRACT(MONTH FROM s.sale_month))::integer AS months_back
        FROM sale s
        JOIN address a ON a.id = s.address_id
        JOIN area_geography l ON l.id = a.geography_id
        JOIN area_geography m ON m.id = l.parent_id
        WHERE s.source_release_id = p_source_release_id
          AND s.ppd_category = 'A'
          AND s.sale_month <= latest
    ), borough AS (
        SELECT borough_id AS geography_id, coalesce(property_type, '*') AS property_type,
               (months_back / 12)::smallint AS years_back, 12::smallint AS window_months,
               count(*) AS sales,
               round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price))::integer AS median_price,
               count(ppm) AS ppm_sales,
               percentile_cont(0.25) WITHIN GROUP (ORDER BY ppm) AS p25_ppm,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY ppm) AS median_ppm,
               percentile_cont(0.75) WITHIN GROUP (ORDER BY ppm) AS p75_ppm
        FROM located
        WHERE borough_id IS NOT NULL AND months_back < 360
        GROUP BY GROUPING SETS ((borough_id, months_back / 12, property_type), (borough_id, months_back / 12))
    ), msoa AS (
        SELECT msoa_id AS geography_id, coalesce(property_type, '*') AS property_type,
               0::smallint AS years_back, 36::smallint AS window_months,
               count(*) AS sales,
               round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price))::integer AS median_price,
               count(ppm) AS ppm_sales,
               percentile_cont(0.25) WITHIN GROUP (ORDER BY ppm) AS p25_ppm,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY ppm) AS median_ppm,
               percentile_cont(0.75) WITHIN GROUP (ORDER BY ppm) AS p75_ppm
        FROM located
        WHERE months_back < 36
        GROUP BY GROUPING SETS ((msoa_id, property_type), (msoa_id))
    )
    INSERT INTO area_type_price (geography_id, property_type, years_back, window_months, window_end, sales,
        median_price, ppm_sales, p25_ppm, median_ppm, p75_ppm, source_release_id)
    SELECT geography_id, property_type, years_back, window_months,
           (latest - make_interval(years => years_back))::date, sales, median_price, ppm_sales,
           p25_ppm, median_ppm, p75_ppm, p_source_release_id
    FROM (SELECT * FROM borough UNION ALL SELECT * FROM msoa) rows;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;
