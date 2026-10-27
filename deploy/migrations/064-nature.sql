-- 064: Nature (area card, Environment section), loaded by deploy/tools/etl_nature.py.
--
--   street_tree      GLA public realm trees (London Datastore, OGL v3): one point per council /
--                    TfL / Royal Parks tree, with its common name. Street and park trees only;
--                    private gardens are not in it.
--   area_green       share of the area's land that is green (Sentinel-2 summer NDVI >= 0.4 on a
--                    10 m grid, sampled every 30 m), written by the ETL for LSOAs, MSOAs, boroughs
--   dwelling_nature  per home: green share and street trees within about 100 m (a 210 m square)
--   nature_site      Natural England Local Nature Reserves and SSSIs (OGL v3)
--   area_nature      derived by rebuild_area_nature(): green share, street trees per hectare and
--                    the nearest nature site, each as a London LSOA percentile, plus a nature score
--   area_wildlife    GBIF open-licence (CC0, CC BY) records of birds, mammals and amphibians within
--                    1 km of the LSOA's point on surface over five years: species seen, never
--                    absences. `records` is the observer effort behind them.
--
-- Nature keeps its own percentiles (not area_london_rank), so other themes never clash with it.
-- Safe to run again.

CREATE TABLE IF NOT EXISTS street_tree (
    id text PRIMARY KEY,                       -- the GLA row's borough and tree id
    location geometry(Point, 4326) NOT NULL,
    common_name text,                          -- e.g. "London Plane", as the owner recorded it
    taxon text,                                -- genus or species as recorded, e.g. "Platanus x hispanica"
    owner text,                                -- borough, TfL, Royal Parks ...
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS street_tree_location_idx ON street_tree USING gist (location);

CREATE TABLE IF NOT EXISTS area_green (
    geography_id text PRIMARY KEY REFERENCES area_geography(id) ON DELETE CASCADE,
    sampled integer NOT NULL CHECK (sampled > 0),     -- 30 m sample points inside the area
    green_share real NOT NULL CHECK (green_share BETWEEN 0 AND 1),
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE TABLE IF NOT EXISTS dwelling_nature (
    uprn text PRIMARY KEY,
    green_share real CHECK (green_share BETWEEN 0 AND 1),
    street_trees smallint CHECK (street_trees >= 0),
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE TABLE IF NOT EXISTS nature_site (
    id text PRIMARY KEY,                       -- 'lnr:<code>' or 'sssi:<code>'
    kind text NOT NULL CHECK (kind IN ('lnr', 'sssi')),
    name text NOT NULL,
    geometry geometry(MultiPolygon, 4326) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS nature_site_geometry_idx ON nature_site USING gist (geometry);

CREATE TABLE IF NOT EXISTS area_nature (
    geography_id text PRIMARY KEY REFERENCES area_geography(id) ON DELETE CASCADE,
    green_share real,
    green_percentile smallint CHECK (green_percentile BETWEEN 0 AND 100),
    street_trees integer NOT NULL CHECK (street_trees >= 0),
    trees_per_hectare real NOT NULL CHECK (trees_per_hectare >= 0),
    trees_percentile smallint CHECK (trees_percentile BETWEEN 0 AND 100),
    top_trees jsonb NOT NULL DEFAULT '[]',     -- [{"name": "London Plane", "count": 120}, ...] up to 5
    site_name text,                            -- nearest LNR or SSSI
    site_kind text CHECK (site_kind IN ('lnr', 'sssi')),
    site_metres integer CHECK (site_metres >= 0),
    site_percentile smallint CHECK (site_percentile BETWEEN 0 AND 100),
    nature_percentile smallint CHECK (nature_percentile BETWEEN 0 AND 100),
    ranked integer,                            -- how many London LSOAs were ranked
    source_release_ids text[] NOT NULL
);

CREATE TABLE IF NOT EXISTS area_wildlife (
    geography_id text PRIMARY KEY REFERENCES area_geography(id) ON DELETE CASCADE,
    radius_metres integer NOT NULL CHECK (radius_metres > 0),
    first_year smallint NOT NULL,
    last_year smallint NOT NULL,
    records integer NOT NULL CHECK (records >= 0),
    bird_species smallint NOT NULL CHECK (bird_species >= 0),
    mammal_species smallint NOT NULL CHECK (mammal_species >= 0),
    amphibian_species smallint NOT NULL CHECK (amphibian_species >= 0),
    notable text[] NOT NULL DEFAULT '{}',      -- curated common names seen, e.g. {Hedgehog, Kingfisher}
    source_release_id text NOT NULL REFERENCES source_release(id)
);

-- Street trees, nearest nature site and the London LSOA percentiles, from area_green,
-- street_tree and nature_site. Trees and green share are also summed to MSOAs and boroughs;
-- percentiles are among LSOAs only. The nature score is the mean of the three percentiles
-- (nearer site = higher), re-ranked; an LSOA missing any part has no score.
CREATE OR REPLACE FUNCTION public.rebuild_area_nature()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM area_nature;
    INSERT INTO area_nature (geography_id, green_share, street_trees, trees_per_hectare, top_trees,
        site_name, site_kind, site_metres, source_release_ids)
    WITH lsoa AS (
        SELECT l.id, l.parent_id AS msoa, m.parent_id AS borough, l.geometry,
               ST_Area(l.geometry::geography) / 10000 AS hectares
        FROM area_geography l JOIN area_geography m ON m.id = l.parent_id
        WHERE l.kind = 'lsoa'
    ), trees AS (
        SELECT lsoa.id, t.common_name
        FROM lsoa JOIN street_tree t ON ST_Intersects(lsoa.geometry, t.location)
    ), levels AS (
        SELECT g.id, g.kind, ST_Area(g.geometry::geography) / 10000 AS hectares, g.geometry
        FROM area_geography g
    ), counted AS (
        SELECT level_id AS id, count(*) AS trees
        FROM (SELECT lsoa.id AS level_id FROM trees JOIN lsoa USING (id)
              UNION ALL SELECT lsoa.msoa FROM trees JOIN lsoa USING (id)
              UNION ALL SELECT lsoa.borough FROM trees JOIN lsoa USING (id)) t
        GROUP BY level_id
    ), named AS (
        SELECT level_id AS id, common_name, count(*) AS n
        FROM (SELECT lsoa.id AS level_id, trees.common_name FROM trees JOIN lsoa USING (id)
              UNION ALL SELECT lsoa.msoa, trees.common_name FROM trees JOIN lsoa USING (id)
              UNION ALL SELECT lsoa.borough, trees.common_name FROM trees JOIN lsoa USING (id)) t
        WHERE common_name IS NOT NULL AND common_name <> 'Other'  -- GLA's catch-all for unrecorded kinds
        GROUP BY level_id, common_name
    ), top AS (
        SELECT id, jsonb_agg(jsonb_build_object('name', common_name, 'count', n) ORDER BY n DESC, common_name) AS top_trees
        FROM (SELECT *, row_number() OVER (PARTITION BY id ORDER BY n DESC, common_name) AS r FROM named) ranked
        WHERE r <= 5 GROUP BY id
    )
    SELECT levels.id, green.green_share, coalesce(counted.trees, 0),
           round((coalesce(counted.trees, 0) / greatest(levels.hectares, 0.01))::numeric, 2),
           coalesce(top.top_trees, '[]'), site.name, site.kind, site.metres,
           array_remove(ARRAY[green.source_release_id,
               (SELECT source_release_id FROM street_tree LIMIT 1),
               (SELECT source_release_id FROM nature_site LIMIT 1)], NULL)
    FROM levels
    LEFT JOIN area_green green ON green.geography_id = levels.id
    LEFT JOIN counted ON counted.id = levels.id
    LEFT JOIN top ON top.id = levels.id
    LEFT JOIN LATERAL (
        SELECT s.name, s.kind, round(ST_Distance(s.geometry::geography,
               ST_PointOnSurface(levels.geometry)::geography))::integer AS metres
        FROM nature_site s
        ORDER BY s.geometry <-> ST_PointOnSurface(levels.geometry)
        LIMIT 1
    ) site ON levels.kind = 'lsoa'
    WHERE green.geography_id IS NOT NULL OR counted.id IS NOT NULL;

    WITH ranked AS (
        SELECT n.geography_id,
               CASE WHEN n.green_share IS NOT NULL
                    THEN round(100 * percent_rank() OVER (PARTITION BY n.green_share IS NULL ORDER BY n.green_share)) END AS green,
               round(100 * percent_rank() OVER (ORDER BY n.trees_per_hectare)) AS trees,
               CASE WHEN n.site_metres IS NOT NULL
                    THEN round(100 * percent_rank() OVER (PARTITION BY n.site_metres IS NULL ORDER BY n.site_metres DESC)) END AS site,
               count(*) OVER () AS lsoas
        FROM area_nature n JOIN area_geography g ON g.id = n.geography_id AND g.kind = 'lsoa'
    )
    UPDATE area_nature n
    SET green_percentile = ranked.green, trees_percentile = ranked.trees,
        site_percentile = ranked.site, ranked = ranked.lsoas
    FROM ranked WHERE ranked.geography_id = n.geography_id;

    WITH scored AS (
        SELECT geography_id,
               round(100 * percent_rank() OVER (ORDER BY green_percentile + trees_percentile + site_percentile)) AS score
        FROM area_nature
        WHERE green_percentile IS NOT NULL AND trees_percentile IS NOT NULL AND site_percentile IS NOT NULL
    )
    UPDATE area_nature n SET nature_percentile = scored.score
    FROM scored WHERE scored.geography_id = n.geography_id;

    SELECT count(*) INTO affected FROM area_nature;
    RETURN affected;
END;
$$;
