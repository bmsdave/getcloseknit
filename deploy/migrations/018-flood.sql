-- Flood risk (Environment Agency NaFRA2, 2025): Risk of Flooding from Rivers
-- and Sea and Risk of Flooding from Surface Water, clipped to London.
-- Bands: 1 very low (< 0.1% a year), 2 low (0.1-1%), 3 medium (1-3.3%),
-- 4 high (> 3.3%). Land outside every mapped band is very low.

CREATE TABLE flood_zone (
    id bigserial PRIMARY KEY,
    source text NOT NULL CHECK (source IN ('rivers-sea', 'surface-water')),
    band smallint NOT NULL CHECK (band BETWEEN 1 AND 4),
    geom geometry(MultiPolygon, 27700) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX flood_zone_geom_gix ON flood_zone USING gist (geom);

-- Rivers, lakes and reservoirs (OpenStreetMap). The EA maps open water itself
-- as high risk, so it is left out of an area's land before shares are taken.
CREATE TABLE flood_water (
    id bigserial PRIMARY KEY,
    geom geometry(MultiPolygon, 27700) NOT NULL
);
CREATE INDEX flood_water_geom_gix ON flood_water USING gist (geom);

-- Band at each dwelling's OS Open UPRN point (highest band the point falls in).
CREATE TABLE dwelling_flood (
    uprn text PRIMARY KEY,
    rivers_sea_band smallint NOT NULL CHECK (rivers_sea_band BETWEEN 1 AND 4),
    surface_water_band smallint NOT NULL CHECK (surface_water_band BETWEEN 1 AND 4),
    source_release_id text NOT NULL REFERENCES source_release(id)
);

-- Land area (open water left out) of each LSOA, MSOA and borough, and how much
-- of it is in the low, medium and high bands. Very low is the rest of the land.
CREATE TABLE area_flood (
    geography_id text NOT NULL REFERENCES area_geography(id),
    source text NOT NULL CHECK (source IN ('rivers-sea', 'surface-water')),
    area_m2 double precision NOT NULL CHECK (area_m2 > 0),
    low_m2 double precision NOT NULL CHECK (low_m2 >= 0),
    medium_m2 double precision NOT NULL CHECK (medium_m2 >= 0),
    high_m2 double precision NOT NULL CHECK (high_m2 >= 0),
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (geography_id, source)
);

-- Rebuild dwelling_flood and area_flood from flood_zone. Polygons are cut into
-- small pieces first so point and area lookups stay fast. Each LSOA's land is
-- intersected once; MSOAs and boroughs are sums of the LSOAs they contain.
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

    CREATE TEMP TABLE flood_lsoa ON COMMIT DROP AS
        SELECT l.id, l.parent_id, coalesce(ST_Difference(l.geom, w.geom), l.geom) AS geom
        FROM (SELECT id, parent_id, ST_Transform(geometry, 27700) AS geom
              FROM area_geography WHERE kind = 'lsoa') l
        LEFT JOIN LATERAL (SELECT ST_Union(geom) AS geom FROM flood_water
                           WHERE ST_Intersects(flood_water.geom, l.geom)) w ON true;
    DELETE FROM flood_lsoa WHERE ST_Area(geom) <= 0;
    CREATE INDEX ON flood_lsoa USING gist (geom);
    ANALYZE flood_lsoa;

    DELETE FROM area_flood;
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
