# Step 1 spec: postcode sectors + zone analytics (#1–#6)

Scope: postcode **sector** (`W5 1`) and **district** (`W5`) as zones, with
£/m² distribution, price index, returns, neighbouring sectors and streets.
Aggregates only (owner decisions 040/044): no per-home value or £/m², no
addresses. LSOA/MSOA reuse is a later step.

## Data (migration `deploy/migrations/057-postcode-sector.sql`)

No new boundary source: everything derives from tables we already load.

- `postcode_sector(code PK 'W5 1', slug 'W5-1', district 'W5', name, borough_id,
  postcode_count, geometry MultiPolygon 4326, label_point Point 4326)`.
  Geometry = Voronoi cells of distinct `address` postcode points
  (`ST_VoronoiPolygons`), dissolved by sector, clipped to the union of borough
  geometries. `name` = name of the MSOA (`area_geography` + MSOA names already
  used for labels) holding most of the sector's postcodes. `borough_id` = majority.
- `postcode_district` same shape, dissolved from sectors.
- `cpih_month(month date PK, cpih_index, source_release_id)`: ONS CPIH index
  (series L522, OGL, registered as `ons-cpih` in
  `pipelines/area-analytics-ingest/area_analytics/sources.py`). Loader:
  `deploy/tools/etl_cpih.py` from the ONS CSV; tests use the fixture
  `ons-cpih-sample.csv`.
- `zone_ppm_distribution(zone_kind 'sector'|'district', zone_code, period_end,
  sales, p09, p25, p50, p75, p91, bucket_edges int[], bucket_counts int[])`:
  category A sales with non-null `sale.price_per_square_metre`, 24 months to
  the latest `sale_month`. 20 equal buckets between p01 and p99. Suppress
  (no row) under 20 sales.
- `zone_price_index(zone_kind, zone_code, group 'all'|'house'|'flat', year,
  sales, median_ppm, index_nominal, index_real)`: annual median £/m², 2004 = 100;
  real = deflated by annual mean CPIH. Year rows with < 10 sales: NULL index.
  House = D/S/T, flat = F.
- `zone_street(sector, street_name, sales_60m, median_floor_area, median_ppm)`:
  street name = longest OS Open Names `street.name` in the same
  `postcode_district` found in the sale's `address.display_address`
  (case-insensitive). Keep streets with ≥ 5 sales in 60 months.
- `rebuild_zone_analytics(p_source_release_id)` rebuilds all zone tables;
  `deploy/tools/etl_sales.py load` calls it after `rebuild_area_price_bands`.
  Safe to re-run.

## API contract (`api/area_api/zones_sector.py`)

`GET /api/v1/sectors/{slug}` (slug `W5-1`, case-insensitive; 404 otherwise), in
the usual evidence envelope (sources: HMLR Price Paid, EPC floor area,
ONS CPIH, ONSPD; caveats: "£/m² uses EPC floor area; sector names are informal"):

```json
{
  "sector": {"code": "W5 1", "slug": "W5-1", "name": "…", "district": "W5",
             "borough": {"id": "uk:borough:E09000009", "name": "Ealing"},
             "postcodeCount": 0, "geometry": {GeoJSON, simplified}},
  "distribution": {"periodEnd": "2026-07-01",
     "sector":   {"sales": 0, "p09": 0, "p25": 0, "p50": 0, "p75": 0, "p91": 0,
                  "buckets": [{"from": 0, "to": 0, "count": 0}]},
     "district": {same, or null}},
  "index": {"base": 2004, "series": [
     {"zone": "sector"|"district"|"borough-house"|"borough-flat",
      "points": [{"year": 2004, "nominal": 100.0, "real": 100.0, "sales": 0}]}]},
  "returns": [{"years": 1|5|10|20, "zone": "sector"|"district",
               "nominalPa": 0.0, "realPa": 0.0, "nominalTotal": 0.0, "realTotal": 0.0}],
  "nearby": [{"code": "W5 2", "slug": "W5-2", "name": "…", "p25": 0, "p50": 0,
              "p75": 0, "sales": 0, "isSelf": false}],
  "streets": [{"name": "Meadvale Road", "sales": 0, "medianFloorArea": 0, "medianPpm": 0}]
}
```

`nearby` = sectors in the same district plus sectors touching the geometry,
sorted by p50 desc, self included. `streets` sorted by sales desc, max 12.
Returns: CAGR from the nominal/real index; omit a row when either end is NULL.
Also `GET /api/v1/sectors?q=W5` → `[{code, slug, name}]` (prefix match, ≤ 20).

## Web (`web/src/app/sector/[slug]/page.tsx`)

Route `/sector/W5-1`. Fast-scan, graphics over text, follow `DESIGN.md`:

1. Header: `W5 1 · <name>`, borough, mini map of the boundary.
2. Headline tiles: median £/m², 1-year real change (arrow), sales in 24 months.
3. One chart: £/m² histogram for the sector with a sector-vs-district box strip
   (p09–p91 whiskers, p25–p75 box, p50 line).
4. One line chart: index since 2004, sector vs district, nominal dashed /
   real solid; toggle borough houses vs flats.
5. Compact returns table (1/5/10/20 y, nominal/real, sector/district).
6. Nearby sectors: rows with an inline p25–p75 bar on a shared scale, self highlighted, linked.
7. Streets: name, sales, median size, median £/m² bar.

Links in: postcode page ("Sector W5 1" chip) and site search for `W5 1`/`W5-1`.
Add sector pages to the sitemap. Reuse existing chart components; no new chart
dependency.

## Checks

- SQL: rebuild runs on the local DB (`docker exec ae-pgold psql -U postgres -d
  area_explorer`); W5 1 has ≥ 100 sales with £/m² in 24 months; every London
  postcode sector with an address has a row in `postcode_sector`.
- API tests: contract shape, 404, suppression under 20 sales, no
  per-home field (extend `api/tests/test_minimisation.py`).
- Web: typecheck, lint, unit tests; page renders `/sector/W5-1` locally.
