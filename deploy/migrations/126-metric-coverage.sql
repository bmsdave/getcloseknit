-- 126: metric coverage from the data, step 6 of docs/architecture/global-geography.md (§5, §11; review #14), the
-- data part only (the one no-data hatch and the legend chip wait for the owner's board #10).
--
-- metric_coverage holds, for each metric, month and kind of area in a release, how many areas of that kind in each
-- region, nation and country have a value (with_value) out of all its areas of that kind (total). Only scopes with a
-- value get a row: no row = no value anywhere in that scope. The metric catalog (/api/v1/metrics) serves it as
-- `coverage: [{scopeId, share}]` at the metric's carrier (each scope in its own latest month with a value), and the
-- layer list's "London only" is read from it, so it can no longer drift from what is loaded (the web's hand-written
-- LAYER_COVERAGE had air-no2 and student-share as London only with England loaded).
--
-- activate_product_release() rebuilds it with the ranks (124), so every way a release goes live stores the coverage
-- of what it serves. A rebuild keeps the active release's rows and the release's own, nothing else. Safe to run again.

CREATE TABLE IF NOT EXISTS metric_coverage (
    release_id text NOT NULL REFERENCES product_release(id) ON DELETE CASCADE,
    metric_id text NOT NULL REFERENCES metric_definition(id) ON DELETE CASCADE,
    period date NOT NULL,
    kind geography_kind NOT NULL,
    scope_id text NOT NULL REFERENCES area_geography(id),
    with_value integer NOT NULL CHECK (with_value > 0),
    total integer NOT NULL CHECK (total >= with_value),
    PRIMARY KEY (release_id, metric_id, period, kind, scope_id)
);

CREATE OR REPLACE FUNCTION public.rebuild_metric_coverage(p_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    written integer;
BEGIN
    DELETE FROM metric_coverage c
    WHERE c.release_id = p_release_id
       OR c.release_id NOT IN (SELECT active.release_id FROM active_product_release active);

    -- Each area's scopes: its region, the region's nation (the region's parent) and its country.
    WITH area_scope AS (
        SELECT g.id, g.kind, s.scope_id
        FROM area_geography g
        LEFT JOIN area_geography r ON r.id = g.region_id
        CROSS JOIN LATERAL unnest(ARRAY[g.region_id, r.parent_id, g.country_id]) AS s(scope_id)
        WHERE s.scope_id IS NOT NULL
    ), total AS (
        SELECT kind, scope_id, count(*)::integer AS n FROM area_scope GROUP BY kind, scope_id
    ), valued AS (
        SELECT mv.metric_id, mv.period, a.kind, a.scope_id, count(*)::integer AS n
        FROM product_release_member member
        JOIN metric_value mv ON mv.source_release_id = member.source_release_id
        JOIN area_scope a ON a.id = mv.geography_id
        WHERE member.release_id = p_release_id AND mv.value IS NOT NULL
        GROUP BY mv.metric_id, mv.period, a.kind, a.scope_id
    )
    INSERT INTO metric_coverage (release_id, metric_id, period, kind, scope_id, with_value, total)
    SELECT p_release_id, v.metric_id, v.period, v.kind, v.scope_id, v.n, t.n
    FROM valued v JOIN total t ON t.kind = v.kind AND t.scope_id = v.scope_id;
    GET DIAGNOSTICS written = ROW_COUNT;
    RETURN written;
END;
$$;

-- 124's body, with the coverage rebuilt beside the ranks before the release goes live.
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
    PERFORM rebuild_metric_coverage(p_release_id);
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
SELECT rebuild_metric_coverage(release_id) FROM active_product_release;
