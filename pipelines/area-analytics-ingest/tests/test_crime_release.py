"""AE-05 recorded-crime release: failing-first acceptance tests.

Deterministic government-shaped fixtures only; no live publishers.
Every test pins one clause of the task: a common twelve-month window,
population denominators, published LSOA association, monthly categories,
separate anti-social behaviour, visible BTP exclusion, summed borough
rates, suppressed England comparisons, and no score or prediction output.
"""

import unittest

from area_analytics.analytics import (
    CITY_OF_LONDON_POLICE,
    METROPOLITAN_POLICE,
    LsoaPopulation,
    PoliceCrimeRecord,
    aggregate_borough_crime,
    build_crime_release,
    dedupe_police_records,
    parse_police_record,
    require_full_force_coverage,
    select_crime_window,
    with_borough_crime,
)

LSOA_MET_A = "E01000001"
LSOA_MET_B = "E01000002"
LSOA_CITY = "E01000003"
BOROUGH_MET = "E09000001"
BOROUGH_CITY = "E09000033"
BTP = "british-transport-police"
DENOMINATOR_YEAR = "2023"


def month_range(start, end):
    year, month = (int(part) for part in start.split("-"))
    stop_year, stop_month = (int(part) for part in end.split("-"))
    periods = []
    while (year, month) <= (stop_year, stop_month):
        periods.append(f"{year}-{month:02d}")
        month += 1
        if month == 13:
            year += 1
            month = 1
    return periods


WINDOW = month_range("2025-07", "2026-06")


def full_force_months():
    return {
        METROPOLITAN_POLICE: month_range("2025-01", "2026-06"),
        CITY_OF_LONDON_POLICE: month_range("2025-07", "2026-06"),
    }


def standard_populations():
    return [
        LsoaPopulation(LSOA_MET_A, 1500, DENOMINATOR_YEAR),
        LsoaPopulation(LSOA_MET_B, 2000, DENOMINATOR_YEAR),
        LsoaPopulation(LSOA_CITY, 1200, DENOMINATOR_YEAR),
    ]


def standard_forces():
    return {
        LSOA_MET_A: METROPOLITAN_POLICE,
        LSOA_MET_B: METROPOLITAN_POLICE,
        LSOA_CITY: CITY_OF_LONDON_POLICE,
    }


def monthly_crimes(lsoa, force, category="burglary", prefix="id"):
    return [
        PoliceCrimeRecord(f"{prefix}-{month}", month, category, lsoa, force)
        for month in WINDOW
    ]


def evidence_by_lsoa(release):
    return {item.lsoa_code: item for item in release.evidence}


class CrimeWindowTests(unittest.TestCase):
    def test_common_window_is_latest_twelve_months_shared_by_both_forces(self):
        window = select_crime_window(full_force_months())

        self.assertEqual(window, WINDOW)

    def test_window_without_twelve_consecutive_months_raises(self):
        force_months = {
            METROPOLITAN_POLICE: month_range("2026-01", "2026-06"),
            CITY_OF_LONDON_POLICE: month_range("2026-01", "2026-06"),
        }

        with self.assertRaisesRegex(ValueError, "twelve"):
            select_crime_window(force_months)

    def test_entirely_unavailable_force_raises(self):
        force_months = {
            METROPOLITAN_POLICE: [],
            CITY_OF_LONDON_POLICE: month_range("2025-07", "2026-06"),
        }

        with self.assertRaisesRegex(ValueError, METROPOLITAN_POLICE):
            select_crime_window(force_months)

    def test_partial_force_coverage_is_reported_not_silent(self):
        force_months = full_force_months()
        force_months[CITY_OF_LONDON_POLICE] = [
            month for month in WINDOW if month != "2026-01"
        ]

        missing = require_full_force_coverage(WINDOW, force_months)

        self.assertEqual(missing[CITY_OF_LONDON_POLICE], ["2026-01"])
        self.assertEqual(missing[METROPOLITAN_POLICE], [])

    def test_full_coverage_passes_validation(self):
        missing = require_full_force_coverage(WINDOW, full_force_months())

        self.assertEqual(missing, {
            METROPOLITAN_POLICE: [], CITY_OF_LONDON_POLICE: []})


