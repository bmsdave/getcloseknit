-- The seed of the throwaway test database (postgis-fixture.sh), applied after schema.sql and every migration.
-- Two LADs in two regions, made-up but real-shaped: Camden (E09000007, London) and Epping Forest (E07000072,
-- East of England), each with two MSOAs and a grid of rectangular LSOAs; an active product release with crime
-- and £/m² for every LSOA and short lets for Camden's alone (percentiles ranked within each region, as the ETL
-- does), a crime breakdown, market depth, noise, three schools and a few addresses. api/tests/test_postgis.py
-- asserts on these numbers.
--
-- Camden:        30 LSOAs E01000900..E01000929, a 6 x 5 grid of 0.01 x 0.008 degree cells from (-0.17, 51.52);
--                columns 0-2 in MSOA E02000166 "Camden 001", 3-5 in E02000167 "Camden 002".
-- Epping Forest:  6 LSOAs E01021700..E01021705, a 3 x 2 grid of 0.04 x 0.03 degree cells from (0.04, 51.64);
--                the south row in E02004541 "Epping Forest 001", the north row in E02004542 "Epping Forest 002".
-- LSOA n of a grid sits in column n % columns, row n / columns.

INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,
                            transformation_version, geography_vintage, validation_status, caveats)
VALUES
    ('fixture-police-2026-06', 'https://data.police.uk/', '2026-07-01', '2026-06-30', repeat('a', 64), 'OGL-3.0',
     'Contains police data licensed under OGL v3.0', 'crime-v1', 'lsoa-2021', 'passed',
     ARRAY['Published crime coordinates are deliberately anonymised.']),
    ('fixture-hmlr-2026-06', 'https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads',
     '2026-07-01', '2026-06-30', repeat('b', 64), 'OGL-3.0',
     'Contains HM Land Registry information licensed under OGL v3.0', 'price-v1', 'lsoa-2021', 'passed',
     ARRAY['Sales joined to EPC floor areas.']),
    ('fixture-noise-2026', 'https://www.gov.uk/government/publications/strategic-noise-mapping-2022', '2026-07-01',
     '2026-06-30', repeat('c', 64), 'OGL-3.0', 'Contains Defra noise data licensed under OGL v3.0', 'noise-v1',
     'lsoa-2021', 'passed', ARRAY['Modelled noise, not measured.']),
    ('fixture-schools-2026', 'https://get-information-schools.service.gov.uk/', '2026-07-01', '2026-06-30',
     repeat('d', 64), 'OGL-3.0', 'Contains DfE data licensed under OGL v3.0', 'schools-v1', 'lsoa-2021', 'passed',
     ARRAY['State schools only.']),
    ('fixture-addresses-2026-06', 'https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads',
     '2026-07-01', '2026-06-30', repeat('e', 64), 'OGL-3.0',
     'Contains HM Land Registry information licensed under OGL v3.0', 'address-v1', 'lsoa-2021', 'passed',
     ARRAY['Addresses with a recorded sale.']),
    ('fixture-airbnb-2026-06', 'https://insideairbnb.com/get-the-data/', '2026-07-01', '2026-06-30', repeat('f', 64),
     'CC-BY-4.0', 'Inside Airbnb, CC BY 4.0', 'short-lets-v1', 'lsoa-2021', 'passed',
     ARRAY['Listings scraped by Inside Airbnb.']);

-- Parents first: the hierarchy trigger (migration 001) checks them and area_region_fill (103) copies the region down.
INSERT INTO area_geography (id, kind, official_code, name, geometry) VALUES
    ('uk:lad:E09000007', 'lad', 'E09000007', 'Camden',
     ST_Multi(ST_MakeEnvelope(-0.17, 51.52, -0.11, 51.56, 4326))),
    ('uk:lad:E07000072', 'lad', 'E07000072', 'Epping Forest',
     ST_Multi(ST_MakeEnvelope(0.04, 51.64, 0.16, 51.70, 4326)));

