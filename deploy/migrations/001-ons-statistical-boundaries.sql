-- 001: immutable ONS 2021 statistical boundaries for London.
--
-- Applies after schema.sql. Boundary rows use stable uk:<kind>:<official-code>
-- identifiers, carry validated MultiPolygon geometry in SRID 4326, and keep a
-- reconciled LSOA to MSOA to London borough hierarchy. Rows are insert-only:
-- a new ONS release lands as new rows, never as an update. Martin publishes
-- the public.area_geometry function below as ordinary TileJSON/MVT.
--
-- Hierarchy rule: lsoa rows reference an msoa parent, msoa rows reference a
-- borough parent, borough rows have no parent and must be London LAD codes.

CREATE OR REPLACE FUNCTION reject_area_geography_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Area geography releases are immutable';
END;
$$;

DROP TRIGGER IF EXISTS area_geography_immutable ON area_geography;

CREATE TRIGGER area_geography_immutable
BEFORE UPDATE OR DELETE ON area_geography
FOR EACH ROW EXECUTE FUNCTION reject_area_geography_change();

CREATE OR REPLACE FUNCTION enforce_geography_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    parent_kind geography_kind;
    london_codes text[] := ARRAY[
        'E09000001','E09000002','E09000003','E09000004','E09000005',
        'E09000006','E09000007','E09000008','E09000009','E09000010',
        'E09000011','E09000012','E09000013','E09000014','E09000015',
        'E09000016','E09000017','E09000018','E09000019','E09000020',
        'E09000021','E09000022','E09000023','E09000024','E09000025',
        'E09000026','E09000027','E09000028','E09000029','E09000030',
        'E09000031','E09000032','E09000033'
    ];
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
    IF NEW.kind = 'borough' THEN
        IF NEW.parent_id IS NOT NULL THEN
            RAISE EXCEPTION 'Borough rows must not have a parent';
        END IF;
        IF NOT (NEW.official_code = ANY (london_codes)) THEN
            RAISE EXCEPTION 'Borough is not a London borough: %', NEW.official_code;
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.parent_id IS NULL THEN
        RAISE EXCEPTION 'Non-borough rows must reference a parent';
    END IF;
    SELECT kind INTO parent_kind FROM area_geography WHERE id = NEW.parent_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent geography does not exist: %', NEW.parent_id;
    END IF;
    IF NEW.kind = 'lsoa' AND parent_kind != 'msoa' THEN
        RAISE EXCEPTION 'LSOA rows must reference an MSOA parent';
    END IF;
    IF NEW.kind = 'msoa' AND parent_kind != 'borough' THEN
        RAISE EXCEPTION 'MSOA rows must reference a borough parent';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS area_geography_hierarchy ON area_geography;

CREATE TRIGGER area_geography_hierarchy
BEFORE INSERT OR UPDATE ON area_geography
FOR EACH ROW EXECUTE FUNCTION enforce_geography_hierarchy();

CREATE OR REPLACE FUNCTION public.area_geometry(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
    WITH bounds AS (
        SELECT ST_TileEnvelope(z, x, y) AS geometry
    ), tile_features AS (
        SELECT
            g.id,
            g.kind::text,
            g.name,
            ST_AsMVTGeom(ST_Transform(g.geometry, 3857), bounds.geometry) AS geometry
        FROM area_geography g, bounds
        WHERE ST_Transform(g.geometry, 3857) && bounds.geometry
    )
    SELECT ST_AsMVT(tile_features, 'area_geometry', 4096, 'geometry')
    FROM tile_features;
$$;
