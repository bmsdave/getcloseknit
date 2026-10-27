import hashlib
import json
import unittest
from pathlib import Path

from area_analytics.acquisition import acquire_release
from area_analytics.geography import (
    build_coverage_report,
    build_geography_manifest,
    build_geography_release,
    extract_boundary_records,
    ingest_geography_release,
    parse_lookup_csv,
    parse_lookup_record,
    stable_geography_id,
    validate_multipolygon,
    verify_content_checksum,
)


FIXTURES = Path(__file__).parent / "fixtures" / "geography"


def load_fixtures():
    lsoa = json.loads((FIXTURES / "lsoa-2021-sample.geojson").read_text())
    msoa = json.loads((FIXTURES / "msoa-2021-sample.geojson").read_text())
    borough = json.loads((FIXTURES / "borough-sample.geojson").read_text())
    lookup = (FIXTURES / "lookup-sample.csv").read_text()
    return lsoa, msoa, borough, lookup


def fixture_boundaries():
    lsoa, msoa, borough, _ = load_fixtures()
    records = extract_boundary_records(lsoa, "lsoa", "LSOA21CD", "LSOA21NM")
    records += extract_boundary_records(msoa, "msoa", "MSOA21CD", "MSOA21NM")
    records += extract_boundary_records(borough, "lad", "LAD21CD", "LAD21NM")
    return records


def fixture_manifest():
    return build_geography_manifest(
        [
            {"sourceId": "ons-lsoa-boundaries-2021", "sourceUrl": "https://example.invalid/lsoa", "sha256": "a" * 64},
            {"sourceId": "ons-msoa-boundaries-2021", "sourceUrl": "https://example.invalid/msoa", "sha256": "b" * 64},
            {"sourceId": "ons-borough-boundaries-2021", "sourceUrl": "https://example.invalid/lad", "sha256": "c" * 64},
            {"sourceId": "ons-lookup-lsoa-msoa-lad", "sourceUrl": "https://example.invalid/lookup", "sha256": "d" * 64},
        ],
        "2026-09-03T10:00:00Z",
        "2026-08-01",
    )


