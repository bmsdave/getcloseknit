-- The analytics UI shows areas by name ("Gillespie Road · N5"), not only by code: the read-only role
-- (migration 050) may also read area_label, which holds public place names and postcode districts only.
GRANT SELECT ON area_label TO close_knit_analytics;
