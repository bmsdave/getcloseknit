-- 135: release_data_health() answered /health with a live count over metric_value that took over the 20 s statement
-- timeout on prod, so the api and mcp containers turned unhealthy. /health now reads the typical-price coverage the
-- coverage guard recorded at activation; deploy/preflight.sh asks for the live count with release_data_health(true).
DROP FUNCTION IF EXISTS public.release_data_health();

CREATE FUNCTION public.release_data_health(live boolean DEFAULT false)
RETURNS TABLE (check_name text, ok boolean, detail text)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    active_id text;
    low text;
    lowest text;
    regions integer;
    run release_build_run%ROWTYPE;
    rows_now integer;
BEGIN
    SELECT release_id INTO active_id FROM active_product_release;
    IF active_id IS NULL THEN
        RETURN QUERY SELECT 'typical-price-coverage'::text, false, 'no active product release'::text;
        RETURN QUERY SELECT 'release-artifacts'::text, false, 'no active product release'::text;
        RETURN;
    END IF;

    -- live: count the shared tables' rows now (preflight; tens of seconds on prod). Otherwise read the counts the
    -- coverage guard recorded when the release was activated, so /health and the container healthcheck stay fast.
    IF live THEN
        WITH lsoa AS (
            SELECT g.id, r.name AS region, r.official_code AS code
            FROM area_geography g JOIN area_geography r ON r.id = g.region_id
            WHERE g.kind = 'lsoa' AND r.kind = 'region' AND r.official_code LIKE 'E12%'
        ), by_region AS (
            SELECT l.region, count(*) AS total, count(v.geography_id) AS n
            FROM lsoa l
            LEFT JOIN (SELECT DISTINCT mv.geography_id
                       FROM metric_value mv
                       JOIN product_release_member m
                         ON m.source_release_id = mv.source_release_id AND m.release_id = active_id
                       WHERE mv.metric_id = 'typical-price' AND mv.value IS NOT NULL) v ON v.geography_id = l.id
            GROUP BY l.region
        )
        SELECT count(*),
               string_agg(format('%s %s/%s LSOAs (%s%%)', region, n, total, round(100.0 * n / total, 1)), '; '
                          ORDER BY n::numeric / total, region) FILTER (WHERE n < 0.95 * total),
               (array_agg(format('%s %s%%', region, round(100.0 * n / total, 1)) ORDER BY n::numeric / total, region))[1]
          INTO regions, low, lowest
        FROM by_region;
    ELSE
        WITH region_totals AS (
            SELECT r.name AS region, r.official_code AS code, count(*) AS total
            FROM area_geography g JOIN area_geography r ON r.id = g.region_id
            WHERE g.kind = 'lsoa' AND r.kind = 'region' AND r.official_code LIKE 'E12%'
            GROUP BY r.name, r.official_code
        ), recorded AS (
            SELECT key AS code, value::integer AS n
            FROM jsonb_each_text((SELECT validation_record -> 'coverage_guard' -> 'coverage' -> 'typical-price'
                                  FROM product_release WHERE id = active_id))
        ), by_region AS (
            SELECT g.region, g.total, coalesce(rc.n, 0) AS n
            FROM region_totals g LEFT JOIN recorded rc ON rc.code = g.code
        )
        SELECT count(*),
               string_agg(format('%s %s/%s LSOAs (%s%%)', region, n, total, round(100.0 * n / total, 1)), '; '
                          ORDER BY n::numeric / total, region) FILTER (WHERE n < 0.95 * total),
               (array_agg(format('%s %s%%', region, round(100.0 * n / total, 1)) ORDER BY n::numeric / total, region))[1]
          INTO regions, low, lowest
        FROM by_region;
    END IF;
    RETURN QUERY SELECT 'typical-price-coverage'::text, regions > 0 AND low IS NULL,
        CASE WHEN regions = 0 THEN 'no English region with LSOAs'
             WHEN low IS NULL THEN format('every English region (%s) has a typical price for at least 95%% of its '
                                          'LSOAs; lowest %s', regions, lowest)
             ELSE 'below 95% of LSOAs with a typical price: ' || low END;

    SELECT * INTO run FROM release_build_run b
    WHERE b.release_id = active_id AND b.tiers @> ARRAY[0, 1]::smallint[]
    ORDER BY b.finished_at DESC LIMIT 1;
    SELECT count(*) INTO rows_now FROM release_artifact a WHERE a.release_id = active_id;
    RETURN QUERY SELECT 'release-artifacts'::text,
        run.release_id IS NOT NULL AND run.failed = 0 AND rows_now >= run.artifacts,
        CASE WHEN run.release_id IS NULL
                 THEN format('%s has %s artifacts and no tier-0/1 build (python -m area_api.release_build '
                             '--tiers 0,1)', active_id, rows_now)
             WHEN run.failed > 0
                 THEN format('the tier-0/1 build of %s failed %s of %s tasks', active_id, run.failed, run.tasks)
             WHEN rows_now < run.artifacts
                 THEN format('%s has %s artifacts, fewer than the %s its tier-0/1 build (%s tasks) left', active_id,
                             rows_now, run.artifacts, run.tasks)
             ELSE format('%s has %s artifacts (tier-0/1 build: %s tasks, %s artifacts, %s over budget)', active_id,
                         rows_now, run.tasks, run.artifacts, run.skipped) END;
END;
$$;
