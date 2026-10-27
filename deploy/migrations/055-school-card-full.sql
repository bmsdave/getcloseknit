-- 055: the rest of the school card's rows from open data (docs/area-card-2026-10/decisions.md item 9,
-- school-data-sources.md). Read by api/area_api/school_card.py into school-card.v1. Safe to re-run.
--
--   school_national_rank  each London school's place among England's state mainstream schools, per
--                         academic year, on one measure per phase (deploy/tools/etl_school_performance.py
--                         RANK_RULES): KS2 % at the expected standard in reading, writing and maths (ties
--                         broken by % at the higher standard) or KS4 Attainment 8. Schools with a
--                         suppressed or missing figure are not in the pool. Equal values share the best
--                         rank (1, 2, 2, 4); top_percent = ceil(rank / pool_size * 100). ranked_urn is the
--                         URN the figure was published under (a predecessor's, before conversion).
--                         source_release_id is the KS2 / KS4 file's own release.
--   school_profile        GIAS facts the slim GIAS extract leaves out: single-sex or mixed, the trust
--                         of an academy, and capacity with the pupils counted at the same census
--                         (deploy/tools/etl_school_profile.py).
--   school_admission_demand  second and third preferences and offers by preference, as published.

CREATE TABLE IF NOT EXISTS school_national_rank (
    urn text NOT NULL REFERENCES school(urn),
    phase text NOT NULL CHECK (phase IN ('primary', 'secondary')),
    academic_year text NOT NULL CHECK (academic_year ~ '^[0-9]{4}/[0-9]{2}$'),
    ranked_urn text NOT NULL CHECK (ranked_urn ~ '^[0-9]{6}$'),
    measure text NOT NULL,
    value real NOT NULL,
    tiebreak_value real,
    rank integer NOT NULL CHECK (rank > 0),
    pool_size integer NOT NULL CHECK (pool_size >= rank),
    top_percent smallint NOT NULL CHECK (top_percent BETWEEN 1 AND 100),
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (urn, phase, academic_year)
);

CREATE INDEX IF NOT EXISTS school_national_rank_release_idx ON school_national_rank (source_release_id);

CREATE TABLE IF NOT EXISTS school_profile (
    urn text PRIMARY KEY REFERENCES school(urn),
    gender text,                -- GIAS Gender (name): Mixed, Girls or Boys
    trust_code text,
    trust_name text,
    capacity integer CHECK (capacity >= 0),
    pupils integer CHECK (pupils >= 0),
    census_date date,           -- the census GIAS took pupils from
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE INDEX IF NOT EXISTS school_profile_release_idx ON school_profile (source_release_id);

ALTER TABLE school_admission_demand
    ADD COLUMN IF NOT EXISTS second_preferences integer CHECK (second_preferences >= 0),
    ADD COLUMN IF NOT EXISTS third_preferences integer CHECK (third_preferences >= 0),
    ADD COLUMN IF NOT EXISTS preferred_offers integer CHECK (preferred_offers >= 0),
    ADD COLUMN IF NOT EXISTS second_preference_offers integer CHECK (second_preference_offers >= 0),
    ADD COLUMN IF NOT EXISTS third_preference_offers integer CHECK (third_preference_offers >= 0);
