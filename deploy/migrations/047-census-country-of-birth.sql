-- 047: Census 2021 country of birth joins the People topics of 015-people.sql:
-- world regions per LSOA (TS004, 'country-of-birth') and about 60 countries per
-- London borough (TS012, 'country-of-birth-detailed'; ONS publishes it for local
-- authorities only). The loader (area_analytics/census_people.py) writes TS004's
-- LSOA rows and TS012's borough rows. rebuild_area_people() still sums LSOAs into
-- MSOAs and boroughs, but now keeps the borough-only topic's rows as loaded
-- (there is nothing below a borough to sum). Safe to run again.

ALTER TABLE census_category DROP CONSTRAINT IF EXISTS census_category_topic_check;
ALTER TABLE census_category ADD CONSTRAINT census_category_topic_check
    CHECK (topic IN ('ethnicity', 'religion', 'qualification', 'occupation', 'economic-activity', 'tenure',
                     'accommodation', 'age', 'household-type', 'country-of-birth', 'country-of-birth-detailed'));

-- As in 015, except the first DELETE: a borough-only topic keeps its borough rows.
CREATE OR REPLACE FUNCTION public.rebuild_area_people()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM area_census_count c USING area_geography g
     WHERE g.id = c.geography_id AND g.kind <> 'lsoa'
       AND c.topic <> 'country-of-birth-detailed';
    INSERT INTO area_census_count (geography_id, topic, category, count, source_release_id)
    WITH lsoa AS (
        SELECT l.parent_id AS msoa, m.parent_id AS borough, c.*
        FROM area_census_count c
        JOIN area_geography l ON l.id = c.geography_id AND l.kind = 'lsoa'
        JOIN area_geography m ON m.id = l.parent_id
    )
    SELECT msoa, topic, category, sum(count), min(source_release_id) FROM lsoa GROUP BY 1, 2, 3
    UNION ALL
    SELECT borough, topic, category, sum(count), min(source_release_id) FROM lsoa GROUP BY 1, 2, 3;
    GET DIAGNOSTICS affected = ROW_COUNT;

    UPDATE census_category k SET london_count = s.count
      FROM (SELECT c.topic, c.category, sum(c.count) AS count
              FROM area_census_count c JOIN area_geography g ON g.id = c.geography_id AND g.kind = 'borough'
             GROUP BY 1, 2) s
     WHERE s.topic = k.topic AND s.category = k.category;

    DELETE FROM area_population p USING area_geography g
     WHERE g.id = p.geography_id AND g.kind <> 'lsoa';
    INSERT INTO area_population (geography_id, population, population_year, area_km2, source_release_id)
    WITH lsoa AS (
        SELECT l.parent_id AS msoa, m.parent_id AS borough, p.*
        FROM area_population p
        JOIN area_geography l ON l.id = p.geography_id AND l.kind = 'lsoa'
        JOIN area_geography m ON m.id = l.parent_id
    ), parents AS (
        SELECT msoa AS geography_id, sum(population) AS population, min(population_year) AS population_year,
               min(source_release_id) AS source_release_id FROM lsoa GROUP BY 1
        UNION ALL
        SELECT borough, sum(population), min(population_year), min(source_release_id) FROM lsoa GROUP BY 1
    )
    SELECT p.geography_id, p.population, p.population_year,
           ST_Area(g.geometry::geography) / 1e6, p.source_release_id
    FROM parents p JOIN area_geography g ON g.id = p.geography_id;
    RETURN affected;
END;
$$;
