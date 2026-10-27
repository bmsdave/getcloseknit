"""Agency site URLs: registrable-looking domain, homepage and the SQL twin of the domain."""

import unittest

from area_analytics.agency_crawl import urls


class SiteDomainTests(unittest.TestCase):
    def test_site_domain_forms(self):
        for raw in ("WWW.Foxtons.co.uk/branches/ealing", "foxtons.co.uk", "http://foxtons.co.uk?ref=osm",
                    "https://www.foxtons.co.uk/#top", " https://foxtons.co.uk:443/ "):
            self.assertEqual(urls.site_domain(raw), "foxtons.co.uk", raw)

    def test_site_domain_rejects_non_web(self):
        for raw in (None, "", "mailto:a@b.com", "tel:0207", "https://", "http://[", "http://[bad",
                    "not a url", "foo", "localhost"):
            self.assertIsNone(urls.site_domain(raw), raw)

    def test_site_domain_keeps_what_the_sql_guard_keeps(self):
        self.assertEqual("a b.com", urls.site_domain("a b.com"))
        self.assertEqual("x_y.com", urls.site_domain("x_y.com"))

    def test_homepage_rejects_malformed_host(self):
        self.assertIsNone(urls.homepage("http://[bad"))

    def test_homepage_keeps_scheme(self):
        self.assertEqual(urls.homepage("http://www.kfh.co.uk/sales"), "http://www.kfh.co.uk/")
        self.assertEqual(urls.homepage("kfh.co.uk"), "https://kfh.co.uk/")

    def test_shared_hosts_match_the_domain_or_a_parent(self):
        for domain in ("rightmove.co.uk", "www.zoopla.co.uk", "elm.wixsite.com", "sites.google.com", "x.com",
                       "m.facebook.com", "linktr.ee", "elm-estates.business.site"):
            self.assertTrue(urls.is_shared_host(domain), domain)
        for domain in ("elm.co.uk", "notrightmove.co.uk", "foxtons.com", "box.com", "", None):
            self.assertFalse(urls.is_shared_host(domain), domain)

    def test_first_website_of_a_multi_value_tag(self):
        self.assertEqual(urls.first_website(" a.co.uk ; b.co.uk"), "a.co.uk")
        self.assertEqual(urls.first_website("https://a.co.uk/"), "https://a.co.uk/")
        self.assertIsNone(urls.first_website(";b.co.uk"))
        self.assertIsNone(urls.first_website(None))

    def test_sql_twin_names_the_website_column(self):
        self.assertIn("website", urls.SITE_DOMAIN_SQL)
        self.assertIn("www", urls.SITE_DOMAIN_SQL)


if __name__ == "__main__":
    unittest.main()
