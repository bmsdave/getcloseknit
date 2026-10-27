"""Track O: metric definitions link to /guide/<slug>, never the retired /methodology."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (ROOT / "migrations" / "021-guide-methodology-paths.sql").read_text()
GUIDE_ROUTES = (ROOT.parent / "web" / "src" / "lib" / "guide-routes.ts").read_text()
PRODUCERS = ("etl_crime_release.py", "etl_station_access.py", "etl_food_hygiene.py",
             "etl_census_layers.py", "etl_kids.py",
             "property-load.sql")
# Metrics first published after migration 021: their producers write the guide path themselves.
AFTER_021 = {"food-hygiene", "noise", "air-no2", "typical-price", "typical-price-flat", "typical-price-terraced", "typical-price-semi",
             "typical-price-detached", "hpi-change-5y", "hpi-change-10y", "rent-change-1y", "rent-change-5y",
             "council-tax-band-mean", "ownership-company-share", "ownership-overseas-share", "short-lets-per-1000", "pipeline-homes-per-1000",
             # Migration 086 writes its own guide path.
             "mobile-4g-indoor", "mobile-5g-outdoor", "future-station-distance", "hmo-per-1000",
             # Migration 100 (Layers v5 batch 1) writes its own guide paths.
             "typical-rent", "typical-rent-1-bed", "typical-rent-3-bed", "flood-risk", "good-schools-nearby",
             "good-schools-nearby-secondary", "student-share",
             # Migration 101 (Layers v5 batch 2) too.
             "supermarket-walk", "gp-walk", "broadband-gigabit",
             # etl_kids.py writes its own guide path; migration 120 repairs a stored definition.
             "road-collisions"}


def metric_guide_all():
    """METRIC_GUIDE from guide-routes.ts."""
    body = GUIDE_ROUTES.split("METRIC_GUIDE", 1)[1].split("};", 1)[0]
    pairs = re.findall(r'"?([\w-]+)"?:\s*"([\w-]+)"', body)
    return {metric: f"/guide/{slug}" for metric, slug in pairs}


def metric_guide():
    """METRIC_GUIDE minus metrics with no stored definition and those published after migration 021."""
    return {metric: path for metric, path in metric_guide_all().items()
            if metric != "personal-match" and metric not in AFTER_021}


class GuideMethodologyPathTests(unittest.TestCase):
    def test_migration_matches_the_web_mapping(self):
        rows = dict(re.findall(r"\('([\w-]+)', '(/guide/[\w-]+)'\)", MIGRATION))
        self.assertEqual(rows, metric_guide())

    def test_migration_120_links_road_collisions_to_the_crime_guide(self):
        later = (ROOT / "migrations" / "120-taxonomy-drift.sql").read_text()
        self.assertEqual(metric_guide_all()["road-collisions"], "/guide/crime")
        self.assertIn("to_jsonb('/guide/crime'::text)", later)
        self.assertIn("WHERE id = 'road-collisions'", later)

    def test_migration_only_rewrites_the_path(self):
        self.assertNotIn("ALTER TABLE", MIGRATION)
        self.assertNotIn("DELETE", MIGRATION)
        self.assertIn("'{methodologyPath}'", MIGRATION)

    def test_producers_write_guide_paths(self):
        for name in PRODUCERS:
            text = (ROOT / "tools" / name).read_text()
            self.assertNotIn('"/methodology', text, name)
            self.assertIn('"methodologyPath": "/guide/', text, name)


if __name__ == "__main__":
    unittest.main()
