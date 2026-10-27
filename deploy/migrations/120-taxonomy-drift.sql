-- 120: places and metric definitions catch up with the web and the places taxonomy (2026-10-26).
-- Safe to run again; apply with psql --single-transaction -v ON_ERROR_STOP=1.
--
-- Turkish grills became a places category (places_taxonomy.json "food": turkish_grill), but place_group()
-- from migration 035 did not list it, so those places drew as 'other' on the Places layer and in downloads.
-- They join kebab in 'fast_food'. The rest of the function is 035's, unchanged.
-- deploy/tests/test_place_tile_schema.py checks the newest place_group() against the taxonomy.
CREATE OR REPLACE FUNCTION public.place_group(category text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
SELECT CASE
    WHEN category IN ('cafe', 'coffee_shop', 'ice_cream') THEN 'coffee'
    WHEN category IN ('fast_food', 'kebab', 'turkish_grill', 'food_court') THEN 'fast_food'
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

-- road-collisions links to the crime guide (web/src/lib/guide-routes.ts METRIC_GUIDE). etl_kids.py writes that
-- path itself; this only repairs a stored definition that lacks it. Only methodologyPath changes.
UPDATE metric_definition
   SET definition = jsonb_set(definition, '{methodologyPath}', to_jsonb('/guide/crime'::text))
 WHERE id = 'road-collisions'
   AND definition->>'methodologyPath' IS DISTINCT FROM '/guide/crime';
