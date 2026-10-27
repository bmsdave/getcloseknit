-- 112: England environment. Flood, noise, air and nature now hold rows for every English area:
-- London from its per-home builds (property/dwelling_* tables, unchanged), the rest of England from
-- area-level loads (deploy/tools/england_flood.py, england_noise.py, etl_england_environment.py) that
-- write area_flood, area_noise, health_air_lsoa, nature_site and metric rows directly. The London
-- rebuild functions below therefore only touch London's rows (region E12000007, the extent of the
-- London per-home sources), so a London reload never wipes or zero-fills the rest of England.
--
--   rebuild_flood(release)         as 018, over London LSOAs only; deletes only London rows
--   rebuild_flood_risk(release)    as 103, writes and deletes only London's flood-risk rows
--   rebuild_area_noise(release)    as 093, deletes only London rows (homes are London's property)
--   rebuild_area_nature()          as 103, plus a row for every LSOA with a nearest nature site; street
--                                  tree counts are NULL (not 0) in regions where most LSOAs have no
--                                  street-tree data (the GLA file is London's); the nearest site is the
--                                  nearest in metres (103 took the nearest in degrees, which favours sites
--                                  to the north or south)
--   area_kids                      protected_km / cycleway_km may be NULL (110 leaves the TfL lanes
--                                  NULL outside London; the STATS19 England load rebuilds area_kids)
--   area_nature                    street_trees / trees_per_hectare may be NULL (no street-tree data)
--
-- Idempotent: safe to run again. Apply with psql -1 -v ON_ERROR_STOP=1.

ALTER TABLE area_kids ALTER COLUMN protected_km DROP NOT NULL;
ALTER TABLE area_kids ALTER COLUMN cycleway_km DROP NOT NULL;
ALTER TABLE area_nature ALTER COLUMN street_trees DROP NOT NULL;
ALTER TABLE area_nature ALTER COLUMN trees_per_hectare DROP NOT NULL;
-- As 090/093 (rebuild_area_noise below and the England load write them); a no-op where those ran.
ALTER TABLE area_noise ADD COLUMN IF NOT EXISTS air_55_share real;
ALTER TABLE area_noise ADD COLUMN IF NOT EXISTS road_lden_mapped_share real;
ALTER TABLE dwelling_noise ADD COLUMN IF NOT EXISTS aircraft_lden real;

CREATE OR REPLACE FUNCTION public.rebuild_flood(p_source_release_id text, OUT homes integer, OUT areas integer)
LANGUAGE plpgsql
AS $$
BEGIN
    CREATE TEMP TABLE flood_piece ON COMMIT DROP AS
        SELECT source, band, ST_Subdivide(geom, 128) AS geom FROM flood_zone WHERE band > 1;
    CREATE INDEX ON flood_piece USING gist (geom);
    ANALYZE flood_piece;

    DELETE FROM dwelling_flood;
    INSERT INTO dwelling_flood (uprn, rivers_sea_band, surface_water_band, source_release_id)
    SELECT p.uprn,
           coalesce(max(f.band) FILTER (WHERE f.source = 'rivers-sea'), 1),
           coalesce(max(f.band) FILTER (WHERE f.source = 'surface-water'), 1),
           p_source_release_id
    FROM property p
    LEFT JOIN flood_piece f ON ST_Intersects(f.geom, ST_Transform(p.location, 27700))
    GROUP BY p.uprn;
    GET DIAGNOSTICS homes = ROW_COUNT;

    -- flood_zone covers London only: its rows are London's areas.
    CREATE TEMP TABLE flood_lsoa ON COMMIT DROP AS
        SELECT l.id, l.parent_id, coalesce(ST_Difference(l.geom, w.geom), l.geom) AS geom
        FROM (SELECT g.id, g.parent_id, ST_Transform(g.geometry, 27700) AS geom
              FROM area_geography g JOIN area_region r ON r.area_id = g.id AND r.region_code = 'E12000007'
              WHERE g.kind = 'lsoa') l
        LEFT JOIN LATERAL (SELECT ST_Union(geom) AS geom FROM flood_water
                           WHERE ST_Intersects(flood_water.geom, l.geom)) w ON true;
    DELETE FROM flood_lsoa WHERE ST_Area(geom) <= 0;
    CREATE INDEX ON flood_lsoa USING gist (geom);
    ANALYZE flood_lsoa;

    DELETE FROM area_flood f USING area_region r
    WHERE r.area_id = f.geography_id AND r.region_code = 'E12000007';
    INSERT INTO area_flood (geography_id, source, area_m2, low_m2, medium_m2, high_m2, source_release_id)
    WITH band_area AS (
        SELECT l.id, f.source, f.band,
               sum(CASE WHEN ST_CoveredBy(f.geom, l.geom) THEN ST_Area(f.geom)
                        ELSE ST_Area(ST_Intersection(f.geom, l.geom)) END) AS m2
        FROM flood_lsoa l JOIN flood_piece f ON ST_Intersects(f.geom, l.geom)
        GROUP BY l.id, f.source, f.band
    ), lsoa AS (
        SELECT l.id, l.parent_id AS msoa, m.parent_id AS borough, s.source, ST_Area(l.geom) AS area_m2,
               coalesce(sum(b.m2) FILTER (WHERE b.band = 2), 0) AS low_m2,
               coalesce(sum(b.m2) FILTER (WHERE b.band = 3), 0) AS medium_m2,
               coalesce(sum(b.m2) FILTER (WHERE b.band = 4), 0) AS high_m2
        FROM flood_lsoa l
        JOIN area_geography m ON m.id = l.parent_id
        CROSS JOIN (VALUES ('rivers-sea'), ('surface-water')) s(source)
        LEFT JOIN band_area b ON b.id = l.id AND b.source = s.source
        GROUP BY l.id, l.parent_id, m.parent_id, s.source, l.geom
    ), levels AS (
        SELECT id AS geography_id, source, area_m2, low_m2, medium_m2, high_m2 FROM lsoa
        UNION ALL SELECT msoa, source, area_m2, low_m2, medium_m2, high_m2 FROM lsoa
        UNION ALL SELECT borough, source, area_m2, low_m2, medium_m2, high_m2 FROM lsoa
    )
    SELECT geography_id, source, sum(area_m2), sum(low_m2), sum(medium_m2), sum(high_m2), p_source_release_id
    FROM levels GROUP BY geography_id, source;
    GET DIAGNOSTICS areas = ROW_COUNT;
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_flood_risk(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    latest date;
    n integer;
BEGIN
    SELECT date_trunc('month', max(s.release_date))::date INTO latest
    FROM source_release s WHERE s.id IN (SELECT DISTINCT source_release_id FROM dwelling_flood);
    IF latest IS NULL THEN
        RAISE EXCEPTION 'dwelling_flood is empty: run rebuild_flood first';
    END IF;
    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    VALUES ('flood-risk', 'lsoa', '%', 'higher-is-more', jsonb_build_object(
        'label', 'Homes at flood risk', 'shortLabel', 'Flood risk',
        'description', 'Share of the area''s homes in a medium or high flood-risk band (a 1% chance a year or more) '
            || 'from rivers and the sea or from surface water, read at each home''s point (Environment Agency NaFRA2, '
            || to_char(latest, 'YYYY') || ').',
        'legend', '[{"value": 0, "colour": "#3a7d44", "label": "0%"},
                    {"value": 5, "colour": "#7ba05b", "label": "5%"},
                    {"value": 15, "colour": "#f4d35e", "label": "15%"},
                    {"value": 30, "colour": "#c96a3b", "label": "30%"},
                    {"value": 50, "colour": "#b23a48", "label": "50%+"}]'::jsonb,
        'sourceId', 'ea-nafra2', 'sourceName', 'Environment Agency National Flood Risk Assessment (NaFRA2)',
        'methodologyPath', '/guide/flood', 'freshness', to_char(latest, 'YYYY-MM'),
        'caveats', jsonb_build_array(
            'Modelled chance of flooding each year, not a record of past floods.',
            'Medium is 1% to 3.3% a year, high more than 3.3%; the higher of the rivers-and-sea and surface-water bands counts.',
            'Areas with fewer than 10 homes with a point show no share.',
            'Contains public sector information licensed under the Open Government Licence v3.0. '
                || '© Environment Agency copyright and/or database right.')),
        p_source_release_id)
    ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit,
        direction = EXCLUDED.direction, definition = EXCLUDED.definition,
        source_release_id = EXCLUDED.source_release_id;

    -- London's rows only: the rest of England comes from england_flood.py.
    DELETE FROM metric_value v USING area_region r
    WHERE v.metric_id = 'flood-risk' AND r.area_id = v.geography_id AND r.region_code = 'E12000007';
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, sample_count, quality,
        source_release_id)
    WITH homes AS (
        SELECT p.geography_id, count(*) AS homes,
               round(100 * avg((greatest(f.rivers_sea_band, f.surface_water_band) >= 3)::int), 1)::float8 AS share
        FROM dwelling_flood f JOIN property p ON p.uprn = f.uprn
        GROUP BY p.geography_id
    ), shares AS (
        SELECT g.id, coalesce(h.homes, 0) AS homes, CASE WHEN h.homes >= 10 THEN h.share END AS share
        FROM area_geography g JOIN area_region r ON r.area_id = g.id AND r.region_code = 'E12000007'
        LEFT JOIN homes h ON h.geography_id = g.id
        WHERE g.kind = 'lsoa'
    ), ranked AS (
        SELECT id, round(100 * percent_rank() OVER (PARTITION BY area_rank_region(id) ORDER BY share))::smallint AS pct
        FROM shares WHERE share IS NOT NULL
    )
    SELECT s.id, 'flood-risk', latest, s.share, r.pct, s.homes,
           CASE WHEN s.share IS NULL THEN 'suppressed' ELSE 'observed' END::metric_quality, p_source_release_id
    FROM shares s LEFT JOIN ranked r ON r.id = s.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_area_noise(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    -- dwelling_noise is London's per-home load: replace London's rows only.
    DELETE FROM area_noise n USING area_region r
    WHERE r.area_id = n.geography_id AND r.region_code = 'E12000007';
    INSERT INTO area_noise (geography_id, dwellings, road_55_share, rail_55_share, air_55_share,
        any_55_share, any_65_share, road_lden_median, road_lden_mapped_share, source_release_id)
    WITH homes AS (
        SELECT l.id AS lsoa, l.parent_id AS msoa, m.parent_id AS borough, n.road_lden, n.rail_lden,
               n.aircraft_lden,
               GREATEST(coalesce(n.road_lden, 0), coalesce(n.rail_lden, 0),
                        coalesce(n.aircraft_lden, 0)) AS loudest
        FROM dwelling_noise n
        JOIN property p ON p.uprn = n.uprn
        JOIN area_geography l ON l.id = p.geography_id
        JOIN area_geography m ON m.id = l.parent_id
        JOIN area_region r ON r.area_id = l.id AND r.region_code = 'E12000007'
    ), levels AS (
        SELECT lsoa AS geography_id, * FROM homes
        UNION ALL SELECT msoa, * FROM homes
        UNION ALL SELECT borough, * FROM homes
    )
    SELECT geography_id, count(*),
           round((avg((coalesce(road_lden, 0) >= 55)::int))::numeric, 3),
           round((avg((coalesce(rail_lden, 0) >= 55)::int))::numeric, 3),
           round((avg((coalesce(aircraft_lden, 0) >= 55)::int))::numeric, 3),
           round((avg((loudest >= 55)::int))::numeric, 3),
           round((avg((loudest >= 65)::int))::numeric, 3),
           CASE WHEN avg((road_lden IS NOT NULL)::int) >= 0.5
                THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY road_lden)
                     FILTER (WHERE road_lden IS NOT NULL) END,
           round((avg((road_lden IS NOT NULL)::int))::numeric, 3),
           p_source_release_id
    FROM levels GROUP BY geography_id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_area_nature()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM area_nature;
    INSERT INTO area_nature (geography_id, green_share, street_trees, trees_per_hectare, top_trees,
        site_name, site_kind, site_metres, source_release_ids)
    WITH lsoa AS (
        SELECT l.id, l.parent_id AS msoa, m.parent_id AS borough, l.geometry,
               ST_Area(l.geometry::geography) / 10000 AS hectares
        FROM area_geography l JOIN area_geography m ON m.id = l.parent_id
        WHERE l.kind = 'lsoa'
    ), trees AS (
        SELECT lsoa.id, t.common_name
        FROM lsoa JOIN street_tree t ON ST_Intersects(lsoa.geometry, t.location)
    ), levels AS (
        SELECT g.id, g.kind, ST_Area(g.geometry::geography) / 10000 AS hectares, g.geometry
        FROM area_geography g
    ), counted AS (
        SELECT level_id AS id, count(*) AS trees
        FROM (SELECT lsoa.id AS level_id FROM trees JOIN lsoa USING (id)
              UNION ALL SELECT lsoa.msoa FROM trees JOIN lsoa USING (id)
              UNION ALL SELECT lsoa.borough FROM trees JOIN lsoa USING (id)) t
        GROUP BY level_id
    ), tree_regions AS (
        -- The street-tree source (GLA) covers London. A region counts as covered when most of its LSOAs have
        -- trees in the file (a few edge trees outside London do not make the South East "zero trees").
        SELECT r.region_code AS region
        FROM area_geography g JOIN area_region r ON r.area_id = g.id
        LEFT JOIN counted c ON c.id = g.id
        WHERE g.kind = 'lsoa'
        GROUP BY r.region_code
        HAVING count(c.id) >= 0.5 * count(*)
    ), named AS (
        SELECT level_id AS id, common_name, count(*) AS n
        FROM (SELECT lsoa.id AS level_id, trees.common_name FROM trees JOIN lsoa USING (id)
              UNION ALL SELECT lsoa.msoa, trees.common_name FROM trees JOIN lsoa USING (id)
              UNION ALL SELECT lsoa.borough, trees.common_name FROM trees JOIN lsoa USING (id)) t
        WHERE common_name IS NOT NULL AND common_name <> 'Other'  -- GLA's catch-all for unrecorded kinds
        GROUP BY level_id, common_name
    ), top AS (
        SELECT id, jsonb_agg(jsonb_build_object('name', common_name, 'count', n) ORDER BY n DESC, common_name) AS top_trees
        FROM (SELECT *, row_number() OVER (PARTITION BY id ORDER BY n DESC, common_name) AS r FROM named) ranked
        WHERE r <= 5 GROUP BY id
    ), scoped AS (
        SELECT levels.*, area_rank_region(levels.id) IN (SELECT region FROM tree_regions) AS has_trees
        FROM levels
    )
    SELECT scoped.id, green.green_share,
           CASE WHEN scoped.has_trees THEN coalesce(counted.trees, 0) END,
           CASE WHEN scoped.has_trees
                THEN round((coalesce(counted.trees, 0) / greatest(scoped.hectares, 0.01))::numeric, 2) END,
           CASE WHEN scoped.has_trees THEN coalesce(top.top_trees, '[]') ELSE '[]' END, site.name, site.kind, site.metres,
           array_remove(ARRAY[green.source_release_id,
               CASE WHEN scoped.has_trees THEN (SELECT source_release_id FROM street_tree LIMIT 1) END,
               (SELECT source_release_id FROM nature_site LIMIT 1)], NULL)
    FROM scoped
    LEFT JOIN area_green green ON green.geography_id = scoped.id
    LEFT JOIN counted ON counted.id = scoped.id
    LEFT JOIN top ON top.id = scoped.id
    LEFT JOIN LATERAL (
        -- The index orders by distance in degrees, which stretches east-west distances: take the 20 nearest
        -- that way, then the truly nearest in metres.
        SELECT c.name, c.kind, round(c.metres)::integer AS metres
        FROM (SELECT s.name, s.kind, ST_Distance(s.geometry::geography,
                     ST_PointOnSurface(scoped.geometry)::geography) AS metres
              FROM nature_site s
              ORDER BY s.geometry <-> ST_PointOnSurface(scoped.geometry)
              LIMIT 20) c
        ORDER BY c.metres, c.name
        LIMIT 1
    ) site ON scoped.kind = 'lsoa'
    WHERE green.geography_id IS NOT NULL OR scoped.has_trees OR site.name IS NOT NULL;

    WITH ranked AS (
        SELECT n.geography_id,
               CASE WHEN n.green_share IS NOT NULL
                    THEN round(100 * percent_rank() OVER (PARTITION BY area_rank_region(n.geography_id), n.green_share IS NULL ORDER BY n.green_share)) END AS green,
               CASE WHEN n.trees_per_hectare IS NOT NULL
                    THEN round(100 * percent_rank() OVER (PARTITION BY area_rank_region(n.geography_id), n.trees_per_hectare IS NULL ORDER BY n.trees_per_hectare)) END AS trees,
               CASE WHEN n.site_metres IS NOT NULL
                    THEN round(100 * percent_rank() OVER (PARTITION BY area_rank_region(n.geography_id), n.site_metres IS NULL ORDER BY n.site_metres DESC)) END AS site,
               count(*) OVER (PARTITION BY area_rank_region(n.geography_id)) AS lsoas
        FROM area_nature n JOIN area_geography g ON g.id = n.geography_id AND g.kind = 'lsoa'
    )
    UPDATE area_nature n
    SET green_percentile = ranked.green, trees_percentile = ranked.trees,
        site_percentile = ranked.site, ranked = ranked.lsoas
    FROM ranked WHERE ranked.geography_id = n.geography_id;

    WITH scored AS (
        SELECT geography_id,
               round(100 * percent_rank() OVER (PARTITION BY area_rank_region(geography_id)
                                         ORDER BY green_percentile + trees_percentile + site_percentile)) AS score
        FROM area_nature
        WHERE green_percentile IS NOT NULL AND trees_percentile IS NOT NULL AND site_percentile IS NOT NULL
    )
    UPDATE area_nature n SET nature_percentile = scored.score
    FROM scored WHERE scored.geography_id = n.geography_id;

    SELECT count(*) INTO affected FROM area_nature;
    RETURN affected;
END;
$$;
