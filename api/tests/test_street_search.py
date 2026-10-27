"""Street-level search for homes with no recorded sale (migration 042), postcode resolution from
the ONS Postcode Directory (migration 019) and borough rents for an area (area-rents.v1)."""
import unittest

from area_api import area_rents
from area_api.evidence import (AreaNotFound, EvidenceReader, MalformedQuery, likely_postcode,
                               street_numbers, street_place, street_query)
from tests.test_production_evidence import OLD_RELEASE, seed_production_fixture

LSOA, BOROUGH = "uk:lsoa:E01000004", "uk:lad:E09000007"


class StreetConnection:
    """The production fixture connection plus street, postcode_civic and borough_rent rows."""

    def __init__(self, base, streets=True):
        self.base = base
        self.streets = [] if streets else None  # street rows, None before migration 042
        self.postcodes = {}  # postcode -> postcode-area row
        self.rents = []  # borough_rent rows joined to their attribution

    def __getattr__(self, name):
        return getattr(self.base, name)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        if marker == "-- evidence:street-table":
            return [{"t": self.streets is not None}]
        if marker == "-- evidence:street-search":
            needle, place = params[0].strip("%").lower(), (params[1] or "").lower()
            rows = [dict(row) for row in self.streets or [] if needle in row["name"].lower() and (
                not place or place in (row["locality"] or "").lower() or place in row["borough_name"].lower()
                or place == row["postcode_district"].lower())]
            # DISTINCT ON (lower(name), borough_id, postcode_district): one row per street and
            # district, not per name and borough (#202).
            seen = {}
            for row in rows:
                seen.setdefault((row["name"].lower(), row["borough_id"],
                                 (row["postcode_district"] or "").upper()), row)
            rows = list(seen.values())
            rows.sort(key=lambda row: (row["name"].lower() != params[5].lower(), row["name"]))
            return rows[:params[6]]
        if marker == "-- evidence:street-homes":
            # md5(street | borough) on sale: the fake matches the upper-cased street in the address
            return [{"display_address": a["display_address"], "postcode": a["postcode"],
                     "geography_id": a["geography_id"]}
                    for a in self.base.addresses.values()
                    if f" {params[0]}," in a["display_address"].upper() and self._borough(a["geography_id"]) == params[1]
                    and not self.base._hidden(a["id"])]
        if marker == "-- evidence:lsoa-center":
            geography = self.base.geographies.get(params[0])
            return [{"center_lon": geography["center_lon"],
                     "center_lat": geography["center_lat"]}] if geography else []
        if marker == "-- evidence:postcode-area":
            row = self.postcodes.get(params[0])
            if not row or row.get("terminated"):
                return []
            return [dict(row)]
        if marker == "-- evidence:postcode-status":
            row = self.postcodes.get(params[0])
            return [{"postcode": params[0],
                     "terminated": bool(row and row.get("terminated"))}] if row else []
        if marker == "-- evidence:area-borough":
            borough = self._borough(params[0])
            return [{"id": borough, "name": self.base.geographies[borough]["name"]}] if borough else []
        if marker == "-- evidence:rent-table":
            return [{"t": bool(self.rents)}]
        if marker == "-- evidence:area-rents":
            return [dict(row) for row in self.rents if row["area_code"] in (params[0], area_rents.LONDON)]
        return self.base.execute(sql, params)

    def _borough(self, area_id):
        area = self.base.geographies.get(area_id)
        while area and area["kind"] != "lad":
            area = self.base.geographies.get(area["parent_id"])
        return area["id"] if area else None


def street(name="Valley Road", locality="Kentish Town"):
    return {"name": name, "locality": locality, "postcode_district": "NW5", "geography_id": LSOA,
            "borough_id": BOROUGH, "borough_name": "Camden", "center_lon": -0.14, "center_lat": 51.55}


def add_home(connection, id_, display, postcode):
    connection.base.addresses[id_] = {"id": id_, "display_address": display, "postcode": postcode,
                                      "geography_id": LSOA, "source_release_id": "src-hmlr"}


