-- Loads the etl_property.py stage outputs into the review stack. Replace /path/to/AE_DATA in the \copy paths below with your $AE_DATA first.
SET max_parallel_workers_per_gather = 0;
SET work_mem = '256MB';
SET maintenance_work_mem = '512MB';

INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,
    transformation_version, geography_vintage, validation_status, caveats)
VALUES
 ('src-os-open-uprn-2026-08', 'https://api.os.uk/downloads/v1/products/OpenUPRN/downloads?area=GB&format=CSV',
  now(), '2026-08-31', 'c50c1b6e6129f7fced4309ee873a25bdcb7f5679ba938b64227240580faa21f1', 'OGL-3.0',
  'Contains OS data © Crown copyright and database right 2026', 'close-knit-etl-property-1', '2021', 'passed',
  ARRAY['UPRNs come from EPC certificates matched to Land Registry addresses; unmatched addresses keep postcode-precision coordinates.']),
 ('src-hmlr-inspire-2026-09', 'https://use-land-property-data.service.gov.uk/datasets/inspire/download',
  now(), '2026-09-06', '11f1ad580546001a70b6abb7d0b537e52600e0138cf442299ae895732afa1155', 'OGL-3.0 with INSPIRE conditions',
  'This information is subject to Crown copyright and database rights 2026 and is reproduced with the permission of HM Land Registry. The polygons (including the associated geometry, namely x, y co-ordinates) are subject to Crown copyright and database rights 2026 Ordnance Survey 100026316.',
  'close-knit-etl-property-1', '2021', 'passed',
  ARRAY['Index polygons are freehold registrations, not building outlines: flats share their block''s parcel.', 'Conditions: https://use-land-property-data.service.gov.uk/datasets/inspire/#conditions'])
ON CONFLICT (id) DO NOTHING;

DROP TABLE IF EXISTS staging_address_uprn; DROP TABLE IF EXISTS staging_uprn_point; DROP TABLE IF EXISTS staging_parcel;
CREATE UNLOGGED TABLE staging_address_uprn (address_id text, uprn text);
CREATE UNLOGGED TABLE staging_uprn_point (uprn text, easting double precision, northing double precision, latitude double precision, longitude double precision);
CREATE UNLOGGED TABLE staging_parcel (inspire_id text, authority_code text, wkt text);
\copy staging_address_uprn FROM '/path/to/AE_DATA/property/address-uprn.csv' CSV HEADER
\copy staging_uprn_point FROM '/path/to/AE_DATA/property/uprn-points.csv' CSV HEADER
\copy staging_parcel FROM '/path/to/AE_DATA/property/parcels.csv' CSV HEADER
CREATE INDEX ON staging_address_uprn (uprn);
CREATE INDEX ON staging_uprn_point (uprn);

-- Parcels: valid polygons only (INSPIRE polygons are single rings, EPSG:27700).
INSERT INTO parcel (id, authority_code, geometry, source_release_id)
SELECT inspire_id, authority_code, ST_Transform(ST_MakeValid(ST_GeomFromText(wkt, 27700)), 4326), 'src-hmlr-inspire-2026-09'
FROM staging_parcel
WHERE GeometryType(ST_MakeValid(ST_GeomFromText(wkt, 27700))) = 'POLYGON'
ON CONFLICT (id) DO NOTHING;

-- One dwelling per UPRN: when several address keys point at one UPRN keep the
-- address with the most recorded sales.
INSERT INTO property (uprn, address, geography_id, location, address_id, source_release_id)
SELECT DISTINCT ON (m.uprn) m.uprn, a.display_address, a.geography_id,
       ST_SetSRID(ST_MakePoint(pt.longitude, pt.latitude), 4326), a.id, 'src-os-open-uprn-2026-08'
FROM staging_address_uprn m
JOIN address a ON a.id = m.address_id
JOIN staging_uprn_point pt ON pt.uprn = m.uprn
LEFT JOIN (SELECT address_id, count(*) AS sales FROM address_transaction GROUP BY 1) s ON s.address_id = a.id
ORDER BY m.uprn, s.sales DESC NULLS LAST, a.id
ON CONFLICT (uprn) DO NOTHING;