INSERT INTO area_geography (id, kind, official_code, name, parent_id, geometry) VALUES
    ('uk:msoa:E02000166', 'msoa', 'E02000166', 'Camden 001', 'uk:lad:E09000007',
     ST_Multi(ST_MakeEnvelope(-0.17, 51.52, -0.14, 51.56, 4326))),
    ('uk:msoa:E02000167', 'msoa', 'E02000167', 'Camden 002', 'uk:lad:E09000007',
     ST_Multi(ST_MakeEnvelope(-0.14, 51.52, -0.11, 51.56, 4326))),
    ('uk:msoa:E02004541', 'msoa', 'E02004541', 'Epping Forest 001', 'uk:lad:E07000072',
     ST_Multi(ST_MakeEnvelope(0.04, 51.64, 0.16, 51.67, 4326))),
    ('uk:msoa:E02004542', 'msoa', 'E02004542', 'Epping Forest 002', 'uk:lad:E07000072',
     ST_Multi(ST_MakeEnvelope(0.04, 51.67, 0.16, 51.70, 4326)));

INSERT INTO area_geography (id, kind, official_code, name, parent_id, geometry)
SELECT 'uk:lsoa:E0' || (1000900 + n), 'lsoa', 'E0' || (1000900 + n),
       CASE WHEN n % 6 < 3 THEN 'Camden 001' ELSE 'Camden 002' END || chr(65 + (n / 6) * 3 + n % 3),
       CASE WHEN n % 6 < 3 THEN 'uk:msoa:E02000166' ELSE 'uk:msoa:E02000167' END,
       ST_Multi(ST_MakeEnvelope(-0.17 + (n % 6) * 0.01, 51.52 + (n / 6) * 0.008,
                                -0.16 + (n % 6) * 0.01, 51.528 + (n / 6) * 0.008, 4326))
FROM generate_series(0, 29) AS n;

INSERT INTO area_geography (id, kind, official_code, name, parent_id, geometry)
SELECT 'uk:lsoa:E0' || (1021700 + n), 'lsoa', 'E0' || (1021700 + n),
       CASE WHEN n < 3 THEN 'Epping Forest 001' ELSE 'Epping Forest 002' END || chr(65 + n % 3),
       CASE WHEN n < 3 THEN 'uk:msoa:E02004541' ELSE 'uk:msoa:E02004542' END,
       ST_Multi(ST_MakeEnvelope(0.04 + (n % 3) * 0.04, 51.64 + (n / 3) * 0.03,
                                0.08 + (n % 3) * 0.04, 51.67 + (n / 3) * 0.03, 4326))
FROM generate_series(0, 5) AS n;

INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id) VALUES
    ('crime', 'lsoa', 'per 1,000', 'higher-is-more', '{
        "label": "Recorded crime", "shortLabel": "Crime",
        "description": "Street-level crimes per 1,000 residents over the latest 12 months.",
        "legend": [{"value": 40, "colour": "#3a7d44", "label": "40"}, {"value": 80, "colour": "#f4d35e", "label": "80"},
                   {"value": 120, "colour": "#b23a48", "label": "120+"}],
        "freshness": "fixture-police-2026-06", "methodologyPath": "/guide/crime",
        "caveats": ["Published crime coordinates are deliberately anonymised."],
        "sourceId": "police-uk", "sourceName": "data.police.uk"}', 'fixture-police-2026-06'),
    ('price-per-square-metre', 'lsoa', 'GBP/m2', 'higher-is-more', '{
        "label": "Price per square metre", "shortLabel": "Price / m2",
        "description": "Rolling 12-month median sold price joined to floor area.",
        "legend": [{"value": 4000, "colour": "#2a6f97", "label": "4k"}, {"value": 12000, "colour": "#c44536", "label": "12k+"}],
        "freshness": "fixture-hmlr-2026-06", "methodologyPath": "/guide/price-per-m2", "caveats": [],
        "sourceId": "hmlr-epc", "sourceName": "HM Land Registry Price Paid + EPC"}', 'fixture-hmlr-2026-06'),
    ('short-lets-per-1000', 'lsoa', 'per 1,000 homes', 'higher-is-more', '{
        "label": "Short lets", "shortLabel": "Short lets",
        "description": "Airbnb listings per 1,000 homes.",
        "legend": [{"value": 0, "colour": "#2a6f97", "label": "0"}, {"value": 30, "colour": "#c44536", "label": "30+"}],
        "freshness": "fixture-airbnb-2026-06", "methodologyPath": "/guide/short-lets", "caveats": [],
        "sourceId": "inside-airbnb", "sourceName": "Inside Airbnb"}', 'fixture-airbnb-2026-06');

