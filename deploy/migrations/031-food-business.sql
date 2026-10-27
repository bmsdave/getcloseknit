-- Food businesses in London (FSA Food Hygiene Rating Scheme register), loaded by
-- pipelines/area-analytics-ingest/area_analytics/food_hygiene.py from the FSA open data
-- XML files, one per local authority (OGL v3). Places, never people: addresses,
-- postcodes, contact details and inspection scores are left out (data minimisation);
-- only the business name, its type, the published rating and a point are kept.
-- Rows without a geocode are skipped (counted by the loader). The rating is the
-- authority's latest published one and can lag the business by months.

CREATE TABLE food_business (
    fhrs_id bigint PRIMARY KEY,
    name text,
    business_type text,
    business_type_id int,
    rating text,                             -- '0'..'5', 'Exempt', 'AwaitingInspection', 'AwaitingPublication'
    rating_date date,
    local_authority text,
    location geometry(Point, 4326),
    source_release_id text REFERENCES source_release(id)
);
CREATE INDEX food_business_location_gix ON food_business USING gist ((location::geography));
CREATE INDEX food_business_type ON food_business (business_type_id);