-- Mislinked UPRNs: a dwelling more than 500 m from the LSOA its postcode sits in
-- is an EPC/address key collision, not a house we can place.
DELETE FROM property p USING area_geography g
WHERE g.id = p.geography_id AND ST_Distance(p.location::geography, g.geometry::geography) > 500;

UPDATE property p SET parcel_id = c.id
FROM parcel c
WHERE p.parcel_id IS NULL AND ST_Contains(c.geometry, p.location);

-- Stock value: last sale with a floor area, restated by the LSOA rolling £/m² index.
INSERT INTO property_stock_value (uprn, period, sale_period, completion_date, nominal_price, floor_area_square_metres,
    sale_price_per_square_metre, index_carrier, index_geography_id, index_at_sale, index_latest,
    restated_price_per_square_metre, restated_value, confidence, source_release_id)
WITH latest_period AS (
    SELECT max(period) AS period FROM metric_value WHERE metric_id = 'price-per-square-metre'
), first_period AS (
    SELECT min(period) AS period FROM metric_value WHERE metric_id = 'price-per-square-metre'
), last_sale AS (
    SELECT DISTINCT ON (p.uprn) p.uprn, p.geography_id, t.sale_month, t.completion_date, t.nominal_price,
           t.floor_area_square_metres, t.price_per_square_metre
    FROM property p
    JOIN address_transaction t ON t.address_id = p.address_id
    -- Market sanity: non-market transfers (< £20k), implausible EPC areas
    -- (< 15 or > 1000 m²) and £/m² outside £500–£40,000 are not restated.
    WHERE t.floor_area_square_metres BETWEEN 15 AND 1000
      AND t.nominal_price >= 20000
      AND t.price_per_square_metre BETWEEN 500 AND 40000
    ORDER BY p.uprn, t.completion_date DESC, t.nominal_price DESC
), indexed AS (
    -- A sale before the index's first month is not restated (#249): no index_period, no row.
    SELECT s.*, lp.period AS latest, fp.period AS first, s.sale_month AS index_period
    FROM last_sale s, latest_period lp, first_period fp
    WHERE s.sale_month >= fp.period
)
SELECT i.uprn, i.latest, i.sale_month, i.completion_date, i.nominal_price, i.floor_area_square_metres,
       i.price_per_square_metre,
       CASE WHEN at_sale.quality = 'observed' AND now_v.quality = 'observed' THEN 'lsoa' ELSE 'msoa' END,
       i.geography_id, at_sale.value, now_v.value,
       round((i.nominal_price * now_v.value / at_sale.value / i.floor_area_square_metres)::numeric, 2),
       round(i.nominal_price * now_v.value / at_sale.value)::integer,
       stock_value_confidence(i.sale_month, i.latest,
           CASE WHEN at_sale.quality = 'observed' AND now_v.quality = 'observed' THEN 'lsoa' ELSE 'msoa' END),
       'src-os-open-uprn-2026-08'
FROM indexed i
JOIN metric_value at_sale ON at_sale.metric_id = 'price-per-square-metre' AND at_sale.geography_id = i.geography_id AND at_sale.period = i.index_period
JOIN metric_value now_v ON now_v.metric_id = 'price-per-square-metre' AND now_v.geography_id = i.geography_id AND now_v.period = i.latest
WHERE at_sale.value > 0 AND now_v.value > 0
  -- An index ratio outside 0.25–6 means the carrier median was not a usable index at one end.
  AND now_v.value / at_sale.value BETWEEN 0.25 AND 6
ON CONFLICT (uprn) DO NOTHING;

