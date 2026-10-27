-- 059: Census 2021 detailed tables join the People topics of 015-people.sql, every leaf a category:
-- per MSOA (ONS publishes them no lower) 'ethnicity-detailed' (TS022, 287 groups),
-- 'country-of-birth-extended' (190 countries, ONS API), 'passports' (TS013), 'national-identity'
-- (TS028) and 'religion-detailed' (TS031); per LSOA 'main-language' (26, ONS API) and
-- 'year-of-arrival' (TS015). The loader (area_analytics/census_people.py) writes MSOA rows for the
-- first five; rebuild_area_people() keeps them as loaded and sums them into boroughs (so London's
-- count follows). LSOA topics and the borough-only country of birth are handled as in 047.
-- Safe to run again.

ALTER TABLE census_category DROP CONSTRAINT IF EXISTS census_category_topic_check;
ALTER TABLE census_category ADD CONSTRAINT census_category_topic_check
    CHECK (topic IN ('ethnicity', 'religion', 'qualification', 'occupation', 'economic-activity', 'tenure',
                     'accommodation', 'age', 'household-type', 'country-of-birth', 'country-of-birth-detailed',
                     'ethnicity-detailed', 'country-of-birth-extended', 'passports', 'national-identity',
                     'religion-detailed', 'main-language', 'year-of-arrival'));

-- As in 047, except that the MSOA-only topics keep their MSOA rows and add their borough sums.
CREATE OR REPLACE FUNCTION public.rebuild_area_people()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM area_census_count c USING area_geography g
     WHERE g.id = c.geography_id AND g.kind <> 'lsoa'
       AND c.topic <> 'country-of-birth-detailed'
       AND NOT (g.kind = 'msoa' AND c.topic IN ('ethnicity-detailed', 'country-of-birth-extended', 'passports', 'national-identity', 'religion-detailed'));
    INSERT INTO area_census_count (geography_id, topic, category, count, source_release_id)
    WITH lsoa AS (
        SELECT l.parent_id AS msoa, m.parent_id AS borough, c.*
        FROM area_census_count c
        JOIN area_geography l ON l.id = c.geography_id AND l.kind = 'lsoa'
        JOIN area_geography m ON m.id = l.parent_id
    )
    SELECT msoa, topic, category, sum(count), min(source_release_id) FROM lsoa GROUP BY 1, 2, 3
    UNION ALL
    SELECT borough, topic, category, sum(count), min(source_release_id) FROM lsoa GROUP BY 1, 2, 3
    UNION ALL
    SELECT m.parent_id, c.topic, c.category, sum(c.count), min(c.source_release_id)
    FROM area_census_count c
    JOIN area_geography m ON m.id = c.geography_id
    WHERE m.kind = 'msoa' AND c.topic IN ('ethnicity-detailed', 'country-of-birth-extended', 'passports', 'national-identity', 'religion-detailed')
    GROUP BY 1, 2, 3;
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
