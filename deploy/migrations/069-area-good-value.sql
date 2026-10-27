-- 069: Good value inputs for the v4 "Best value" sort (v4 Task 21d, data task D1).
--
--   area_score_vector  each London LSOA's six London ranks, 0-100, higher is better:
--                        safety   100 - crime per 1,000 residents percentile (metric `crime`, latest month)
--                        schools  best primary within 1 km (area_london_rank `best-primary`)
--                        station  100 - walk to a station percentile (area_london_rank `station-walk`)
--                        quiet    100 - share of homes at 55 dB+ percentile (area_london_rank `quiet`)
--                        parks    100 - metres to the nearest park percentile (area_london_rank `park-distance`)
--                        air      100 - mean NO2 at its homes percentile (metric `air-no2`)
--                      Never price, income, deprivation or who lives there. A missing rank is null.
--   area_good_value    per LSOA and home type ('*' all, 'F', 'T', 'S', 'D') with 20 or more sales in
--                      area_price_band (migration 040): the typical price (p50, adjusted to today),
--                      the median typical price of the PEERS (up to 50) LSOAs whose score vectors are
--                      closest (root-mean-square gap over the ranks both have, at least 4 shared) among
--                      those with 20+ sales of that type, and value_ratio = typical / peers' median
--                      (0.85 = 15% below areas like it). Under 20 sales: no row, the sort hides it.
--
-- Area level only, never one home. Derived, so rebuilt rather than loaded: stage_release.stage() and
-- release_bundle.stage_sql() call rebuild_area_good_value() after rebuild_area_london_rank(), before
-- activating each release; run `SELECT rebuild_area_good_value();` by hand after loading sales, crime,
-- noise, parks, schools or air outside a release. Needs 040 and 054. Safe to run again.

