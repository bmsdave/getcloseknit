import hashlib
import inspect
import unittest
from pathlib import Path

import area_analytics.acquisition as acquisition_module
from area_analytics.acquisition import acquire_release
from area_analytics.sources import source_definition


FIXTURES = Path(__file__).parent / "fixtures" / "acquisition"


class AcquisitionTests(unittest.TestCase):
    def test_release_is_content_addressed_and_has_complete_provenance(self):
        payload = b"government-shaped fixture\n"
        release = acquire_release(
            source_id="police-uk",
            release="2026-06",
            retrieved_at="2026-09-03T10:00:00Z",
            geography_vintage="2021",
            transformation_version="crime-v1",
            fetch=lambda _: payload,
        )

        self.assertEqual(release.content, payload)
        self.assertEqual(release.manifest["sha256"], hashlib.sha256(payload).hexdigest())
        self.assertEqual(release.manifest["validationStatus"], "passed")
        self.assertEqual(release.manifest["carrierPolicy"], "published-lsoa")

    def test_unknown_source_is_rejected_before_fetch(self):
        calls = []
        with self.assertRaisesRegex(ValueError, "unknown source"):
            acquire_release("competitor-score", "v1", "2026-09-03T10:00:00Z", "2021", "v1", lambda url: calls.append(url))
        self.assertEqual(calls, [])


class ReviewedSourceAcquisitionTests(unittest.TestCase):
    def test_html_error_page_with_http_200_is_rejected(self):
        html = b"<!DOCTYPE html><html><body>Something went wrong</body></html>"
        with self.assertRaisesRegex(ValueError, "html"):
            acquire_release(
                source_id="police-uk",
                release="2026-06",
                retrieved_at="2026-09-03T10:00:00Z",
                geography_vintage="2021",
                transformation_version="crime-v1",
                fetch=lambda _: (html, "text/html"),
            )

    def test_html_bytes_without_content_type_are_rejected(self):
        html = b"<html><head><title>Login</title></head><body>Sign in</body></html>"
        with self.assertRaisesRegex(ValueError, "html"):
            acquire_release(
                source_id="police-uk",
                release="2026-06",
                retrieved_at="2026-09-03T10:00:00Z",
                geography_vintage="2021",
                transformation_version="crime-v1",
                fetch=lambda _: html,
            )

    def test_unknown_licence_decision_is_rejected_before_fetch(self):
        calls = []
        with self.assertRaisesRegex(ValueError, "licence decision"):
            acquire_release(
                source_id="la-admissions-ealing",
                release="2026-06",
                retrieved_at="2026-09-03T10:00:00Z",
                geography_vintage="2021",
                transformation_version="tfl-v1",
                fetch=lambda url: calls.append(url),
            )
        self.assertEqual(calls, [])

    def test_wrong_content_type_is_rejected(self):
        payload = b"government-shaped fixture\n"
        with self.assertRaisesRegex(ValueError, "content type"):
            acquire_release(
                source_id="police-uk",
                release="2026-06",
                retrieved_at="2026-09-03T10:00:00Z",
                geography_vintage="2021",
                transformation_version="crime-v1",
                fetch=lambda _: (payload, "application/pdf"),
            )

    def test_checksum_mismatch_is_rejected(self):
        payload = b"government-shaped fixture\n"
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            acquire_release(
                source_id="police-uk",
                release="2026-06",
                retrieved_at="2026-09-03T10:00:00Z",
                geography_vintage="2021",
                transformation_version="crime-v1",
                fetch=lambda _: payload,
                expected_sha256="0" * 64,
            )

    def test_matching_checksum_and_content_type_are_accepted(self):
        payload = b"government-shaped fixture\n"
        release = acquire_release(
            source_id="police-uk",
            release="2026-06",
            retrieved_at="2026-09-03T10:00:00Z",
            geography_vintage="2021",
            transformation_version="crime-v1",
            fetch=lambda _: (payload, "text/csv; charset=utf-8"),
            expected_sha256=hashlib.sha256(payload).hexdigest(),
        )
        self.assertEqual(release.content, payload)
        self.assertEqual(release.manifest["validationStatus"], "passed")

    def test_blocked_source_cannot_enter_active_release(self):
        calls = []
        with self.assertRaisesRegex(ValueError, "blocked|licence decision"):
            acquire_release(
                source_id="la-admissions-ealing",
                release="2026-06",
                retrieved_at="2026-09-03T10:00:00Z",
                geography_vintage="2021",
                transformation_version="tfl-v1",
                fetch=lambda url: calls.append(url),
            )
        self.assertEqual(calls, [])

    def test_fetch_uses_reviewed_distribution_url(self):
        seen = []
        acquire_release(
            source_id="police-uk",
            release="2026-06",
            retrieved_at="2026-09-03T10:00:00Z",
            geography_vintage="2021",
            transformation_version="crime-v1",
            fetch=lambda url: seen.append(url) or b"government-shaped fixture\n",
        )
        self.assertEqual(seen, [source_definition("police-uk").url])

    def test_acquisition_adapter_makes_no_live_network_calls(self):
        module_source = inspect.getsource(acquisition_module)
        for forbidden in ("urllib", "requests", "urlopen", "socket", "http.client"):
            self.assertNotIn(forbidden, module_source)

    def test_government_shaped_fixture_is_acquirable(self):
        payload = (FIXTURES / "police-uk-street-sample.csv").read_bytes()
        header = payload.decode("utf-8").splitlines()[0]
        self.assertIn("Street ID", header)
        release = acquire_release(
            source_id="police-uk",
            release="2026-06",
            retrieved_at="2026-09-03T10:00:00Z",
            geography_vintage="2021",
            transformation_version="crime-v1",
            fetch=lambda _: (payload, "text/csv"),
            expected_sha256=hashlib.sha256(payload).hexdigest(),
        )
        self.assertEqual(release.manifest["sha256"], hashlib.sha256(payload).hexdigest())


if __name__ == "__main__":
    unittest.main()
