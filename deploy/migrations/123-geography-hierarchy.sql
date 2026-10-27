-- 123: the geography hierarchy, steps 1-3 of docs/architecture/global-geography.md (§3, §11). The country, England
-- and its regions become area_geography rows above the LADs, each one's shape the union of its LSOAs (one coverage,
-- as the map's area_shape, migration 119), and the parent chain runs LSOA > MSOA > LAD > region > nation > country.
--
-- Step 1  rows uk:country:GB, uk:nation:E92000001 and uk:region:E12000001..9 (kinds from migration 122); a LAD's
--         parent is its region (lad_region, migration 103, stays the LAD -> region lookup). The id and code checks
--         take any namespace (§3.2).
-- Step 2  area_geography.region_id and country_id: the ancestor at the level that ranks (geo_level.rank_region) and
--         the root, filled by the ancestors trigger on insert and by refresh_geography_tree() for what exists.
--         area_region is now a view over region_id (same columns and rows), so every reader keeps working; the
--         table, its fill trigger and refresh_area_region() are gone.
-- Step 3  geo_level (the levels of each namespace), scope_grant (the places a flag serves: London without one,
--         England with CLOSE_KNIT_ENGLAND; read from step 4), area_alias, area_xref and boundary_set.
--
-- refresh_geography_tree() builds the rows above the LADs from the LSOAs there are, gives each LAD without a parent
-- its region and fills region_id/country_id down the tree. An insert of LSOAs or LADs runs it (statement trigger
-- area_geography_tree), so a geography load needs no extra step. area_geography stays insert-only except for what
-- the tree derives: region_id, country_id, a LAD's first parent and the shapes of the levels built from children.
-- area_tile_release() hashes the tile kinds only, so the stored tiles stay current.
--
-- The proof runs here: region_id gives every area the region area_region held (else the migration stops) and
-- every LAD has a region. Rollback, with the code (the old API would list the new rows in search): turn the view
-- back into a table (CREATE TABLE ... AS SELECT * FROM area_region), drop the trigger area_geography_tree and
-- re-create 103's area_region_fill; then, with area_geography_immutable disabled, set the LADs' parent_id to NULL
-- and delete the rows of kind region, nation and country. Safe to run again.

-- Step 3: configuration (the triggers below read geo_level).
CREATE TABLE IF NOT EXISTS geo_level (
    ns text NOT NULL CHECK (ns ~ '^[a-z0-9]{2,5}$'),
    kind text NOT NULL,
    depth smallint NOT NULL CHECK (depth >= 0),                -- 0 = the country, growing downwards
    role text NOT NULL CHECK (role IN ('admin', 'stat', 'grid')),
    parent_kind text,                                          -- the main hierarchy
    rank_region boolean NOT NULL DEFAULT false,                -- region_percentile ranks within this level
    url_segment text,                                          -- /area/<segment>/<code>; NULL: no page yet
    label text NOT NULL,
    PRIMARY KEY (ns, kind),
    FOREIGN KEY (ns, parent_kind) REFERENCES geo_level (ns, kind)
);

INSERT INTO geo_level (ns, kind, depth, role, parent_kind, rank_region, url_segment, label) VALUES
    ('uk', 'country', 0, 'admin', NULL, false, NULL, 'Country'),
    ('uk', 'nation', 1, 'admin', 'country', false, NULL, 'Nation'),
    ('uk', 'region', 2, 'admin', 'nation', true, NULL, 'Region'),
    ('uk', 'lad', 3, 'admin', 'region', false, 'borough', 'Local authority district'),
    ('uk', 'msoa', 4, 'stat', 'lad', false, 'msoa', 'Middle layer super output area'),
    ('uk', 'lsoa', 5, 'stat', 'msoa', false, 'lsoa', 'Lower layer super output area')
ON CONFLICT (ns, kind) DO UPDATE SET depth = EXCLUDED.depth, role = EXCLUDED.role, parent_kind = EXCLUDED.parent_kind,
    rank_region = EXCLUDED.rank_region, url_segment = EXCLUDED.url_segment, label = EXCLUDED.label;

-- A place a flag adds to the served scope; flag NULL is the base, served with every flag off (FLAGS.md).
CREATE TABLE IF NOT EXISTS scope_grant (
    flag text CHECK (flag ~ '^CLOSE_KNIT_[A-Z0-9_]+$'),
    area_id text NOT NULL CHECK (area_id ~ '^[a-z0-9]{2,5}:[a-z0-9_]+:[A-Za-z0-9._-]+$'),
    UNIQUE NULLS NOT DISTINCT (flag, area_id)
);

