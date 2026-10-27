-- 058: where a primary school's Year 6 pupils went to secondary school (docs/area-card-2026-10/decisions.md
-- item 9, school-data-sources.md). Read by api/area_api/school_card.py into school-card.v1 destinations.feeders.
-- Safe to re-run.
--
--   school_feeder_flow  GLA London Schools Atlas, "Primary school feeder schools" (Feeder_Pri2Sec), one row per
--                       published flow: state-funded Year 6 pupils of a London primary counted at the secondary
--                       they went to, Spring School Census of census_year (January). Built by the GLA from the
--                       National Pupil Database; flows under 3 pupils are not published (no row), and
--                       primary_total was counted before that suppression, so primary_total - sum(pupils) is the
--                       pupils in unpublished flows. Loaded by deploy/tools/etl_school_feeders.py.
--                       urn is the current primary in table school; reported_urn the URN the GLA printed (a
--                       predecessor's, before conversion). secondary_urn / secondary_name are as printed;
--                       secondary_current_urn is that secondary's school today in table school (NULL outside
--                       London or when GIAS links give none).

CREATE TABLE IF NOT EXISTS school_feeder_flow (
    urn text NOT NULL REFERENCES school(urn),
    census_year smallint NOT NULL CHECK (census_year BETWEEN 2010 AND 2100),
    reported_urn text NOT NULL CHECK (reported_urn ~ '^[0-9]{6}$'),
    primary_total integer NOT NULL CHECK (primary_total > 0),
    flow_rank smallint NOT NULL CHECK (flow_rank >= 1),     -- Pri2Sec_Flow<n> as printed
    secondary_urn text NOT NULL CHECK (secondary_urn ~ '^[0-9]{6}$'),
    secondary_name text NOT NULL,
    secondary_current_urn text REFERENCES school(urn),
    pupils integer NOT NULL CHECK (pupils >= 3 AND pupils <= primary_total),
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (urn, census_year, secondary_urn)
);

CREATE INDEX IF NOT EXISTS school_feeder_flow_release_idx ON school_feeder_flow (source_release_id);
