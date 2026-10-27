-- 094: combined A-level (sixth-form) rank of state and independent schools (issue #201).
--
--   school_sixth_form_rank  one row per London school with a sixth form of 20+ A-level students,
--                           per academic year: its place on the A level average point score per
--                           entry among every RECTYPE 1 (mainstream) school in England that published
--                           a figure that year, state and independent in one pool (DfE 16-18 results,
--                           OGL v3.0; independents' rows are kept by deploy/tools/etl_school_performance.py
--                           and linked to independent_school by URN).
--
-- A table of its own, next to school_national_rank, for two reasons:
--   * school_national_rank.urn REFERENCES school(urn), and independent schools are not in `school`
--     (migration 067 keeps them in independent_school), so the combined rows cannot live there;
--   * the state-only KS2/KS4 ranks in school_national_rank are never overwritten or mixed into this
--     pool. Readers that need one scale join or union the two tables explicitly.
--
-- rank / pool_size are the England-wide place and pool; the London place is derived by readers
-- (rank() over the London rows ordered by the England rank, as school-points does for the
-- state ranks). Equal (value, average grade) pairs share the best rank (1, 2, 2, 4);
-- top_percent = ceil(rank / pool_size * 100). tiebreak_value is the average A level grade in
-- DfE points (A* = 60 .. U = 0, +/- half a grade). cohort_size is the A-level student count the
-- 20-minimum was checked against. Read only through the active product release. Safe to run again
-- (the loader deletes and re-inserts by source_release_id).
--
-- Independent and selective (grammar) schools choose their pupils, so high results partly reflect
-- who gets in, not only teaching. Some independent schools don't publish results.

CREATE TABLE IF NOT EXISTS school_sixth_form_rank (
    urn text NOT NULL CHECK (urn ~ '^[0-9]{6}$'),
    academic_year text NOT NULL CHECK (academic_year ~ '^[0-9]{4}/[0-9]{2}$'),
    kind text NOT NULL CHECK (kind IN ('state', 'independent')),
    ranked_urn text NOT NULL CHECK (ranked_urn ~ '^[0-9]{6}$'),
    measure text NOT NULL DEFAULT 'ks5-alevel-aps',
    value double precision NOT NULL,
    tiebreak_value double precision,
    cohort_size integer CHECK (cohort_size IS NULL OR cohort_size >= 0),
    rank integer NOT NULL CHECK (rank >= 1),
    pool_size integer NOT NULL CHECK (pool_size >= 1),
    top_percent smallint NOT NULL CHECK (top_percent BETWEEN 1 AND 100),
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (urn, academic_year)
);
CREATE INDEX IF NOT EXISTS school_sixth_form_rank_release_idx ON school_sixth_form_rank (source_release_id);
CREATE INDEX IF NOT EXISTS school_sixth_form_rank_year_idx ON school_sixth_form_rank (academic_year, rank);
