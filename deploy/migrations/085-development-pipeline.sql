-- Development pipeline and growth areas (open data wave A, source 6; deploy/tools/etl_pipeline.py).
--
--   development_pipeline  London Development Database permissions with net new homes, read from the
--                         Planning London Datahub (GLA, OGL v3): status, net homes, decision and
--                         completion dates and the site's centroid. No applicant, address or description.
--   opportunity_area      London Plan Opportunity Areas and GLA Housing Zones (London Datastore, OGL v3).
--   area_pipeline         per LSOA, MSOA and borough: homes not started, under construction and completed
--                         in the last five years (MSOAs and boroughs are sums of their LSOAs), homes not
--                         started or under construction within 1 km of the area, the rate per 1,000 homes
--                         and its London percentile among areas of the same kind.
--   area_opportunity      each area's land in each Opportunity Area or Housing Zone (sums of LSOAs).
--
-- rebuild_area_pipeline() also publishes the `pipeline-homes-per-1000` map layer (metric_definition and
-- one metric_value row per LSOA), which makes it a range:<layer> criterion in My match.

CREATE TABLE IF NOT EXISTS development_pipeline (
    id text PRIMARY KEY,                     -- Planning London Datahub id ("Southwark-25/AP/0001")
    status text NOT NULL CHECK (status IN ('not-started', 'under-construction', 'completed')),
    net_homes integer NOT NULL CHECK (net_homes > 0),
    permitted_on date,                       -- decision date
    completed_on date,
    lat double precision NOT NULL,           -- the site's centroid as published (WGS84)
    lon double precision NOT NULL,
    site geometry(Point, 27700) GENERATED ALWAYS AS
        (ST_Transform(ST_SetSRID(ST_MakePoint(lon, lat), 4326), 27700)) STORED,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS development_pipeline_site_gix ON development_pipeline USING gist (site);

CREATE TABLE IF NOT EXISTS opportunity_area (
    id text PRIMARY KEY,                     -- "oa:canada-water", "hz:12"
    name text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('opportunity-area', 'housing-zone')),
    url text NOT NULL,                       -- the GLA page for the area, else the dataset page
    geom geometry(MultiPolygon, 27700) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS opportunity_area_geom_gix ON opportunity_area USING gist (geom);

CREATE TABLE IF NOT EXISTS area_pipeline (
    geography_id text PRIMARY KEY REFERENCES area_geography(id),
    area_m2 double precision NOT NULL CHECK (area_m2 > 0),
    homes integer,                           -- dwellings (area_noise) behind the rate; NULL when not loaded
    homes_not_started integer NOT NULL CHECK (homes_not_started >= 0),
    homes_under_construction integer NOT NULL CHECK (homes_under_construction >= 0),
    homes_completed_5y integer NOT NULL CHECK (homes_completed_5y >= 0),
    homes_within_1km integer NOT NULL CHECK (homes_within_1km >= 0),
    within_1km_not_started integer NOT NULL,
    within_1km_under_construction integer NOT NULL,
    per_1000 real,                           -- (not started + under construction) per 1,000 homes
    london_percentile smallint CHECK (london_percentile BETWEEN 0 AND 100),
    period date NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE TABLE IF NOT EXISTS area_opportunity (
    geography_id text NOT NULL REFERENCES area_geography(id),
    opportunity_id text NOT NULL REFERENCES opportunity_area(id) ON DELETE CASCADE,
    overlap_m2 double precision NOT NULL CHECK (overlap_m2 > 0),
    PRIMARY KEY (geography_id, opportunity_id)
);

CREATE OR REPLACE FUNCTION public.rebuild_area_pipeline(p_period date, p_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    n integer;
    min_homes constant integer := 100;  -- below this many homes a rate per 1,000 says nothing
BEGIN
    CREATE TEMP TABLE pipeline_area ON COMMIT DROP AS
        SELECT id AS geography_id, kind::text AS kind, parent_id, ST_Transform(geometry, 27700) AS geom
        FROM area_geography WHERE kind IN ('lsoa', 'msoa', 'borough');
    CREATE INDEX ON pipeline_area USING gist (geom);
    -- One LSOA per site, so a point on a shared boundary is never counted twice.
    CREATE TEMP TABLE pipeline_site ON COMMIT DROP AS
        SELECT DISTINCT ON (s.id) s.id, s.status, s.net_homes, a.geography_id
        FROM development_pipeline s
        JOIN pipeline_area a ON a.kind = 'lsoa' AND ST_Intersects(a.geom, s.site)
        ORDER BY s.id, a.geography_id;
    CREATE TEMP TABLE opportunity_piece ON COMMIT DROP AS
        SELECT id, ST_Subdivide(geom, 128) AS geom FROM opportunity_area;
    CREATE INDEX ON opportunity_piece USING gist (geom);
    ANALYZE pipeline_area;
    ANALYZE opportunity_piece;

    DELETE FROM area_pipeline;
    INSERT INTO area_pipeline (geography_id, area_m2, homes, homes_not_started, homes_under_construction,
        homes_completed_5y, homes_within_1km, within_1km_not_started, within_1km_under_construction, period,
        source_release_id)
    SELECT a.geography_id, ST_Area(a.geom), NULL,
        coalesce(sum(s.net_homes) FILTER (WHERE s.status = 'not-started'), 0),
        coalesce(sum(s.net_homes) FILTER (WHERE s.status = 'under-construction'), 0),
        coalesce(sum(s.net_homes) FILTER (WHERE s.status = 'completed'), 0),
        0, 0, 0, p_period, p_release_id
    FROM pipeline_area a LEFT JOIN pipeline_site s ON s.geography_id = a.geography_id
    WHERE a.kind = 'lsoa' AND ST_Area(a.geom) > 0
    GROUP BY a.geography_id, a.geom;

    -- MSOAs, then boroughs: sums of their children.
    FOR n IN 1..2 LOOP
        INSERT INTO area_pipeline (geography_id, area_m2, homes, homes_not_started, homes_under_construction,
            homes_completed_5y, homes_within_1km, within_1km_not_started, within_1km_under_construction, period,
            source_release_id)
        SELECT g.parent_id, sum(c.area_m2), NULL, sum(c.homes_not_started), sum(c.homes_under_construction),
            sum(c.homes_completed_5y), 0, 0, 0, p_period, p_release_id
        FROM area_pipeline c JOIN area_geography g ON g.id = c.geography_id
        WHERE g.kind::text = CASE n WHEN 1 THEN 'lsoa' ELSE 'msoa' END AND g.parent_id IS NOT NULL
        GROUP BY g.parent_id;
    END LOOP;

    -- Homes still to come within 1 km of each area: measured per area, so not a sum.
    UPDATE area_pipeline p
       SET within_1km_not_started = w.not_started, within_1km_under_construction = w.building,
           homes_within_1km = w.not_started + w.building
      FROM (SELECT a.geography_id,
                   coalesce(sum(s.net_homes) FILTER (WHERE s.status = 'not-started'), 0) AS not_started,
                   coalesce(sum(s.net_homes) FILTER (WHERE s.status = 'under-construction'), 0) AS building
            FROM pipeline_area a
            JOIN development_pipeline s ON s.status <> 'completed' AND ST_DWithin(a.geom, s.site, 1000)
            GROUP BY a.geography_id) w
     WHERE p.geography_id = w.geography_id;

    -- Homes behind the rate: dwellings per LSOA from the noise layer (migration 009), summed upwards.
    IF to_regclass('public.area_noise') IS NOT NULL THEN
        EXECUTE 'UPDATE area_pipeline p SET homes = n.dwellings FROM area_noise n WHERE n.geography_id = p.geography_id';
    END IF;
    UPDATE area_pipeline
       SET per_1000 = CASE WHEN homes >= min_homes
                           THEN round((1000.0 * (homes_not_started + homes_under_construction) / homes)::numeric, 1) END;
    UPDATE area_pipeline p SET london_percentile = r.pct
      FROM (SELECT p2.geography_id,
                   round(100 * percent_rank() OVER (PARTITION BY g.kind ORDER BY p2.per_1000))::smallint AS pct
            FROM area_pipeline p2 JOIN area_geography g ON g.id = p2.geography_id
            WHERE p2.per_1000 IS NOT NULL) r
     WHERE p.geography_id = r.geography_id;

    DELETE FROM area_opportunity;
    INSERT INTO area_opportunity (geography_id, opportunity_id, overlap_m2)
    SELECT a.geography_id, o.id, sum(ST_Area(ST_Intersection(a.geom, o.geom)))
    FROM pipeline_area a JOIN opportunity_piece o ON ST_Intersects(a.geom, o.geom)
    WHERE a.kind = 'lsoa'
    GROUP BY a.geography_id, o.id
    HAVING sum(ST_Area(ST_Intersection(a.geom, o.geom))) > 0;
    FOR n IN 1..2 LOOP
        INSERT INTO area_opportunity (geography_id, opportunity_id, overlap_m2)
        SELECT g.parent_id, c.opportunity_id, sum(c.overlap_m2)
        FROM area_opportunity c JOIN area_geography g ON g.id = c.geography_id
        WHERE g.kind::text = CASE n WHEN 1 THEN 'lsoa' ELSE 'msoa' END AND g.parent_id IS NOT NULL
        GROUP BY g.parent_id, c.opportunity_id;
    END LOOP;

    -- The map layer: one value per LSOA, its London percentile and a five-step legend at the
    -- 10th–90th percentiles of the LSOA rates.
    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    VALUES ('pipeline-homes-per-1000', 'lsoa', 'per 1,000 homes', 'neutral', '{}'::jsonb, p_release_id)
    ON CONFLICT (id) DO NOTHING;
    DELETE FROM metric_value WHERE metric_id = 'pipeline-homes-per-1000';
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, england_percentile,
        sample_count, quality, source_release_id)
    SELECT p.geography_id, 'pipeline-homes-per-1000', p_period, p.per_1000, p.london_percentile, NULL, p.homes,
        (CASE WHEN p.per_1000 IS NULL THEN 'suppressed' ELSE 'observed' END)::metric_quality, p_release_id
    FROM area_pipeline p JOIN area_geography g ON g.id = p.geography_id
    WHERE g.kind = 'lsoa';
    UPDATE metric_definition d
       SET source_release_id = p_release_id,
           definition = jsonb_build_object(
               'label', 'New homes in the pipeline', 'shortLabel', 'Homes pipeline',
               'description', 'Net new homes permitted but not started, or under construction, per 1,000 homes '
                   || 'in the area (London Development Database). Permissions are not completions; dates slip.',
               'sourceId', 'gla-ldd', 'sourceName', 'London Development Database (Planning London Datahub)',
               'methodologyPath', '/guide/planning', 'freshness', to_char(p_period, 'YYYY-MM'),
               'legend', CASE WHEN q.c1 IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(
                   jsonb_build_object('value', q.c1, 'colour', '#c7e9b4', 'label', round(q.c1::numeric)::text),
                   jsonb_build_object('value', q.c2, 'colour', '#7fcdbb', 'label', round(q.c2::numeric)::text),
                   jsonb_build_object('value', q.c3, 'colour', '#1d91c0', 'label', round(q.c3::numeric)::text),
                   jsonb_build_object('value', q.c4, 'colour', '#253494', 'label', round(q.c4::numeric)::text),
                   jsonb_build_object('value', q.c5, 'colour', '#081d58', 'label', round(q.c5::numeric)::text || '+')) END,
               'caveats', jsonb_build_array(
                   'Permissions are not completions; start and finish dates slip and some permissions lapse.',
                   'Each site counts in the area holding its centroid; large schemes are one point.',
                   'Planning London Datahub, Greater London Authority, licensed under the Open Government Licence v3.0.'))
      FROM (SELECT percentile_cont(0.1) WITHIN GROUP (ORDER BY per_1000) AS c1,
                   percentile_cont(0.3) WITHIN GROUP (ORDER BY per_1000) AS c2,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY per_1000) AS c3,
                   percentile_cont(0.7) WITHIN GROUP (ORDER BY per_1000) AS c4,
                   percentile_cont(0.9) WITHIN GROUP (ORDER BY per_1000) AS c5
            FROM area_pipeline p JOIN area_geography g ON g.id = p.geography_id
            WHERE g.kind = 'lsoa' AND p.per_1000 IS NOT NULL) q
     WHERE d.id = 'pipeline-homes-per-1000';

    SELECT count(*) INTO n FROM area_pipeline;
    RETURN n;
END;
$$;
