-- People and homes: ONS mid-year population with land area (density), and
-- Census 2021 topic counts (ethnic group, religion, qualifications, occupation,
-- economic activity, tenure, accommodation type). The loader
-- (area_analytics/census_people.py) writes LSOA rows; rebuild_area_people()
-- adds MSOA and borough sums and the London-wide count of every category.

CREATE TABLE census_category (
    topic text NOT NULL CHECK (topic IN ('ethnicity', 'religion', 'qualification', 'occupation',
                                         'economic-activity', 'tenure', 'accommodation')),
    category text NOT NULL CHECK (category ~ '^[a-z0-9-]+$'),
    label text NOT NULL,
    position smallint NOT NULL,
    london_count integer CHECK (london_count >= 0),
    PRIMARY KEY (topic, category)
);

CREATE TABLE area_census_count (
    geography_id text NOT NULL REFERENCES area_geography(id),
    topic text NOT NULL,
    category text NOT NULL,
    count integer NOT NULL CHECK (count >= 0),
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (geography_id, topic, category),
    FOREIGN KEY (topic, category) REFERENCES census_category(topic, category)
);

CREATE TABLE area_population (
    geography_id text PRIMARY KEY REFERENCES area_geography(id),
    population integer NOT NULL CHECK (population >= 0),
    population_year smallint NOT NULL,
    area_km2 real NOT NULL CHECK (area_km2 > 0),
    source_release_id text NOT NULL REFERENCES source_release(id)
);

-- Sum LSOA rows into their MSOA and borough; London is the sum of the
-- boroughs. Land area comes from each boundary (generalised, clipped to the
-- coastline), so parents get their own area rather than a sum of children.
CREATE OR REPLACE FUNCTION public.rebuild_area_people()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM area_census_count c USING area_geography g
     WHERE g.id = c.geography_id AND g.kind <> 'lsoa';
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
