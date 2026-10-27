"""Crime headline: 12-month offences per 1,000 residents, anti-social behaviour excluded."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import crime_rates  # noqa: E402
import ziprange  # noqa: E402


def month(cells):
    return {code: {"n": n, "asb": asb, "cats": cats} for code, (n, asb, cats) in cells.items()}


class CrimeRateTests(unittest.TestCase):
    def test_month_list_crosses_year_boundaries(self):
        self.assertEqual(crime_rates.month_list("2026-02", 4), ["2025-11", "2025-12", "2026-01", "2026-02"])
        self.assertEqual(ziprange.months_ending("2026-02", 4), crime_rates.month_list("2026-02", 4))

    def test_window_sums_offences_but_keeps_asb_out_of_the_count(self):
        monthly = {
            "2026-01": month({"A": (3, 5, {"Burglary": 1, "Drugs": 2}), "B": (1, 0, {"Drugs": 1})}),
            "2026-02": month({"A": (2, 1, {"Drugs": 2})}),
        }
        cell = crime_rates.window_cell(monthly, ["2026-01", "2026-02"], ["A", "B"])
        self.assertEqual(cell["count"], 6)
        self.assertEqual(cell["asb"], 6)
        self.assertEqual(cell["cats"], {"Burglary": 1, "Drugs": 5})
        self.assertEqual(sum(cell["cats"].values()), cell["count"])

    def test_annual_rate_is_per_thousand_residents(self):
        self.assertEqual(crime_rates.annual_rate(150, 1500), 100.0)
        self.assertIsNone(crime_rates.annual_rate(5, 0))
        self.assertIsNone(crime_rates.annual_rate(5, None))

    def test_percentiles_ascend_with_crime_and_skip_missing_rates(self):
        pct = crime_rates.ascending_percentiles({"low": 10.0, "mid": 50.0, "high": 90.0, "none": None})
        self.assertEqual(pct, {"low": 0, "mid": 50, "high": 100})

    def test_tied_rates_share_one_percentile_whatever_their_code(self):
        """#221: five equal rates were 0, 20, 40, 60, 80 by LSOA code; they share the lowest position."""
        pct = crime_rates.ascending_percentiles({f"E0{i}": 4.0 for i in range(5)} | {"E99": 9.0})
        self.assertEqual(pct, {"E00": 0, "E01": 0, "E02": 0, "E03": 0, "E04": 0, "E99": 100})

    def test_legend_has_five_ascending_stops(self):
        stops = crime_rates.legend_stops(range(1, 101))
        self.assertEqual(len(stops), 5)
        self.assertEqual([s["value"] for s in stops], sorted(s["value"] for s in stops))
        self.assertTrue(stops[-1]["label"].endswith("+"))


class SnapGapTests(unittest.TestCase):
    def test_an_lsoa_without_its_crimes_falls_back_to_the_msoa(self):
        self.assertTrue(crime_rates.snap_gap(0, 1500, 98.0))
        self.assertTrue(crime_rates.snap_gap(10, 1500, 98.0))

    def test_quiet_but_plausible_lsoas_keep_their_own_rate(self):
        self.assertFalse(crime_rates.snap_gap(40, 1500, 98.0))
        self.assertFalse(crime_rates.snap_gap(0, 100, 50.0))  # too few expected to judge
        self.assertFalse(crime_rates.snap_gap(0, None, 98.0))


