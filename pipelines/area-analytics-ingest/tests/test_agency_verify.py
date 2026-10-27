"""Website verification by company number (pure parsing plus verify_site over a fake fetcher; no network)."""

import unittest

from area_analytics.agency_crawl import verify
from area_analytics.agency_crawl.fetch import Page

HOME = ('<html><body><a href="/privacy">Privacy policy</a><a href="/contact-us">Contact</a>'
        '<a href="https://other.com/contact">Other</a></body></html>')


class FakeFetcher:
    """Serves pages by URL; anything unknown is dead. Records every request."""

    def __init__(self, pages, blocked=()):
        self.pages = pages
        self.blocked = set(blocked)
        self.requests = []

    def get(self, url):
        self.requests.append(url)
        entry = self.pages.get(url)
        domain = url.split("/")[2].removeprefix("www.")
        if entry is None:
            return Page(url, url, domain, 404, None, "dead")
        if isinstance(entry, Page):
            return entry
        return Page(url, url, domain, 200, entry, "ok")


class ParsingTests(unittest.TestCase):
    def test_company_numbers_pad_leading_zeros(self):
        self.assertEqual(verify.company_numbers("Registered in England, Company No. 1234567"), {"01234567"})

    def test_scottish_and_llp_prefixes(self):
        self.assertEqual(verify.company_numbers("Company number SC123456. LLP no OC301234"), {"SC123456", "OC301234"})

    def test_vat_numbers_are_not_company_numbers(self):
        self.assertEqual(verify.company_numbers("VAT Reg No. 123 4567 89"), set())
        self.assertEqual(verify.company_numbers("VAT registered no. 12345678"), set())

    def test_internal_spaces_and_no_keyword(self):
        self.assertEqual(verify.company_numbers("Company no 123 456"), {"00123456"})
        self.assertEqual(verify.company_numbers("We sell 12345678 homes"), set())

    def test_other_kinds_of_number_are_not_company_numbers(self):
        for text in ("VAT Registration No. 123 4567 89", "Registered with the FCA, FRN 123456",
                     "membership number: 123456", "Phone number: 020 8123 4567", "Tel no: 07123 456789",
                     "Fax number 020 8123 4567", "Mobile no 07123 456789"):
            with self.subTest(text=text):
                self.assertEqual(verify.company_numbers(text), set())

    def test_registered_in_england_and_wales_phrasings(self):
        for text in ("Registered in England and Wales: 05123456", "Registered in England & Wales under 05123456"):
            with self.subTest(text=text):
                self.assertEqual(verify.company_numbers(text), {"05123456"})

    def test_company_label_closer_than_an_excluded_word(self):
        for text, expected in (("Member of TPO. Company no 1234567", "01234567"),
                               ("TPO member. Company No. 05123456", "05123456"),
                               ("Members of ARLA. Reg No. 05123456", "05123456"),
                               ("ARLA Propertymark member | Company No 05123456", "05123456"),
                               ("Tel 020 8123 4567 Co. No. 05123456", "05123456"),
                               ("Fax 020 812 3456 Reg no 05123456", "05123456"),
                               ("VAT 123456789. Co No 05123456", "05123456"),
                               ("Phone us | Company no. 05123456", "05123456"),
                               ("Telford House. Company no 05123456", "05123456")):
            with self.subTest(text=text):
                self.assertEqual(verify.company_numbers(text), {expected})

    def test_postcodes_and_redress(self):
        text = "Visit us at 12 Elm Road, London W13 9AB. Members of The Property Ombudsman."
        self.assertEqual(verify.uk_postcodes(text), ["W13 9AB"])
        self.assertEqual(verify.redress_scheme(text), "TPO")

    def test_postcodes_normalised_in_page_order(self):
        self.assertEqual(verify.uk_postcodes("SW1A1AA then e1 6an then EC1A 1BB"), ["SW1A 1AA", "EC1A 1BB"])

    def test_redress_first_found_wins(self):
        self.assertEqual(verify.redress_scheme("Property Redress Scheme and TPO"), "PRS")
        self.assertIsNone(verify.redress_scheme("No scheme here"))

    def test_verification_links_same_domain_contact_first(self):
        self.assertEqual(verify.verification_links(HOME, "https://elm.co.uk/"),
                         ["https://elm.co.uk/contact-us", "https://elm.co.uk/privacy"])

    def test_verification_links_at_most_two_and_match_text(self):
        html = ('<a href="/a">Terms of business</a><a href="/b">Legal</a><a href="/c">Privacy</a>'
                '<a href="mailto:x@elm.co.uk">Contact</a>')
        self.assertEqual(verify.verification_links(html, "https://elm.co.uk/"),
                         ["https://elm.co.uk/a", "https://elm.co.uk/b"])

    def test_candidate_domains(self):
        self.assertEqual(verify.candidate_domains("ELM ESTATES LTD"),
                         ["elm.co.uk", "elm.com", "elm.london", "elmestates.co.uk"])
        self.assertEqual(verify.candidate_domains("THE PROPERTIES LTD"), [])
        self.assertEqual(verify.candidate_domains("Smith & Jones Estate Agents Limited")[0], "smithjones.co.uk")