def seeded(streets=True):
    connection = StreetConnection(seed_production_fixture(), streets=streets)
    if streets:
        connection.streets.append(street())
    add_home(connection, "uk:addr:0000000000a1", "118 Valley Road, London, NW5 1AA", "NW5 1AA")
    add_home(connection, "uk:addr:0000000000a2", "Flat 2, 122 Valley Road, London, NW5 1AA", "NW5 1AA")
    add_home(connection, "uk:addr:0000000000a3", "7 Valley Road, London, NW5 1AB", "NW5 1AB")
    return connection


def rent(code, bedrooms, monthly, change=None):
    return {"area_code": code, "period": "2026-08", "bedrooms": bedrooms, "monthly_rent": monthly,
            "annual_change_pct": change, "source_release_id": "src-ons-pipr-2026-09",
            "attribution": "Source: Office for National Statistics, Price Index of Private Rents."}


class StreetQueryTests(unittest.TestCase):
    def test_the_place_after_the_street(self):
        self.assertEqual(street_place("66 Valley Road, Kenley"), "Kenley")
        self.assertEqual(street_place("66 Valley Road, London, CR8 5BU"), "CR8")
        self.assertIsNone(street_place("66 Valley Road, London"))
        self.assertIsNone(street_place("66 Valley Road"))

    def test_splits_number_and_street(self):
        self.assertEqual(street_query("120 Valley Road"), (120, "Valley Road"))
        self.assertEqual(street_query("Flat 2, 120a  Valley Road, Kentish Town"), (120, "Valley Road"))
        self.assertEqual(street_query("valley road"), (None, "valley road"))

    def test_postcodes_and_bare_numbers_are_not_streets(self):
        for needle in ("NW5 1AA", "nw51aa", "120", "12 a"):
            self.assertEqual(street_query(needle), (None, None), needle)

    def test_numbers_only_count_on_the_named_street(self):
        homes = [{"display_address": "118 Valley Road, London", "postcode": "NW5 1AA"},
                 {"display_address": "45 Chipstead Valley Road, London", "postcode": "CR5 1AA"},
                 {"display_address": "Flat 3, Rose Court, Valley Road, London", "postcode": "NW5 1AC"}]
        self.assertEqual(street_numbers("Valley Road", homes), [(118, "NW5 1AA")])


class LikelyPostcodeTests(unittest.TestCase):
    def test_neighbours_on_both_sides_agree(self):
        self.assertEqual(likely_postcode(120, [(118, "NW5 1AA"), (124, "NW5 1AA"), (119, "NW5 9ZZ")]),
                         ("NW5 1AA", [118, 124]))

    def test_neighbours_that_differ_give_nothing(self):
        self.assertEqual(likely_postcode(120, [(118, "NW5 1AA"), (122, "NW5 1AB")]), (None, []))

    def test_other_side_of_the_street_does_not_count(self):
        self.assertEqual(likely_postcode(120, [(119, "NW5 1AA"), (121, "NW5 1AA")]), (None, []))

    def test_one_side_only_or_too_far_gives_nothing(self):
        self.assertEqual(likely_postcode(120, [(118, "NW5 1AA")]), (None, []))
        self.assertEqual(likely_postcode(120, [(108, "NW5 1AA"), (122, "NW5 1AA")]), (None, []))

    def test_the_same_number_decides_alone(self):
        # The new contract (issue #152): likely_postcode still answers "one likely postcode"
        # (None here), while street_candidates models the number's recorded homes separately
        # via numberPostcodes/neighbours.
        self.assertEqual(likely_postcode(120, [(120, "NW5 1AA"), (122, "NW5 1AB")]), ("NW5 1AA", [120]))
        self.assertEqual(likely_postcode(120, [(120, "NW5 1AA"), (120, "NW5 1AB")]), (None, []))


