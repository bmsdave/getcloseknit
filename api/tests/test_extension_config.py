import os
import unittest
from unittest import mock

from area_api.extension_config import ENV, FEATURES_ENV, extension_config

try:
    from fastapi.testclient import TestClient
    from area_api import app as app_module
    from tests.test_ratelimit import without_rate_limits
except ImportError:  # pragma: no cover
    TestClient = None

DEFAULT = {"v": 1, "portals": {"rightmove": {"mode": "inline"}, "zoopla": {"mode": "inline"},
                               "onthemarket": {"mode": "inline"}, "spareroom": {"mode": "side-panel"},
                               "openrent": {"mode": "inline"}},
           "features": {"resultsLine": True, "mapPopup": True},
           "notice": "Close Knit is independent and not affiliated with Rightmove, Zoopla, OnTheMarket, "
                     "SpareRoom or OpenRent."}


def config(value, features=""):
    with mock.patch.dict(os.environ, {ENV: value, FEATURES_ENV: features}):
        return extension_config()


class ExtensionConfigTests(unittest.TestCase):
    def test_without_the_env_every_portal_has_its_default(self):
        self.assertEqual(config(""), DEFAULT)

    def test_the_env_switches_a_portal_without_a_release(self):
        portals = config('{"rightmove": "off", "zoopla": "side-panel"}')["portals"]

        self.assertEqual((portals["rightmove"], portals["zoopla"], portals["openrent"]),
                         ({"mode": "off"}, {"mode": "side-panel"}, {"mode": "inline"}))

    def test_unknown_portals_and_modes_are_ignored_and_logged(self):
        with self.assertLogs("area_api.extension_config", "WARNING") as logs:
            result = config('{"rightmove": "hidden", "purplebricks": "off", "zoopla": "off"}')

        self.assertEqual(result["portals"]["rightmove"], {"mode": "inline"})
        self.assertNotIn("purplebricks", result["portals"])
        self.assertEqual(result["portals"]["zoopla"], {"mode": "off"})
        self.assertEqual(len(logs.output), 2)

    def test_bad_json_keeps_the_defaults(self):
        for value in ("{not json", '["off"]'):
            with self.assertLogs("area_api.extension_config", "WARNING"):
                self.assertEqual(config(value), DEFAULT)

    def test_features_are_on_by_default_and_switched_by_their_env(self):
        self.assertEqual(config("", '{"mapPopup": false}')["features"], {"resultsLine": True, "mapPopup": False})

    def test_unknown_features_and_non_boolean_values_are_ignored_and_logged(self):
        with self.assertLogs("area_api.extension_config", "WARNING") as logs:
            result = config("", '{"resultsLine": "no", "overlay": true, "mapPopup": false}')

        self.assertEqual(result["features"], {"resultsLine": True, "mapPopup": False})
        self.assertEqual(len(logs.output), 2)

    def test_bad_features_json_keeps_the_defaults(self):
        for value in ("{not json", "[false]"):
            with self.assertLogs("area_api.extension_config", "WARNING"):
                self.assertEqual(config("", value), DEFAULT)


@unittest.skipIf(TestClient is None, "dependencies are not installed")
class ExtensionConfigRouteTests(unittest.TestCase):
    def setUp(self):
        without_rate_limits(self)
        self.client = TestClient(app_module.app)

    def test_the_route_is_cached_for_five_minutes(self):
        with mock.patch.dict(os.environ, {ENV: "", FEATURES_ENV: ""}):
            response = self.client.get("/api/v1/extension-config")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), DEFAULT)
        self.assertEqual(response.headers["cache-control"], "public, max-age=300")


if __name__ == "__main__":
    unittest.main()
