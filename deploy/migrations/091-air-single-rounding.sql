-- 091: rebuild_area_health() without the second air rounding (issue #159).
--
-- 061 rounded the dwelling-weighted means to 2 dp in area_health while etl_health.py
-- stored the means rounded to 2 dp in health_air_lsoa, so the overview rounded twice
-- (raw -> 2 dp -> 1 dp) while the air-no2 layer rounded once (raw -> 1 dp): e.g. raw
-- 24.152 read 24.1 in the overview and 24.2 in the layer. The loader now writes the
-- unrounded dwelling means (etl_health.py air_table_rows); this migration drops the
-- second rounding here, so api health._num is the only rounding (1 dp on read).
-- Percentiles and heat are untouched.
--
-- Apply BEFORE the air bundle reload (RELEASE-CHECKLIST step 6p): air.sql.gz calls
-- rebuild_area_health(), and an old function would reintroduce the 2 dp rounding.

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
    SELECT geography_id, no2, pm25, air_year, round(no2_pct::numeric, 1), round(pm25_pct::numeric, 1),
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