class StreetSearchTests(unittest.TestCase):
    def search(self, connection, query):
        return EvidenceReader(connect=lambda: connection).search_areas(query)["results"]

    def test_an_unsold_number_finds_its_street_and_likely_postcode(self):
        [result] = self.search(seeded(), "120 Valley Road")

        self.assertEqual(result["label"], "120 Valley Road")
        self.assertEqual(result["secondaryLabel"], "Kentish Town · Camden · likely NW5 1AA")
        self.assertEqual(result["geographyId"], LSOA)
        self.assertIsNone(result["uprn"])
        self.assertEqual(result["street"]["likelyPostcode"], "NW5 1AA")
        self.assertEqual(result["street"]["neighbours"], [118, 122])
        self.assertEqual(result["street"]["postcodes"], ["NW5 1AA", "NW5 1AB"])

    def test_no_likely_postcode_says_no_recorded_sale(self):
        [result] = self.search(seeded(), "130 Valley Road")

        self.assertEqual(result["secondaryLabel"], "Kentish Town · Camden · no recorded sale")
        self.assertIsNone(result["street"]["likelyPostcode"])
        self.assertEqual(result["street"]["neighbours"], [])

    def test_a_recorded_home_is_found_as_an_address_not_a_street(self):
        results = self.search(seeded(), "118 Valley Road")

        self.assertEqual([r.get("addressId") for r in results], ["uk:addr:0000000000a1"])
        self.assertNotIn("street", results[0])

    def test_a_near_miss_number_puts_the_street_before_it(self):
        results = self.search(seeded(), "18 Valley Road")

        self.assertEqual([r["label"] for r in results], ["18 Valley Road", "118 Valley Road, London, NW5 1AA"])
        self.assertEqual(results[0]["street"]["number"], 18)

    def test_flats_sharing_the_number_are_named_not_called_unsold(self):
        [result] = self.search(seeded(), "Flat 9, 122 Valley Road")

        self.assertEqual(result["secondaryLabel"], "Kentish Town · Camden · recorded homes at no. 122 in NW5 1AA")
        self.assertEqual(result["street"]["neighbours"], [122])

    def test_suppressed_homes_never_decide_the_postcode(self):
        connection = seeded()
        connection.base.suppressed.add("uk:addr:0000000000a2")
        [result] = self.search(connection, "120 Valley Road")

        self.assertIsNone(result["street"]["likelyPostcode"])
        self.assertEqual(result["street"]["postcodes"], ["NW5 1AA", "NW5 1AB"])

    def test_a_place_after_a_comma_picks_the_street(self):
        connection = seeded()
        connection.streets.append({**street(locality="Kenley"), "borough_id": "uk:lad:E09000008",
                                   "borough_name": "Croydon", "postcode_district": "CR8"})
        self.assertEqual(len(self.search(connection, "130 Valley Road")), 2)
        [result] = self.search(connection, "130 Valley Road, Kenley")
        self.assertEqual(result["street"]["borough"], "Croydon")
        [result] = self.search(connection, "130 Valley Road, NW5 1AA")
        self.assertEqual(result["street"]["borough"], "Camden")

    def test_a_place_open_names_does_not_name_is_found_in_recorded_addresses(self):
        connection = seeded()
        add_home(connection, "uk:addr:0000000000a4", "124 Valley Road, Tufnell Park, London, NW5 1AA", "NW5 1AA")
        [named] = self.search(connection, "130 Valley Road, Tufnell")
        self.assertEqual(named["street"]["borough"], "Camden")
        self.assertEqual(len(self.search(connection, "130 Valley Road, Nowhere")), 1)

    def test_before_migration_042_nothing_is_found(self):
        self.assertEqual(self.search(seeded(streets=False), "120 Valley Road"), [])

    def test_postcode_with_no_recorded_home_resolves_through_onspd(self):
        connection = seeded()
        connection.postcodes["NW5 9XY"] = {"postcode": "NW5 9XY", "geography_id": LSOA, "name": "Camden 001A",
                                           "borough_name": "Camden", "center_lon": -0.14, "center_lat": 51.55}
        [result] = self.search(connection, "nw59xy")

        self.assertEqual(result["label"], "NW5 9XY")
        self.assertEqual(result["secondaryLabel"], "Camden 001A · Camden")
        self.assertEqual(result["geographyId"], LSOA)


