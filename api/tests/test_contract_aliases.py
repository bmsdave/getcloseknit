"""Deprecated field names (contract_aliases, step R1 of docs/architecture/global-geography.md)."""
import copy
import json
import os
import unittest
from unittest import mock
from pathlib import Path

from area_api import contract_aliases
from area_api.contract_aliases import DEPRECATED, with_aliases

GOLDEN = Path(__file__).resolve().parents[2] / "contracts" / "fixtures" / "golden-v1"


def _without_old_names(value):
    if isinstance(value, dict):
        return {key: _without_old_names(item) for key, item in value.items() if key not in DEPRECATED.values()}
    if isinstance(value, list):
        return [_without_old_names(item) for item in value]
    return value


class AliasTests(unittest.TestCase):
    def test_each_new_name_gains_its_old_one_with_the_same_value(self):
        payload = {"values": [{"regionPercentile": 40, "countryPercentile": None, "value": 1.5}],
                   "summary": {"regionMedian": 12, "regionShare": 0.3, "nested": [[1, 2], {"regionRate": 4.2}]}}
        aliased = with_aliases(payload)
        self.assertEqual(aliased["values"][0], {"regionPercentile": 40, "countryPercentile": None, "value": 1.5,
                                                "londonPercentile": 40, "englandPercentile": None})
        self.assertEqual(aliased["summary"]["londonMedian"], 12)
        self.assertEqual(aliased["summary"]["londonShare"], 0.3)
        self.assertEqual(aliased["summary"]["nested"][1], {"regionRate": 4.2, "londonRate": 4.2})
        for new, old in DEPRECATED.items():
            self.assertEqual(with_aliases({new: 7})[old], 7, new)

    def test_the_input_is_never_changed_and_untouched_parts_are_shared(self):
        payload = {"a": {"regionPercentile": 1}, "b": {"value": 2}, "rows": [[1, "x"]]}
        before = copy.deepcopy(payload)
        aliased = with_aliases(payload)
        self.assertEqual(payload, before)
        self.assertIs(aliased["b"], payload["b"])
        self.assertIs(aliased["rows"], payload["rows"])
        plain = {"value": 1, "items": [1, 2]}
        self.assertIs(with_aliases(plain), plain)

    def test_an_old_name_already_there_is_kept(self):
        self.assertEqual(with_aliases({"regionPercentile": 1, "londonPercentile": 2}),
                         {"regionPercentile": 1, "londonPercentile": 2})

    def test_golden_fixtures_are_the_new_payloads_with_their_aliases(self):
        # The goldens carry both names; built from the new names alone, the API's answer is the golden itself.
        for name in ("area-real.json", "area-demo.json", "area-suppressed.json"):
            golden = json.loads((GOLDEN / name).read_text())
            self.assertEqual(with_aliases(_without_old_names(golden)), golden, name)
            self.assertEqual(golden["summary"]["regionPercentile"], golden["summary"]["londonPercentile"], name)
            self.assertEqual(golden["summary"]["countryPercentile"], golden["summary"]["englandPercentile"], name)


class ResponseTests(unittest.TestCase):
    def test_aliased_answers_say_they_are_deprecated(self):
        response = contract_aliases.AliasedJSONResponse({"regionPercentile": 3})
        self.assertEqual(json.loads(response.body), {"regionPercentile": 3, "londonPercentile": 3})
        self.assertEqual(response.headers["deprecation"], contract_aliases.DEPRECATION_HEADER)
        self.assertNotIn("sunset", response.headers)  # no date until the extension with the new names ships

    def test_sunset_is_sent_once_its_date_is_set(self):
        with mock.patch.dict(os.environ, {contract_aliases.SUNSET_ENV: "2027-01-15"}):
            response = contract_aliases.AliasedJSONResponse({"regionPercentile": 3})
            self.assertEqual(response.headers["sunset"], "Fri, 15 Jan 2027 00:00:00 GMT")
        with mock.patch.dict(os.environ, {contract_aliases.SUNSET_ENV: "soon"}):
            self.assertIsNone(contract_aliases.sunset_header())

    def test_other_answers_carry_no_deprecation_headers(self):
        response = contract_aliases.AliasedJSONResponse({"value": 3}, status_code=201, headers={"x-a": "b"})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.headers["x-a"], "b")
        self.assertNotIn("deprecation", response.headers)

    def test_a_body_without_renamed_names_skips_the_walk(self):
        # The England match pack (~2 million values) has no renamed name: rendering it skipped a 0.2 s walk.
        self.assertTrue(all(name.startswith(("region", "country")) for name in DEPRECATED), "the fast path's test")
        pack = {"values": [{"geographyId": "uk:lsoa:E01000001", "name": "a region near country", "score": 80}]}
        with mock.patch.object(contract_aliases, "has_aliases", wraps=contract_aliases.has_aliases) as walk:
            response = contract_aliases.AliasedJSONResponse(pack)
            self.assertEqual(json.loads(response.body), pack)
            walk.assert_not_called()
            nested = contract_aliases.AliasedJSONResponse({"values": [{"countryPercentile": 7}]})
            walk.assert_called_once()
        self.assertEqual(json.loads(nested.body), {"values": [{"countryPercentile": 7, "englandPercentile": 7}]})
        self.assertIn("deprecation", nested.headers)
        both = contract_aliases.AliasedJSONResponse({"regionRank": 1, "londonRank": 1})
        self.assertEqual(json.loads(both.body), {"regionRank": 1, "londonRank": 1})
        self.assertNotIn("deprecation", both.headers)


if __name__ == "__main__":
    unittest.main()
