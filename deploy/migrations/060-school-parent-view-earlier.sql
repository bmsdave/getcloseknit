-- 060: Ofsted Parent View from the earlier survey (questions in use before 10 November 2025) next to the current
-- one (docs/area-card-2026-10/school-card-open-spec.md, "Parent View"). Safe to re-run.
--
--   school_parent_view  one row per school and survey: survey '2025-11' (the questions in use since 10 November
--                       2025) or 'pre-2025-11' (the earlier questions; only a release whose period ended before
--                       10 November 2025). The two surveys ask different questions and are never mixed: the card
--                       shows the newest survey a school has (deploy/tools/etl_school_parent_view.py).

ALTER TABLE school_parent_view DROP CONSTRAINT IF EXISTS school_parent_view_survey_check;
ALTER TABLE school_parent_view DROP CONSTRAINT IF EXISTS school_parent_view_period_start_check;
ALTER TABLE school_parent_view DROP CONSTRAINT IF EXISTS school_parent_view_survey_period_check;
ALTER TABLE school_parent_view ADD CONSTRAINT school_parent_view_survey_period_check CHECK (
    (survey = '2025-11' AND period_start >= DATE '2025-11-10')
    OR (survey = 'pre-2025-11' AND as_at < DATE '2025-11-10'));

DO $$
BEGIN
    IF (SELECT array_length(conkey, 1) FROM pg_constraint WHERE conname = 'school_parent_view_pkey') = 1 THEN
        ALTER TABLE school_parent_view DROP CONSTRAINT school_parent_view_pkey;
        ALTER TABLE school_parent_view ADD CONSTRAINT school_parent_view_pkey PRIMARY KEY (urn, survey);
    END IF;
END $$;