class GeographyTests(unittest.TestCase):
    def test_stable_ids_preserve_official_codes(self):
        self.assertEqual(stable_geography_id("lsoa", "E01000001"), "uk:lsoa:E01000001")
        self.assertEqual(stable_geography_id("msoa", "E02000001"), "uk:msoa:E02000001")
        self.assertEqual(stable_geography_id("lad", "E09000033"), "uk:lad:E09000033")

    def test_stable_ids_reject_unofficial_codes(self):
        with self.assertRaisesRegex(ValueError, "official code"):
            stable_geography_id("lsoa", "E0100001")
        with self.assertRaisesRegex(ValueError, "kind"):
            stable_geography_id("ward", "E05000001")

    def test_fixture_polygons_validate_as_multipolygons(self):
        for record in fixture_boundaries():
            polygons = validate_multipolygon(record["geometry"])
            self.assertTrue(polygons)
            self.assertEqual(record["id"], stable_geography_id(record["kind"], record["official_code"]))

    def test_street_or_property_precision_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Polygon"):
            validate_multipolygon({"type": "Point", "coordinates": [-0.15, 51.51]})
        with self.assertRaisesRegex(ValueError, "Polygon"):
            validate_multipolygon({"type": "LineString", "coordinates": [[-0.15, 51.51]]})

    def test_open_or_out_of_range_rings_are_rejected(self):
        open_ring = {"type": "Polygon", "coordinates": [[[0.0, 51.0], [1.0, 51.0], [1.0, 52.0], [0.5, 51.5]]]}
        with self.assertRaisesRegex(ValueError, "closed"):
            validate_multipolygon(open_ring)
        far_ring = {"type": "Polygon", "coordinates": [[[500.0, 51.0], [501.0, 51.0], [501.0, 52.0], [500.0, 51.0]]]}
        with self.assertRaisesRegex(ValueError, "longitude"):
            validate_multipolygon(far_ring)

    def test_non_lad_borough_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "English local authority district"):
            extract_boundary_records(
                {"type": "FeatureCollection", "features": [{
                    "type": "Feature",
                    "properties": {"LAD21CD": "E10000002", "LAD21NM": "Buckinghamshire CC"},
                    "geometry": {"type": "Polygon", "coordinates": [[[-0.8, 51.8], [-0.7, 51.8], [-0.7, 51.9], [-0.8, 51.8]]]},
                }]},
                "lad", "LAD21CD", "LAD21NM",
            )

    def test_any_english_lad_is_a_borough(self):
        records = extract_boundary_records(
            {"type": "FeatureCollection", "features": [{
                "type": "Feature",
                "properties": {"LAD21CD": "E08000001", "LAD21NM": "Bolton"},
                "geometry": {"type": "Polygon", "coordinates": [[[-2.0, 53.5], [-1.9, 53.5], [-1.9, 53.6], [-2.0, 53.5]]]},
            }]},
            "lad", "LAD21CD", "LAD21NM",
        )
        self.assertEqual(records[0]["id"], "uk:lad:E08000001")
        self.assertEqual(parse_lookup_record({"LSOA21CD": "E01004768", "MSOA21CD": "E02000984",
                                              "LAD21CD": "E08000001"})["lad_code"], "E08000001")

    def test_hierarchy_reconciles_lookup_with_boundaries(self):
        _, _, _, lookup_text = load_fixtures()
        release = ingest_geography_release(
            fixture_boundaries(), parse_lookup_csv(lookup_text), fixture_manifest()
        )
        by_id = {area["id"]: area for area in release["areas"]}
        self.assertEqual(by_id["uk:lsoa:E01000001"]["parent_id"], "uk:msoa:E02000001")
        self.assertEqual(by_id["uk:msoa:E02000001"]["parent_id"], "uk:lad:E09000033")
        self.assertIsNone(by_id["uk:lad:E09000033"]["parent_id"])
        self.assertEqual(release["manifest"]["geographyVintage"], "2021")

    def test_orphan_boundary_without_lookup_is_rejected(self):
        _, _, _, lookup_text = load_fixtures()
        lookups = parse_lookup_csv(lookup_text)[:2]
        with self.assertRaisesRegex(ValueError, "lookup"):
            ingest_geography_release(fixture_boundaries(), lookups, fixture_manifest())

    def test_mismatched_parent_is_rejected(self):
        _, _, _, lookup_text = load_fixtures()
        lookups = parse_lookup_csv(lookup_text)
        lookups[0] = dict(lookups[0], lad_code="E09000007")
        with self.assertRaisesRegex(ValueError, "hierarchy"):
            ingest_geography_release(fixture_boundaries(), lookups, fixture_manifest())

    def test_manifest_carries_provenance_and_licence(self):
        manifest = fixture_manifest()
        self.assertEqual(manifest["licence"], "OGL-3.0")
        self.assertEqual(manifest["validationStatus"], "passed")
        self.assertEqual(manifest["geographyVintage"], "2021")
        self.assertEqual(manifest["transformationVersion"], "geography-v1")
        for entry in manifest["inputs"]:
            self.assertRegex(entry["sha256"], r"^[0-9a-f]{64}$")

    def test_release_is_immutable_and_inputs_are_preserved(self):
        boundaries = fixture_boundaries()
        _, _, _, lookup_text = load_fixtures()
        lookups = parse_lookup_csv(lookup_text)
        manifest = fixture_manifest()
        release = build_geography_release(
            ingest_geography_release(boundaries, lookups, manifest)["areas"], manifest
        )
        release["areas"][0]["name"] = "mutated"
        release["manifest"]["inputs"][0]["sha256"] = "0" * 64
        boundaries[0]["name"] = "mutated"
        fresh = ingest_geography_release(fixture_boundaries(), lookups, manifest)
        self.assertNotEqual(fresh["areas"][0]["name"], "mutated")
        self.assertNotEqual(fresh["manifest"]["inputs"][0]["sha256"], "0" * 64)

    def test_production_acquisition_is_explicit_and_validated(self):
        payload = (FIXTURES / "lsoa-2021-sample.geojson").read_bytes()
        release = acquire_release(
            source_id="ons-lsoa-boundaries-2021",
            release="2021",
            retrieved_at="2026-09-03T10:00:00Z",
            geography_vintage="2021",
            transformation_version="geography-v1",
            fetch=lambda _: payload,
        )
        self.assertEqual(release.manifest["sha256"], hashlib.sha256(payload).hexdigest())
        self.assertEqual(release.manifest["licence"], "OGL-3.0")
        self.assertEqual(release.manifest["validationStatus"], "passed")

    def test_checksum_verification_is_explicit(self):
        payload = (FIXTURES / "lookup-sample.csv").read_bytes()
        digest = verify_content_checksum(payload, hashlib.sha256(payload).hexdigest())
        self.assertEqual(len(digest), 64)
        with self.assertRaisesRegex(ValueError, "mismatch"):
            verify_content_checksum(payload, "0" * 64)
        with self.assertRaisesRegex(ValueError, "empty"):
            verify_content_checksum(b"", "0" * 64)


def bowtie_geometry():
    return {
        "type": "Polygon",
        "coordinates": [[
            [0.0, 51.0], [1.0, 52.0], [1.0, 51.0], [0.0, 52.0], [0.0, 51.0],
        ]],
    }


