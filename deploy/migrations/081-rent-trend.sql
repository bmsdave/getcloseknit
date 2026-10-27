-- Rent trend (open data wave A, source 2), loaded by deploy/tools/etl_rent_trend.py from the ONS
-- Price Index of Private Rents (PIPR), UK: monthly price statistics, Table 1 (OGL v3, official
-- statistics in development). Every month in the workbook (from January 2015) for each London
-- borough and London as a whole: the index and the average (mean) monthly
-- rent of new and existing tenancies, rounded to £1, for all homes, bedroom counts and types of
-- home. No City of London row is published. borough_rent (029, latest month only) stays as it is.
-- The map layers rent-change-1y and rent-change-5y (metric_value, carrier borough) are written by
-- the loader, which also writes their metric_definition rows once their source release exists.

CREATE TABLE IF NOT EXISTS borough_rent_series (
    borough text NOT NULL CHECK (borough = 'E12000007' OR borough ~ '^E09[0-9]{6}$'),
    month date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
    category text NOT NULL CHECK (category IN ('all', '1 bedroom', '2 bedrooms', '3 bedrooms',
        '4 or more bedrooms', 'detached', 'semi-detached', 'terraced', 'flat or maisonette')),
    rent integer CHECK (rent > 0 AND rent <= 20000),
    index numeric(10, 4) CHECK (index > 0),
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (borough, month, category),
    CHECK (rent IS NOT NULL OR index IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS borough_rent_series_month ON borough_rent_series (month);