class VerifySiteTests(unittest.TestCase):
    PAGES = {
        "https://elm.co.uk/": HOME + " Company No. 1234567",
        "https://elm.co.uk/contact-us": "Visit 12 Elm Road, London W13 9AB. Property Redress Scheme member.",
        "https://elm.co.uk/privacy": "Privacy",
    }

    def test_keeps_only_known_numbers(self):
        fetcher = FakeFetcher(self.PAGES)
        self.assertEqual(verify.verify_site(fetcher, "https://www.elm.co.uk/x", {"09999999"}, {"W13 9AB"}), [])

    def test_known_number_yields_one_row(self):
        fetcher = FakeFetcher(self.PAGES)
        rows = verify.verify_site(fetcher, "https://elm.co.uk/", {"01234567"}, {"W13 9AB"})
        self.assertEqual(rows, [{"domain": "elm.co.uk", "company_number": "01234567",
                                 "page_url": "https://elm.co.uk/", "redress_scheme": "PRS",
                                 "office_postcode": "W13 9AB"}])
        self.assertEqual(fetcher.requests, ["https://elm.co.uk/", "https://elm.co.uk/contact-us",
                                            "https://elm.co.uk/privacy"])

    def test_non_london_contact_postcode_is_not_used(self):
        rows = verify.verify_site(FakeFetcher(self.PAGES), "https://elm.co.uk/", {"01234567"}, {"E1 6AN"})
        self.assertIsNone(rows[0]["office_postcode"])

    def test_postcode_from_any_page_without_contact_page(self):
        pages = {"https://elm.co.uk/": 'Company no 1234567, Elm Road London W13 9AB <a href="/terms">Terms</a>'}
        rows = verify.verify_site(FakeFetcher(pages), "https://elm.co.uk/", {"01234567"}, {"W13 9AB"})
        self.assertEqual(rows[0]["office_postcode"], "W13 9AB")

    def test_rows_use_final_domain(self):
        pages = {"https://old.co.uk/": Page("https://old.co.uk/", "https://new.co.uk/", "new.co.uk", 200,
                                            "Company number 1234567", "ok")}
        rows = verify.verify_site(FakeFetcher(pages), "https://old.co.uk/", {"01234567"}, set())
        self.assertEqual(rows[0]["domain"], "new.co.uk")

    def test_guess_without_number_creates_nothing(self):
        pages = {"https://elm.com/": "This domain is for sale"}
        self.assertEqual(verify.verify_site(FakeFetcher(pages), "https://elm.com/", {"01234567"}, set()), [])

    def test_dead_and_blocked_homepage(self):
        blocked = Page("https://elm.co.uk/", "https://elm.co.uk/", "elm.co.uk", 403, None, "blocked")
        self.assertEqual(verify.verify_site(FakeFetcher({"https://elm.co.uk/": blocked}), "https://elm.co.uk/",
                                            {"01234567"}, set()), [])
        self.assertEqual(verify.verify_site(FakeFetcher({}), "https://elm.co.uk/", {"01234567"}, set()), [])

    def test_redirect_to_opted_out_domain_reads_nothing_more(self):
        pages = {"https://foxtons.com/": Page("https://foxtons.com/", "https://foxtons.co.uk/", "foxtons.co.uk", 200,
                                              HOME + " Company No. 1234567", "ok")}
        fetcher = FakeFetcher(pages)
        result = verify.check_site(fetcher, "https://foxtons.com/", {"01234567"}, set(), {"foxtons.co.uk"})
        self.assertEqual(result, ("opted_out", "foxtons.co.uk", []))
        self.assertEqual(fetcher.requests, ["https://foxtons.com/"])

    def test_check_site_reports_status(self):
        blocked = Page("https://elm.co.uk/", "https://elm.co.uk/", "elm.co.uk", 403, None, "blocked")
        self.assertEqual(verify.check_site(FakeFetcher({"https://elm.co.uk/": blocked}), "https://elm.co.uk/",
                                           set(), set())[0], "blocked")
        self.assertEqual(verify.check_site(FakeFetcher({}), "https://elm.co.uk/", set(), set())[0], "dead")
        self.assertEqual(verify.check_site(FakeFetcher(self.PAGES), "https://elm.co.uk/", {"01234567"}, set())[0],
                         "verified")
        self.assertEqual(verify.check_site(FakeFetcher(self.PAGES), "https://elm.co.uk/", {"0"}, set())[0], "none")

    def test_robots_refusal_is_its_own_status_not_dead(self):
        refused = Page("https://elm.co.uk/", "https://elm.co.uk/", "elm.co.uk", 0, None, "robots")
        result = verify.check_site(FakeFetcher({"https://elm.co.uk/": refused}), "https://elm.co.uk/", {"01234567"},
                                   set())
        self.assertEqual(result, ("robots", "elm.co.uk", []))


