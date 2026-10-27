-- 057: postcode sectors and districts as zones, with £/m² analytics
-- (GET /api/v1/sectors/{slug}, api/area_api/zones_sector.py).
--
-- No new boundary source: a sector ("W5 1") is the union of the Voronoi cells
-- of its `address` postcode points, clipped to London's boroughs; a district
-- ("W5") is the union of its sectors. `name` is the House of Commons Library
-- name of the MSOA holding most of the zone's postcodes (informal), and
-- `borough_id` the borough holding most of them.
--
-- Aggregates only (owner decisions 040/044): no per-home value or £/m², no
-- addresses. Category A sales of the four Price Paid types with an EPC floor
-- area (`sale.price_per_square_metre`):
--   zone_ppm_distribution  per sector and district, the 24 months to the latest
--                          sale month: percentiles and 20 equal buckets between
--                          p01 and p99 (sales outside fall in the end buckets);
--                          no row under 20 sales
--   zone_price_index       per sector, district and borough, and all / house
--                          (D, S, T) / flat (F): annual median £/m², 2004 = 100,
--                          real = deflated by the annual mean CPIH; NULL index
--                          for a year (or a base) under 10 sales
--   zone_street            per sector, streets with at least 5 sales in 60
--                          months: the longest OS Open Names street of the
--                          sale's district found in its address
-- cpih_month holds ONS CPIH (series L522), loaded by deploy/tools/etl_cpih.py.
--
-- rebuild_zone_analytics(sales release) rebuilds every zone table;
-- `etl_sales.py load` calls it after rebuild_area_price_bands. Safe to re-run.

