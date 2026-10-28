-- 134: guards on a release going live, after the October Price Paid refresh activated a release with no prices
-- outside London and 157 of its ~376k derived artifacts. RELEASE-CHECKLIST.md ("Monthly Price Paid refresh").
--
-- 1. Coverage guard. activate_product_release() compares the release's coverage of the key layers, region by
--    region, with the active release's and refuses when any region loses more than 2% (the threshold is the
--    setting close_knit.coverage_drop_threshold_percent; deploy/tools/release_guard.py sets it from the
--    environment variable CLOSE_KNIT_COVERAGE_DROP_THRESHOLD_PERCENT). Coverage = areas (schools for the
--    school layer) with a non-null value: a metric at its carrier in each region's latest month with a value
--    (metric_coverage, 126), area_price_band's LSOAs with a whole-home median, and schools placed in the
--    region. Guarded: every metric the baseline has in two regions or more (the England-wide layers: typical
--    price, £/m², crime, school and civic layers...), the price layers wherever they are, and the two tables.
--    The baseline is what the guard recorded for the active release, else (a release from before this) the
--    active release's metric_coverage. The guard's numbers go into the release's validation_record under
--    coverage_guard, the one key a staged release may still change (the immutability trigger allows it).
-- 2. Stage only. With the setting close_knit.stage_only on (deploy/tools/etl.py sets it, through PGOPTIONS,
--    for every step of a run), activate_product_release() refuses: a run stages its releases and activates
--    one composed release at the end, after release_build has built it.
-- 3. release_build_run: what `python -m area_api.release_build` built for a release (the tier-0/1 plan's size
--    and the release's artifact rows when it ended), so a release activated before its build is visible.
-- 4. release_data_health(): the checks deploy/preflight.sh and /health share: every English region has a
--    typical price for at least 95% of its LSOAs, and the active release has its tier-0/1 build.
-- Safe to run again.

CREATE OR REPLACE FUNCTION public.product_release_guard_record_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.id, NEW.geography_vintage, NEW.transformation_versions, NEW.assets, NEW.validation_status,
            NEW.created_at)
           IS NOT DISTINCT FROM (OLD.id, OLD.geography_vintage, OLD.transformation_versions, OLD.assets,
                                 OLD.validation_status, OLD.created_at)
       AND NEW.validation_record - 'coverage_guard' = OLD.validation_record - 'coverage_guard' THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Product releases are immutable';
END;
$$;

DROP TRIGGER IF EXISTS product_release_immutable ON product_release;
CREATE TRIGGER product_release_immutable
BEFORE UPDATE OR DELETE ON product_release
FOR EACH ROW EXECUTE FUNCTION product_release_guard_record_only();