TOWER_LSOA = "uk:lsoa:E01000005"  # same borough as the fixture LSOA; stands in for E01032782


def with_tower(connection):
    """Like 10 Marsh Wall: flats at one number, split over several postcodes, in another LSOA."""
    for n, (flat, postcode) in enumerate((("101", "NW5 1AD"), ("3901", "NW5 1AE"), ("4602", "NW5 1AF"))):
        id_ = f"uk:addr:0000000000b{n}"
        connection.base.addresses[id_] = {
            "id": id_, "display_address": f"Apartment {flat}, 10 Valley Road, London, {postcode}",
            "postcode": postcode, "geography_id": TOWER_LSOA, "source_release_id": "src-hmlr"}
    return connection


class TowerNumberTests(unittest.TestCase):
    # "Tufnell Park" names no recorded address, so the query takes the street fallback whether or
    # not the address index matches portal-style queries (B1, #149).
    QUERY = "10 Valley Road, Tufnell Park"

    def search(self, connection, query):
        return EvidenceReader(connect=lambda: connection).search_areas(query)["results"]

    def test_a_number_with_recorded_homes_in_several_postcodes_is_never_unsold(self):
        [result] = self.search(with_tower(seeded()), self.QUERY)

        self.assertNotIn("no recorded sale", result["secondaryLabel"])
        self.assertEqual(result["street"]["neighbours"], [10])
        self.assertIn("recorded homes at no. 10", result["secondaryLabel"])
        for postcode in ("NW5 1AD", "NW5 1AE", "NW5 1AF"):
            self.assertIn(postcode, result["secondaryLabel"])

    def test_a_number_with_recorded_homes_lands_in_their_lsoa_not_the_segment_point(self):
        [result] = self.search(with_tower(seeded()), self.QUERY)

        self.assertEqual(result["geographyId"], TOWER_LSOA)

    def test_the_number_postcodes_come_first_despite_the_cut(self):
        connection = with_tower(seeded())
        for n in range(7):  # more other postcodes than STREET_POSTCODES keeps
            id_ = f"uk:addr:0000000000c{n}"
            connection.base.addresses[id_] = {
                "id": id_, "display_address": f"{20 + n} Valley Road, London, NW5 1A{'ABCDEFG'[n]}",
                "postcode": f"NW5 1A{'ABCDEFG'[n]}", "geography_id": LSOA, "source_release_id": "src-hmlr"}
        [result] = self.search(connection, self.QUERY)

        self.assertEqual(result["street"]["postcodes"][:3], ["NW5 1AD", "NW5 1AE", "NW5 1AF"])

    def test_a_number_with_no_recorded_home_still_says_no_recorded_sale(self):
        [result] = self.search(seeded(), "130 Valley Road, Tufnell Park")

        self.assertIn("no recorded sale", result["secondaryLabel"])