class FallbackRowTests(unittest.TestCase):
    """#184: a fallback row carries its carrier's count and breakdown (scaled to
    the LSOA), not the LSOA's own tiny count next to the carrier's rate.

    Fixture: two LSOAs in one MSOA; E01000001 has 4 own offences (a snap gap)
    and falls back to the MSOA rate 34.67/1,000. The carrier breakdown
    {Burglary: 62, Drugs: 42} scales by 1500/3000, so sample_count is 52 and
    per-type rates (count / residents) stay consistent with the headline.
    """

    _GEOGRAPHY = [
        {"id": "uk:lad:E09000001", "kind": "lad", "official_code": "E09000001",
         "parent_id": None},
        {"id": "uk:msoa:E02000001", "kind": "msoa", "official_code": "E02000001",
         "parent_id": "uk:lad:E09000001"},
        {"id": "uk:lsoa:E01000001", "kind": "lsoa", "official_code": "E01000001",
         "parent_id": "uk:msoa:E02000001"},
        {"id": "uk:lsoa:E01000002", "kind": "lsoa", "official_code": "E01000002",
         "parent_id": "uk:msoa:E02000001"},
    ]

    def _build(self):
        from unittest import mock
        import etl_crime_release  # noqa: E402

        monthly = {m: {} for m in crime_rates.month_list("2026-08", 23)}
        monthly["2026-08"] = {
            "E01000001": {"n": 4, "asb": 0, "cats": {"Burglary": 2, "Drugs": 2}},
            "E01000002": {"n": 100, "asb": 0, "cats": {"Burglary": 60, "Drugs": 40}},
        }
        population = {"E01000001": 1500, "E01000002": 1500}
        with mock.patch.object(etl_crime_release, "load_population", return_value=population), \
             mock.patch.object(etl_crime_release, "load_months", return_value=(monthly, {}, {})):
            return etl_crime_release.build("2026-08", self._GEOGRAPHY)

    def test_fallback_row_carries_the_carriers_count_and_breakdown_scaled(self):
        values, breakdown, _, _, record, _ = self._build()
        msoa_rate = round(104 / 3000 * 1000, 2)  # 34.67
        row = next(v for v in values if v[0] == "uk:lsoa:E01000001" and v[2] == "2026-08-01")
        self.assertEqual(row[3], msoa_rate)
        self.assertEqual(row[6], "fallback")
        self.assertEqual(row[5], 52, "sample_count must be the carrier's, scaled to the LSOA")
        rows = {b[3]: b[4] for b in breakdown if b[0] == "uk:lsoa:E01000001" and b[2] == "2026-08-01"}
        self.assertEqual(rows, {"Burglary": 31, "Drugs": 21, "anti-social-behaviour": 0})
        self.assertEqual(record["lsoa_snap_gap_fallbacks_latest"], 1)

    def test_the_carriers_own_rows_are_unchanged(self):
        values, breakdown, _, _, _, _ = self._build()
        row = next(v for v in values if v[0] == "uk:msoa:E02000001" and v[2] == "2026-08-01")
        self.assertEqual(row[6], "observed")
        self.assertEqual(row[5], 104)
        rows = {b[3]: b[4] for b in breakdown if b[0] == "uk:msoa:E02000001" and b[2] == "2026-08-01"}
        # Anti-social behaviour is stored as its own breakdown category (#163), outside the rate.
        self.assertEqual(rows, {"Burglary": 62, "Drugs": 42, "anti-social-behaviour": 0})


class SnapGapCeilingTests(unittest.TestCase):
    """#204: the ceiling is an absolute count, on top of the relative test."""

    def test_nineteen_offences_in_a_hotspot_msoa_still_falls_back(self):
        # expected = 2367.19 * 1500 / 1000 = 3550.8; 19 < 10% of that, and < 20 own offences.
        self.assertTrue(crime_rates.snap_gap(19, 1500, 2367.19))

    def test_twenty_own_offences_never_fall_back(self):
        self.assertFalse(crime_rates.snap_gap(20, 1500, 2367.19))
        self.assertFalse(crime_rates.snap_gap(433, 1987, 2367.19))


# Issue #204 regression fixture: Westminster 013A (E01004715, Fitzrovia west)
# shows its MSOA's rate because 433 own offences fall under 10% of the
# hotspot-pooled MSOA rate. Hundreds of own offences must keep their own rate.
_WESTMINSTER_013 = {
    "E01035716": (10139, {"Public order": 238, "Criminal damage and arson": 80}, 2274),  # 013G
    "E01004763": (6859, {"Public order": 214, "Criminal damage and arson": 61}, 2190),   # 013B
    "E01004765": (2354, {"Public order": 79, "Criminal damage and arson": 28}, 1907),    # 013D
    "E01004715": (433, {"Public order": 23, "Criminal damage and arson": 4}, 1987),      # 013A
}
_WESTMINSTER_013_MSOA_RATE = 2367.19


