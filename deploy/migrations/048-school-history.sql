-- 048: school history — results by year, every Ofsted inspection, admission demand and the
-- distance of the last place offered, for London state schools.
--
-- Every row hangs off the school as it is today (school.urn). Rows published under a
-- predecessor URN (academy conversion, amalgamation) are mapped to the current school by
-- deploy/tools/school_history_common.py (GIAS links); rows that cannot be mapped are reported,
-- never loaded.
--
--   school_observation            (schema.sql) one row per school, measure and academic year;
--                                 observation_kind is a measure id from deploy/tools/school_measures.py.
--   school_inspection             every inspection from Ofsted management information; the report
--                                 card framework (Nov 2025) has no overall grade, so overall is NULL.
--   school_admission_demand       DfE applications and offers per school and entry year.
--   school_admission_observation  (schema.sql) the last place offered from each council's on-time
--                                 offer tables, extended below with the printed value and counts.
--
-- academic_year is the year of entry written as in the performance tables ('2026/27' for
-- September 2026); entry_year is its first calendar year (2026). Distances are metres
-- (miles x 1609.344, rounded); raw_value keeps the cell as printed. publishable is true only
-- for councils whose terms allow re-use; everything else is kept for review and stays off the
-- site. In school_admission_observation, rule_id is the entry point ('reception') or, where a
-- council prints one row per criterion or band, '<entry point>:<rule>'; school_site_id is 'main'
-- unless the council lists sites separately. Safe to re-run.

CREATE TABLE IF NOT EXISTS school_inspection (
    urn text NOT NULL REFERENCES school(urn),
    inspection_number text NOT NULL,
    -- The URN the school had when inspected (a predecessor's, before conversion).
    inspected_urn text NOT NULL CHECK (inspected_urn ~ '^[0-9]{6}$'),
    start_date date,
    publication_date date,
    inspection_type text,
    -- 'pre-2015', 'cif-2015', 'eif-2019', 'eif-2024-no-overall', 'report-card-2025', as loaded.
    framework text,
    overall smallint CHECK (overall BETWEEN 1 AND 4),
    judgements jsonb NOT NULL DEFAULT '{}'::jsonb,
    report_url text,
    improve_text text,
    key_findings text,
    text_extracted_at timestamptz,
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (urn, inspection_number)
);

CREATE INDEX IF NOT EXISTS school_inspection_release_idx ON school_inspection (source_release_id);

CREATE TABLE IF NOT EXISTS school_admission_demand (
    urn text NOT NULL REFERENCES school(urn),
    entry_year integer NOT NULL CHECK (entry_year BETWEEN 2000 AND 2100),
    entry_point text NOT NULL CHECK (entry_point IN ('reception', 'year7')),
    first_preferences integer CHECK (first_preferences >= 0),
    any_preferences integer CHECK (any_preferences >= 0),
    offers integer CHECK (offers >= 0),
    first_preference_offers integer CHECK (first_preference_offers >= 0),
    pan integer CHECK (pan >= 0),
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (urn, entry_year, entry_point)
);

CREATE INDEX IF NOT EXISTS school_admission_demand_release_idx
    ON school_admission_demand (source_release_id);

ALTER TABLE school_admission_observation
    ADD COLUMN IF NOT EXISTS entry_point text CHECK (entry_point IN ('reception', 'year3', 'year7')),
    ADD COLUMN IF NOT EXISTS all_offered boolean,
    ADD COLUMN IF NOT EXISTS last_offer_criterion text,
    ADD COLUMN IF NOT EXISTS applicants integer CHECK (applicants >= 0),
    ADD COLUMN IF NOT EXISTS offers integer CHECK (offers >= 0),
    ADD COLUMN IF NOT EXISTS refused integer CHECK (refused >= 0),
    ADD COLUMN IF NOT EXISTS raw_value text,
    ADD COLUMN IF NOT EXISTS publishable boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS school_admission_observation_release_idx
    ON school_admission_observation (source_release_id);

-- Results are loaded and replaced per source release, and counted per measure and year.
CREATE INDEX IF NOT EXISTS school_observation_release_idx ON school_observation (source_release_id);
CREATE INDEX IF NOT EXISTS school_observation_kind_year_idx
    ON school_observation (observation_kind, academic_year);
