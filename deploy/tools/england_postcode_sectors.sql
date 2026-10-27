-- England postcode sectors and districts (057's postcode_sector / postcode_district) from ONSPD points.
--
-- London draws its sectors from its address spine (rebuild_zone_analytics, 057); England has no spine, so
-- each live English postcode's ONSPD grid point stands in. Same method: Voronoi cells around the points,
-- each cell to the sector with most postcodes at that point, cells unioned per sector, clipped to land
-- (the LADs the sector touches); districts are the union of their sectors. The Voronoi runs per postcode
-- area with every point within 3 km of the area as context, so neighbouring areas' cells meet without
-- overlapping. London's own rows are kept (ON CONFLICT DO NOTHING).
--
-- Input: a table england_postcode_point (postcode text, east integer, north integer, lsoa_code text) of live
-- English postcodes (etl_england_prices.py sectors loads it from postcodes.tsv.gz). Run with
--   psql -v ON_ERROR_STOP=1 -1 -f england_postcode_sectors.sql

CREATE TEMP TABLE zp ON COMMIT DROP AS
SELECT p.postcode, left(p.postcode, length(p.postcode) - 2) AS sector, split_part(p.postcode, ' ', 1) AS district,
       substring(p.postcode FROM '^[A-Z]+') AS area,
       ST_SetSRID(ST_MakePoint(p.east, p.north), 27700) AS point, 'uk:lsoa:' || p.lsoa_code AS lsoa_id
FROM england_postcode_point p
WHERE p.postcode ~ '^[A-Z]{1,2}[0-9][0-9A-Z]? [0-9][A-Z]{2}$' AND p.east > 0 AND p.north > 0;
CREATE INDEX ON zp USING gist (point);
CREATE INDEX ON zp (area);
ANALYZE zp;

CREATE TEMP TABLE zcell (sector text, district text, cell geometry) ON COMMIT DROP;

DO $$
DECLARE
    a text;
BEGIN
    FOR a IN SELECT DISTINCT area FROM zp ORDER BY 1 LOOP
        INSERT INTO zcell (sector, district, cell)
        WITH own AS (
            SELECT ST_Expand(ST_Extent(point)::geometry, 3000) AS box FROM zp WHERE area = a
        ), cells AS (
            SELECT row_number() OVER () AS id, d.geom AS cell
            FROM (SELECT ST_VoronoiPolygons(ST_Collect(z.point), 0, ST_Expand(own.box, 2000)) AS cells
                  FROM zp z, own WHERE z.point && own.box GROUP BY own.box) v,
                 LATERAL ST_Dump(v.cells) d
        ), held AS (
            -- Postcodes sharing a point share a cell: it goes to the sector with most of them.
            SELECT c.id, c.cell, p.sector, p.district,
                   row_number() OVER (PARTITION BY c.id ORDER BY count(*) DESC, p.sector) AS rank
            FROM cells c JOIN zp p ON p.area = a AND ST_Intersects(p.point, c.cell)
            GROUP BY c.id, c.cell, p.sector, p.district
        )
        SELECT sector, district, cell FROM held WHERE rank = 1;
    END LOOP;
END $$;

-- Land: England's LADs as small pieces, so clipping a sector to the coast stays cheap.
CREATE TEMP TABLE zland ON COMMIT DROP AS
SELECT ST_Subdivide(ST_Union(ST_Transform(geometry, 27700), 1), 256) AS geom
FROM area_geography WHERE kind = 'lad';
CREATE INDEX ON zland USING gist (geom);

CREATE TEMP TABLE zsector ON COMMIT DROP AS
WITH shapes AS (
    SELECT sector, min(district) AS district, ST_Union(ST_MakeValid(cell), 0.01) AS geometry
    FROM zcell GROUP BY sector
), clipped AS (
    SELECT s.sector, s.district,
           (SELECT ST_Union(ST_Intersection(s.geometry, l.geom), 0.01) FROM zland l
             WHERE l.geom && s.geometry) AS land, s.geometry
    FROM shapes s
)
SELECT sector, district,
       ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(
           CASE WHEN land IS NULL OR ST_IsEmpty(land) THEN geometry ELSE land END, 5)), 3)) AS geometry
FROM clipped;

INSERT INTO postcode_sector (code, slug, district, name, borough_id, postcode_count, geometry, label_point)
WITH facts AS (
    SELECT p.sector, count(*) AS postcodes,
           mode() WITHIN GROUP (ORDER BY lsoa.parent_id) AS msoa_id,
           mode() WITHIN GROUP (ORDER BY msoa.parent_id) AS borough_id
    FROM zp p
    JOIN area_geography lsoa ON lsoa.id = p.lsoa_id
    JOIN area_geography msoa ON msoa.id = lsoa.parent_id
    GROUP BY p.sector
)
SELECT s.sector, replace(s.sector, ' ', '-'), s.district, coalesce(lab.friendly_name, m.name), f.borough_id,
       f.postcodes, ST_Transform(s.geometry, 4326), ST_Transform(ST_PointOnSurface(s.geometry), 4326)
FROM zsector s
JOIN facts f ON f.sector = s.sector
LEFT JOIN area_geography m ON m.id = f.msoa_id
LEFT JOIN area_label lab ON lab.geography_id = f.msoa_id
WHERE NOT ST_IsEmpty(s.geometry)
ON CONFLICT (code) DO NOTHING;

INSERT INTO postcode_district (code, slug, name, borough_id, postcode_count, geometry, label_point)
WITH facts AS (
    SELECT p.district, count(*) AS postcodes,
           mode() WITHIN GROUP (ORDER BY lsoa.parent_id) AS msoa_id,
           mode() WITHIN GROUP (ORDER BY msoa.parent_id) AS borough_id
    FROM zp p
    JOIN area_geography lsoa ON lsoa.id = p.lsoa_id
    JOIN area_geography msoa ON msoa.id = lsoa.parent_id
    GROUP BY p.district
), shapes AS (
    SELECT district, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Union(geometry)), 3)) AS geometry
    FROM zsector GROUP BY district
)
SELECT f.district, f.district, coalesce(lab.friendly_name, m.name), f.borough_id, f.postcodes,
       ST_Transform(s.geometry, 4326), ST_Transform(ST_PointOnSurface(s.geometry), 4326)
FROM facts f
JOIN shapes s ON s.district = f.district
LEFT JOIN area_geography m ON m.id = f.msoa_id
LEFT JOIN area_label lab ON lab.geography_id = f.msoa_id
WHERE NOT ST_IsEmpty(s.geometry)
ON CONFLICT (code) DO NOTHING;
