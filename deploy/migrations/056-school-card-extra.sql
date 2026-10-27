-- 056: Parent View, workforce, finance and destinations on the school card (docs/area-card-2026-10/decisions.md
-- item 9, school-data-sources.md). Read by api/area_api/school_card.py into school-card.v1. Every figure is
-- stored as its publisher printed it; a suppressed or missing figure is NULL. Safe to re-run.
--
--   school_parent_view   Ofsted Parent View management information, school level (only schools with 10 or more
--                        submissions are published). One row per school from the latest release of the survey
--                        that started on 10 November 2025; answers from the earlier survey are never loaded
--                        here (deploy/tools/etl_school_parent_view.py). answers: {"Q1": {"question": text,
--                        "options": {"Strongly agree": percent, ...}}} with only the options the release prints.
--   school_workforce     School Workforce in England, school level (Size of the school workforce, Pupil to
--                        teacher ratios): the latest census year (deploy/tools/etl_school_workforce.py).
--   school_finance       DfE Consistent Financial Reporting (CFR, maintained schools, financial year Apr-Mar) or
--                        Academies Accounts Return (AAR, academic year Sep-Aug): the latest return of each kind
--                        (deploy/tools/etl_school_finance.py). Totals in pounds as published (AAR rounds to
--                        £1,000). The two kinds are different accounts and are never compared.
--   school_destination   KS4 and 16-18 destination measures, institution level, all students: the latest
--                        cohort (deploy/tools/etl_school_destinations.py). reported_urn is the URN the figures
--                        were published under (a predecessor's, before conversion).

CREATE TABLE IF NOT EXISTS school_parent_view (
    urn text PRIMARY KEY REFERENCES school(urn),
    survey text NOT NULL CHECK (survey = '2025-11'),  -- the questions in use since 10 November 2025
    period_start date NOT NULL CHECK (period_start >= DATE '2025-11-10'),
    as_at date NOT NULL CHECK (as_at > period_start),
    submissions integer NOT NULL CHECK (submissions >= 10),
    response_rate real CHECK (response_rate BETWEEN 0 AND 100),
    answers jsonb NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE INDEX IF NOT EXISTS school_parent_view_release_idx ON school_parent_view (source_release_id);

CREATE TABLE IF NOT EXISTS school_workforce (
    urn text NOT NULL REFERENCES school(urn),
    academic_year text NOT NULL CHECK (academic_year ~ '^[0-9]{4}/[0-9]{2}$'),
    teachers_fte real CHECK (teachers_fte >= 0),
    teaching_assistants_fte real CHECK (teaching_assistants_fte >= 0),
    leadership_teachers_fte real CHECK (leadership_teachers_fte >= 0),
    support_staff_fte real CHECK (support_staff_fte >= 0),
    workforce_fte real CHECK (workforce_fte >= 0),
    workforce_headcount integer CHECK (workforce_headcount >= 0),
    teachers_headcount integer CHECK (teachers_headcount >= 0),
    pupils_fte real CHECK (pupils_fte >= 0),
    pupils_per_teacher real CHECK (pupils_per_teacher >= 0),
    pupils_per_adult real CHECK (pupils_per_adult >= 0),
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (urn, academic_year)
);

CREATE INDEX IF NOT EXISTS school_workforce_release_idx ON school_workforce (source_release_id);

CREATE TABLE IF NOT EXISTS school_finance (
    urn text NOT NULL REFERENCES school(urn),
    accounts text NOT NULL CHECK (accounts IN ('CFR', 'AAR')),
    period text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),  -- CFR financial year / AAR academic year
    period_months smallint CHECK (period_months BETWEEN 1 AND 12),
    pupils_fte real CHECK (pupils_fte >= 0),
    revenue_reserve numeric,
    in_year_balance numeric,
    grant_funding numeric,
    self_generated_income numeric,
    total_income numeric,
    staff_costs numeric,
    premises_costs numeric,
    total_expenditure numeric,
    not_supplied_reason text,           -- e.g. reported by its federation's lead school
    federation_lead_urn text,           -- CFR: the federation's lead school (figures cover the federation)
    trust_kind text CHECK (trust_kind IN ('MAT', 'SAT')),
    trust_company_number text,
    trust_name text,
    trust_revenue_reserve numeric,      -- AAR, MAT: central services + every academy's reserve
    trust_academies integer CHECK (trust_academies > 0),
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (urn, accounts)
);

CREATE INDEX IF NOT EXISTS school_finance_release_idx ON school_finance (source_release_id);

CREATE TABLE IF NOT EXISTS school_destination (
    urn text NOT NULL REFERENCES school(urn),
    stage text NOT NULL CHECK (stage IN ('ks4', '16-18')),
    cohort_year text NOT NULL CHECK (cohort_year ~ '^[0-9]{4}/[0-9]{2}$'),  -- the year students finished
    reported_urn text NOT NULL CHECK (reported_urn ~ '^[0-9]{6}$'),
    version text,                       -- Provisional or Revised
    cohort integer CHECK (cohort >= 0),
    sustained_percent real,             -- education, apprenticeship or employment
    education_percent real,
    higher_education_percent real,      -- 16-18 only
    apprenticeship_percent real,
    employment_percent real,
    not_sustained_percent real,
    unknown_percent real,
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (urn, stage, cohort_year)
);

CREATE INDEX IF NOT EXISTS school_destination_release_idx ON school_destination (source_release_id);