CREATE TABLE IF NOT EXISTS postcode_sector (
    code text PRIMARY KEY CHECK (code ~ '^[A-Z]{1,2}[0-9][0-9A-Z]? [0-9]$'),
    slug text NOT NULL UNIQUE,
    district text NOT NULL,
    name text,
    borough_id text REFERENCES area_geography(id),
    postcode_count integer NOT NULL CHECK (postcode_count > 0),
    geometry geometry(MultiPolygon, 4326) NOT NULL,
    label_point geometry(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS postcode_sector_district ON postcode_sector (district);
CREATE INDEX IF NOT EXISTS postcode_sector_geometry ON postcode_sector USING gist (geometry);

CREATE TABLE IF NOT EXISTS postcode_district (
    code text PRIMARY KEY CHECK (code ~ '^[A-Z]{1,2}[0-9][0-9A-Z]?$'),
    slug text NOT NULL UNIQUE,
    name text,
    borough_id text REFERENCES area_geography(id),
    postcode_count integer NOT NULL CHECK (postcode_count > 0),
    geometry geometry(MultiPolygon, 4326) NOT NULL,
    label_point geometry(Point, 4326) NOT NULL
);

CREATE TABLE IF NOT EXISTS cpih_month (
    month date PRIMARY KEY CHECK (EXTRACT(DAY FROM month) = 1),
    cpih_index numeric NOT NULL CHECK (cpih_index > 0),
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE TABLE IF NOT EXISTS zone_ppm_distribution (
    zone_kind text NOT NULL CHECK (zone_kind IN ('sector', 'district')),
    zone_code text NOT NULL,
    period_end date NOT NULL,
    sales integer NOT NULL CHECK (sales >= 20),
    p09 integer, p25 integer, p50 integer, p75 integer, p91 integer,
    bucket_edges integer[] NOT NULL,         -- 21 edges, p01 .. p99
    bucket_counts integer[] NOT NULL,        -- 20 counts
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (zone_kind, zone_code)
);

CREATE TABLE IF NOT EXISTS zone_price_index (
    zone_kind text NOT NULL CHECK (zone_kind IN ('sector', 'district', 'borough')),
    zone_code text NOT NULL,
    "group" text NOT NULL CHECK ("group" IN ('all', 'house', 'flat')),
    year smallint NOT NULL,
    sales integer NOT NULL CHECK (sales > 0),
    median_ppm integer NOT NULL,
    index_nominal numeric(8, 1),
    index_real numeric(8, 1),
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (zone_kind, zone_code, "group", year)
);

CREATE TABLE IF NOT EXISTS zone_street (
    sector text NOT NULL,
    street_name text NOT NULL,
    sales_60m integer NOT NULL CHECK (sales_60m >= 5),
    median_floor_area integer,
    median_ppm integer,
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (sector, street_name)
);

CREATE OR REPLACE FUNCTION public.rebuild_zone_analytics(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    latest date;
    affected integer;
BEGIN
    -- Postcode points (one per postcode, in British National Grid) with their modal LSOA.
    DROP TABLE IF EXISTS zone_postcode;
    CREATE TEMP TABLE zone_postcode ON COMMIT DROP AS
    SELECT a.postcode, left(a.postcode, length(a.postcode) - 2) AS sector,
           split_part(a.postcode, ' ', 1) AS district,
           ST_Transform(ST_SetSRID(ST_MakePoint(avg(a.longitude), avg(a.latitude)), 4326), 27700) AS point,
           mode() WITHIN GROUP (ORDER BY a.geography_id) AS lsoa_id
    FROM address a
    WHERE a.postcode ~ '^[A-Z]{1,2}[0-9][0-9A-Z]? [0-9][A-Z]{2}$'
      AND a.longitude IS NOT NULL AND a.latitude IS NOT NULL
    GROUP BY a.postcode;
    CREATE INDEX ON zone_postcode USING gist (point);

    DROP TABLE IF EXISTS zone_london;
    CREATE TEMP TABLE zone_london ON COMMIT DROP AS
    SELECT ST_Transform(ST_Union(geometry), 27700) AS geometry FROM area_geography WHERE kind = 'borough';

    -- Voronoi cells, each given to the postcode point it holds (one postcode per cell).
    DROP TABLE IF EXISTS zone_voronoi;
    CREATE TEMP TABLE zone_voronoi ON COMMIT DROP AS
    SELECT row_number() OVER () AS id, ST_CollectionExtract(ST_MakeValid(d.geom), 3) AS cell
    FROM (SELECT ST_VoronoiPolygons(ST_Collect(point), 0,
                     (SELECT ST_Expand(ST_Envelope(geometry), 2000) FROM zone_london)) AS cells
          FROM zone_postcode) v,
         LATERAL ST_Dump(v.cells) d;
    CREATE INDEX ON zone_voronoi USING gist (cell);
    DROP TABLE IF EXISTS zone_cell;
    CREATE TEMP TABLE zone_cell ON COMMIT DROP AS
    -- Postcodes sharing a point share a cell: it goes to the sector with most of them,
    -- unless that leaves a sector with no cell at all (then both keep it).
    WITH held AS (
        SELECT c.id, c.cell, p.sector, p.district, count(*) AS postcodes
        FROM zone_voronoi c
        JOIN zone_postcode p ON ST_Intersects(p.point, c.cell)
        GROUP BY c.id, c.cell, p.sector, p.district
    ), owner AS (
        SELECT DISTINCT ON (id) id, sector FROM held ORDER BY id, postcodes DESC, sector
    )
    SELECT h.cell, h.sector, h.district
    FROM held h
    WHERE EXISTS (SELECT 1 FROM owner o WHERE o.id = h.id AND o.sector = h.sector)
       OR NOT EXISTS (SELECT 1 FROM owner o WHERE o.sector = h.sector);

    DELETE FROM postcode_sector;
    INSERT INTO postcode_sector (code, slug, district, name, borough_id, postcode_count, geometry, label_point)
    WITH shapes AS (
        SELECT c.sector, ST_Union(c.cell, 0.01) AS geometry FROM zone_cell c GROUP BY c.sector
    ), clipped AS (
        SELECT s.sector,
               ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Intersection(s.geometry, l.geometry, 0.01)), 3)) AS clip,
               ST_Multi(s.geometry) AS whole
        FROM shapes s, zone_london l
    ), facts AS (
        SELECT p.sector, min(p.district) AS district, count(*) AS postcodes,
               mode() WITHIN GROUP (ORDER BY lsoa.parent_id) AS msoa_id,
               mode() WITHIN GROUP (ORDER BY msoa.parent_id) AS borough_id
        FROM zone_postcode p
        JOIN area_geography lsoa ON lsoa.id = p.lsoa_id
        JOIN area_geography msoa ON msoa.id = lsoa.parent_id
        GROUP BY p.sector
    )
    SELECT f.sector, replace(f.sector, ' ', '-'), f.district,
           coalesce(lab.friendly_name, m.name), f.borough_id, f.postcodes,
           ST_Transform(CASE WHEN ST_IsEmpty(c.clip) THEN c.whole ELSE c.clip END, 4326),
           ST_Transform(ST_PointOnSurface(CASE WHEN ST_IsEmpty(c.clip) THEN c.whole ELSE c.clip END), 4326)
    FROM facts f
    JOIN clipped c ON c.sector = f.sector
    LEFT JOIN area_geography m ON m.id = f.msoa_id
    LEFT JOIN area_label lab ON lab.geography_id = f.msoa_id;

    DELETE FROM postcode_district;
    INSERT INTO postcode_district (code, slug, name, borough_id, postcode_count, geometry, label_point)
    WITH facts AS (
        SELECT p.district, count(*) AS postcodes,
               mode() WITHIN GROUP (ORDER BY lsoa.parent_id) AS msoa_id,
               mode() WITHIN GROUP (ORDER BY msoa.parent_id) AS borough_id
        FROM zone_postcode p
        JOIN area_geography lsoa ON lsoa.id = p.lsoa_id
        JOIN area_geography msoa ON msoa.id = lsoa.parent_id
        GROUP BY p.district
    ), shapes AS (
        SELECT district, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Union(geometry)), 3)) AS geometry
        FROM postcode_sector GROUP BY district
    )
    SELECT f.district, f.district, coalesce(lab.friendly_name, m.name), f.borough_id, f.postcodes,
           s.geometry, ST_PointOnSurface(s.geometry)
    FROM facts f
    JOIN shapes s ON s.district = f.district
    LEFT JOIN area_geography m ON m.id = f.msoa_id
    LEFT JOIN area_label lab ON lab.geography_id = f.msoa_id;

    -- Sales with a £/m², placed in their sector, district and borough.
    DROP TABLE IF EXISTS zone_sale;
    -- "year" is a 12-month period ending at the latest sale month (2026 = Aug 2025 to
    -- Jul 2026 when the latest is July), so the newest year is never a part year.
    SELECT max(sale_month) INTO latest FROM sale WHERE source_release_id = p_source_release_id;
    CREATE TEMP TABLE zone_sale ON COMMIT DROP AS
    SELECT s.address_id, s.sale_month,
           (EXTRACT(YEAR FROM latest) - ((EXTRACT(YEAR FROM latest) * 12 + EXTRACT(MONTH FROM latest))
               - (EXTRACT(YEAR FROM s.sale_month) * 12 + EXTRACT(MONTH FROM s.sale_month)))::int / 12)::smallint AS year,
           s.price_per_square_metre AS ppm, s.floor_area_square_metres AS floor_area,
           CASE WHEN s.property_type = 'F' THEN 'flat' ELSE 'house' END AS kind,
           left(s.postcode, length(s.postcode) - 2) AS sector, split_part(s.postcode, ' ', 1) AS district,
           msoa.parent_id AS borough_id
    FROM sale s
    JOIN address a ON a.id = s.address_id
    JOIN area_geography lsoa ON lsoa.id = a.geography_id
    JOIN area_geography msoa ON msoa.id = lsoa.parent_id
    WHERE s.source_release_id = p_source_release_id
      AND s.ppd_category = 'A' AND s.property_type IN ('D', 'S', 'T', 'F')
      AND s.price_per_square_metre IS NOT NULL
      AND s.postcode ~ '^[A-Z]{1,2}[0-9][0-9A-Z]? [0-9][A-Z]{2}$';

    DELETE FROM zone_ppm_distribution;
    INSERT INTO zone_ppm_distribution (zone_kind, zone_code, period_end, sales, p09, p25, p50, p75, p91,
        bucket_edges, bucket_counts, source_release_id)
    WITH recent AS (
        SELECT z.kind AS zone_kind, z.code AS zone_code, s.ppm
        FROM zone_sale s
        CROSS JOIN LATERAL (VALUES ('sector', s.sector), ('district', s.district)) z(kind, code)
        WHERE s.sale_month > (latest - interval '24 months') AND s.sale_month <= latest
    ), q AS (
        SELECT zone_kind, zone_code, count(*) AS sales,
               percentile_cont(ARRAY[0.01, 0.09, 0.25, 0.5, 0.75, 0.91, 0.99])
                   WITHIN GROUP (ORDER BY ppm) AS p
        FROM recent GROUP BY zone_kind, zone_code HAVING count(*) >= 20
    ), counted AS (
        SELECT r.zone_kind, r.zone_code,
               CASE WHEN q.p[7] > q.p[1]
                    THEN least(greatest(width_bucket(r.ppm, q.p[1], q.p[7], 20), 1), 20) ELSE 1 END AS bucket,
               count(*) AS n
        FROM recent r JOIN q USING (zone_kind, zone_code)
        GROUP BY 1, 2, 3
    )
    SELECT q.zone_kind, q.zone_code, latest, q.sales,
           round(q.p[2]), round(q.p[3]), round(q.p[4]), round(q.p[5]), round(q.p[6]),
           ARRAY(SELECT round(q.p[1] + i * (q.p[7] - q.p[1]) / 20)::integer FROM generate_series(0, 20) i),
           ARRAY(SELECT coalesce(c.n, 0)::integer FROM generate_series(1, 20) b
                 LEFT JOIN counted c ON c.zone_kind = q.zone_kind AND c.zone_code = q.zone_code AND c.bucket = b
                 ORDER BY b),
           p_source_release_id
    FROM q;
    GET DIAGNOSTICS affected = ROW_COUNT;

    DELETE FROM zone_price_index;
    INSERT INTO zone_price_index (zone_kind, zone_code, "group", year, sales, median_ppm,
        index_nominal, index_real, source_release_id)
    WITH yearly AS (
        SELECT z.kind AS zone_kind, z.code AS zone_code, g.grp, s.year, count(*) AS sales,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY s.ppm) AS median
        FROM zone_sale s
        CROSS JOIN LATERAL (VALUES ('sector', s.sector), ('district', s.district), ('borough', s.borough_id)) z(kind, code)
        CROSS JOIN LATERAL (VALUES ('all'), (s.kind)) g(grp)
        WHERE s.year >= 2004 AND z.code IS NOT NULL
        GROUP BY 1, 2, 3, 4
    ), cpi AS (
        SELECT (EXTRACT(YEAR FROM latest) - ((EXTRACT(YEAR FROM latest) * 12 + EXTRACT(MONTH FROM latest))
                   - (EXTRACT(YEAR FROM month) * 12 + EXTRACT(MONTH FROM month)))::int / 12)::smallint AS year,
               avg(cpih_index) AS cpih
        FROM cpih_month WHERE month <= latest GROUP BY 1
    ), indexed AS (
        SELECT y.*, CASE WHEN y.sales >= 10 AND b.sales >= 10 THEN 100 * y.median / b.median END AS nominal,
               c.cpih / c0.cpih AS deflator
        FROM yearly y
        LEFT JOIN yearly b ON b.zone_kind = y.zone_kind AND b.zone_code = y.zone_code
             AND b.grp = y.grp AND b.year = 2004
        LEFT JOIN cpi c ON c.year = y.year
        LEFT JOIN cpi c0 ON c0.year = 2004
    )
    SELECT zone_kind, zone_code, grp, year, sales, round(median), round(nominal::numeric, 1),
           round((nominal / deflator)::numeric, 1), p_source_release_id
    FROM indexed;

    DELETE FROM zone_street;
    INSERT INTO zone_street (sector, street_name, sales_60m, median_floor_area, median_ppm, source_release_id)
    WITH recent AS (
        SELECT * FROM zone_sale WHERE sale_month > (latest - interval '60 months') AND sale_month <= latest
    ), names AS (
        SELECT DISTINCT postcode_district AS district, name FROM street WHERE postcode_district IS NOT NULL
    ), matched AS (
        -- Word-bounded, case-insensitive: the longest street name of the district in the address.
        SELECT DISTINCT ON (a.id) a.id AS address_id, n.name
        FROM (SELECT DISTINCT address_id, district FROM recent) r
        JOIN address a ON a.id = r.address_id
        JOIN names n ON n.district = r.district
         AND strpos(' ' || lower(translate(a.display_address, ',.', '  ')) || ' ', ' ' || lower(n.name) || ' ') > 0
        ORDER BY a.id, length(n.name) DESC, n.name
    )
    SELECT r.sector, m.name, count(*),
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.floor_area)),
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.ppm)),
           p_source_release_id
    FROM recent r JOIN matched m USING (address_id)
    GROUP BY r.sector, m.name
    HAVING count(*) >= 5;

    RETURN affected;
END;
$$;