def _window_cell(n, cats):
    return {"n": n, "asb": 0, "cats": {**cats, "Other theft": n - sum(cats.values())}}


class Westminster013Tests(unittest.TestCase):
    """#204: Westminster 013A keeps its own rate (~218/1,000), not the MSOA's 2367."""

    def test_hundreds_of_own_offences_are_not_a_snap_gap(self):
        # expected = 2367.19 * 1987 / 1000 = 4703.6; 433 < 470.4, but 433 >= 20 own offences.
        self.assertFalse(crime_rates.snap_gap(433, 1987, _WESTMINSTER_013_MSOA_RATE))

    def test_every_month_of_the_window_keeps_its_own_rate(self):
        series = [(386, 3318.38), (385, 3223.14), (393, 3124.55), (398, 2996.53), (387, 2904.88),
                  (391, 2806.41), (405, 2704.71), (414, 2623.12), (420, 2544.27), (421, 2473.08),
                  (426, 2419.96), (433, 2367.19)]
        for count, parent in series:
            with self.subTest(count=count, parent=parent):
                self.assertFalse(crime_rates.snap_gap(count, 1987, parent))

    def test_a_real_gap_in_the_same_msoa_still_falls_back(self):
        self.assertTrue(crime_rates.snap_gap(0, 1500, _WESTMINSTER_013_MSOA_RATE))
        self.assertTrue(crime_rates.snap_gap(3, 1500, _WESTMINSTER_013_MSOA_RATE))


class EtlBuildTests(unittest.TestCase):
    """#204: build() keeps 013A observed at its own rate and lists fallbacks."""

    def _build(self):
        from unittest import mock
        import etl_crime_release  # noqa: E402

        geography = [{"id": "uk:lad:E09000033", "kind": "lad", "official_code": "E09000033",
                      "parent_id": None},
                     {"id": "uk:msoa:E02000972", "kind": "msoa", "official_code": "E02000972",
                      "parent_id": "uk:lad:E09000033"}]
        geography += [{"id": f"uk:lsoa:{code}", "kind": "lsoa", "official_code": code,
                       "parent_id": "uk:msoa:E02000972"} for code in _WESTMINSTER_013]
        monthly = {m: {} for m in crime_rates.month_list("2026-08", 23)}
        monthly["2026-08"] = {code: _window_cell(n, cats)
                              for code, (n, cats, _) in _WESTMINSTER_013.items()}
        population = {code: pop for code, (_, _, pop) in _WESTMINSTER_013.items()}
        with mock.patch.object(etl_crime_release, "load_population", return_value=population), \
             mock.patch.object(etl_crime_release, "load_months", return_value=(monthly, {}, {})):
            return etl_crime_release.build("2026-08", geography)

    def test_build_keeps_013a_observed_at_its_own_rate(self):
        values, _, _, _, record, _ = self._build()
        msoa = next(v for v in values if v[0] == "uk:msoa:E02000972" and v[2] == "2026-08-01")
        self.assertEqual(msoa[3], _WESTMINSTER_013_MSOA_RATE)  # sanity: matches the live release
        row = next(v for v in values if v[0] == "uk:lsoa:E01004715" and v[2] == "2026-08-01")
        self.assertEqual(row[3], 217.92)  # 433 / 1987 * 1000, not the MSOA's 2367.19
        self.assertEqual(row[6], "observed")
        self.assertEqual(record["lsoa_snap_gap_fallbacks_latest"], 0)
        self.assertEqual(record["lsoa_snap_gap_fallback_codes_latest"], [])


class ZipRangeCountTests(unittest.TestCase):
    def test_asb_rows_never_enter_the_headline_count(self):
        source = (Path(ziprange.__file__)).read_text()
        block = source.split('if cat == "Anti-social behaviour":', 1)[1].split("print(", 1)[0]
        asb_branch, other_branch = block.split("else:", 1)
        self.assertNotIn('cell["n"]', asb_branch)
        self.assertIn('cell["n"] += 1', other_branch)


