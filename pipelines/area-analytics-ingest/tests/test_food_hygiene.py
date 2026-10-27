"""FSA food hygiene register: XML parsing, minimisation, skipped geocodes and the TSV."""

import io
import os
import tempfile
import unittest

from area_analytics import food_hygiene

FIXTURE = b"""<?xml version="1.0"?>
<FHRSEstablishment xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<Header><ExtractDate>2026-10-01</ExtractDate><ItemCount>4</ItemCount><ReturnCode>Success</ReturnCode></Header>
<EstablishmentCollection>
<EstablishmentDetail><FHRSID>101</FHRSID><BusinessName>Cafe\tNero</BusinessName>
 <BusinessType>Restaurant/Cafe/Canteen</BusinessType><BusinessTypeID>1</BusinessTypeID>
 <AddressLine1>1 High Road</AddressLine1><PostCode>E1 1AA</PostCode><RatingValue>5</RatingValue>
 <RatingDate>2026-02-25</RatingDate><LocalAuthorityName>Tower Hamlets</LocalAuthorityName>
 <LocalAuthorityEmailAddress>food@example.org</LocalAuthorityEmailAddress>
 <Scores><Hygiene>5</Hygiene><Structural>10</Structural></Scores>
 <Geocode><Longitude>-0.0712</Longitude><Latitude>51.5155</Latitude></Geocode></EstablishmentDetail>
<EstablishmentDetail><FHRSID>102</FHRSID><BusinessName>Mobile Van</BusinessName>
 <BusinessType>Mobile caterer</BusinessType><BusinessTypeID>7846</BusinessTypeID>
 <RatingValue>AwaitingInspection</RatingValue><RatingDate xsi:nil="true" />
 <LocalAuthorityName>Tower Hamlets</LocalAuthorityName><Geocode /></EstablishmentDetail>
<EstablishmentDetail><FHRSID>103</FHRSID><BusinessName>Corner Shop</BusinessName>
 <BusinessType>Retailers - other</BusinessType><BusinessTypeID>4613</BusinessTypeID>
 <RatingValue>Exempt</RatingValue><RatingDate xsi:nil="true" />
 <LocalAuthorityName>Tower Hamlets</LocalAuthorityName>
 <Geocode><Longitude>-0.05</Longitude><Latitude>51.52</Latitude></Geocode></EstablishmentDetail>
<EstablishmentDetail><FHRSID>104</FHRSID><BusinessName>Nowhere</BusinessName>
 <RatingValue>3</RatingValue><Geocode><Longitude>0</Longitude><Latitude>0</Latitude></Geocode></EstablishmentDetail>
</EstablishmentCollection></FHRSEstablishment>"""


class EstablishmentTests(unittest.TestCase):
    def setUp(self):
        self.extract, self.rows, self.skipped = food_hygiene.establishments(io.BytesIO(FIXTURE))

    def test_keeps_geocoded_rows_and_counts_the_rest(self):
        self.assertEqual(self.extract, "2026-10-01")
        self.assertEqual([r["fhrs_id"] for r in self.rows], [101, 103])
        self.assertEqual(self.skipped["no geocode"], 2)  # empty <Geocode/> and 0,0

    def test_fields_and_minimisation(self):
        cafe, shop = self.rows
        self.assertEqual(set(cafe), set(food_hygiene.COLUMNS))  # no address, postcode, email or scores
        self.assertEqual(cafe["rating"], "5")
        self.assertEqual(cafe["rating_date"], "2026-02-25")
        self.assertEqual(cafe["business_type_id"], 1)
        self.assertEqual(cafe["location"], "SRID=4326;POINT(-0.0712 51.5155)")
        self.assertEqual(shop["rating"], "Exempt")
        self.assertIsNone(shop["rating_date"])

    def test_tsv_escapes_tabs_and_writes_nulls_empty(self):
        cafe, shop = self.rows
        self.assertEqual(food_hygiene.tsv_line(cafe).split("\t")[1], "Cafe\\tNero")
        self.assertEqual(food_hygiene.tsv_line(shop).split("\t")[5], "")
        self.assertEqual(len(food_hygiene.tsv_line(cafe).split("\t")), len(food_hygiene.COLUMNS))

    def test_merge_drops_duplicate_ids(self):
        rows, skipped = food_hygiene.merge([(self.rows, self.skipped), (self.rows[:1], {})])
        self.assertEqual(len(rows), 2)
        self.assertEqual(skipped["duplicate id"], 1)
        self.assertEqual(skipped["no geocode"], 2)


class SourceTests(unittest.TestCase):
    def test_london_codes_from_authorities(self):
        listing = {"authorities": [{"LocalAuthorityIdCode": "501", "RegionName": "London"},
                                   {"LocalAuthorityIdCode": "760", "RegionName": "Scotland"}]}
        self.assertEqual(food_hygiene.london_codes(listing), {"501"})

    def test_sha256_covers_every_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            a, b = os.path.join(tmp, "a.xml"), os.path.join(tmp, "b.xml")
            for path in (a, b):
                with open(path, "wb") as handle:
                    handle.write(b"x")
            both = food_hygiene.files_sha256([b, a])
            self.assertEqual(both, food_hygiene.files_sha256([a, b]))
            self.assertNotEqual(both, food_hygiene.files_sha256([a]))

    def test_source_release_names_the_release(self):
        release = food_hygiene.source_release({"extract_date": "2026-10-01", "sha256": "f" * 64, "files": 33,
                                               "skipped": {"no geocode": 5}})
        self.assertEqual(release[0], "src-fsa-fhrs-2026-10")
        self.assertEqual(release[4], "OGL-3.0")
        self.assertTrue(any("(5)" in caveat for caveat in release[6]))


if __name__ == "__main__":
    unittest.main()
