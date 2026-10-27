-- 061: Health layers per area (GET /api/v1/areas/{id}/health, api/area_api/health.py),
-- loaded by deploy/tools/etl_health.py. Renumber at merge if 061 is taken.
--
-- Places and practices, never people (owner decisions: aggregates only, open data):
--   health_air_lsoa   GLA LAEI modelled annual mean NO2 and PM2.5 (µg/m³) sampled at every
--                     OS Open UPRN point (`property.location`) and averaged per LSOA
--   health_heat_lsoa  summer heat per LSOA (see etl_health.py for the source and unit)
--   gp_practice       NHS England practices with a London postcode: registered patients, FTE GPs
--                     (excluding trainees and locums; NULL when not reported) and the postcode centre
--
-- rebuild_area_health() rebuilds `area_health` for every LSOA, MSOA and borough:
--   air and heat  LSOA values; MSOA and borough = home-weighted means of their LSOAs
--   gp            LSOA: practices within 1 km of its representative point (patients summed over FTE
--                 GPs summed, nearest surgery in metres); MSOA and borough: practices inside it
--   *_pct         percent_rank among areas of the same kind × 100 (0 = lowest in London);
--                 air_pct ranks the sum of the NO2 and PM2.5 percentiles
-- Safe to re-run; each etl stage calls it after loading its own staging table.