class EnglandForceTests(unittest.TestCase):
    """England: every force's street file, region-scoped ranks, missing force-months quarantined."""

    def test_wanted_forces_takes_every_force_but_btp_in_england(self):
        import area_coverage
        members = [f"2026-08/2026-08-{force}-street.csv" for force in
                   ("kent", "metropolitan", "british-transport-police", "btp", "west-yorkshire")]
        members += ["2026-08/2026-08-kent-outcomes.csv", "2026-07/2026-07-surrey-street.csv"]
        self.assertEqual(ziprange.wanted_forces(members, "2026-08", area_coverage.ENGLAND),
                         ["kent", "metropolitan", "west-yorkshire"])
        self.assertEqual(ziprange.wanted_forces(members, "2026-08", area_coverage.LONDON),
                         ["metropolitan", "city-of-london"])

    def test_force_gaps_flags_absent_and_partial_months(self):
        import etl_crime_release as ecr
        forces = {"2026-01": {"kent": 100, "glos": 50}, "2026-02": {"kent": 40},
                  "2026-03": {"kent": 100, "glos": 50}, "2026-04": {"kent": 110, "glos": None}}
        self.assertEqual(ecr.force_gaps(forces), {"glos": ["2026-02"], "kent": ["2026-02"]})
        self.assertEqual(ecr.force_gaps({"2026-01": {"metropolitan": None}}), {})

    def test_borough_forces_follow_the_force_area_and_leave_unpublished_areas_empty(self):
        import etl_crime_release as ecr
        leaves = {"uk:lad:E08000001": ["E01A"], "uk:lad:E07000001": ["E01B"],
                  "uk:lad:E07000002": ["E01C"]}
        lad_pfa = {"E08000001": "E23000005", "E07000001": "E23000003", "E07000002": "E23000003"}
        monthly = {"2026-08": {"E01A": {"n": 3, "asb": 0, "cats": {}, "f": {"lancashire": 3}},
                               "E01B": {"n": 90, "asb": 0, "cats": {}, "f": {"lancashire": 90}},
                               "E01C": {"n": 5, "asb": 0, "cats": {}, "f": {"lancashire": 4, "cumbria": 1}}}}
        forces_of = ecr.borough_forces(monthly, leaves, lad_pfa)
        # Greater Manchester (E23000005) publishes nothing: Lancashire's 3 border rows don't make it Lancashire's.
        self.assertEqual(forces_of, {"uk:lad:E08000001": None, "uk:lad:E07000001": "lancashire",
                                     "uk:lad:E07000002": "lancashire"})
        blocked = ecr.blocked_boroughs(["2026-07", "2026-08"], forces_of, {"lancashire": ["2026-01"]})
        self.assertEqual(blocked, {"uk:lad:E08000001": "no-force-data"})
        blocked = ecr.blocked_boroughs(["2026-07", "2026-08"], forces_of, {"lancashire": ["2026-07"]})
        self.assertEqual(set(blocked.values()), {"no-force-data", "missing-force-month"})

    def test_cells_keep_only_the_forces_of_the_lsoas_region(self):
        import etl_crime_release as ecr
        monthly = {"2026-08": {"E01A": {"n": 12, "asb": 2, "cats": {"Burglary": 10, "Drugs": 2}, "f": {
            "metropolitan": {"n": 9, "asb": 2, "cats": {"Burglary": 9}},
            "city-of-london": {"n": 1, "asb": 0, "cats": {"Burglary": 1}},
            "devon-and-cornwall": {"n": 2, "asb": 0, "cats": {"Drugs": 2}}}}}}
        kept, dropped = ecr.keep_region_forces(
            monthly, {"E01A": "E12000007"},
            {"metropolitan": "E12000007", "city-of-london": "E12000007", "devon-and-cornwall": "E12000009"})
        cell = kept["2026-08"]["E01A"]
        self.assertEqual((cell["n"], cell["asb"], cell["cats"]), (10, 2, {"Burglary": 10}))
        self.assertEqual(dropped, 2)

    def _build(self, forces):
        from unittest import mock
        import etl_crime_release as ecr

        geography, regions, population, lad_pfa = [], {}, {}, {}
        for lad, region, pfa, rates in (("E09000001", "E12000007", "E23000034", (10, 20)),
                                        ("E08000035", "E12000003", "E23000010", (100, 200)),
                                        ("E06000001", "E12000001", "E23000013", (5, 6))):
            bid, mid = f"uk:lad:{lad}", f"uk:msoa:M{lad}"
            # A LAD's parent is its region (migration 123), a row the ETL does not read.
            geography += [{"id": bid, "kind": "lad", "official_code": lad, "parent_id": f"uk:region:{region}"},
                          {"id": mid, "kind": "msoa", "official_code": f"M{lad}", "parent_id": bid}]
            regions.update({bid: region, mid: region})
            lad_pfa[lad] = pfa
            for i, n in enumerate(rates):
                code = f"L{lad}{i}"
                geography.append({"id": f"uk:lsoa:{code}", "kind": "lsoa", "official_code": code, "parent_id": mid})
                regions[f"uk:lsoa:{code}"] = region
                population[code] = 1000
        force_of = {"E09000001": "city-of-london", "E08000035": "west-yorkshire", "E06000001": "cleveland"}
        months = crime_rates.month_list("2026-08", 23)
        monthly = {m: {} for m in months}
        for g in geography:
            if g["kind"] == "lsoa":
                lad = g["official_code"][1:10]
                n = {"0": 1, "1": 2}[g["official_code"][-1]] * {"E09000001": 10, "E08000035": 100,
                                                               "E06000001": 5}[lad]
                monthly["2026-08"][g["official_code"]] = {"n": n, "asb": 0, "cats": {"Burglary": n},
                                                          "f": {force_of[lad]: n}}
        with mock.patch.object(ecr, "load_population", return_value=population), \
             mock.patch.object(ecr, "load_months", return_value=(monthly, forces, {})):
            return ecr.build("2026-08", geography, regions, lad_pfa)

    def test_ranks_are_within_the_region_and_missing_months_suppress_the_force_area(self):
        all_forces = {"city-of-london": 10, "west-yorkshire": 100, "cleveland": 5}
        forces = {m: dict(all_forces) for m in crime_rates.month_list("2026-08", 23)}
        del forces["2026-08"]["cleveland"]  # Cleveland misses the latest month
        values, _, utility, latest, record, _ = self._build(forces)
        latest_rows = {v[0]: v for v in values if v[2] == "2026-08-01"}
        # Each region ranks on its own: the higher LSOA of each region is its 100th percentile.
        self.assertEqual(latest_rows["uk:lsoa:LE090000011"][4], 100)
        self.assertEqual(latest_rows["uk:lsoa:LE080000351"][4], 100)
        self.assertEqual(latest_rows["uk:lsoa:LE090000010"][4], 0)
        for gid in ("uk:lad:E06000001", "uk:msoa:ME06000001", "uk:lsoa:LE060000010"):
            self.assertEqual(latest_rows[gid][6], "suppressed")
            self.assertEqual(latest_rows[gid][3], "")
        # The previous window ends before the gap, so Cleveland keeps that figure.
        earlier = {v[0]: v for v in values if v[2] == "2026-07-01"}
        self.assertEqual(earlier["uk:lad:E06000001"][6], "observed")
        self.assertEqual(record["suppressed_boroughs_latest"], {"uk:lad:E06000001": "missing-force-month"})
        self.assertEqual(record["missing_force_months"], {"cleveland": ["2026-08"]})
        self.assertNotIn("uk:lsoa:LE060000010", {row[0] for row in utility if row[1] == "disorder"})
        self.assertEqual(record["london_rate_latest"], 15.0)  # (10 + 20) / 2,000 residents
        self.assertEqual(len(latest), 4)  # suppressed LSOAs stay out of the legend


if __name__ == "__main__":
    unittest.main()