class CrimeRecordHandlingTests(unittest.TestCase):
    def test_conflicting_duplicates_are_quarantined_and_counted_once(self):
        records = [
            PoliceCrimeRecord("abc", "2026-01", "burglary", LSOA_MET_A,
                              METROPOLITAN_POLICE),
            PoliceCrimeRecord("abc", "2026-01", "robbery", LSOA_MET_A,
                              METROPOLITAN_POLICE),
        ]

        kept, quarantined = dedupe_police_records(records)

        self.assertEqual(len(kept), 1)
        self.assertEqual(len(quarantined), 1)
        self.assertEqual(quarantined[0].reason, "conflicting-duplicate")

    def test_exact_duplicates_collapse_to_one_record(self):
        record = PoliceCrimeRecord("abc", "2026-01", "burglary", LSOA_MET_A,
                                   METROPOLITAN_POLICE)

        kept, quarantined = dedupe_police_records([record, record])

        self.assertEqual(kept, [record])
        self.assertEqual(quarantined, [])

    def test_distinct_blank_id_records_survive_deduplication(self):
        first = PoliceCrimeRecord("", "2026-01", "burglary", LSOA_MET_A,
                                  METROPOLITAN_POLICE)
        second = PoliceCrimeRecord("   ", "2026-01", "burglary", LSOA_MET_A,
                                   METROPOLITAN_POLICE)

        kept, quarantined = dedupe_police_records([first, first, second])

        self.assertEqual(kept, [first, first, second])
        self.assertEqual(quarantined, [])

    def test_parse_preserves_published_lsoa_and_blank_crime_id(self):
        row = {"Category": "Anti-social behaviour", "Persistent ID": "",
               "Date": "2026-06", "LSOA code": "E01000001"}

        record = parse_police_record(row, METROPOLITAN_POLICE)

        self.assertEqual(record.crime_id, "")
        self.assertEqual(record.category, "anti-social-behaviour")
        self.assertEqual(record.lsoa_code, "E01000001")
        self.assertEqual(record.month, "2026-06")

    def test_incompatible_geography_is_quarantined(self):
        records = [PoliceCrimeRecord("x1", "2026-01", "burglary", "NOTACODE",
                                     METROPOLITAN_POLICE)]

        release = build_crime_release(records, standard_populations(),
                                      standard_forces(), full_force_months(),
                                      DENOMINATOR_YEAR)

        self.assertEqual(len(release.evidence), 3)
        self.assertEqual(len(release.quarantine), 1)
        self.assertEqual(release.quarantine[0].reason,
                         "incompatible-geography")