-- Area stock value: median restated £/m² of the dwellings in each LSOA.
INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
VALUES ('stock-value-per-square-metre', 'lsoa', '£/m²', 'higher-is-more', $json${
  "label": "Stock value per square metre", "shortLabel": "Stock value",
  "description": "Median of every dwelling's last achieved price per square metre, restated to the latest period by its area's price change. A restated sale, not a valuation.",
  "sourceId": "hmlr-epc-os-uprn", "sourceName": "HM Land Registry Price Paid + EPC + OS Open UPRN",
  "legend": [{"label": "£4k", "value": 4000, "colour": "#2a6f97"}, {"label": "£8k", "value": 8000, "colour": "#f4d35e"}, {"label": "£12k+", "value": 12000, "colour": "#c44536"}],
  "freshness": "2026-06", "methodologyPath": "/guide/stock-value",
  "caveats": ["Each dwelling counts once at its last recorded sale; homes never sold since 1995 are absent.", "A home whose last sale predates the price per m² index (June 2006) is not restated and is left out of the median and the count; it is never moved forward as if it had sold in June 2006.", "Areas with fewer than 10 valued dwellings are suppressed.", "Restated sales carry no condition, layout or tenure information: they are not valuations."]
}$json$::jsonb, 'src-os-open-uprn-2026-08')
ON CONFLICT (id) DO NOTHING;

INSERT INTO metric_value (geography_id, metric_id, period, value, region_percentile, country_percentile, sample_count, quality, source_release_id)
WITH medians AS (
    SELECT p.geography_id, v.period,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY v.restated_price_per_square_metre) AS value,
           count(*) AS n
    FROM property_stock_value v JOIN property p ON p.uprn = v.uprn
    GROUP BY p.geography_id, v.period
), ranked AS (
    SELECT *, round(100 * percent_rank() OVER (ORDER BY value))::smallint AS pct FROM medians WHERE n >= 10
)
SELECT g.id, 'stock-value-per-square-metre', m.period,
       CASE WHEN m.n >= 10 THEN round(m.value::numeric, 2) END,
       r.pct, NULL, m.n,
       CASE WHEN m.n >= 10 THEN 'observed'::metric_quality ELSE 'suppressed'::metric_quality END,
       'src-os-open-uprn-2026-08'
FROM area_geography g
JOIN medians m ON m.geography_id = g.id
LEFT JOIN ranked r ON r.geography_id = g.id
WHERE g.kind = 'lsoa'
ON CONFLICT DO NOTHING;

-- Street blocks (migration 006): OSM roads (ODbL) polygonised, intersected with merged parcels.
INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,
    transformation_version, geography_vintage, validation_status, caveats)
VALUES ('src-osm-greater-london-2026-09', 'https://download.geofabrik.de/europe/united-kingdom/england/greater-london-latest.osm.pbf',
  now(), '2026-09-10', '40a8750074d1cc945450b83ccc7f041571ee955fc086df50d94f77a7849baa98', 'ODbL-1.0',
  '© OpenStreetMap contributors', 'close-knit-etl-property-1', '2021', 'passed',
  ARRAY['Roads only (highway=* ways) are used, to cut street blocks; no OSM attribute is shown as evidence.'])
ON CONFLICT (id) DO NOTHING;
-- \copy osm_road (highway, name, geometry) ... from the extracted roads.csv (see etl_property.py roads stage)
SELECT rebuild_city_blocks('src-os-open-uprn-2026-08');

DROP TABLE staging_address_uprn; DROP TABLE staging_uprn_point; DROP TABLE staging_parcel;
ANALYZE parcel; ANALYZE property; ANALYZE property_stock_value; ANALYZE city_block;

-- Release ceremony (run after validating the counts above): assets is a LIST
-- naming a tiles/ entry, which the readiness check requires.
-- INSERT INTO product_release (id, geography_vintage, transformation_versions, assets, validation_status, validation_record)
-- VALUES ('rel-<date>-london-<n>m-v1', '2021',
--   '{"etl": "close-knit-etl-1", "property": "close-knit-etl-property-1"}',
--   '["metrics/crime", "metrics/deprivation", "metrics/income", "metrics/social-renting", "metrics/price-per-square-metre",
--     "metrics/stock-value-per-square-metre", "tiles/property_tile", "tiles/city_block"]', 'passed', '{...counts...}');
-- INSERT INTO product_release_member ... (previous members + src-os-open-uprn-2026-08 + src-hmlr-inspire-2026-09 + src-osm-greater-london-2026-09);
-- SELECT activate_product_release('rel-<date>-london-<n>m-v1');