-- The layers the guard always checks, wherever they are loaded.
CREATE OR REPLACE FUNCTION public.release_guard_key_layer(p_layer text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_layer IN ('price-per-square-metre', 'crime', 'area_price_band', 'school')
        OR p_layer LIKE 'typical-price%';
$$;

-- {layer: {region code: areas with a value}} of a release. Metric layers read metric_coverage, so
-- rebuild_metric_coverage(release) must have run; p_tables adds the two shared tables as they are now.
CREATE OR REPLACE FUNCTION public.release_layer_coverage(p_release_id text, p_tables boolean DEFAULT true)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    WITH metric_layer AS (
        SELECT DISTINCT ON (c.metric_id, c.scope_id) c.metric_id AS layer, r.official_code AS region,
               c.with_value AS n
        FROM metric_coverage c
        JOIN metric_definition d ON d.id = c.metric_id AND d.carrier::text = c.kind::text
        JOIN area_geography r ON r.id = c.scope_id AND r.kind = 'region'
        WHERE c.release_id = p_release_id
        ORDER BY c.metric_id, c.scope_id, c.period DESC
    ), band AS (
        SELECT 'area_price_band'::text AS layer, r.official_code AS region,
               count(DISTINCT b.geography_id)::integer AS n
        FROM area_price_band b
        JOIN area_geography g ON g.id = b.geography_id AND g.kind = 'lsoa'
        JOIN area_geography r ON r.id = g.region_id
        WHERE p_tables AND b.property_type = '*' AND b.p50 IS NOT NULL
        GROUP BY r.official_code
    ), schools AS (
        SELECT 'school'::text AS layer, s.region_code AS region, count(*)::integer AS n
        FROM school s
        WHERE p_tables AND s.region_code IS NOT NULL
        GROUP BY s.region_code
    ), layers AS (
        SELECT layer, jsonb_object_agg(region, n) AS regions, count(*) AS region_count
        FROM (SELECT * FROM metric_layer UNION ALL SELECT * FROM band UNION ALL SELECT * FROM schools) x
        GROUP BY layer
    )
    SELECT coalesce(jsonb_object_agg(layer, regions), '{}'::jsonb)
    FROM layers
    WHERE region_count >= 2 OR release_guard_key_layer(layer);
$$;

-- The guard: the release's coverage against the active release's. Returns (and with p_record stores in the
-- release's validation_record.coverage_guard) {ok, drops, threshold_percent, baseline_release, coverage...}.
CREATE OR REPLACE FUNCTION public.check_release_coverage(p_release_id text, p_record boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    active_id text;
    threshold numeric;
    baseline jsonb;
    baseline_from text;
    current jsonb;
    drops jsonb;
    result jsonb;
BEGIN
    threshold := coalesce(nullif(current_setting('close_knit.coverage_drop_threshold_percent', true), '')::numeric,
                          2);
    SELECT release_id INTO active_id FROM active_product_release;
    current := release_layer_coverage(p_release_id);
    IF active_id IS NOT NULL AND active_id <> p_release_id THEN
        SELECT validation_record -> 'coverage_guard' -> 'coverage' INTO baseline
        FROM product_release WHERE id = active_id;
        baseline_from := 'recorded';
        IF baseline IS NULL THEN
            baseline := release_layer_coverage(active_id, false);
            baseline_from := 'metric_coverage';
        END IF;
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'layer', b.layer, 'region', b.region, 'before', b.n, 'after', coalesce(c.n, 0),
               'drop_percent', round(100.0 * (b.n - coalesce(c.n, 0)) / b.n, 2))
             ORDER BY b.layer, b.region), '[]'::jsonb)
      INTO drops
    FROM (SELECT l.key AS layer, r.key AS region, r.value::integer AS n
          FROM jsonb_each(coalesce(baseline, '{}'::jsonb)) l
          CROSS JOIN LATERAL jsonb_each_text(l.value) r) b
    LEFT JOIN LATERAL (SELECT (current -> b.layer ->> b.region)::integer AS n) c ON true
    WHERE b.n > 0 AND coalesce(c.n, 0) < b.n * (1 - threshold / 100);
    result := jsonb_build_object(
        'ok', jsonb_array_length(drops) = 0, 'drops', drops, 'threshold_percent', threshold,
        'baseline_release', active_id, 'baseline_from', baseline_from, 'checked_at', now(),
        'coverage', current);
    IF p_record THEN
        UPDATE product_release
           SET validation_record = validation_record || jsonb_build_object('coverage_guard', result)
         WHERE id = p_release_id;
    END IF;
    RETURN result;
END;
$$;