-- Crime, two months: Camden LSOA n is 60 + n in 2026-06 (59 + n in 2026-05), Epping Forest n is 20 + 2n (19 + 2n).
INSERT INTO metric_value (geography_id, metric_id, period, value, quality, source_release_id)
SELECT 'uk:lsoa:E0' || (1000900 + n), 'crime', month, 60 + n - (month < '2026-06-01')::int, 'observed'::metric_quality,
       'fixture-police-2026-06'
FROM generate_series(0, 29) AS n, unnest(ARRAY['2026-05-01', '2026-06-01']::date[]) AS month
UNION ALL
SELECT 'uk:lsoa:E0' || (1021700 + n), 'crime', month, 20 + 2 * n - (month < '2026-06-01')::int, 'observed'::metric_quality,
       'fixture-police-2026-06'
FROM generate_series(0, 5) AS n, unnest(ARRAY['2026-05-01', '2026-06-01']::date[]) AS month;

-- £/m², two years: Camden n is 9000 + 100n in 2026-06 (8500 + 100n a year earlier), Epping Forest n 5000 + 100n
-- (4800 + 100n). Camden 002O (n = 29) has too few sales in 2026-06: suppressed, no value.
INSERT INTO metric_value (geography_id, metric_id, period, value, sample_count, quality, source_release_id)
SELECT 'uk:lsoa:E0' || (1000900 + n), 'price-per-square-metre', month,
       CASE WHEN n = 29 AND month = '2026-06-01' THEN NULL
            WHEN month = '2026-06-01' THEN 9000 + 100 * n ELSE 8500 + 100 * n END,
       CASE WHEN n = 29 AND month = '2026-06-01' THEN 2 ELSE 20 END,
       CASE WHEN n = 29 AND month = '2026-06-01' THEN 'suppressed' ELSE 'observed' END::metric_quality,
       'fixture-hmlr-2026-06'
FROM generate_series(0, 29) AS n, unnest(ARRAY['2025-06-01', '2026-06-01']::date[]) AS month
UNION ALL
SELECT 'uk:lsoa:E0' || (1021700 + n), 'price-per-square-metre', month,
       CASE WHEN month = '2026-06-01' THEN 5000 + 100 * n ELSE 4800 + 100 * n END, 20, 'observed'::metric_quality,
       'fixture-hmlr-2026-06'
FROM generate_series(0, 5) AS n, unnest(ARRAY['2025-06-01', '2026-06-01']::date[]) AS month;

-- Short lets, a London-only source (Inside Airbnb): Camden LSOA n is n per 1,000 homes in 2026-06, Camden 002O
-- (n = 29) has no listing data; Epping Forest has no rows (metric_coverage, migration 126: London only).
INSERT INTO metric_value (geography_id, metric_id, period, value, quality, source_release_id)
SELECT 'uk:lsoa:E0' || (1000900 + n), 'short-lets-per-1000', '2026-06-01', n, 'observed'::metric_quality,
       'fixture-airbnb-2026-06'
FROM generate_series(0, 28) AS n;

-- Percentiles within each area's region (percentiles.py: competition ranking = percent_rank()).
UPDATE metric_value v SET region_percentile = r.percentile
FROM (SELECT geography_id, metric_id, period,
             round(100 * percent_rank() OVER (PARTITION BY metric_id, period, area_rank_region(geography_id)
                                              ORDER BY value))::smallint AS percentile
      FROM metric_value WHERE value IS NOT NULL) r
WHERE (v.geography_id, v.metric_id, v.period) = (r.geography_id, r.metric_id, r.period);

-- Camden 001A's offence mix in 2026-06; anti-social behaviour is its own category (#163).
INSERT INTO metric_value_breakdown (geography_id, metric_id, period, category, offence_count, source_release_id) VALUES
    ('uk:lsoa:E01000900', 'crime', '2026-06-01', 'Violence and sexual offences', 9, 'fixture-police-2026-06'),
    ('uk:lsoa:E01000900', 'crime', '2026-06-01', 'Shoplifting', 4, 'fixture-police-2026-06'),
    ('uk:lsoa:E01000900', 'crime', '2026-06-01', 'anti-social-behaviour', 5, 'fixture-police-2026-06');

INSERT INTO area_market_depth (geography_id, period_end, sales_12m, dwellings, dwellings_sold_12m, turnover_percent,
                               tenure_known_12m, leasehold_share_of_sales, new_build_sample_36m, resale_sample_36m,
                               new_build_median_ppm, resale_median_ppm, new_build_premium_percent, growth_period,
                               growth_1y, source_release_id)
