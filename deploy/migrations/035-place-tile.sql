-- Places map layer: vector tiles of the unified place table (migration 034) for the web's "Places"
-- overlay, served by GET /api/v1/tiles/places/{z}/{x}/{y}.pbf. Only places the sources agree on
-- (confidence >= 0.6) and that have a name, from zoom 14. Places of worship and religion are never
-- stored in place; place_tile() still refuses them so a future loader change cannot put them on the map.
-- Tiles carry OSM-derived rows: the layer's attribution names ODbL 1.0 (OSM), OGL v3.0 (FSA register),
-- CDLA-Permissive-2.0 (Overture) and Apache 2.0 (Foursquare).

CREATE INDEX IF NOT EXISTS place_location_gix ON place USING gist (location) WHERE confidence >= 0.6;

-- Map group of a place category (places_taxonomy.json keys). Groups: coffee, fast_food, restaurant,
-- pub, gym, shop, culture, other. deploy/tests/test_place_tile_schema.py checks the lists against the
-- taxonomy's food_shop/shop, drink, fitness and culture groups.
CREATE OR REPLACE FUNCTION public.place_group(category text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
SELECT CASE
    WHEN category IN ('cafe', 'coffee_shop', 'ice_cream') THEN 'coffee'
    WHEN category IN ('fast_food', 'kebab', 'food_court') THEN 'fast_food'
    WHEN category = 'restaurant' THEN 'restaurant'
    WHEN category IN ('pub', 'bar', 'nightclub', 'biergarten', 'brewery') THEN 'pub'
    WHEN category IN ('fitness_centre', 'yoga', 'sports_centre', 'swimming_pool', 'pitch', 'dance', 'dojo',
                      'golf_course', 'miniature_golf', 'bowling_alley', 'stadium', 'ice_rink', 'horse_riding',
                      'escape_game', 'trampoline_park') THEN 'gym'
    WHEN category IN (
        -- food_shop
        'bakery', 'pastry', 'supermarket', 'convenience', 'greengrocer', 'butcher', 'deli', 'alcohol', 'wine',
        'beverages', 'confectionery', 'chocolate', 'seafood', 'health_food', 'frozen_food', 'coffee_retail',
        'tea_retail', 'cheese', 'food', 'newsagent', 'kiosk', 'marketplace',
        -- shop
        'shop', 'clothes', 'shoes', 'jewelry', 'watches', 'bag', 'fashion_accessories', 'boutique', 'second_hand',
        'charity', 'department_store', 'mall', 'variety_store', 'gift', 'florist', 'books', 'stationery', 'art',
        'craft_shop', 'fabric', 'frame', 'music', 'musical_instrument', 'video_games', 'toys', 'party', 'sports',
        'outdoor', 'bicycle_shop', 'electronics', 'mobile_phone', 'computer', 'hifi', 'photo', 'electrical',
        'furniture', 'interior_decoration', 'houseware', 'kitchen', 'bathroom_furnishing', 'bed', 'carpet',
        'flooring', 'tiles', 'lighting', 'appliance', 'doityourself', 'hardware', 'paint', 'garden_centre', 'trade',
        'wholesale', 'pet', 'cosmetics', 'perfumery', 'chemist', 'optician', 'hearing_aids', 'medical_supply',
        'baby_goods', 'car', 'car_parts', 'tyres', 'motorcycle', 'antiques', 'pawnbroker', 'money_lender',
        'tobacco', 'e_cigarette', 'ticket', 'storage_rental', 'travel_agency') THEN 'shop'
    WHEN category IN ('cinema', 'theatre', 'arts_centre', 'music_venue', 'events_venue', 'museum', 'gallery',
                      'attraction') THEN 'culture'
    ELSE 'other'
END
$$;

-- Points from zoom 14 (NULL below: the API answers 204). Zooms 14-15 keep the most confident place per
-- group in each grid cell (32 cells per tile edge at 14, 64 at 15, about 8 px) so a central tile stays
-- small and every group still shows; zoom 16+ has every place. sources is comma-joined (MVT has no
-- arrays): fhrs, overture, osm, fsq.
CREATE OR REPLACE FUNCTION public.place_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    bounds geometry := ST_TileEnvelope(z, x, y);
    cells integer := CASE WHEN z >= 16 THEN 0 WHEN z = 15 THEN 64 ELSE 32 END;
    cell double precision := (ST_XMax(ST_TileEnvelope(z, x, y)) - ST_XMin(ST_TileEnvelope(z, x, y))) / greatest(cells, 1);
    tile bytea;
BEGIN
    IF z < 14 THEN
        RETURN NULL;
    END IF;
    SELECT ST_AsMVT(f, 'places', 4096, 'geom') INTO tile FROM (
        SELECT DISTINCT ON (q."group", q.cx, q.cy)
               ST_AsMVTGeom(q.point, bounds, 4096, 0, true) AS geom,
               q.id, q.name, q.category, q."group", q.brand, q.sources, q.hygiene_rating
        FROM (
            SELECT ST_Transform(p.location, 3857) AS point, p.id, p.name, p.category,
                   place_group(p.category) AS "group", p.tags->>'brand' AS brand,
                   array_to_string(p.sources, ',') AS sources, p.hygiene_rating, p.confidence,
                   -- zoom 16+: every place is its own cell
                   CASE WHEN cells = 0 THEN p.id ELSE floor(ST_X(ST_Transform(p.location, 3857)) / cell)::text END AS cx,
                   CASE WHEN cells = 0 THEN '' ELSE floor(ST_Y(ST_Transform(p.location, 3857)) / cell)::text END AS cy
            FROM place p
            WHERE p.location && ST_Transform(bounds, 4326)
              AND p.confidence >= 0.6
              AND p.name IS NOT NULL
              -- Never religion: no place of worship, religious shop or office, nor any religion tag.
              AND p.category NOT IN ('place_of_worship', 'monastery', 'religion')
              AND NOT (p.tags ? 'religion')
              AND coalesce(p.tags->>'amenity', '') NOT IN ('place_of_worship', 'monastery')
              AND coalesce(p.tags->>'shop', '') <> 'religion'
              AND coalesce(p.tags->>'office', '') <> 'religion'
        ) q
        ORDER BY q."group", q.cx, q.cy, q.confidence DESC, q.id
    ) f WHERE f.geom IS NOT NULL;
    RETURN tile;
END;
$$;
