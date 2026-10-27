"""A school's Visit & links (school_links.py, migration 099): /go click-outs rebuilt from the URN and the database."""
import os
import unittest
from unittest import mock

from area_api import school_links

try:
    from fastapi.testclient import TestClient

    from area_api import app as app_module
    from area_api.repository import evidence_connection
except ImportError:  # pragma: no cover
    TestClient = None

ROW = {"urn": "100000", "name": "The Aldgate School", "phase": "primary", "local_authority": "City of London",
       "website": "www.thealdgateschool.org"}
BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15"


def flags(**values):
    env = {"CLOSE_KNIT_ACCESS": "public", **{f"CLOSE_KNIT_SCHOOL_LINKS_{k.upper()}": v for k, v in values.items()}}
    return mock.patch.dict(os.environ, env)


class DestinationTests(unittest.TestCase):
    def test_every_target_from_the_urn_name_phase_and_borough(self):
        with flags(gsg="1", locrating="1"):
            got = {target: school_links.destination(target, ROW) for target in school_links.TARGETS.values()}
        self.assertEqual(got, {
            "website": "https://www.thealdgateschool.org",
            "admissions": "https://www.thealdgateschool.org",
            "ofsted": "https://reports.ofsted.gov.uk/provider/ELS/100000",
            "dfe-performance": "https://www.compare-school-performance.service.gov.uk/school/100000",
            "parent-view": "https://parentview.ofsted.gov.uk/parent-view-results?name=The+Aldgate+School",
            "council-admissions": "https://www.gov.uk/apply-for-primary-school-place/city-of-london",
            "gias": "https://get-information-schools.service.gov.uk/Establishments/Establishment/Details/100000",
            "eadmissions": "https://www.eadmissions.org.uk/",
            "gsg": "https://www.goodschoolsguide.co.uk/uk-schools/search?name=the+aldgate+school",
            "locrating": "https://www.locrating.com/schools-0urn100000.aspx",
        })

    def test_guides_are_off_by_default_and_on_in_the_private_preview(self):
        with flags():
            self.assertIsNone(school_links.destination("gsg", ROW))
            self.assertIsNone(school_links.destination("locrating", ROW))
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_ACCESS": "private"}):
            self.assertTrue(school_links.destination("locrating", ROW))
            with flags(locrating="0"):
                self.assertIsNone(school_links.destination("locrating", ROW))

    def test_no_website_sends_admissions_to_the_council(self):
        row = {**ROW, "website": None, "phase": "secondary", "local_authority": "Hammersmith and Fulham"}
        self.assertIsNone(school_links.destination("website", row))
        self.assertEqual(school_links.destination("admissions", row),
                         "https://www.gov.uk/apply-for-secondary-school-place/hammersmith-and-fulham")
        unknown = {**row, "local_authority": "Kent"}
        self.assertEqual(school_links.destination("council-admissions", unknown),
                         "https://www.gov.uk/apply-for-secondary-school-place")

    def test_unknown_targets_and_bad_urns_go_nowhere(self):
        self.assertIsNone(school_links.destination("evil", ROW))
        self.assertIsNone(school_links.destination("ofsted", {**ROW, "urn": "1; DROP"}))

    def test_website_is_normalised_or_refused(self):
        self.assertEqual(school_links.website("http://www.x.sch.uk/home"), "http://www.x.sch.uk/home")
        self.assertEqual(school_links.website("HTTPS://X.org"), "HTTPS://X.org")
        for bad in ("", None, "not a url", "javascript:alert(1)", "https://user:pw@x.org", "localhost", "ftp://x.org"):
            self.assertIsNone(school_links.website(bad), bad)
        self.assertEqual(school_links.website_host("https://www.thealdgateschool.org/"), "thealdgateschool.org")

    def test_phone_is_a_tel_link_with_a_london_number(self):
        self.assertEqual(school_links.phone("02072831147"), {"href": "tel:+442072831147", "number": "020 7283 1147"})
        self.assertEqual(school_links.phone("01895 556 000"), {"href": "tel:+441895556000", "number": "01895 556000"})
        for bad in ("", None, "12345", "not known"):
            self.assertIsNone(school_links.phone(bad))


class CardLinksTests(unittest.TestCase):
    def test_every_key_present_with_go_hrefs_and_null_flags(self):
        with flags():
            links = school_links.links(ROW, "02072831147")
        self.assertEqual(set(links), set(school_links.TARGETS) | {"phone"})
        self.assertEqual(links["website"], {"href": "/go/school-website?urn=100000&from=web", "portal": "school-website",
                                            "host": "thealdgateschool.org"})
        self.assertEqual(links["admissions"]["via"], "website")
        self.assertEqual(links["councilAdmissions"]["council"], "City of London")
        self.assertEqual(links["goodSchoolsGuide"], {"href": None, "portal": "school-gsg"})
        self.assertIsNone(links["locrating"]["href"])
        for key in ("ofstedReport", "dfePerformance", "parentView", "gias", "eAdmissions"):
            self.assertTrue(links[key]["href"].startswith("/go/school-"), key)

    def test_no_website_or_phone(self):
        links = school_links.links({**ROW, "website": None})
        self.assertIsNone(links["website"])
        self.assertIsNone(links["phone"])
        self.assertEqual(links["admissions"]["via"], "council")


class FakeConnection:
    def __init__(self, row):
        self.row, self.events = row, []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        if marker == "-- evidence:school-links":
            return [self.row] if self.row and params == (self.row["urn"],) else []
        if marker == "-- usage:insert":
            self.events.append(params)
            return []
        if marker == "-- usage:purge":
            return [{"purged": 0}]
        raise AssertionError(sql)


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class GoTests(unittest.TestCase):
    def setUp(self):
        self.connection = FakeConnection(ROW)
        app_module._connect = lambda: self.connection
        self.addCleanup(setattr, app_module, "_connect", evidence_connection)
        self.client = TestClient(app_module.app)

    def get(self, path):
        return self.client.get(path, headers={"user-agent": BROWSER}, follow_redirects=False)

    def test_go_redirects_to_the_website_from_the_database(self):
        response = self.get("/go/school-website?urn=100000&from=web")
        self.assertEqual((response.status_code, response.headers["location"]), (302, "https://www.thealdgateschool.org"))
        self.assertEqual(self.connection.events, [])  # from=web: the page counted it

    def test_go_ignores_a_url_in_the_request_and_refuses_unknown_schools(self):
        response = self.get("/go/school-ofsted?urn=100000&url=https://evil.example")
        self.assertEqual(response.headers["location"], "https://reports.ofsted.gov.uk/provider/ELS/100000")
        self.assertEqual(self.get("/go/school-ofsted?urn=999999").status_code, 404)
        self.assertEqual(self.get("/go/school-ofsted?urn=abc").status_code, 404)
        with flags():
            self.assertEqual(self.get("/go/school-gsg?urn=100000").status_code, 404)


if __name__ == "__main__":
    unittest.main()