CREATE TABLE IF NOT EXISTS health_air_lsoa (
    geography_id text PRIMARY KEY REFERENCES area_geography(id),
    dwellings integer NOT NULL CHECK (dwellings > 0),
    no2 numeric NOT NULL CHECK (no2 >= 0),
    pm25 numeric CHECK (pm25 >= 0),
    year integer NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE TABLE IF NOT EXISTS health_heat_lsoa (
    geography_id text PRIMARY KEY REFERENCES area_geography(id),
    heat numeric NOT NULL,
    unit text NOT NULL,
    year integer,
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE TABLE IF NOT EXISTS gp_practice (
    code text PRIMARY KEY CHECK (code ~ '^[A-Z][0-9]{5}$'),
    postcode text NOT NULL,
    location geometry(Point, 4326) NOT NULL,
    patients integer NOT NULL CHECK (patients >= 0),
    gp_fte numeric CHECK (gp_fte >= 0),
    month date NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS gp_practice_location ON gp_practice USING gist (location);

CREATE TABLE IF NOT EXISTS area_health (
    geography_id text PRIMARY KEY REFERENCES area_geography(id),
    no2 numeric, pm25 numeric, air_year integer, no2_pct numeric, pm25_pct numeric, air_pct numeric,
    heat numeric, heat_unit text, heat_year integer, heat_pct numeric,
    gp_patients_per_fte numeric, gp_practices integer, gp_nearest_m numeric, gp_month date, gp_pct numeric,
    air_release_id text REFERENCES source_release(id),
    heat_release_id text REFERENCES source_release(id),
    gp_release_id text REFERENCES source_release(id)
);

CREATE OR REPLACE FUNCTION public.rebuild_area_health()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM area_health;
    WITH lsoa AS (
        SELECT l.id AS lsoa, l.parent_id AS msoa, m.parent_id AS borough, l.geometry
        FROM area_geography l JOIN area_geography m ON m.id = l.parent_id
        WHERE l.kind = 'lsoa'
    ), levels AS (
        SELECT lsoa AS geography_id, lsoa FROM lsoa
        UNION ALL SELECT msoa, lsoa FROM lsoa
        UNION ALL SELECT borough, lsoa FROM lsoa
    ), air AS (
        SELECT v.geography_id, sum(a.no2 * a.dwellings) / sum(a.dwellings) AS no2,
               sum(a.pm25 * a.dwellings) / nullif(sum(a.dwellings) FILTER (WHERE a.pm25 IS NOT NULL), 0) AS pm25,
               max(a.year) AS year, max(a.source_release_id) AS release_id
        FROM levels v JOIN health_air_lsoa a ON a.geography_id = v.lsoa
        GROUP BY v.geography_id
    ), heat AS (
        SELECT v.geography_id,
               sum(h.heat * coalesce(a.dwellings, 1)) / sum(coalesce(a.dwellings, 1)) AS heat,
               max(h.unit) AS unit, max(h.year) AS year, max(h.source_release_id) AS release_id
        FROM levels v JOIN health_heat_lsoa h ON h.geography_id = v.lsoa
        LEFT JOIN health_air_lsoa a ON a.geography_id = v.lsoa
        GROUP BY v.geography_id
    ), centre AS (
        -- The same representative point the place and food-hygiene evidence use.
        SELECT lsoa, ST_PointOnSurface(geometry) AS point FROM lsoa
    ), gp_lsoa AS (
        SELECT c.lsoa AS geography_id,
               sum(p.patients) FILTER (WHERE p.gp_fte > 0) / nullif(sum(p.gp_fte), 0) AS per_fte,
               count(p.code) AS practices,
               (SELECT ST_Distance(n.location::geography, c.point::geography)
                FROM gp_practice n ORDER BY n.location <-> c.point LIMIT 1) AS nearest
        FROM centre c
        LEFT JOIN gp_practice p ON ST_DWithin(p.location::geography, c.point::geography, 1000)
        GROUP BY c.lsoa, c.point
    ), gp_wide AS (
        SELECT g.id AS geography_id, sum(p.patients) FILTER (WHERE p.gp_fte > 0) / nullif(sum(p.gp_fte), 0) AS per_fte,
               count(p.code) AS practices, NULL::numeric AS nearest
        FROM area_geography g LEFT JOIN gp_practice p ON ST_Contains(g.geometry, p.location)
        WHERE g.kind IN ('msoa', 'borough')
        GROUP BY g.id
    ), gp AS (
        SELECT * FROM gp_lsoa UNION ALL SELECT * FROM gp_wide
    ), gp_meta AS (
        SELECT max(month) AS month, max(source_release_id) AS release_id FROM gp_practice
    ), joined AS (
        SELECT g.id AS geography_id, g.kind, air.no2, air.pm25, air.year AS air_year, air.release_id AS air_release_id,
               heat.heat, heat.unit, heat.year AS heat_year, heat.release_id AS heat_release_id,
               CASE WHEN gp_meta.release_id IS NOT NULL THEN gp.per_fte END AS per_fte,
               CASE WHEN gp_meta.release_id IS NOT NULL THEN gp.practices END AS practices,
               CASE WHEN gp_meta.release_id IS NOT NULL THEN gp.nearest END AS nearest,
               gp_meta.month AS gp_month, gp_meta.release_id AS gp_release_id
        FROM area_geography g
        CROSS JOIN gp_meta
        LEFT JOIN air ON air.geography_id = g.id
        LEFT JOIN heat ON heat.geography_id = g.id
        LEFT JOIN gp ON gp.geography_id = g.id
    ), ranked AS (
        SELECT j.*,
               CASE WHEN no2 IS NOT NULL THEN percent_rank() OVER (PARTITION BY kind, no2 IS NULL ORDER BY no2) * 100 END AS no2_pct,
               CASE WHEN pm25 IS NOT NULL THEN percent_rank() OVER (PARTITION BY kind, pm25 IS NULL ORDER BY pm25) * 100 END AS pm25_pct,
               CASE WHEN heat IS NOT NULL THEN percent_rank() OVER (PARTITION BY kind, heat IS NULL ORDER BY heat) * 100 END AS heat_pct,
               CASE WHEN per_fte IS NOT NULL THEN percent_rank() OVER (PARTITION BY kind, per_fte IS NULL ORDER BY per_fte) * 100 END AS gp_pct
        FROM joined j
    )
    INSERT INTO area_health (geography_id, no2, pm25, air_year, no2_pct, pm25_pct, air_pct,
        heat, heat_unit, heat_year, heat_pct, gp_patients_per_fte, gp_practices, gp_nearest_m, gp_month, gp_pct,
        air_release_id, heat_release_id, gp_release_id)
    SELECT geography_id, round(no2, 2), round(pm25, 2), air_year, round(no2_pct::numeric, 1), round(pm25_pct::numeric, 1),
           CASE WHEN no2_pct IS NOT NULL THEN round((percent_rank() OVER (
               PARTITION BY kind, no2_pct IS NULL ORDER BY no2_pct + coalesce(pm25_pct, no2_pct)) * 100)::numeric, 1) END,
           round(heat, 2), unit, heat_year, round(heat_pct::numeric, 1),
           round(per_fte, 1), practices, round(nearest::numeric), gp_month, round(gp_pct::numeric, 1),
           air_release_id, heat_release_id, gp_release_id
    FROM ranked
    WHERE no2 IS NOT NULL OR heat IS NOT NULL OR gp_release_id IS NOT NULL;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;
