-- 102: Green streets' band: the zone of homes along each street with trees, for the map (owner, 2026-10-20,
--      Trees-green-streets board, Option 1).
--
--   green_street_tile  gains a second layer, `green_street_bands`, from zoom 14: every road link with
--                      street trees (migration 066's road_link, OS Open Roads, OGL v3) as a buffer 35 m
--                      each side of its centre line, the homes fronting it, with its trees per 100 m so
--                      the map shades them in the street's green under the line. Links just outside the
--                      tile whose band reaches in are included, so the zones never break at a tile seam.
--                      The `green_streets` layer is as in 066. No table, no data load: built per tile from
--                      road_link alone (no join to homes or parcels).
--
-- Safe to run again.

CREATE OR REPLACE FUNCTION public.green_street_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    bounds geometry := ST_TileEnvelope(z, x, y);
    box geometry := ST_Transform(bounds, 27700);
    tile bytea;
    bands bytea;
BEGIN
    IF z < 13 THEN
        RETURN NULL;
    END IF;
    SELECT ST_AsMVT(f, 'green_streets', 4096, 'geom') INTO tile FROM (
        SELECT ST_AsMVTGeom(ST_Transform(r.geometry, 3857), bounds, 4096, 64, true) AS geom,
               r.name, r.trees,
               round((r.trees * 100.0 / greatest(r.length_m, 50))::numeric, 1)::real AS per_100m,
               CASE WHEN r.trees > 0 AND r.canopy_trees * 5 >= r.trees * 4
                    THEN round(least(1, r.canopy_sum_m / (2 * greatest(r.length_m, 50)))::numeric, 2)::real END AS canopy
        FROM road_link r
        WHERE r.geometry && box
    ) f WHERE f.geom IS NOT NULL;
    IF z >= 14 THEN
        -- 35 m in the British grid's metres. Flat ends: links are short (one per junction), so round ends
        -- would draw a disc at every junction; a flat end stops where the link does, and the next link's
        -- band carries on. quad_segs 4 keeps the bends' round joins light.
        SELECT ST_AsMVT(f, 'green_street_bands', 4096, 'geom') INTO bands FROM (
            SELECT ST_AsMVTGeom(ST_Transform(ST_Buffer(r.geometry, 35, 'endcap=flat join=round quad_segs=4'), 3857),
                                bounds, 4096, 64, true) AS geom,
                   round((r.trees * 100.0 / greatest(r.length_m, 50))::numeric, 1)::real AS per_100m
            FROM road_link r
            WHERE r.trees > 0 AND r.geometry && ST_Expand(box, 35)
        ) f WHERE f.geom IS NOT NULL;
        tile := coalesce(tile, ''::bytea) || coalesce(bands, ''::bytea);
    END IF;
    RETURN tile;
END;
$$;