VALUES ('uk:lsoa:E01000900', '2026-06-30', 24, 800, 24, 3.0, 24, 0.75, 12, 60, 11000, 9500, 15.8, '2026-06-01', 5.9,
        'fixture-hmlr-2026-06');

-- Noise for every LSOA: Camden n has 30 + n % 10 per cent of homes above 55 dB, Epping Forest n 5 + n.
INSERT INTO area_noise (geography_id, dwellings, road_55_share, rail_55_share, any_55_share, any_65_share,
                        road_lden_median, source_release_id)
SELECT id, 600, share, 0, share, share / 4, 55, 'fixture-noise-2026'
FROM (SELECT 'uk:lsoa:E0' || (1000900 + n) AS id, (30 + n % 10)::real AS share FROM generate_series(0, 29) n
      UNION ALL
      SELECT 'uk:lsoa:E0' || (1021700 + n), (5 + n)::real FROM generate_series(0, 5) n) noise;

-- Two schools in Camden 001A's corner, one in Epping Forest (school_region_trg sets region_code).
INSERT INTO school (urn, school_id, name, phase, attributes, location, source_release_id) VALUES
    ('900001', 'uk:school:900001', 'Fixture Primary School', 'primary', '{"type": "Community school", "ageFrom": 3, "ageTo": 11}',
     ST_SetSRID(ST_MakePoint(-0.1645, 51.5235), 4326), 'fixture-schools-2026'),
    ('900002', 'uk:school:900002', 'Fixture Academy', 'secondary', '{"type": "Academy", "ageFrom": 11, "ageTo": 18}',
     ST_SetSRID(ST_MakePoint(-0.158, 51.527), 4326), 'fixture-schools-2026'),
    ('900003', 'uk:school:900003', 'Epping Fixture Primary', 'primary', '{"type": "Community school", "ageFrom": 4, "ageTo": 11}',
     ST_SetSRID(ST_MakePoint(0.06, 51.655), 4326), 'fixture-schools-2026');

INSERT INTO school_inspection (urn, inspection_number, inspected_urn, start_date, publication_date, inspection_type,
                               framework, overall, judgements, source_release_id)
VALUES ('900001', '10000001', '900001', '2024-03-05', '2024-04-02', 'Graded inspection', 'EIF', 2, '{}',
        'fixture-schools-2026');

-- Homes near Camden 001A's middle (-0.165, 51.524): NW1 0AA (3 homes) and NW1 0AB (2, one hidden by an objection)
-- within 800 m, NW3 9ZZ about 3.5 km away. Easting/northing are the points on the British National Grid.
INSERT INTO address (id, display_address, postcode, geography_id, easting, northing, source_release_id)
SELECT id, display, postcode, 'uk:lsoa:E01000900',
       round(ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(lon, lat), 4326), 27700)))::integer,
       round(ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint(lon, lat), 4326), 27700)))::integer,
       'fixture-addresses-2026-06'
FROM (VALUES
    ('uk:addr:00000000000a', 'Flat 1, 1 Fixture Street, London, NW1 0AA', 'NW1 0AA', -0.1652, 51.5241),
    ('uk:addr:00000000000b', 'Flat 2, 1 Fixture Street, London, NW1 0AA', 'NW1 0AA', -0.1652, 51.5241),
    ('uk:addr:00000000000c', '3 Fixture Street, London, NW1 0AA', 'NW1 0AA', -0.1650, 51.5243),
    ('uk:addr:00000000000d', '1 Sample Road, London, NW1 0AB', 'NW1 0AB', -0.1610, 51.5260),
    ('uk:addr:00000000000e', '2 Sample Road, London, NW1 0AB', 'NW1 0AB', -0.1612, 51.5260),
    ('uk:addr:00000000000f', '1 Far Lane, London, NW3 9ZZ', 'NW3 9ZZ', -0.1150, 51.5550)
) AS a (id, display, postcode, lon, lat);

INSERT INTO property_objection (address_id, contact_email_hash, token_hash, status, confirmed_at)
VALUES ('uk:addr:00000000000e', repeat('1', 64), repeat('2', 64), 'active', '2026-06-01');

INSERT INTO product_release (id, geography_vintage, transformation_versions, assets, validation_status)
VALUES ('fixture-2026-06', 'lsoa-2021', '{}', '{}', 'passed');
INSERT INTO product_release_member (release_id, source_release_id)
SELECT 'fixture-2026-06', id FROM source_release;
SELECT activate_product_release('fixture-2026-06');
