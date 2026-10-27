-- 021: metric "Read more" links point at the guide (track O).
--
-- /methodology was retired for /guide/<slug>; the metric definitions stored in
-- earlier releases still carry "/methodology" or "/methodology#<anchor>". This
-- rewrites only definition->methodologyPath, using the metric -> guide mapping
-- in web/src/lib/guide-routes.ts (METRIC_GUIDE). No table is altered; on an
-- empty database it changes nothing. The ETL tools write the new paths.

UPDATE metric_definition m
   SET definition = jsonb_set(m.definition, '{methodologyPath}', to_jsonb(g.path))
  FROM (VALUES
    ('price-per-square-metre', '/guide/price-per-m2'),
    ('stock-value-per-square-metre', '/guide/stock-value'),
    ('crime', '/guide/crime'),
    ('deprivation', '/guide/deprivation'),
    ('income', '/guide/income'),
    ('social-renting', '/guide/social-renting'),
    ('station-access', '/guide/getting-around')
  ) AS g(metric_id, path)
 WHERE m.id = g.metric_id
   AND m.definition->>'methodologyPath' IS DISTINCT FROM g.path;