class AreaRentsTests(unittest.TestCase):
    def read(self, connection, area=LSOA):
        return area_rents.area_rents(EvidenceReader(connect=lambda: connection), area)

    def test_an_lsoa_reads_its_borough_with_london_alongside(self):
        connection = seeded()
        connection.rents = [rent("E09000007", "1 bedroom", 2100, "4.20"), rent("E09000007", "2 bedrooms", 2800),
                            rent("E12000007", "1 bedroom", 1800), rent("E09000001", "1 bedroom", 9999)]
        payload = self.read(connection)

        self.assertEqual(payload["schemaVersion"], "area-rents.v1")
        self.assertEqual(payload["productReleaseId"], OLD_RELEASE)
        self.assertTrue(payload["available"])
        self.assertEqual(payload["borough"], {"id": BOROUGH, "name": "Camden test borough"})
        self.assertEqual(payload["period"], "2026-08")
        self.assertEqual(payload["rents"], [
            {"bedrooms": "oneBedroom", "monthlyRent": 2100, "annualChangePct": 4.2, "regionMonthlyRent": 1800},
            {"bedrooms": "twoBedrooms", "monthlyRent": 2800, "annualChangePct": None, "regionMonthlyRent": None}])

    def test_no_rents_loaded_is_unavailable(self):
        payload = self.read(seeded())

        self.assertFalse(payload["available"])
        self.assertEqual(payload["rents"], [])

    def test_bad_and_unknown_areas(self):
        with self.assertRaises(MalformedQuery):
            self.read(seeded(), "camden")
        with self.assertRaises(AreaNotFound):
            self.read(seeded(), "uk:lsoa:E01999999")


if __name__ == "__main__":
    unittest.main()


W5_LSOA, UB2_LSOA = "uk:lsoa:E01000004", "uk:lsoa:E01000005"  # both in the fixture's one borough


def two_warwick_roads():
    """Ealing has two Warwick Roads ~5.5 km apart: one in W5 (Ealing) and one in UB2 (Southall)."""
    connection = StreetConnection(seed_production_fixture())
    base = {"name": "Warwick Road", "borough_id": BOROUGH, "borough_name": "Ealing"}
    connection.streets[:] = [
        {**base, "locality": None, "postcode_district": "W5", "geography_id": W5_LSOA,
         "center_lon": -0.2975, "center_lat": 51.5077},
        {**base, "locality": "Southall", "postcode_district": "UB2", "geography_id": UB2_LSOA,
         "center_lon": -0.3759, "center_lat": 51.5009},
    ]
    for i, (display, postcode, lsoa) in enumerate([
            ("10 Warwick Road, London, W5 3XJ", "W5 3XJ", W5_LSOA),
            ("16 Warwick Road, London, W5 3XJ", "W5 3XJ", W5_LSOA),
            ("35 Warwick Road, London, W5 5PZ", "W5 5PZ", W5_LSOA),
            ("11 Warwick Road, Southall, UB2 4NX", "UB2 4NX", UB2_LSOA),
            ("12 Warwick Road, Southall, UB2 4NX", "UB2 4NX", UB2_LSOA),
            ("16 Warwick Road, Southall, UB2 4NX", "UB2 4NX", UB2_LSOA)]):
        add_home(connection, f"uk:addr:00000000n5{i:02d}", display, postcode)
        connection.base.addresses[f"uk:addr:00000000n5{i:02d}"]["geography_id"] = lsoa
    return connection


class PortalAddressTests(unittest.TestCase):
    """#149: portals write "street + outcode/postcode" with no comma."""

    def search(self, connection, query):
        return EvidenceReader(connect=lambda: connection).search_areas(query)["results"]

    def test_a_trailing_outcode_or_postcode_is_the_place_not_the_street(self):
        self.assertEqual(street_query("Montague Road E8"), (None, "Montague Road"))
        self.assertEqual(street_place("Montague Road E8"), "E8")
        self.assertEqual(street_query("10 Borwick Avenue E17 6RA"), (10, "Borwick Avenue"))
        self.assertEqual(street_place("10 Borwick Avenue E17 6RA"), "E17")
        self.assertEqual(street_query("100a Baker Street EN1"), (100, "Baker Street"))
        self.assertEqual(street_query("A1 Road"), (None, "A1 Road"))

    def test_street_plus_outcode_finds_the_street(self):
        [result] = self.search(seeded(), "130 Valley Road NW5")
        self.assertEqual(result["street"]["borough"], "Camden")

    def test_recorded_home_plus_postcode_finds_the_home(self):
        results = self.search(seeded(), "118 Valley Road NW5 1AA")
        self.assertEqual([r.get("addressId") for r in results], ["uk:addr:0000000000a1"])

    def test_an_outcode_never_returns_a_street_in_another_district(self):
        connection = seeded()
        connection.streets[:] = [  # Open Names spells the Peckham street with an apostrophe
            {**street(name="King's Grove", locality=None), "postcode_district": "SE15",
             "borough_id": "uk:lad:E09000028", "borough_name": "Southwark"},
            {**street(name="Kings Grove", locality="Romford"), "postcode_district": "RM1",
             "borough_id": "uk:lad:E09000016", "borough_name": "Havering"},
        ]
        for query in ("Kings Grove, SE15", "Kings Grove SE15"):
            results = self.search(connection, query)
            self.assertNotIn("RM1", [r["street"]["postcodeDistrict"] for r in results], query)


