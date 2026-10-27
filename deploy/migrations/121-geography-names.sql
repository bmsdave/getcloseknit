-- 121: geography names, step R1 of docs/architecture/global-geography.md (§10-11), 2026-10-26. Names only, no
-- logic: the "London" percentile always held the area's region's and the "England" one the country's, and the
-- local-authority kind is a LAD everywhere, not only in London.
--   metric_value.london_percentile   -> region_percentile
--   metric_value.england_percentile  -> country_percentile
--   area_london_rank                 -> area_rank (.london_percentile -> .region_percentile)
--   rebuild_area_london_rank()       -> rebuild_area_rank()
--   area_pipeline.london_percentile  -> region_percentile
--   geography_kind 'borough'         -> 'lad'
-- Ids keep uk:borough: and the tile kind keeps 'borough' (both until R2). For one release the old names still
-- answer: a view area_london_rank (old column name, updatable) and a wrapper rebuild_area_london_rank().
-- RENAME is a catalogue change (instant). Ship it in the same deploy as the code that reads the new names;
-- rollback = the reverse renames (and the reverse function rewrite below). Safe to run again; apply with
-- psql --single-transaction -v ON_ERROR_STOP=1.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'metric_value' AND column_name = 'london_percentile') THEN
        ALTER TABLE metric_value RENAME COLUMN london_percentile TO region_percentile;
        ALTER TABLE metric_value RENAME COLUMN england_percentile TO country_percentile;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'area_pipeline' AND column_name = 'london_percentile') THEN
        ALTER TABLE area_pipeline RENAME COLUMN london_percentile TO region_percentile;
    END IF;
    IF to_regclass('public.area_london_rank') IS NOT NULL
       AND (SELECT relkind FROM pg_class WHERE oid = 'public.area_london_rank'::regclass) = 'r' THEN
        ALTER TABLE area_london_rank RENAME TO area_rank;
        ALTER TABLE area_rank RENAME COLUMN london_percentile TO region_percentile;
        ALTER INDEX IF EXISTS area_london_rank_pkey RENAME TO area_rank_pkey;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'geography_kind'::regtype AND enumlabel = 'borough') THEN
        ALTER TYPE geography_kind RENAME VALUE 'borough' TO 'lad';
    END IF;
    IF to_regproc('public.rebuild_area_london_rank') IS NOT NULL AND to_regproc('public.rebuild_area_rank') IS NULL THEN
        ALTER FUNCTION rebuild_area_london_rank() RENAME TO rebuild_area_rank;
    END IF;
END $$;

-- Function bodies are stored as text, so each one naming an old name is rewritten (whatever version this
-- database holds). Only comparisons with the geography_kind enum turn 'borough' into 'lad': text vocabularies
-- keep it (zone kinds in rebuild_zone_analytics, carriers read from ids in rebuild_area_price_bands and
-- rebuild_stock_values). area_tile_mvt keeps its tile kind 'borough' and reads it as the enum's 'lad'.
DO $$
DECLARE
    f record;
    def text;
    fixed text;
BEGIN
    FOR f IN
        SELECT p.oid FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
          AND p.prosrc ~ '(london_percentile|england_percentile|area_london_rank|''borough''|kind::text = area_kind)'
    LOOP
        def := pg_get_functiondef(f.oid);
        fixed := replace(def, 'london_percentile', 'region_percentile');
        fixed := replace(fixed, 'england_percentile', 'country_percentile');
        fixed := replace(fixed, 'area_london_rank', 'area_rank');
        -- Functions on the tile shapes (area_shape, area_shape_zoom: text kinds named as the tiles, migration 119)
        -- keep 'borough'; they never compare the enum with it.
        IF def !~ 'area_shape' THEN
            -- kind = 'borough', NEW.kind = 'borough', parent_kind != 'borough', g.kind::text = 'borough'
            fixed := regexp_replace(fixed, '(\m(parent_)?kind(::text)?\s*(=|!=|<>)\s*)''borough''', '\1''lad''', 'g');
            -- kind IN ('lsoa', 'msoa', 'borough')
            fixed := regexp_replace(fixed, '(\mkind\s+IN\s*\([^)]*)''borough''', '\1''lad''', 'g');
            -- CASE g.kind WHEN 'borough'
            fixed := regexp_replace(fixed, '(CASE\s+\w+\.kind\s+WHEN\s+)''borough''', '\1''lad''', 'g');
        END IF;
        -- a metric_definition row's carrier
        fixed := replace(fixed, 'SELECT k.id, ''borough'', ''%''', 'SELECT k.id, ''lad'', ''%''');
        fixed := replace(fixed, 'VALUES (spec.id, ''borough'', ', 'VALUES (spec.id, ''lad'', ');
        -- the tile kind stays 'borough' (URLs, area_tile rows, the MVT layer name)
        fixed := replace(fixed, 'g.kind::text = area_kind',
                         'g.kind::text = CASE area_kind WHEN ''borough'' THEN ''lad'' ELSE area_kind END');
        IF fixed <> def THEN
            EXECUTE fixed;
        END IF;
    END LOOP;
END $$;

-- The old names for one release (removed with the deprecated API fields, step 11).
DO $$
BEGIN
    IF to_regclass('public.area_rank') IS NOT NULL AND to_regclass('public.area_london_rank') IS NULL THEN
        CREATE VIEW area_london_rank AS
        SELECT geography_id, rank_id, value, region_percentile AS london_percentile, ranked, detail, source_release_id
        FROM area_rank;
    END IF;
    IF to_regproc('public.rebuild_area_rank') IS NOT NULL THEN
        CREATE OR REPLACE FUNCTION rebuild_area_london_rank() RETURNS integer LANGUAGE sql
        AS 'SELECT rebuild_area_rank()';
    END IF;
END $$;
