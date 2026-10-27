-- Private rents by London borough and bedroom count (stream G2, money), loaded by
-- pipelines/area-analytics-ingest/area_analytics/rents.py from the ONS Price Index of
-- Private Rents (PIPR), UK: monthly price statistics (OGL v3). PIPR publishes the average
-- (mean) monthly rent of new and existing private tenancies, rounded to £1, for each local
-- authority: all homes, one to four-or-more bedrooms and flats/maisonettes. There is no
-- studio or room figure and nothing below a borough, so an LSOA reads its borough's rent:
-- a ballpark for budget fit, never the rent of a particular home.

CREATE TABLE borough_rent (
    area_code text NOT NULL,                 -- E09… borough, or E12000007 for London as a whole
    period date NOT NULL,                    -- first day of the month the rent describes
    bedrooms text NOT NULL CHECK (bedrooms IN ('all', '1 bedroom', '2 bedrooms', '3 bedrooms',
        '4 or more bedrooms', 'flat or maisonette')),
    monthly_rent integer NOT NULL CHECK (monthly_rent > 0 AND monthly_rent <= 20000),
    annual_change_pct numeric(6, 2),         -- change on the same month a year before
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (area_code, period, bedrooms)
);
CREATE INDEX borough_rent_period ON borough_rent (period);
