-- 067: London's independent (private) schools for the map's Show › Schools, loaded by
-- deploy/tools/etl_independent_schools.py from DfE Get Information about Schools (OGL v3).
--
--   independent_school  one row per open "Other independent school" in a London borough: name, ages,
--                       GIAS gender, religious character, whether it has an official sixth form, and
--                       its point. No Ofsted grade (most are inspected by ISI), no rank, no head
--                       teacher or other personal field.
--
-- A table of its own: `school` stays state-funded, so ranks, Ofsted, cards, search and area counts
-- read exactly what they read before. Read only through the active product release. Safe to run again.

CREATE TABLE IF NOT EXISTS independent_school (
    urn text PRIMARY KEY CHECK (urn ~ '^[0-9]{6}$'),
    name text NOT NULL,
    local_authority text NOT NULL,
    age_from smallint CHECK (age_from BETWEEN 0 AND 99),
    age_to smallint CHECK (age_to BETWEEN 0 AND 99),
    gender text CHECK (gender IN ('Mixed', 'Girls', 'Boys')),
    religious_character text,
    sixth_form boolean,
    postcode text,
    location geometry(Point, 4326) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS independent_school_location_gix ON independent_school USING gist (location);
CREATE INDEX IF NOT EXISTS independent_school_release_idx ON independent_school (source_release_id);