class SameNamedStreetsTests(unittest.TestCase):
    """#202: same-named streets in one borough are separate physical streets."""

    def search(self, query):
        return EvidenceReader(connect=lambda: two_warwick_roads()).search_areas(query)["results"]

    def test_a_streets_postcodes_are_only_its_own(self):
        [result] = self.search("14 Warwick Road, W5")
        self.assertNotIn("UB2 4NX", result["street"]["postcodes"])

    def test_a_district_keeps_the_other_streets_homes_out(self):
        # The recorded no. 16 in W5 is the answer; Southall's no. 16 never comes along (#149, #202).
        results = self.search("16 Warwick Road, W5")
        self.assertEqual([r.get("addressId") for r in results], ["uk:addr:00000000n501"])

    def test_likely_postcode_reads_only_this_streets_neighbours(self):
        [result] = self.search("14 Warwick Road, Southall")
        self.assertEqual(result["street"]["likelyPostcode"], "UB2 4NX")

    def test_a_recorded_home_is_not_followed_by_its_own_street_called_unsold(self):
        results = self.search("16 Warwick Road, Southall")
        self.assertEqual([r.get("addressId") for r in results], ["uk:addr:00000000n505"])


class SearchAreasPostcodeTests(unittest.TestCase):
    """#200: a full postcode compares exactly, never as a substring of a longer one."""

    def connection(self):
        connection = StreetConnection(seed_production_fixture())
        add_home(connection, "uk:addr:00000000se83", "19 Enterprize Way, London, SE8 3PJ", "SE8 3PJ")
        connection.base.addresses["uk:addr:00000000se83"]["geography_id"] = "uk:lsoa:E01000004"
        connection.postcodes["E8 3PJ"] = {"postcode": "E8 3PJ", "geography_id": "uk:lsoa:E01000005",
                                          "name": "Hackney 001A", "borough_name": "Hackney",
                                          "center_lon": -0.06, "center_lat": 51.55}
        return connection

    def search(self, query):
        connection = self.connection()
        return EvidenceReader(connect=lambda: connection).search_areas(query)["results"]

    def test_full_postcode_never_returns_another_districts_homes(self):
        for query in ("E8 3PJ", "e83pj"):
            labels = [row["label"] for row in self.search(query)]
            self.assertFalse([label for label in labels if "SE8 3PJ" in label], query)

    def test_full_postcode_with_no_recorded_home_falls_back_to_onspd(self):
        self.assertEqual([(row["geographyId"], row["label"]) for row in self.search("E8 3PJ")],
                         [("uk:lsoa:E01000005", "E8 3PJ")])

    def test_full_postcode_finds_only_its_own_recorded_homes(self):
        rows = self.search("SE8 3PJ")
        addresses = [row for row in rows if row.get("addressId")]
        self.assertTrue(addresses)
        self.assertTrue(all("SE8 3PJ" in row["label"] for row in addresses))

    def test_partial_postcode_keeps_substring_behaviour(self):
        rows = EvidenceReader(connect=lambda: self.connection()).search_areas("SE8 3P")["results"]
        self.assertTrue(any("SE8 3PJ" in row["label"] for row in rows if row.get("addressId")))