INSERT INTO scope_grant (flag, area_id) VALUES
    (NULL, 'uk:region:E12000007'),
    ('CLOSE_KNIT_ENGLAND', 'uk:nation:E92000001')
ON CONFLICT DO NOTHING;

-- An old id of a place, kept for ever (API and web accept it; the web answers 301).
CREATE TABLE IF NOT EXISTS area_alias (
    alias_id text PRIMARY KEY CHECK (alias_id ~ '^[a-z0-9]{2,5}:[a-z0-9_]+:[A-Za-z0-9._-]+$'),
    area_id text NOT NULL REFERENCES area_geography(id)
);

-- Other systems' ids of a place (wikidata, ons, osm, overture...): looked up, never a key.
CREATE TABLE IF NOT EXISTS area_xref (
    area_id text NOT NULL REFERENCES area_geography(id),
    system text NOT NULL CHECK (system ~ '^[a-z0-9_]+$'),
    ext_id text NOT NULL,
    PRIMARY KEY (area_id, system, ext_id)
);

-- A versioned set of boundaries a level is loaded from.
CREATE TABLE IF NOT EXISTS boundary_set (
    id text PRIMARY KEY,
    ns text NOT NULL,
    kind text NOT NULL,
    source_release_id text REFERENCES source_release(id),
    valid_from date,
    FOREIGN KEY (ns, kind) REFERENCES geo_level (ns, kind)
);

INSERT INTO boundary_set (id, ns, kind, valid_from) VALUES
    ('ons-lsoa-2021-bgc', 'uk', 'lsoa', '2021-03-21'),
    ('ons-msoa-2021-bgc', 'uk', 'msoa', '2021-03-21'),
    ('ons-lad-2026-05-bgc', 'uk', 'lad', '2026-05-01')
ON CONFLICT (id) DO NOTHING;

-- Steps 1-2: the table.
DROP TRIGGER IF EXISTS area_region_fill ON area_geography;
DROP FUNCTION IF EXISTS fill_area_region();

ALTER TABLE area_geography DROP CONSTRAINT IF EXISTS area_geography_id_check;
ALTER TABLE area_geography DROP CONSTRAINT IF EXISTS area_geography_official_code_check;
ALTER TABLE area_geography DROP CONSTRAINT IF EXISTS area_geography_id_format;
ALTER TABLE area_geography ADD CONSTRAINT area_geography_id_format
    CHECK (id ~ '^[a-z0-9]{2,5}:[a-z0-9_]+:[A-Za-z0-9._-]+$');
ALTER TABLE area_geography DROP CONSTRAINT IF EXISTS area_geography_code_format;
ALTER TABLE area_geography ADD CONSTRAINT area_geography_code_format CHECK (official_code ~ '^[A-Za-z0-9._-]+$');
ALTER TABLE area_geography ADD COLUMN IF NOT EXISTS region_id text REFERENCES area_geography(id);
ALTER TABLE area_geography ADD COLUMN IF NOT EXISTS country_id text REFERENCES area_geography(id);
CREATE INDEX IF NOT EXISTS area_geography_region_idx ON area_geography (region_id);

-- One place's region and country: itself at the ranking level and at the root, else its parent's.
CREATE OR REPLACE FUNCTION public.geography_ancestors(p_id text, p_kind text, p_parent_id text)
RETURNS TABLE (region_id text, country_id text)
LANGUAGE sql
STABLE
AS $$
    SELECT CASE WHEN l.rank_region THEN p_id ELSE p.region_id END,
           CASE WHEN l.depth = 0 THEN p_id ELSE p.country_id END
    FROM geo_level l
    LEFT JOIN area_geography p ON p.id = p_parent_id
    WHERE l.ns = split_part(p_id, ':', 1) AND l.kind = p_kind
$$;

CREATE OR REPLACE FUNCTION public.fill_geography_ancestors()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    SELECT a.region_id, a.country_id INTO NEW.region_id, NEW.country_id
    FROM geography_ancestors(NEW.id, NEW.kind::text, NEW.parent_id) a;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS area_geography_ancestors ON area_geography;
CREATE TRIGGER area_geography_ancestors
BEFORE INSERT OR UPDATE OF parent_id ON area_geography
FOR EACH ROW EXECUTE FUNCTION fill_geography_ancestors();

-- As migration 001's, with the levels from geo_level: a parent of the level's parent kind, none at the root. A LAD
-- may come without one: refresh_geography_tree() gives it its region once the region's row exists.
CREATE OR REPLACE FUNCTION public.enforce_geography_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    wanted text;
    found_kind text;
