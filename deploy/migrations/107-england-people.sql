-- 107: People for all of England (after 103). The census loader (area_analytics/census_people.py) now
-- writes every English LSOA/MSOA/borough; rebuild_area_people() keeps 059's sums and adds:
--   census_category.london_count  London's total again (boroughs in region E12000007 only), so London's
--                                 shares do not change now that boroughs are any English LAD;
--   census_region_count           each region's total per category (E12000001..E12000009), which the
--                                 People payload compares an area with (its own region; London = London).
-- Safe to run again; the function is rebuilt from the loaded rows by `SELECT rebuild_area_people()`.

CREATE TABLE IF NOT EXISTS census_region_count (
    region_code text NOT NULL,               -- E12...: area_region's region
    topic text NOT NULL,
    category text NOT NULL,
    count bigint NOT NULL CHECK (count >= 0),
    PRIMARY KEY (region_code, topic, category),
    FOREIGN KEY (topic, category) REFERENCES census_category (topic, category) ON DELETE CASCADE
);

-- As in 059, except that London's count and the region counts come from area_region.
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

    DELETE FROM census_region_count;
    INSERT INTO census_region_count (region_code, topic, category, count)
    SELECT r.region_code, c.topic, c.category, sum(c.count)
      FROM area_census_count c
      JOIN area_geography g ON g.id = c.geography_id AND g.kind = 'borough'
      JOIN area_region r ON r.area_id = g.id
     GROUP BY 1, 2, 3;

    UPDATE census_category k SET london_count = s.count
      FROM (SELECT topic, category, count FROM census_region_count WHERE region_code = 'E12000007') s
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
