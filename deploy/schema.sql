CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE source_release (
    id text PRIMARY KEY,
    source_url text NOT NULL,
    retrieved_at timestamptz NOT NULL,
    release_date date NOT NULL,
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    licence text NOT NULL,
    attribution text NOT NULL,
    transformation_version text NOT NULL,
    geography_vintage text NOT NULL,
    validation_status text NOT NULL CHECK (validation_status = 'passed'),
    caveats text[] NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION reject_source_release_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Source releases are immutable';
END;
$$;

CREATE TRIGGER source_release_immutable
BEFORE UPDATE OR DELETE ON source_release
FOR EACH ROW EXECUTE FUNCTION reject_source_release_change();

CREATE TYPE geography_kind AS ENUM ('lsoa', 'msoa', 'borough');
CREATE TYPE metric_quality AS ENUM ('observed', 'fallback', 'suppressed');

CREATE TABLE area_geography (
    id text PRIMARY KEY CHECK (id ~ '^uk:(lsoa|msoa|borough):E[0-9]{8}$'),
    kind geography_kind NOT NULL,
    official_code text NOT NULL UNIQUE CHECK (official_code ~ '^E[0-9]{8}$'),
    name text NOT NULL,
    parent_id text REFERENCES area_geography(id),
    geometry geometry(MultiPolygon, 4326) NOT NULL
);

CREATE INDEX area_geography_geometry_gix ON area_geography USING gist (geometry);

CREATE TABLE metric_definition (
    id text PRIMARY KEY,
    carrier geography_kind NOT NULL,
    unit text NOT NULL,
    direction text NOT NULL CHECK (direction IN ('higher-is-more', 'higher-is-better', 'neutral')),
    definition jsonb NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE TABLE metric_value (
    geography_id text NOT NULL REFERENCES area_geography(id),
    metric_id text NOT NULL REFERENCES metric_definition(id),
    period date NOT NULL,
    value double precision,
    london_percentile smallint CHECK (london_percentile BETWEEN 0 AND 100),
    england_percentile smallint CHECK (england_percentile BETWEEN 0 AND 100),
    sample_count integer CHECK (sample_count IS NULL OR sample_count >= 0),
    quality metric_quality NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (geography_id, metric_id, period)
);

CREATE INDEX metric_value_lookup_idx ON metric_value (metric_id, period, geography_id);

CREATE TABLE factor_utility (
    geography_id text NOT NULL REFERENCES area_geography(id),
    factor_id text NOT NULL,
    period date NOT NULL,
    utility double precision NOT NULL CHECK (utility BETWEEN 0 AND 100),
    raw_value double precision NOT NULL,
    unit text NOT NULL,
    carrier_geography_id text NOT NULL REFERENCES area_geography(id),
    quality metric_quality NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (geography_id, factor_id, period)
);

CREATE INDEX factor_utility_lookup_idx ON factor_utility (factor_id, period, geography_id);

CREATE TABLE property (
    uprn text PRIMARY KEY CHECK (uprn ~ '^[0-9]+$'),
    address text NOT NULL,
    geography_id text NOT NULL REFERENCES area_geography(id),
    location geometry(Point, 4326) NOT NULL
);

CREATE INDEX property_location_gix ON property USING gist (location);

CREATE TABLE property_transaction (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uprn text NOT NULL REFERENCES property(uprn),
    completion_date date NOT NULL,
    nominal_price integer NOT NULL CHECK (nominal_price > 0),
    floor_area_square_metres double precision CHECK (floor_area_square_metres > 0),
    cpih_index double precision NOT NULL CHECK (cpih_index > 0),
    local_price_per_square_metre double precision CHECK (local_price_per_square_metre > 0),
    source_release_id text NOT NULL REFERENCES source_release(id),
    UNIQUE (uprn, completion_date, nominal_price)
);

CREATE TABLE school (
    urn text PRIMARY KEY CHECK (urn ~ '^[0-9]{6}$'),
    school_id text NOT NULL UNIQUE CHECK (school_id = 'uk:school:' || urn),
    name text NOT NULL,
    phase text NOT NULL CHECK (phase IN ('primary', 'secondary')),
    attributes jsonb NOT NULL,
    location geometry(Point, 4326) NOT NULL,
    predecessor_urn text REFERENCES school(urn),
    successor_urn text REFERENCES school(urn),
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE INDEX school_location_gix ON school USING gist (location);

CREATE TABLE school_observation (
    urn text NOT NULL REFERENCES school(urn),
    observation_kind text NOT NULL,
    academic_year text NOT NULL,
    value jsonb NOT NULL,
    cohort_size integer CHECK (cohort_size IS NULL OR cohort_size >= 0),
    confidence_interval numrange,
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (urn, observation_kind, academic_year, source_release_id)
);

CREATE TABLE school_admission_observation (
    urn text NOT NULL REFERENCES school(urn),
    academic_year text NOT NULL,
    rule_id text NOT NULL,
    school_site_id text NOT NULL,
    measurement_method text NOT NULL,
    last_offer_distance_metres integer CHECK (last_offer_distance_metres >= 0),
    source_url text NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (urn, academic_year, rule_id, school_site_id)
);

CREATE TABLE school_priority_area (
    urn text NOT NULL REFERENCES school(urn),
    academic_year text NOT NULL,
    priority_geometry geometry(MultiPolygon, 4326) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (urn, academic_year)
);

CREATE TABLE route_network_release (
    id text PRIMARY KEY,
    osm_source_release_id text NOT NULL REFERENCES source_release(id),
    timetable_source_release_id text NOT NULL REFERENCES source_release(id),
    service_date date NOT NULL,
    r5_version text NOT NULL,
    otp_version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE travel_time_matrix (
    network_release_id text NOT NULL REFERENCES route_network_release(id),
    geography_id text NOT NULL REFERENCES area_geography(id),
    destination_cell text NOT NULL,
    arrival_band text NOT NULL,
    mode text NOT NULL CHECK (mode IN ('transit', 'walk', 'cycle', 'car')),
    median_minutes smallint,
    p10_minutes smallint,
    p90_minutes smallint,
    transfers smallint,
    walking_minutes smallint,
    unreachable boolean NOT NULL,
    PRIMARY KEY (network_release_id, geography_id, destination_cell, arrival_band, mode)
);

CREATE TABLE forecast_run (
    id text PRIMARY KEY,
    metric_id text NOT NULL REFERENCES metric_definition(id),
    training_start date NOT NULL,
    training_end date NOT NULL,
    model_version text NOT NULL,
    backtest jsonb NOT NULL,
    source_release_ids text[] NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE price_forecast (
    forecast_run_id text NOT NULL REFERENCES forecast_run(id),
    geography_id text NOT NULL REFERENCES area_geography(id),
    carrier_geography_id text NOT NULL REFERENCES area_geography(id),
    horizon text NOT NULL CHECK (horizon IN ('1y', '5y')),
    status text NOT NULL CHECK (status IN ('available', 'insufficient-history', 'failed-backtest')),
    p10 double precision,
    p20 double precision,
    p50 double precision,
    p90 double precision,
    scenarios jsonb,
    suppression_reason text,
    PRIMARY KEY (forecast_run_id, geography_id, horizon)
);

CREATE TABLE profile_analytics_event (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    market text NOT NULL CHECK (market IN ('buy', 'rent')),
    budget_band integer NOT NULL,
    bedrooms smallint NOT NULL,
    forecast_horizon text NOT NULL CHECK (forecast_horizon IN ('1y', '5y')),
    factor_weights jsonb NOT NULL,
    destination_count smallint NOT NULL,
    destination_modes text[] NOT NULL,
    school_phases text[] NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_release (
    id text PRIMARY KEY,
    geography_vintage text NOT NULL,
    transformation_versions jsonb NOT NULL,
    assets jsonb NOT NULL,
    validation_status text NOT NULL DEFAULT 'pending'
        CHECK (validation_status IN ('pending', 'passed', 'failed')),
    validation_record jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_release_member (
    release_id text NOT NULL REFERENCES product_release(id),
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (release_id, source_release_id)
);

CREATE TABLE active_product_release (
    singleton boolean PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    release_id text NOT NULL REFERENCES product_release(id),
    previous_release_id text REFERENCES product_release(id),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_release_activation (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    release_id text NOT NULL REFERENCES product_release(id),
    previous_release_id text REFERENCES product_release(id),
    activated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION reject_product_release_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Product releases are immutable';
END;
$$;

CREATE TRIGGER product_release_immutable
BEFORE UPDATE OR DELETE ON product_release
FOR EACH ROW EXECUTE FUNCTION reject_product_release_change();

CREATE TRIGGER product_release_member_immutable
BEFORE UPDATE OR DELETE ON product_release_member
FOR EACH ROW EXECUTE FUNCTION reject_product_release_change();

CREATE FUNCTION activate_product_release(p_release_id text)
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

CREATE FUNCTION rollback_product_release()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    current_id text;
    previous_id text;
BEGIN
    SELECT active.release_id, active.previous_release_id
    INTO current_id, previous_id FROM active_product_release active;
    IF NOT FOUND OR previous_id IS NULL THEN
        RAISE EXCEPTION 'No previous release to roll back to';
    END IF;
    UPDATE active_product_release
    SET release_id = previous_id, previous_release_id = current_id, updated_at = now();
    INSERT INTO product_release_activation (release_id, previous_release_id)
    VALUES (previous_id, current_id);
    RETURN previous_id;
END;
$$;

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
        -- The envelope in 4326 uses area_geography_geometry_gix; kinds follow the map's zoom (migration 105).
        WHERE g.geometry && ST_Transform(bounds.geometry, 4326)
          AND (g.kind = 'borough' OR (g.kind = 'msoa' AND z >= 9) OR (g.kind = 'lsoa' AND z >= 11))
    )
    SELECT ST_AsMVT(tile_features, 'area_geometry', 4096, 'geometry')
    FROM tile_features;
$$;

CREATE TABLE correction_report (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    observation_id text,
    product_release_id text REFERENCES product_release(id),
    source_release_id text REFERENCES source_release(id),
    kind text NOT NULL CHECK (kind IN ('publisher-error', 'transformation-error')),
    description text CHECK (description IS NULL OR char_length(description) <= 2000),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        observation_id IS NOT NULL
        OR product_release_id IS NOT NULL
        OR source_release_id IS NOT NULL
    )
);
