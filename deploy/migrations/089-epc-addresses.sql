-- 089: homes known only from an energy certificate (CLOSE_KNIT_EPC_ADDRESSES, FLAGS.md).
--
-- `property_epc` (020) keeps certificate facts only for UPRNs the property spine knows, so a home
-- with an EPC but no recorded sale has no page and no row in its postcode list. `property_epc_home`
-- keeps those homes: the UPRN, the certificate's postcode and address, the same facts as
-- property_epc, and the LSOA and a point placed from the spine's homes in that postcode (the
-- certificate carries no coordinates). A home whose postcode has no spine home is not kept.
--
-- The certificate address carries Royal Mail/OS rights (DATA-LICENCES.md, EPC row), so the API
-- reads this table only while CLOSE_KNIT_EPC_ADDRESSES is on. Nothing about the occupant (EPC
-- tenure, names) and no running costs are stored. Loaded by deploy/tools/etl_epc.py load.
--
-- Safe to run again. No existing table changes.

CREATE TABLE IF NOT EXISTS property_epc_home (
    uprn text PRIMARY KEY CHECK (uprn ~ '^[0-9]+$'),
    postcode text NOT NULL CHECK (postcode ~ '^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$'),
    display_address text NOT NULL CHECK (display_address <> ''),
    geography_id text NOT NULL REFERENCES area_geography(id),
    location geometry(Point, 4326) NOT NULL,  -- the middle of the spine's homes in the postcode
    lodgement_date date NOT NULL,
    current_rating char(1) CHECK (current_rating ~ '^[A-G]$'),
    potential_rating char(1) CHECK (potential_rating ~ '^[A-G]$'),
    property_type text,
    built_form text,
    construction_age_band text,
    total_floor_area double precision CHECK (total_floor_area IS NULL OR total_floor_area > 0),
    habitable_rooms smallint CHECK (habitable_rooms IS NULL OR habitable_rooms BETWEEN 0 AND 100),
    floor_level text,
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE INDEX IF NOT EXISTS property_epc_home_postcode_idx ON property_epc_home (postcode);
CREATE INDEX IF NOT EXISTS property_epc_home_release_idx ON property_epc_home (source_release_id);

-- staging_epc (facts) + staging_epc_address (uprn, postcode, display_address), the temp tables
-- etl_epc.py fills -> property_epc_home. Only UPRNs the property spine does not know are kept.
CREATE OR REPLACE FUNCTION public.load_property_epc_home(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM property_epc_home WHERE source_release_id = p_source_release_id;
    -- One LSOA (the most common) and one point per postcode, from the spine's homes there.
    WITH spine AS (
        SELECT a.postcode, mode() WITHIN GROUP (ORDER BY p.geography_id) AS geography_id,
               ST_Centroid(ST_Collect(p.location)) AS location
        FROM address a JOIN property p ON p.address_id = a.id
        WHERE a.postcode IN (SELECT DISTINCT postcode FROM staging_epc_address)
        GROUP BY a.postcode)
    INSERT INTO property_epc_home (uprn, postcode, display_address, geography_id, location, lodgement_date,
        current_rating, potential_rating, property_type, built_form, construction_age_band, total_floor_area,
        habitable_rooms, floor_level, source_release_id)
    SELECT s.uprn, t.postcode, t.display_address, spine.geography_id, spine.location, s.lodgement_date,
           s.current_rating, s.potential_rating, s.property_type, s.built_form, s.construction_age_band,
           s.total_floor_area, s.habitable_rooms, s.floor_level, p_source_release_id
    FROM staging_epc s
    JOIN staging_epc_address t ON t.uprn = s.uprn
    JOIN spine ON spine.postcode = t.postcode
    WHERE NOT EXISTS (SELECT 1 FROM property p WHERE p.uprn = s.uprn)
    ON CONFLICT (uprn) DO UPDATE SET
        postcode = excluded.postcode, display_address = excluded.display_address,
        geography_id = excluded.geography_id, location = excluded.location,
        lodgement_date = excluded.lodgement_date, current_rating = excluded.current_rating,
        potential_rating = excluded.potential_rating, property_type = excluded.property_type,
        built_form = excluded.built_form, construction_age_band = excluded.construction_age_band,
        total_floor_area = excluded.total_floor_area, habitable_rooms = excluded.habitable_rooms,
        floor_level = excluded.floor_level, source_release_id = excluded.source_release_id
    WHERE excluded.lodgement_date >= property_epc_home.lodgement_date;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;