BEGIN
    IF GeometryType(NEW.geometry) != 'MULTIPOLYGON' THEN
        RAISE EXCEPTION 'Area geography geometry must be a MultiPolygon';
    END IF;
    IF ST_SRID(NEW.geometry) != 4326 THEN
        RAISE EXCEPTION 'Area geography geometry must use SRID 4326';
    END IF;
    IF NOT ST_IsValid(NEW.geometry) THEN
        RAISE EXCEPTION 'Area geography geometry is not valid';
    END IF;
    SELECT parent_kind INTO wanted FROM geo_level WHERE ns = split_part(NEW.id, ':', 1) AND kind = NEW.kind::text;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No geo_level for %', NEW.id;
    END IF;
    IF NEW.kind = 'lad' AND NEW.official_code !~ '^E0[6-9][0-9]{6}$' THEN
        RAISE EXCEPTION 'Borough is not an English local authority district: %', NEW.official_code;
    END IF;
    IF NEW.parent_id IS NULL THEN
        IF wanted IS NOT NULL AND NEW.kind <> 'lad' THEN
            RAISE EXCEPTION '% rows must reference a % parent', NEW.kind, wanted;
        END IF;
        RETURN NEW;
    END IF;
    SELECT kind::text INTO found_kind FROM area_geography WHERE id = NEW.parent_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent geography does not exist: %', NEW.parent_id;
    END IF;
    IF found_kind IS DISTINCT FROM wanted THEN
        RAISE EXCEPTION '% rows must reference a % parent, not %', NEW.kind, coalesce(wanted, 'no'), found_kind;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS area_geography_hierarchy ON area_geography;
CREATE TRIGGER area_geography_hierarchy
BEFORE INSERT OR UPDATE OF kind, parent_id, geometry ON area_geography
FOR EACH ROW EXECUTE FUNCTION enforce_geography_hierarchy();

-- Insert-only, except what the tree derives (refresh_geography_tree): region_id and country_id, a LAD's parent while
-- it has none, and the shape of a level built from its children.
CREATE OR REPLACE FUNCTION public.reject_area_geography_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.id, NEW.kind, NEW.official_code, NEW.name) = (OLD.id, OLD.kind, OLD.official_code, OLD.name)
       AND (NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id OR (OLD.parent_id IS NULL AND OLD.kind = 'lad'))
       AND (OLD.kind IN ('region', 'nation', 'country') OR NEW.geometry = OLD.geometry) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Area geography releases are immutable';
END;
$$;

-- The shape of a union of LSOAs (ST_CoverageUnion's output): valid even where test shapes overlap, and in a
-- canonical vertex order, so a shape rebuilt from the same LSOAs in another order compares equal and is left alone.
CREATE OR REPLACE FUNCTION public.geography_union_shape(p_union geometry)
RETURNS geometry
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
    SELECT ST_Normalize(ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(p_union, 4326)), 3)))
$$;

-- The rows above the LADs, the LADs' parents and every row's region_id/country_id. Returns the rows it changed.
CREATE OR REPLACE FUNCTION public.refresh_geography_tree()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    changed integer := 0;
    n integer;
    level_depth smallint;
