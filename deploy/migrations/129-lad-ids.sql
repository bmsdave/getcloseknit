-- 129: LAD ids, step R2 of docs/architecture/global-geography.md (§10-11), 2026-10-27.
--   uk:borough:<code> -> uk:lad:<code>   area_geography and every column holding an area id
--   geo_level url_segment of lad          borough -> lad (/area/lad/<code>)
-- The old id stays a row of area_alias for ever: the API reads it as the new one on every route, body and tool
-- (api/area_api/kinds.py, id_alias.py), the web sends /area/borough/<code> on to /area/lad/<code> with a 301.
-- Area tiles keep their kind 'borough' (area_shape*.kind, area_tile, PMTiles file and layer names): the tiles carry
-- the code's number (fid), not the id, so their bytes do not change; renaming the kind is step 7.
-- One transaction (migrate.sh). The foreign keys to area_geography become DEFERRABLE (a catalogue change; they are
-- still checked at once unless deferred) and are deferred here, then every column is rewritten through the ~300
-- old ids (the referencing indexes lead with the id; metric_value: ~80k rows). Columns without a foreign key that
-- hold area ids are listed below (found by scanning prod, 2026-10-27; product_event.props is history, left as
-- logged). Function bodies naming 'uk:borough:' are rewritten as in 121. Safe to run again: a second run finds no
-- old id. Rollback: the same with the two prefixes swapped and the alias rows deleted.

SET lock_timeout = '60s';

DO $$
DECLARE
    c record;
BEGIN
    FOR c IN
        SELECT k.conrelid::regclass AS tbl, k.conname
        FROM pg_constraint k
        WHERE k.contype = 'f' AND k.confrelid = 'area_geography'::regclass AND NOT k.condeferrable
    LOOP
        EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY IMMEDIATE', c.tbl, c.conname);
    END LOOP;
END $$;

SET CONSTRAINTS ALL DEFERRED;
-- Area geography rows are immutable (001, 123): this rename is the one sanctioned change of an id.
ALTER TABLE area_geography DISABLE TRIGGER area_geography_immutable;

CREATE TEMP TABLE lad_rename ON COMMIT DROP AS
SELECT id AS old_id, 'uk:lad:' || substr(id, length('uk:borough:') + 1) AS new_id
FROM area_geography WHERE id LIKE 'uk:borough:%';
ANALYZE lad_rename;

DO $$
DECLARE
    c record;
    n bigint;
    total bigint := 0;
BEGIN
    UPDATE area_geography g SET id = r.new_id FROM lad_rename r WHERE g.id = r.old_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '129: % LAD ids renamed', n;
    FOR c IN
        SELECT k.conrelid::regclass AS tbl, a.attname AS col
        FROM pg_constraint k
        JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
        WHERE k.contype = 'f' AND k.confrelid = 'area_geography'::regclass AND k.conrelid <> 'area_alias'::regclass
        ORDER BY 1, 2
    LOOP
        EXECUTE format('UPDATE %s t SET %I = r.new_id FROM lad_rename r WHERE t.%I = r.old_id', c.tbl, c.col, c.col);
        GET DIAGNOSTICS n = ROW_COUNT;
        total := total + n;
    END LOOP;
    RAISE NOTICE '129: % referencing rows rewritten', total;
    -- Area ids outside a foreign key (derived tables, the tile shapes, zone indexes).
    FOR c IN
        SELECT table_name AS tbl, column_name AS col
        FROM information_schema.columns
        WHERE table_schema = 'public' AND (table_name, column_name) IN (
            ('area_label', 'geography_id'), ('area_market', 'geography_id'), ('area_noise', 'geography_id'),
            ('area_price_growth', 'geography_id'), ('area_price_year', 'geography_id'),
            ('area_recent_sale', 'borough_id'), ('area_shape', 'id'), ('area_shape', 'parent_id'),
            ('area_shape_zoom', 'id'), ('zone_price_index', 'zone_code'))
    LOOP
        EXECUTE format('UPDATE %I SET %I = ''uk:lad:'' || substr(%I, %s) WHERE %I LIKE ''uk:borough:%%''',
                       c.tbl, c.col, c.col, length('uk:borough:') + 1, c.col);
    END LOOP;
END $$;

INSERT INTO area_alias (alias_id, area_id)
SELECT old_id, new_id FROM lad_rename
ON CONFLICT (alias_id) DO UPDATE SET area_id = EXCLUDED.area_id;

UPDATE geo_level SET url_segment = 'lad' WHERE ns = 'uk' AND kind = 'lad';

-- The deferred checks run here, before the trigger comes back (ALTER TABLE refuses pending trigger events).
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE area_geography ENABLE TRIGGER area_geography_immutable;

-- Function bodies that build LAD ids from codes, and the notices counting carriers read from ids.
DO $$
DECLARE
    f record;
    def text;
    fixed text;
BEGIN
    FOR f IN
        SELECT p.oid FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
          AND p.prosrc ~ '(uk:borough:|carrier = ''borough'')'
    LOOP
        def := pg_get_functiondef(f.oid);
        fixed := replace(def, 'uk:borough:', 'uk:lad:');
        fixed := replace(fixed, '(WHERE carrier = ''borough'')', '(WHERE carrier = ''lad'')');
        fixed := replace(fixed, '(WHERE index_carrier = ''borough'')', '(WHERE index_carrier = ''lad'')');
        IF fixed <> def THEN
            EXECUTE fixed;
        END IF;
    END LOOP;
END $$;

-- Nothing may still name an old id outside area_alias.
DO $$
DECLARE
    left_over bigint;
BEGIN
    SELECT count(*) INTO left_over FROM area_geography WHERE id LIKE 'uk:borough:%' OR parent_id LIKE 'uk:borough:%';
    IF left_over > 0 THEN
        RAISE EXCEPTION '129: % area_geography rows still name uk:borough:', left_over;
    END IF;
END $$;
