-- Local market by property type (HM Land Registry Price Paid, category A).
--
-- `area_market` holds, for every LSOA, MSOA and borough, one row per property
-- type (D/S/T/F/O and 'all') and 12-month window: the latest window ends at
-- the newest sale month (`window_end`, first day of that month) and ten
-- earlier windows step back a year each. Sale-price percentiles and the
-- median £/m² (sales with a plausible EPC floor area only) are computed by
-- pipelines/area-analytics-ingest/area_analytics/market.py, which also
-- applies the minimum-sales rules: NULL means too few sales ("unknown"), and
-- a type with no sales in a window has no row. Release data: rebuilt by
-- `python -m area_analytics.market_load <db-url>` after `etl_sales.py load`,
-- which also calls rebuild_area_recent_sales() (below).

CREATE TABLE IF NOT EXISTS area_market (
    geography_id text NOT NULL,
    property_type text NOT NULL CHECK (property_type IN ('all', 'D', 'S', 'T', 'F', 'O')),
    window_end date NOT NULL,
    sales integer NOT NULL CHECK (sales > 0),
    median_price integer,
    p5 integer,
    p25 integer,
    p75 integer,
    p95 integer,
    min_price integer,
    max_price integer,
    ppm_sales integer NOT NULL CHECK (ppm_sales >= 0),
    median_ppm double precision,
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (geography_id, property_type, window_end)
);

CREATE INDEX IF NOT EXISTS sale_completion_idx ON sale (completion_date);

-- Recent sales list: category-A sales of £10,000+ in the 18 months to the
-- newest sale, with the LSOA, MSOA and borough they fall in and a point
-- (the UPRN when known, else the postcode centre), so the list for any area
-- reads one small indexed table. Privacy objections are applied when the
-- list is read (suppressed_dwelling), never baked in.
CREATE TABLE IF NOT EXISTS area_recent_sale (
    transaction_id text PRIMARY KEY,
    address_id text NOT NULL,
    uprn text,
    lsoa_id text NOT NULL,
    msoa_id text NOT NULL,
    borough_id text NOT NULL,
    completion_date date NOT NULL,
    display_address text NOT NULL,
    postcode text NOT NULL,
    property_type char(1) NOT NULL,
    tenure char(1) NOT NULL,
    new_build boolean NOT NULL,
    price integer NOT NULL,
    location geography(Point, 4326),
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS area_recent_sale_lsoa_idx ON area_recent_sale (lsoa_id);
CREATE INDEX IF NOT EXISTS area_recent_sale_msoa_idx ON area_recent_sale (msoa_id);
CREATE INDEX IF NOT EXISTS area_recent_sale_borough_idx ON area_recent_sale (borough_id);

CREATE OR REPLACE FUNCTION public.rebuild_area_recent_sales()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM area_recent_sale;
    INSERT INTO area_recent_sale (transaction_id, address_id, uprn, lsoa_id, msoa_id, borough_id,
        completion_date, display_address, postcode, property_type, tenure, new_build, price, location,
        source_release_id)
    SELECT s.transaction_id, a.id, p.uprn, l.id, m.id, m.parent_id, s.completion_date, a.display_address,
           s.postcode, s.property_type, s.tenure, s.new_build, s.price,
           COALESCE(p.location, CASE WHEN a.longitude IS NOT NULL AND a.latitude IS NOT NULL
                                     THEN ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326) END)::geography,
           s.source_release_id
    FROM sale s
    JOIN address a ON a.id = s.address_id
    JOIN area_geography l ON l.id = a.geography_id AND l.kind = 'lsoa'
    JOIN area_geography m ON m.id = l.parent_id AND m.kind = 'msoa'
    LEFT JOIN LATERAL (SELECT uprn, location FROM property WHERE property.address_id = a.id
                       ORDER BY uprn LIMIT 1) p ON true
    WHERE s.ppd_category = 'A' AND s.price >= 10000
      AND s.completion_date > (SELECT max(completion_date) - interval '18 months' FROM sale);
    GET DIAGNOSTICS affected = ROW_COUNT;
    ANALYZE area_recent_sale;
    RETURN affected;
END;
$$;