BEGIN
    -- Each region the union of its LSOAs; England's regions (E12) make up England (E92000001), England the country.
    DROP TABLE IF EXISTS pg_temp.tree_region;
    CREATE TEMP TABLE tree_region ON COMMIT DROP AS
    SELECT 'uk:region:' || r.region_code AS id, r.region_code AS code, min(r.region_name) AS name,
           geography_union_shape(ST_CoverageUnion(l.geometry)) AS geometry
    FROM area_geography l
    JOIN area_geography m ON m.id = l.parent_id
    JOIN area_geography b ON b.id = m.parent_id
    JOIN lad_region r ON r.lad_code = b.official_code
    WHERE l.kind = 'lsoa'
    GROUP BY r.region_code;

    IF EXISTS (SELECT 1 FROM tree_region) THEN
        -- Parents first: the hierarchy trigger checks them.
        INSERT INTO area_geography (id, kind, official_code, name, parent_id, geometry)
        SELECT 'uk:country:GB', 'country', 'GB', 'United Kingdom', NULL,
               geography_union_shape(ST_CoverageUnion(geometry)) FROM tree_region
        ON CONFLICT (id) DO UPDATE SET geometry = EXCLUDED.geometry
        WHERE area_geography.geometry IS DISTINCT FROM EXCLUDED.geometry;
        GET DIAGNOSTICS n = ROW_COUNT; changed := changed + n;
        INSERT INTO area_geography (id, kind, official_code, name, parent_id, geometry)
        SELECT 'uk:nation:E92000001', 'nation', 'E92000001', 'England', 'uk:country:GB',
               geography_union_shape(ST_CoverageUnion(geometry)) FROM tree_region
        ON CONFLICT (id) DO UPDATE SET geometry = EXCLUDED.geometry
        WHERE area_geography.geometry IS DISTINCT FROM EXCLUDED.geometry;
        GET DIAGNOSTICS n = ROW_COUNT; changed := changed + n;
        INSERT INTO area_geography (id, kind, official_code, name, parent_id, geometry)
        SELECT id, 'region', code, name, 'uk:nation:E92000001', geometry FROM tree_region ORDER BY id
        ON CONFLICT (id) DO UPDATE SET geometry = EXCLUDED.geometry
        WHERE area_geography.geometry IS DISTINCT FROM EXCLUDED.geometry;
        GET DIAGNOSTICS n = ROW_COUNT; changed := changed + n;
    END IF;

    -- A LAD's parent is its region, once the region's row exists (the ancestors trigger fills the LAD's own ids).
    UPDATE area_geography g SET parent_id = 'uk:region:' || r.region_code
    FROM lad_region r
    WHERE g.kind = 'lad' AND g.parent_id IS NULL AND r.lad_code = g.official_code
      AND EXISTS (SELECT 1 FROM area_geography p WHERE p.id = 'uk:region:' || r.region_code);
    GET DIAGNOSTICS n = ROW_COUNT; changed := changed + n;

    -- region_id and country_id down the tree, a level at a time (a level reads its parents').
    FOR level_depth IN SELECT DISTINCT depth FROM geo_level ORDER BY depth LOOP
        UPDATE area_geography g SET region_id = a.region_id, country_id = a.country_id
        FROM area_geography c
        JOIN geo_level l ON l.ns = split_part(c.id, ':', 1) AND l.kind = c.kind::text AND l.depth = level_depth
        CROSS JOIN LATERAL geography_ancestors(c.id, c.kind::text, c.parent_id) a
        WHERE g.id = c.id AND (g.region_id, g.country_id) IS DISTINCT FROM (a.region_id, a.country_id);
        GET DIAGNOSTICS n = ROW_COUNT; changed := changed + n;
    END LOOP;
    RETURN changed;
END;
$$;

SELECT refresh_geography_tree();

-- The proof (§11 step 2), then area_region becomes a view over region_id with the same columns and rows.
DO $$
DECLARE
    wrong integer;
    orphans integer;
BEGIN
    IF (SELECT relkind FROM pg_class WHERE oid = 'public.area_region'::regclass) = 'r' THEN
        SELECT count(*) INTO wrong
        FROM area_region a
        FULL JOIN (SELECT g.id, r.official_code, r.name
                   FROM area_geography g JOIN area_geography r ON r.id = g.region_id
                   WHERE g.kind IN ('lsoa', 'msoa', 'lad')) t ON t.id = a.area_id
        WHERE (a.region_code, a.region_name) IS DISTINCT FROM (t.official_code, t.name);
        IF wrong > 0 THEN
            RAISE EXCEPTION '% areas get another region from region_id than area_region holds', wrong;
        END IF;
        DROP TABLE area_region;
    END IF;
    SELECT count(*) INTO orphans FROM area_geography WHERE kind = 'lad' AND region_id IS NULL;
    IF orphans > 0 THEN
        RAISE EXCEPTION '% LADs without a region (lad_region has no row for them)', orphans;
    END IF;
END $$;

DROP FUNCTION IF EXISTS refresh_area_region();

CREATE OR REPLACE VIEW area_region AS
SELECT g.id AS area_id, r.official_code AS region_code, r.name AS region_name
FROM area_geography g
JOIN area_geography r ON r.id = g.region_id
WHERE g.kind IN ('lsoa', 'msoa', 'lad');

-- New LSOAs or LADs (a geography load) rebuild the tree once per statement.
CREATE OR REPLACE FUNCTION public.refresh_geography_tree_after_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM inserted WHERE kind IN ('lsoa', 'lad')) THEN
        PERFORM refresh_geography_tree();
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS area_geography_tree ON area_geography;
CREATE TRIGGER area_geography_tree
AFTER INSERT ON area_geography
REFERENCING NEW TABLE AS inserted
FOR EACH STATEMENT EXECUTE FUNCTION refresh_geography_tree_after_insert();

-- As migration 119's, over the kinds the tiles draw: the rows above the LADs do not change the tile set.
CREATE OR REPLACE FUNCTION public.area_tile_release()
RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
    SELECT 'a2-' || left(md5(string_agg(id, ',' ORDER BY id)), 12) FROM area_geography WHERE kind IN ('lsoa', 'msoa', 'lad')
$$;
