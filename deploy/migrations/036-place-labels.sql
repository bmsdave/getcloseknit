-- Places map layer as labels (replaces 035's place_tile()): the web draws each place as an icon and its
-- name, and MapLibre keeps the most important when labels collide, like the basemap's own POI labels.
-- The tile carries an importance `score` (0-100, higher first) and thins by zoom: zoom 14 keeps only
-- landmarks and well-confirmed places, zoom 15 a few more, zoom 16+ every confident named place except
-- generic one-source entries (offices, trades). Same rows as 035: confidence >= 0.6, named, never religion.
-- Tiles carry OSM-derived rows: the layer's attribution names ODbL 1.0 (OSM), OGL v3.0 (FSA register),
-- CDLA-Permissive-2.0 (Overture) and Apache 2.0 (Foursquare).

-- What a place's category is worth on a map someone uses to judge a street: landmarks a visitor finds
-- their way by (big food shops, markets, cinemas and theatres, gyms and pools, libraries) first; everyday
-- food, drink and shops next; offices, trades and services last. Categories are places_taxonomy.json keys.
CREATE OR REPLACE FUNCTION public.place_category_weight(category text)
RETURNS integer
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
SELECT CASE
    WHEN category IN ('supermarket', 'marketplace', 'department_store', 'mall', 'cinema', 'theatre',
                      'arts_centre', 'music_venue', 'museum', 'gallery', 'events_venue',
                      'stadium', 'sports_centre', 'swimming_pool', 'library', 'ice_rink') THEN 45
    WHEN category IN ('fitness_centre', 'hospital', 'university') THEN 38
    WHEN category IN ('pub', 'cafe', 'coffee_shop', 'post_office', 'bowling_alley', 'attraction',
                      'climbing', 'yoga', 'park') THEN 28
    WHEN category IN ('restaurant', 'bakery', 'bar', 'biergarten', 'brewery', 'nightclub', 'greengrocer',
                      'butcher', 'deli', 'books', 'food_court', 'community_centre', 'garden',
                      'nature_reserve', 'dance', 'escape_game', 'trampoline_park', 'pitch', 'dojo') THEN 22
    WHEN category IN ('fast_food', 'kebab', 'ice_cream', 'convenience', 'newsagent', 'cheese', 'seafood',
                      'health_food', 'pastry', 'confectionery', 'chocolate', 'wine', 'alcohol', 'florist',
                      'clothes', 'shoes', 'second_hand', 'charity', 'hardware', 'doityourself', 'bicycle_shop',
                      'sports', 'outdoor', 'toys', 'gift', 'stationery', 'electronics', 'optician',
                      'pharmacy', 'chemist', 'doctors', 'clinic', 'bank', 'hotel', 'college', 'playground', 'police',
                      'golf_course', 'miniature_golf', 'horse_riding') THEN 15
    WHEN place_group(category) <> 'other' THEN 10
    WHEN category IN ('school', 'dentist', 'veterinary', 'hairdresser', 'laundry', 'dry_cleaning',
                      'coworking', 'hostel', 'guest_house', 'indoor_play', 'casino') THEN 8
    ELSE 2
END
$$;

-- Importance 0-100: the category's weight, plus how far the sources agree (confidence, and each source
-- beyond the first), a recognised brand where the category itself matters (a chain supermarket, not a
-- branded charging point), and a register-rated food place.
CREATE OR REPLACE FUNCTION public.place_importance(category text, confidence real, sources text[],
                                                   brand text, hygiene_rating text)
RETURNS integer
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
SELECT least(100, place_category_weight(category)
    + round(20 * coalesce(confidence, 0))::integer
    + 8 * greatest(coalesce(cardinality(sources), 1) - 1, 0)
    + CASE WHEN brand IS NOT NULL AND place_category_weight(category) >= 10 THEN 10 ELSE 0 END
    + CASE WHEN hygiene_rating IS NOT NULL AND place_group(category) IN ('coffee', 'fast_food', 'restaurant', 'pub')
           THEN 5 ELSE 0 END)
$$;

-- Labels from zoom 14 (NULL below: the API answers 204). Each zoom keeps places scoring at least its floor,
-- and zooms 14-15 keep only the best place per group in each grid cell (8 cells per tile edge at 14,
-- 16 at 15, about 64 and 32 px) so the group filter still finds every group. sources is comma-joined
-- (MVT has no arrays): fhrs, overture, osm, fsq. score orders the labels (symbol-sort-key).
CREATE OR REPLACE FUNCTION public.place_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    bounds geometry := ST_TileEnvelope(z, x, y);
    cells integer := CASE WHEN z >= 16 THEN 0 WHEN z = 15 THEN 16 ELSE 8 END;
    floor_score integer := CASE WHEN z >= 16 THEN 16 WHEN z = 15 THEN 50 ELSE 65 END;
    cell double precision := (ST_XMax(ST_TileEnvelope(z, x, y)) - ST_XMin(ST_TileEnvelope(z, x, y))) / greatest(cells, 1);
    tile bytea;
BEGIN
    IF z < 14 THEN
        RETURN NULL;
    END IF;
    SELECT ST_AsMVT(f, 'places', 4096, 'geom') INTO tile FROM (
        SELECT DISTINCT ON (q."group", q.cx, q.cy)
               ST_AsMVTGeom(q.point, bounds, 4096, 0, true) AS geom,
               q.id, q.name, q.category, q."group", q.brand, q.sources, q.hygiene_rating, q.score
        FROM (
            SELECT r.*,
                   -- zoom 16+: every place is its own cell
                   CASE WHEN cells = 0 THEN r.id ELSE floor(ST_X(r.point) / cell)::text END AS cx,
                   CASE WHEN cells = 0 THEN '' ELSE floor(ST_Y(r.point) / cell)::text END AS cy
            FROM (
                SELECT ST_Transform(p.location, 3857) AS point, p.id, p.name, p.category,
                       place_group(p.category) AS "group", p.tags->>'brand' AS brand,
                       array_to_string(p.sources, ',') AS sources, p.hygiene_rating,
                       place_importance(p.category, p.confidence, p.sources, p.tags->>'brand', p.hygiene_rating) AS score
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
            ) r
            WHERE r.score >= floor_score
        ) q
        ORDER BY q."group", q.cx, q.cy, q.score DESC, q.id
    ) f WHERE f.geom IS NOT NULL;
    RETURN tile;
END;
$$;