def island_geometry():
    return {
        "type": "MultiPolygon",
        "coordinates": [
            [[[-0.19, 51.5], [-0.16, 51.5], [-0.16, 51.52], [-0.19, 51.52], [-0.19, 51.5]]],
            [[[-0.10, 51.5], [-0.08, 51.5], [-0.08, 51.52], [-0.10, 51.52], [-0.10, 51.5]]],
        ],
    }


class GeographyValidityTests(unittest.TestCase):
    def test_self_intersecting_polygon_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "self-intersecting"):
            validate_multipolygon(bowtie_geometry())

    def test_pre_2021_vintage_fields_are_rejected(self):
        lsoa, _, _, _ = load_fixtures()
        with self.assertRaisesRegex(ValueError, "vintage"):
            extract_boundary_records(lsoa, "lsoa", "LSOA11CD", "LSOA11NM")

    def test_duplicate_official_codes_are_rejected(self):
        boundaries = fixture_boundaries()
        _, _, _, lookup_text = load_fixtures()
        with self.assertRaisesRegex(ValueError, "duplicate"):
            ingest_geography_release(
                boundaries + [boundaries[0]],
                parse_lookup_csv(lookup_text),
                fixture_manifest(),
            )

    def test_2011_manifest_vintage_is_rejected(self):
        manifest = dict(fixture_manifest(), geographyVintage="2011")
        with self.assertRaisesRegex(ValueError, "vintage"):
            ingest_geography_release(
                fixture_boundaries(),
                parse_lookup_csv(load_fixtures()[3]),
                manifest,
            )

    def test_coverage_report_quarantines_lookup_without_geometry(self):
        _, _, _, lookup_text = load_fixtures()
        lookups = parse_lookup_csv(lookup_text)
        lookups.append({
            "lsoa_code": "E01000009", "msoa_code": "E02000009",
            "lad_code": "E09000033",
        })
        report = build_coverage_report(fixture_boundaries(), lookups)
        entry = next(
            q for q in report["quarantine"] if q["official_code"] == "E01000009"
        )
        self.assertEqual(entry["reason"], "missing-boundary")
        self.assertNotIn("uk:lsoa:E01000009", [a["id"] for a in report["areas"]])

    def test_coverage_report_quarantines_boundary_without_lookup(self):
        boundaries = fixture_boundaries() + [{
            "id": "uk:lsoa:E01000009", "kind": "lsoa",
            "official_code": "E01000009", "name": "Unlinked 009A",
            "geometry": island_geometry(),
        }]
        _, _, _, lookup_text = load_fixtures()
        report = build_coverage_report(boundaries, parse_lookup_csv(lookup_text))
        entry = next(
            q for q in report["quarantine"] if q["official_code"] == "E01000009"
        )
        self.assertEqual(entry["reason"], "missing-lookup")

    def test_coverage_report_quarantines_conflicting_parents(self):
        _, _, _, lookup_text = load_fixtures()
        lookups = parse_lookup_csv(lookup_text)
        lookups.append(dict(lookups[0], msoa_code="E02000002"))
        report = build_coverage_report(fixture_boundaries(), lookups)
        reasons = {q["official_code"]: q["reason"] for q in report["quarantine"]}
        self.assertEqual(reasons.get("E01000001"), "hierarchy-mismatch")

    def test_coverage_counts_reconcile_against_the_lookup(self):
        _, _, _, lookup_text = load_fixtures()
        lookups = parse_lookup_csv(lookup_text)
        report = build_coverage_report(fixture_boundaries(), lookups)
        expected = {c for row in lookups for c in row.values()}
        reported = {a["official_code"] for a in report["areas"]}
        reported |= {q["official_code"] for q in report["quarantine"]}
        self.assertEqual(report["expected"], len(expected))
        self.assertEqual(report["matched"], len(report["areas"]))
        self.assertTrue(expected <= reported)
        for area in report["areas"]:
            self.assertEqual(area["id"], stable_geography_id(area["kind"], area["official_code"]))

    def test_multipart_islands_survive_reconciliation(self):
        boundaries = fixture_boundaries()
        island = {
            "kind": "lsoa", "officialCode": "E01000001",
            "name": "Westminster 001A",
            "geometry": island_geometry(),
        }
        parsed = [b for b in boundaries if b["official_code"] != "E01000001"]
        _, _, _, lookup_text = load_fixtures()
        release = ingest_geography_release(
            parsed + [island], parse_lookup_csv(lookup_text), fixture_manifest()
        )
        area = next(a for a in release["areas"] if a["id"] == "uk:lsoa:E01000001")
        self.assertEqual(len(area["geometry"]["coordinates"]), 2)


if __name__ == "__main__":
    unittest.main()
