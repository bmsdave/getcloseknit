-- 124: country ranks in SQL at release build, step 5 of docs/architecture/global-geography.md (§4, §11).
--
-- rebuild_metric_ranks(release) fills metric_value.country_percentile for the release's rows: an area's percentile
-- among the areas of its kind in its country, for one metric and month. The rule is the one every stored percentile
-- uses (migration 103, area_api.percentiles): round(100 * percent_rank()) ascending on value, so 0 = the lowest
-- value, ties share the lowest position and the ends are 0 and 100; direction is applied where it is read. Only the
-- rows the loader ranked within their region (value and region_percentile set) are ranked: a metric that is never
-- ranked (Census, wildlife) stays unranked in the country too. This is the rule the API ran on each request
-- (evidence.ENGLAND_RANK_SQL with map_chunks.england_ranks), now stored once: the column was empty until now.
--
-- region_percentile stays the loaders'. One rule for it would change London's numbers: IMD deciles, income and
-- social renting are ranked by cume_dist (etl_people_metrics), house-price change carries its LAD's rank down to
-- the LSOAs (rebuild_hpi_layers), and crime, £/m², short lets and future stations were ranked on unrounded values
-- (PR body: the diff per metric). That waits for the owner.
--
-- activate_product_release() runs it, so every way a release goes live (stage_release.py, the ETLs, bundles, a
-- rollback) stores the ranks of what it serves. Rows are written only when their rank changes. Safe to run again.

CREATE OR REPLACE FUNCTION public.rebuild_metric_ranks(p_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    written integer;
    cleared integer;
BEGIN
    UPDATE metric_value v
    SET country_percentile = r.pct
    FROM (
        SELECT mv.geography_id, mv.metric_id, mv.period,
               round(100 * percent_rank() OVER (
                   PARTITION BY mv.metric_id, mv.period, g.kind, g.country_id ORDER BY mv.value))::smallint AS pct
        FROM product_release_member member
        JOIN metric_value mv ON mv.source_release_id = member.source_release_id
        JOIN area_geography g ON g.id = mv.geography_id
        WHERE member.release_id = p_release_id
          AND mv.value IS NOT NULL AND mv.region_percentile IS NOT NULL
    ) r
    WHERE v.geography_id = r.geography_id AND v.metric_id = r.metric_id AND v.period = r.period
      AND v.country_percentile IS DISTINCT FROM r.pct;
    GET DIAGNOSTICS written = ROW_COUNT;

    UPDATE metric_value v
    SET country_percentile = NULL
    FROM product_release_member member
    WHERE member.release_id = p_release_id AND v.source_release_id = member.source_release_id
      AND v.country_percentile IS NOT NULL AND (v.value IS NULL OR v.region_percentile IS NULL);
    GET DIAGNOSTICS cleared = ROW_COUNT;
    RETURN written + cleared;
END;
$$;

-- schema.sql's body, with the ranks rebuilt before the release goes live.
CREATE OR REPLACE FUNCTION public.activate_product_release(p_release_id text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    previous_id text;
    release_status text;
    failed_members integer;
BEGIN
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

-- The release that is live now.
SELECT rebuild_metric_ranks(release_id) FROM active_product_release;
