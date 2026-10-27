-- 099: a school's website, phone and LAESTAB from GIAS, for the school page's Visit & links.
--
-- school_profile (055) gains three columns from the same OGL v3.0 GIAS edubasealldata file that
-- deploy/tools/etl_school_profile.py already reads:
--   website    SchoolWebsite as published ("www.x.org.uk" or a full URL); the API normalises it and
--              /go/school-website rebuilds the redirect from this column, never from the request
--   telephone  TelephoneNum: the school's published switchboard number
--   laestab    LA (code) / EstablishmentNumber, "201/3614", the DfE number councils and forms use
-- Head teacher names (HeadTitle/HeadFirstName/HeadLastName) are not loaded: a named person, owner call.
-- Safe to re-run. Reload afterwards: etl_school_profile.py fetch && etl_school_profile.py load.

ALTER TABLE school_profile
    ADD COLUMN IF NOT EXISTS website text,
    ADD COLUMN IF NOT EXISTS telephone text,
    ADD COLUMN IF NOT EXISTS laestab text CHECK (laestab ~ '^[0-9]{3}/[0-9]{4}$');
