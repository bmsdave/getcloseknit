from pathlib import Path
import unittest


SHIP = (Path(__file__).parents[1] / "ship.sh").read_text()


class ShipReleaseBuildTests(unittest.TestCase):
    """What a release derives is built into release_artifact (api/area_api/release_build.py) before the new API
    starts; the API itself warms nothing."""

    def test_the_new_image_builds_the_release_before_the_api_restarts(self):
        build = SHIP.index("$compose run --rm --no-deps -T api python -m area_api.release_build --tiers 0,1")
        self.assertLess(SHIP.index("$compose build api mcp web"), build)
        self.assertLess(SHIP.index("./migrate.sh apply"), build, "the table exists before the build writes it")
        self.assertLess(build, SHIP.index("$compose up -d --build --no-deps api mcp web"))
        self.assertIn('ship: the release build failed (see above); nothing was restarted" >&2; exit 1', SHIP)

    def test_the_rest_of_the_map_builds_in_the_background(self):
        self.assertIn("$compose exec -d api python -m area_api.release_build --tiers 2,3", SHIP)
        self.assertNotIn("area_api.warm_cache", SHIP)

    def test_lenses_are_built_by_the_release_build_not_warmed_over_http(self):
        self.assertNotIn("/api/v1/area-values/lens/", SHIP)
        self.assertNotRegex(SHIP, r"\$base/api/v1/area-values")

    def test_the_mcp_process_ships_with_the_api(self):
        self.assertIn("up -d --build --no-deps api mcp web", SHIP)

    def test_the_price_scale_warms_through_the_web_app(self):
        self.assertIn('"$base/api/v1/price-scale?mode=real&release=$release"', SHIP)


if __name__ == "__main__":
    unittest.main()
