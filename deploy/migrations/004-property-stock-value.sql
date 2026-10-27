-- 004: house-level stock value.
--
-- A dwelling gains a real UPRN through its EPC certificate (matched by the
-- same postcode + address key as the address spine), an exact coordinate from
-- OS Open UPRN, and its freehold parcel from HM Land Registry INSPIRE index
-- polygons. property_stock_value restates the dwelling's last achieved £/m²
-- by the change in its carrier's rolling median £/m² since the sale: a
-- restated sale with a confidence band, never a valuation.

ALTER TABLE property
    ADD COLUMN address_id text REFERENCES address(id),
    ADD COLUMN source_release_id text REFERENCES source_release(id);

CREATE INDEX property_address_idx ON property (address_id);

CREATE TABLE parcel (
    id text PRIMARY KEY,
    authority_code text NOT NULL CHECK (authority_code ~ '^E09[0-9]{6}$'),
    geometry geometry(Polygon, 4326) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE INDEX parcel_geometry_gix ON parcel USING gist (geometry);

ALTER TABLE property ADD COLUMN parcel_id text REFERENCES parcel(id);
CREATE INDEX property_parcel_idx ON property (parcel_id);

CREATE TABLE property_stock_value (
    uprn text PRIMARY KEY REFERENCES property(uprn),
    period date NOT NULL,
    sale_period date NOT NULL,
    completion_date date NOT NULL,
    nominal_price integer NOT NULL CHECK (nominal_price > 0),
    floor_area_square_metres double precision NOT NULL CHECK (floor_area_square_metres > 0),
    sale_price_per_square_metre double precision NOT NULL CHECK (sale_price_per_square_metre > 0),
    index_carrier text NOT NULL CHECK (index_carrier IN ('lsoa', 'msoa', 'borough')),
    index_geography_id text NOT NULL REFERENCES area_geography(id),
    index_at_sale double precision NOT NULL CHECK (index_at_sale > 0),
    index_latest double precision NOT NULL CHECK (index_latest > 0),
    restated_price_per_square_metre double precision NOT NULL CHECK (restated_price_per_square_metre > 0),
    restated_value integer NOT NULL CHECK (restated_value > 0),
    confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE INDEX property_stock_value_release_idx ON property_stock_value (source_release_id);

-- Confidence mirrors area_analytics.property_value.confidence_band: high within
-- 3 years on the dwelling's own LSOA index, medium within 8 years or on the
-- MSOA index, otherwise low (including sales older than the index itself).
CREATE OR REPLACE FUNCTION public.stock_value_confidence(
    sale_period date, latest_period date, index_carrier text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN months <= 36 AND index_carrier = 'lsoa' THEN 'high'
        WHEN months <= 96 AND index_carrier IN ('lsoa', 'msoa') THEN 'medium'
        ELSE 'low'
    END
    FROM (SELECT (EXTRACT(YEAR FROM latest_period) - EXTRACT(YEAR FROM sale_period)) * 12
                 + (EXTRACT(MONTH FROM latest_period) - EXTRACT(MONTH FROM sale_period)) AS months) m;
$$;

-- Vector tile of parcels (and parcel-less dwellings as points) carrying the
-- restated £/m² of the active release. Served from zoom 14 up.
CREATE OR REPLACE FUNCTION public.property_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
    WITH bounds AS (
        SELECT ST_TileEnvelope(z, x, y) AS geometry,
               ST_Transform(ST_TileEnvelope(z, x, y), 4326) AS geometry_4326
    ), active AS NOT MATERIALIZED (
        SELECT member.source_release_id
        FROM active_product_release active
        JOIN product_release_member member ON member.release_id = active.release_id
    ), tile_parcels AS (
        SELECT parcel.id, parcel.geometry
        FROM parcel, bounds
        WHERE parcel.geometry && bounds.geometry_4326
    ), valued AS NOT MATERIALIZED (
        SELECT p.uprn, p.parcel_id, p.address_id, p.location, p.address,
               v.restated_price_per_square_metre AS ppm, v.restated_value AS value,
               v.confidence, v.sale_period
        FROM property p
        JOIN property_stock_value v ON v.uprn = p.uprn
        WHERE v.source_release_id IN (SELECT source_release_id FROM active)
    ), parcels AS (
        SELECT tp.id, tp.geometry,
               count(valued.uprn) AS dwellings,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY valued.ppm) AS ppm,
               sum(valued.value)::bigint AS value,
               min(valued.confidence) AS confidence,
               max(valued.sale_period)::text AS latest_sale,
               (array_agg(valued.address_id ORDER BY valued.value DESC))[1] AS address_id,
               (array_agg(valued.uprn ORDER BY valued.value DESC))[1] AS uprn
        FROM tile_parcels tp
        JOIN valued ON valued.parcel_id = tp.id
        GROUP BY tp.id, tp.geometry
    ), parcel_features AS (
        SELECT parcels.id, parcels.dwellings, round(parcels.ppm) AS ppm, parcels.value, parcels.confidence,
               parcels.latest_sale, parcels.address_id, parcels.uprn,
               ST_AsMVTGeom(ST_Transform(parcels.geometry, 3857), bounds.geometry) AS geometry
        FROM parcels, bounds
    ), point_features AS (
        SELECT valued.uprn, valued.address_id, valued.address, round(valued.ppm) AS ppm,
               valued.value, valued.confidence, valued.sale_period::text AS latest_sale,
               ST_AsMVTGeom(ST_Transform(valued.location, 3857), bounds.geometry) AS geometry
        FROM valued, bounds
        WHERE valued.parcel_id IS NULL
          AND valued.location && bounds.geometry_4326
    )
    SELECT coalesce((SELECT ST_AsMVT(parcel_features, 'parcels', 4096, 'geometry') FROM parcel_features), ''::bytea)
        || coalesce((SELECT ST_AsMVT(point_features, 'dwellings', 4096, 'geometry') FROM point_features), ''::bytea);
$$;