class CrimeEvidenceTests(unittest.TestCase):
    def test_missing_force_month_yields_unavailable_evidence_never_zero_rate(self):
        force_months = full_force_months()
        force_months[CITY_OF_LONDON_POLICE] = [
            month for month in WINDOW if month != "2026-01"
        ]
        records = monthly_crimes(LSOA_CITY, CITY_OF_LONDON_POLICE)

        release = build_crime_release(records, standard_populations(),
                                      standard_forces(), force_months,
                                      DENOMINATOR_YEAR)

        city = evidence_by_lsoa(release)[LSOA_CITY]
        self.assertEqual(city.status, "unavailable")
        self.assertEqual(city.reason, "missing-force-month")
        self.assertIsNone(city.rate_per_thousand)

    def test_zero_population_yields_unavailable_evidence(self):
        populations = [LsoaPopulation(LSOA_MET_A, 0, DENOMINATOR_YEAR),
                       LsoaPopulation(LSOA_MET_B, 2000, DENOMINATOR_YEAR),
                       LsoaPopulation(LSOA_CITY, 1200, DENOMINATOR_YEAR)]
        records = monthly_crimes(LSOA_MET_A, METROPOLITAN_POLICE)

        release = build_crime_release(records, populations, standard_forces(),
                                      full_force_months(), DENOMINATOR_YEAR)

        area = evidence_by_lsoa(release)[LSOA_MET_A]
        self.assertEqual(area.status, "unavailable")
        self.assertEqual(area.reason, "missing-denominator")
        self.assertIsNone(area.rate_per_thousand)

    def test_missing_population_row_yields_unavailable_evidence(self):
        populations = [item for item in standard_populations()
                       if item.lsoa_code != LSOA_MET_B]

        release = build_crime_release([], populations, standard_forces(),
                                      full_force_months(), DENOMINATOR_YEAR)

        area = evidence_by_lsoa(release)[LSOA_MET_B]
        self.assertEqual(area.status, "unavailable")
        self.assertIsNone(area.rate_per_thousand)

    def test_incompatible_denominator_year_raises(self):
        populations = [LsoaPopulation(LSOA_MET_A, 1500, "2021"),
                       LsoaPopulation(LSOA_MET_B, 2000, DENOMINATOR_YEAR),
                       LsoaPopulation(LSOA_CITY, 1200, DENOMINATOR_YEAR)]

        with self.assertRaisesRegex(ValueError, "denominator"):
            build_crime_release([], populations, standard_forces(),
                                full_force_months(), DENOMINATOR_YEAR)

    def test_anti_social_behaviour_stays_separate_from_headline_rate(self):
        records = monthly_crimes(LSOA_MET_A, METROPOLITAN_POLICE)
        records += monthly_crimes(LSOA_MET_A, METROPOLITAN_POLICE,
                                  category="anti-social-behaviour",
                                  prefix="asb")

        release = build_crime_release(records, standard_populations(),
                                      standard_forces(), full_force_months(),
                                      DENOMINATOR_YEAR)

        area = evidence_by_lsoa(release)[LSOA_MET_A]
        self.assertEqual(area.status, "available")
        self.assertEqual(area.headline_count, 12)
        self.assertEqual(area.asb_count, 12)
        self.assertEqual(area.rate_per_thousand, 12 / 1500 * 1000)
        self.assertNotIn("anti-social-behaviour", area.categories)

    def test_monthly_categories_are_preserved(self):
        records = [
            PoliceCrimeRecord("m1", "2026-06", "burglary", LSOA_MET_A,
                              METROPOLITAN_POLICE),
            PoliceCrimeRecord("m2", "2026-06", "violence", LSOA_MET_A,
                              METROPOLITAN_POLICE),
            PoliceCrimeRecord("m3", "2026-05", "burglary", LSOA_MET_A,
                              METROPOLITAN_POLICE),
        ]

        release = build_crime_release(records, standard_populations(),
                                      standard_forces(), full_force_months(),
                                      DENOMINATOR_YEAR)

        area = evidence_by_lsoa(release)[LSOA_MET_A]
        self.assertEqual(area.monthly["2026-06"], {"burglary": 1, "violence": 1})
        self.assertEqual(area.monthly["2026-05"], {"burglary": 1})
        self.assertEqual(area.categories, {"burglary": 2, "violence": 1})
        self.assertEqual(area.denominator_year, DENOMINATOR_YEAR)

    def test_british_transport_police_exclusion_is_visible(self):
        records = monthly_crimes(LSOA_MET_A, METROPOLITAN_POLICE)
        records += [PoliceCrimeRecord(f"btp-{month}", month, "theft",
                                      LSOA_MET_A, BTP) for month in WINDOW]

        release = build_crime_release(records, standard_populations(),
                                      standard_forces(), full_force_months(),
                                      DENOMINATOR_YEAR)

        area = evidence_by_lsoa(release)[LSOA_MET_A]
        self.assertEqual(area.headline_count, 12)
        self.assertIn(BTP, release.coverage["excludedForces"])
        btp_quarantine = [item for item in release.quarantine
                          if item.reason == "btp-excluded"]
        self.assertEqual(len(btp_quarantine), 12)

    def test_england_comparison_is_suppressed_without_score_or_prediction(self):
        release = build_crime_release([], standard_populations(),
                                      standard_forces(), full_force_months(),
                                      DENOMINATOR_YEAR)

        self.assertEqual(release.coverage["englandComparison"], "suppressed")
        for item in release.evidence:
            self.assertFalse(hasattr(item, "country_percentile"))
            self.assertFalse(hasattr(item, "score"))
            self.assertFalse(hasattr(item, "prediction"))

    def test_release_window_is_reproducible_and_explicit(self):
        first = build_crime_release([], standard_populations(),
                                    standard_forces(), full_force_months(),
                                    DENOMINATOR_YEAR)
        second = build_crime_release([], standard_populations(),
                                     standard_forces(), full_force_months(),
                                     DENOMINATOR_YEAR)

        self.assertEqual(first, second)
        self.assertEqual(list(first.window), WINDOW)
        self.assertEqual(first.coverage["denominatorYear"], DENOMINATOR_YEAR)
        self.assertEqual(first.transformation_version, "crime-v1")


