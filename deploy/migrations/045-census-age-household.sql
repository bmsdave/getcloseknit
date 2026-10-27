-- 045: Census 2021 residents' age (TS007A) and household type (TS003) join the
-- People and homes topics of 015-people.sql. Only the topic check changes: the
-- loader (area_analytics/census_people.py) writes their LSOA rows into
-- census_category / area_census_count like every other topic, and
-- rebuild_area_people() adds MSOA, borough and London sums. Safe to run again.

ALTER TABLE census_category DROP CONSTRAINT IF EXISTS census_category_topic_check;
ALTER TABLE census_category ADD CONSTRAINT census_category_topic_check
    CHECK (topic IN ('ethnicity', 'religion', 'qualification', 'occupation', 'economic-activity', 'tenure',
                     'accommodation', 'age', 'household-type'));
