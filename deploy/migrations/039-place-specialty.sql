-- Specialty coffee on the unified place table (034): pipelines/area-analytics-ingest/area_analytics/
-- places_specialty.py scores every coffee shop, café and coffee-bean shop from open signals (how many
-- sources call it a coffee shop, roasters, the name, a short list of London specialty groups; big chains
-- never) and appends "specialty_coffee" to tags.cuisine for places at or over its threshold, so custom
-- criteria match {"cuisine": "specialty_coffee"} unchanged. specialty_score keeps the points for
-- inspection: NULL for places that are not coffee shops or cafés, and for big chains.

ALTER TABLE place ADD COLUMN IF NOT EXISTS specialty_score real;