CREATE TABLE IF NOT EXISTS area_score_vector (
    geography_id text PRIMARY KEY REFERENCES area_geography(id) ON DELETE CASCADE,
    safety smallint CHECK (safety BETWEEN 0 AND 100),
    schools smallint CHECK (schools BETWEEN 0 AND 100),
    station smallint CHECK (station BETWEEN 0 AND 100),
    quiet smallint CHECK (quiet BETWEEN 0 AND 100),
    parks smallint CHECK (parks BETWEEN 0 AND 100),
    air smallint CHECK (air BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS area_good_value (
    geography_id text NOT NULL REFERENCES area_geography(id) ON DELETE CASCADE,
    property_type char(1) NOT NULL CHECK (property_type IN ('D', 'S', 'T', 'F', '*')),
    typical_price integer NOT NULL CHECK (typical_price > 0),
    sales integer NOT NULL CHECK (sales >= 20),
    peers smallint NOT NULL CHECK (peers BETWEEN 1 AND 50),
    peer_price integer NOT NULL CHECK (peer_price > 0),
    value_ratio real NOT NULL CHECK (value_ratio > 0),
    source_release_id text NOT NULL,
    PRIMARY KEY (geography_id, property_type)
);
CREATE INDEX IF NOT EXISTS area_good_value_type_idx ON area_good_value (property_type, value_ratio);

CREATE OR REPLACE FUNCTION public.rebuild_area_good_value()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM area_score_vector;
    INSERT INTO area_score_vector (geography_id, safety, schools, station, quiet, parks, air)
    WITH crime AS (
        SELECT DISTINCT ON (mv.geography_id) mv.geography_id, mv.london_percentile AS pct
        FROM metric_value mv
        WHERE mv.metric_id = 'crime' AND mv.geography_id LIKE 'uk:lsoa:%' AND mv.london_percentile IS NOT NULL
        ORDER BY mv.geography_id, mv.period DESC
    ), air AS (
        SELECT DISTINCT ON (mv.geography_id) mv.geography_id, mv.london_percentile AS pct
        FROM metric_value mv
        WHERE mv.metric_id = 'air-no2' AND mv.geography_id LIKE 'uk:lsoa:%' AND mv.london_percentile IS NOT NULL
        ORDER BY mv.geography_id, mv.period DESC
    ), ranks AS (
        SELECT geography_id,
               max(london_percentile) FILTER (WHERE rank_id = 'best-primary') AS schools,
               max(london_percentile) FILTER (WHERE rank_id = 'station-walk') AS walk,
               max(london_percentile) FILTER (WHERE rank_id = 'quiet') AS noisy,
               max(london_percentile) FILTER (WHERE rank_id = 'park-distance') AS park
        FROM area_london_rank GROUP BY geography_id
    )
    SELECT g.id, 100 - crime.pct, ranks.schools, 100 - ranks.walk, 100 - ranks.noisy, 100 - ranks.park, 100 - air.pct
    FROM area_geography g
    LEFT JOIN crime ON crime.geography_id = g.id
    LEFT JOIN air ON air.geography_id = g.id
    LEFT JOIN ranks ON ranks.geography_id = g.id
    WHERE g.kind = 'lsoa'
      AND num_nonnulls(crime.pct, ranks.schools, ranks.walk, ranks.noisy, ranks.park, air.pct) > 0;

    DROP TABLE IF EXISTS pg_temp.good_value_candidate;
    CREATE TEMP TABLE good_value_candidate ON COMMIT DROP AS
    SELECT b.geography_id, b.property_type, b.p50 AS price, b.sales, b.source_release_id,
           v.safety, v.schools, v.station, v.quiet, v.parks, v.air
    FROM area_price_band b
    JOIN area_geography g ON g.id = b.geography_id AND g.kind = 'lsoa'
    JOIN area_score_vector v ON v.geography_id = b.geography_id
    WHERE b.sales >= 20 AND b.p50 > 0
      AND num_nonnulls(v.safety, v.schools, v.station, v.quiet, v.parks, v.air) >= 4;
    CREATE INDEX ON good_value_candidate (property_type);
    ANALYZE good_value_candidate;

    DELETE FROM area_good_value;
    INSERT INTO area_good_value (geography_id, property_type, typical_price, sales, peers, peer_price, value_ratio,
                                 source_release_id)
    SELECT a.geography_id, a.property_type, a.price, a.sales, peer.n, peer.price,
           round((a.price::numeric / peer.price), 3)::real, a.source_release_id
    FROM good_value_candidate a
    CROSS JOIN LATERAL (
        SELECT count(*)::smallint AS n, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY near.price))::integer AS price
        FROM (
            SELECT b.price
            FROM good_value_candidate b
            CROSS JOIN LATERAL (SELECT
                (a.safety IS NOT NULL AND b.safety IS NOT NULL)::int + (a.schools IS NOT NULL AND b.schools IS NOT NULL)::int
              + (a.station IS NOT NULL AND b.station IS NOT NULL)::int + (a.quiet IS NOT NULL AND b.quiet IS NOT NULL)::int
              + (a.parks IS NOT NULL AND b.parks IS NOT NULL)::int + (a.air IS NOT NULL AND b.air IS NOT NULL)::int AS shared,
                coalesce((a.safety - b.safety) ^ 2, 0) + coalesce((a.schools - b.schools) ^ 2, 0)
              + coalesce((a.station - b.station) ^ 2, 0) + coalesce((a.quiet - b.quiet) ^ 2, 0)
              + coalesce((a.parks - b.parks) ^ 2, 0) + coalesce((a.air - b.air) ^ 2, 0) AS gap) d
            WHERE b.property_type = a.property_type AND b.geography_id <> a.geography_id AND d.shared >= 4
            ORDER BY d.gap / d.shared, b.geography_id
            LIMIT 50
        ) near
    ) peer
    WHERE peer.n > 0;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;

-- Fill it now when its inputs exist (a fresh database has none yet: 0 rows, filled at the first stage).
SELECT rebuild_area_good_value();
