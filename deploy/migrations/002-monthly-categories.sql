-- 002: monthly offence-category breakdown backing the area evidence panel.
--
-- metric_value_breakdown carries per-category offence counts for the same
-- (geography, metric, period) grain as metric_value. Headline rates stay in
-- metric_value; anti-social behaviour is counted here as its own category and
-- excluded from the headline. Rows are covered by the same release-membership
-- reads as metric_value (see BREAKDOWN_SQL in area_api/evidence.py).

CREATE TABLE metric_value_breakdown (
    geography_id text NOT NULL REFERENCES area_geography(id),
    metric_id text NOT NULL REFERENCES metric_definition(id),
    period date NOT NULL,
    category text NOT NULL,
    offence_count integer NOT NULL CHECK (offence_count >= 0),
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (geography_id, metric_id, period, category)
);

CREATE INDEX metric_value_breakdown_lookup_idx
    ON metric_value_breakdown (geography_id, metric_id, period);