class BoroughAggregationTests(unittest.TestCase):
    def test_borough_rates_come_from_summed_counts_and_populations(self):
        records = monthly_crimes(LSOA_MET_A, METROPOLITAN_POLICE)
        records += [
            PoliceCrimeRecord("b1", "2026-06", "burglary", LSOA_MET_B,
                              METROPOLITAN_POLICE),
            PoliceCrimeRecord("b2", "2026-05", "burglary", LSOA_MET_B,
                              METROPOLITAN_POLICE),
        ]
        release = build_crime_release(records, standard_populations(),
                                      standard_forces(), full_force_months(),
                                      DENOMINATOR_YEAR)
        borough_of = {LSOA_MET_A: BOROUGH_MET, LSOA_MET_B: BOROUGH_MET,
                      LSOA_CITY: BOROUGH_CITY}

        boroughs = aggregate_borough_crime(release.evidence, borough_of,
                                           {item.lsoa_code: item.population
                                            for item in standard_populations()})

        metro = next(item for item in boroughs
                     if item.borough_code == BOROUGH_MET)
        self.assertEqual(metro.headline_count, 14)
        self.assertEqual(metro.population, 3500)
        self.assertEqual(metro.rate_per_thousand, 14 / 3500 * 1000)

    def test_unavailable_lsoas_are_excluded_from_borough_sums(self):
        populations = [LsoaPopulation(LSOA_MET_A, 1500, DENOMINATOR_YEAR),
                       LsoaPopulation(LSOA_MET_B, 0, DENOMINATOR_YEAR),
                       LsoaPopulation(LSOA_CITY, 1200, DENOMINATOR_YEAR)]
        records = monthly_crimes(LSOA_MET_A, METROPOLITAN_POLICE)
        release = build_crime_release(records, populations, standard_forces(),
                                      full_force_months(), DENOMINATOR_YEAR)
        borough_of = {LSOA_MET_A: BOROUGH_MET, LSOA_MET_B: BOROUGH_MET,
                      LSOA_CITY: BOROUGH_CITY}

        with_rates = with_borough_crime(
            release, borough_of,
            {item.lsoa_code: item.population for item in populations})

        metro = next(item for item in with_rates.boroughs
                     if item.borough_code == BOROUGH_MET)
        self.assertEqual(metro.status, "available")
        self.assertEqual(metro.headline_count, 12)
        self.assertEqual(metro.population, 1500)
        self.assertEqual(metro.lsoa_excluded, 1)


if __name__ == "__main__":
    unittest.main()