-- 126's body, refusing while stage-only is on, then the coverage guard before the release goes live.
CREATE OR REPLACE FUNCTION public.activate_product_release(p_release_id text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    previous_id text;
    release_status text;
    failed_members integer;
    guard jsonb;
    worst jsonb;
BEGIN
    IF coalesce(current_setting('close_knit.stage_only', true), '') IN ('on', 'true', '1') THEN
        RAISE EXCEPTION 'activation of % is deferred: close_knit.stage_only is on (a run of deploy/tools/etl.py '
                        'activates once at the end: etl.py activate)', p_release_id;
    END IF;
    SELECT validation_status INTO release_status
    FROM product_release WHERE id = p_release_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product release is not staged: %', p_release_id;
    END IF;
    IF release_status != 'passed' THEN
        RAISE EXCEPTION 'Product release validation has not passed: %', p_release_id;
    END IF;
    SELECT count(*) INTO failed_members
    FROM product_release_member member
    JOIN source_release source ON source.id = member.source_release_id
    WHERE member.release_id = p_release_id AND source.validation_status != 'passed';
    IF failed_members > 0 THEN
        RAISE EXCEPTION 'Product release has unvalidated members: %', p_release_id;
    END IF;
    PERFORM rebuild_metric_ranks(p_release_id);
    PERFORM rebuild_metric_coverage(p_release_id);
    guard := check_release_coverage(p_release_id);
    IF NOT (guard ->> 'ok')::boolean THEN
        SELECT d INTO worst FROM jsonb_array_elements(guard -> 'drops') d
        ORDER BY (d ->> 'drop_percent')::numeric DESC LIMIT 1;
        RAISE EXCEPTION 'coverage guard: % would lose coverage against % in % layer-region(s), worst % in % (% -> %, -% %%; '
                        'limit % %%). Fix the load; to accept the drop re-run with '
                        'CLOSE_KNIT_COVERAGE_DROP_THRESHOLD_PERCENT=% (psql: PGOPTIONS=''-c close_knit.coverage_drop_threshold_percent=%'')',
            p_release_id, guard ->> 'baseline_release', jsonb_array_length(guard -> 'drops'),
            worst ->> 'layer', worst ->> 'region', worst ->> 'before', worst ->> 'after', worst ->> 'drop_percent',
            guard ->> 'threshold_percent', ceil((worst ->> 'drop_percent')::numeric),
            ceil((worst ->> 'drop_percent')::numeric)
            USING DETAIL = (guard -> 'drops')::text;
    END IF;
    SELECT active.release_id INTO previous_id FROM active_product_release active;
    IF FOUND THEN
        UPDATE active_product_release
        SET release_id = activate_product_release.p_release_id,
            previous_release_id = previous_id,
            updated_at = now();
    ELSE
        INSERT INTO active_product_release (release_id, previous_release_id)
        VALUES (activate_product_release.p_release_id, NULL);
        previous_id := NULL;
    END IF;
    INSERT INTO product_release_activation (release_id, previous_release_id)
    VALUES (activate_product_release.p_release_id, previous_id);
    RETURN activate_product_release.p_release_id;
END;
$$;

CREATE TABLE IF NOT EXISTS release_build_run (
    release_id text NOT NULL REFERENCES product_release(id) ON DELETE CASCADE,
    tiers smallint[] NOT NULL,
    tasks integer NOT NULL,          -- the plan's tasks for these tiers
    done integer NOT NULL,
    failed integer NOT NULL,
    skipped integer NOT NULL,        -- over the time budget
    artifacts integer NOT NULL,      -- the release's release_artifact rows when the build ended
    finished_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (release_id, tiers)
);

CREATE OR REPLACE FUNCTION public.release_data_health()
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

    -- Live rows, not metric_coverage: the shared tables can lose rows after the release went live.
    WITH lsoa AS (
        SELECT g.id, r.name AS region
        FROM area_geography g JOIN area_geography r ON r.id = g.region_id
        WHERE g.kind = 'lsoa' AND r.kind = 'region' AND r.official_code LIKE 'E12%'
    ), valued AS (
        SELECT DISTINCT mv.geography_id
        FROM metric_value mv
        JOIN product_release_member m ON m.source_release_id = mv.source_release_id AND m.release_id = active_id
        WHERE mv.metric_id = 'typical-price' AND mv.value IS NOT NULL
    ), by_region AS (
        SELECT l.region, count(*) AS total, count(v.geography_id) AS n,
               round(100.0 * count(v.geography_id) / count(*), 1) AS share
        FROM lsoa l LEFT JOIN valued v ON v.geography_id = l.id
        GROUP BY l.region
    )
    SELECT count(*),
           string_agg(format('%s %s/%s LSOAs (%s%%)', region, n, total, share), '; ' ORDER BY share, region)
               FILTER (WHERE n < 0.95 * total),
           (array_agg(format('%s %s%%', region, share) ORDER BY share, region))[1]
      INTO regions, low, lowest
    FROM by_region;
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

-- The active release's coverage now becomes the next activation's baseline.
DO $$
DECLARE active_id text;
BEGIN
    SELECT release_id INTO active_id FROM active_product_release;
    IF active_id IS NOT NULL
       AND (SELECT validation_record -> 'coverage_guard' FROM product_release WHERE id = active_id) IS NULL THEN
        PERFORM check_release_coverage(active_id);
    END IF;
END $$;