class VerifyDomainsTests(unittest.TestCase):
    def test_offices_plus_guesses_minus_opt_outs(self):
        from area_analytics import agency_companies
        domains = agency_companies.verify_domains(["a.co.uk", "b.co.uk"], [("1", "ELM ESTATES LTD")],
                                                  ["b.co.uk", "elm.com"], verify.candidate_domains)
        self.assertEqual(domains, ["a.co.uk", "elm.co.uk", "elm.london", "elmestates.co.uk"])

    def test_shared_hosts_are_never_verified(self):
        from area_analytics import agency_companies
        domains = agency_companies.verify_domains(["rightmove.co.uk", "elm.wixsite.com", "a.co.uk"],
                                                  [("1", "FACEBOOK LTD")], [], verify.candidate_domains)
        self.assertEqual(domains, ["a.co.uk", "facebook.co.uk", "facebook.london", "facebookestates.co.uk"])

    def test_site_urls_keep_the_website_scheme_and_host_then_try_www(self):
        from area_analytics.agency_companies import site_urls
        self.assertEqual(site_urls("kfh.co.uk", "http://kfh.co.uk/sales"), ["http://kfh.co.uk/", "https://www.kfh.co.uk/"])
        self.assertEqual(site_urls("kfh.co.uk", "WWW.KFH.co.uk"), ["https://www.kfh.co.uk/"])
        self.assertEqual(site_urls("kfh.co.uk", "kfh.co.uk;kfh.london"), ["https://kfh.co.uk/", "https://www.kfh.co.uk/"])
        self.assertEqual(site_urls("elm.london", None), ["https://elm.london/"])  # a guessed domain: once, as it is

    def test_check_domain_retries_with_www_only_when_dead(self):
        from area_analytics.agency_companies import check_domain
        www = {"https://www.elm.co.uk/": VerifySiteTests.PAGES["https://elm.co.uk/"]}
        fetcher = FakeFetcher(www)
        result = check_domain(fetcher, ["https://elm.co.uk/", "https://www.elm.co.uk/"], {"0"}, set(), set())
        self.assertEqual(result[0], "none")
        self.assertEqual(fetcher.requests[:2], ["https://elm.co.uk/", "https://www.elm.co.uk/"])
        blocked = Page("https://elm.co.uk/", "https://elm.co.uk/", "elm.co.uk", 403, None, "blocked")
        fetcher = FakeFetcher({"https://elm.co.uk/": blocked, **www})
        self.assertEqual(check_domain(fetcher, ["https://elm.co.uk/", "https://www.elm.co.uk/"], set(), set(),
                                      set())[0], "blocked")
        self.assertEqual(fetcher.requests, ["https://elm.co.uk/"])

    def test_which_domains_a_check_replaces(self):
        from area_analytics.agency_companies import domains_to_replace
        self.assertEqual(domains_to_replace("a.com", "verified", "a.co.uk"), ["a.co.uk", "a.com"])
        self.assertEqual(domains_to_replace("a.com", "verified", "a.com"), ["a.com"])
        self.assertEqual(domains_to_replace("a.com", "none", "a.com"), ["a.com"])
        self.assertIsNone(domains_to_replace("a.com", "none", "a.co.uk"))
        for status in ("blocked", "dead", "opted_out", "robots"):
            self.assertIsNone(domains_to_replace("a.com", status, "a.com"))


if __name__ == "__main__":
    unittest.main()
