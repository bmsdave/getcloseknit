"""People and homes loader: every topic splits into categories that add up to the Census total.

Fixtures are the real Nomis LSOA header and first two rows of each table
(City of London 001A and 001B), zipped in memory the way Nomis ships
them. TS012 (detailed country of birth) is published for local authorities only: its fixture is
the real LTLA header with City of London, Barking and Dagenham and Hartlepool. The detailed tables
TS013, TS022, TS028 and TS031 go down to MSOAs only: their fixtures are the real MSOA header with
Hartlepool 001, City of London 001 and Barking and Dagenham 001 (TS015's the LSOA header with Hartlepool
009A). cob190 and lang26 are census_api's extracts of the ONS API, London only.
"""

import io
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from pathlib import Path

from area_analytics import census_people as people

FIXTURES = Path(__file__).parent / "fixtures" / "census"
MIGRATIONS = Path(__file__).resolve().parents[3] / "deploy" / "migrations"
MIGRATION = (MIGRATIONS / "015-people.sql").read_text()
# The newest migration that lists every census topic.
TOPIC_MIGRATION = (MIGRATIONS / "059-census-detailed.sql").read_text()
LONDON = {"lsoa": ["E01000001", "E01000002"], "msoa": ["E02000001", "E02000002"], "ltla": ["E09000001", "E09000002"]}


def nomis_zip(table: str, text: str | None = None, geography: str = "lsoa") -> io.BytesIO:
    csv_text = text if text is not None else (FIXTURES / f"census2021-{table}-{geography}.csv").read_text()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(f"census2021-{table}-{geography}.csv", csv_text)
    buffer.seek(0)
    return buffer


class TopicTests(unittest.TestCase):
    def test_every_topic_reads_the_real_headers_and_adds_up(self):
        for topic in people.TOPICS:
            with self.subTest(topic=topic.id):
                rows = people.read_topic(topic, nomis_zip(topic.table, geography=topic.geography))
                expected = LONDON[topic.geography]
                self.assertEqual(sorted(set(rows) & set(expected)), expected)
                self.assertTrue(all(code[:3] == expected[0][:3] or topic.geography == "ltla" for code in rows))
                keys = people.categories(topic, nomis_zip(topic.table, geography=topic.geography))
                self.assertEqual(list(rows[expected[0]]), [key for key, _label in keys])

    def test_city_of_london_001a_matches_the_published_counts(self):
        ethnicity = people.read_topic(people.TOPICS[0], nomis_zip("ts021"))["E01000001"]
        self.assertEqual(ethnicity["white-british"], 822)
        self.assertEqual(sum(ethnicity.values()), 1474)
        work = people.read_topic(people.TOPICS[4], nomis_zip("ts066"))["E01000001"]
        # Self-employed joins "with" (42) and "without employees" (162); students join active and inactive.
        self.assertEqual(work["self-employed"], 42 + 162)
        self.assertEqual(work["student"], 16 + 76)
        self.assertEqual(sum(work.values()), 1351)

    def test_age_sums_five_year_bands_into_five_groups(self):
        topic = next(topic for topic in people.TOPICS if topic.id == "age")
        self.assertEqual(topic.table, "ts007a")
        age = people.read_topic(topic, nomis_zip("ts007a"))["E01000001"]
        # 0-4, 5-9, 10-14 | 15-19, 20-24 | 25-29 .. 40-44 | 45-49 .. 60-64 | 65-69 .. 85+
        self.assertEqual(age, {"0-14": 52 + 34 + 32, "15-24": 23 + 90, "25-44": 159 + 132 + 117 + 114,
                               "45-64": 105 + 89 + 73 + 83, "65-plus": 119 + 102 + 57 + 57 + 35})
        self.assertEqual(sum(age.values()), 1473)

    def test_household_type_maps_every_ts003_leaf_once(self):
        topic = next(topic for topic in people.TOPICS if topic.id == "household-type")
        self.assertEqual(topic.table, "ts003")
        homes = people.read_topic(topic, nomis_zip("ts003"))["E01000001"]
        self.assertEqual(homes, {
            "one-person": 129 + 244,
            # Married/civil partnership and cohabiting couples with no children, plus families all aged 66+.
            "couple-no-children": 111 + 99 + 82,
            # Couples with dependent or only non-dependent children.
            "couple-children": 68 + 13 + 13 + 0,
            "lone-parent": 10 + 7,
            # Other single-family households and every multi-family or shared household.
            "other": 14 + 1 + 50,
        })
        self.assertEqual(sum(homes.values()), 841)
        leaves = [column for _key, _label, columns in topic.categories for column in columns]
        self.assertEqual(len(leaves), len(set(leaves)))

    def test_country_of_birth_regions_split_every_lsoa_resident_once(self):
        topic = next(topic for topic in people.TOPICS if topic.id == "country-of-birth")
        self.assertEqual((topic.table, topic.geography), ("ts004", "lsoa"))
        # The real header ends "British Overseas ; measures: Value" (a space before the semicolon).
        regions = people.read_topic(topic, nomis_zip("ts004"))["E01000001"]
        self.assertEqual(regions, {
            "uk": 874, "eu14": 171, "eu8": 30, "eu2": 9, "other-eu": 15, "other-europe": 61, "africa": 33,
            "middle-east-asia": 133, "americas-caribbean": 101, "oceania-other": 49, "british-overseas": 0})
        self.assertEqual(sum(regions.values()), 1476)
        leaves = [column for _key, _label, columns in topic.categories for column in columns]
        self.assertEqual(len(leaves), len(set(leaves)))

    def test_detailed_country_of_birth_is_read_for_every_english_borough(self):
        topic = next(topic for topic in people.TOPICS if topic.id == "country-of-birth-detailed")
        self.assertEqual((topic.table, topic.geography), ("ts012", "ltla"))
        rows = people.read_topic(topic, nomis_zip("ts012", geography="ltla"))
        # Hartlepool (E06000001) is an English unitary authority: a borough since England (migration 103).
        self.assertEqual(sorted(rows), ["E06000001", "E09000001", "E09000002"])
        city = rows["E09000001"]
        self.assertEqual(sum(city.values()), 8579)
        self.assertEqual((city["england"], city["france"], city["poland"], city["india"], city["united-states"]),
                         (4044, 207, 131, 175, 266))
        # Great Britain and United Kingdom "not otherwise specified" are one category.
        self.assertEqual(city["uk-not-specified"], 0)
        self.assertEqual(sum(rows["E09000002"].values()), 218870)
        # Every one of TS012's 59 leaves counted once, in 58 categories.
        leaves = [column for _key, _label, columns in topic.categories for column in columns]
        self.assertEqual((len(leaves), len(set(leaves)), len(topic.categories)), (59, 59, 58))

    def test_detailed_tables_load_every_leaf_at_the_finest_geography(self):
        topics = {topic.id: topic for topic in people.TOPICS}
        self.assertEqual({topic.id: (topic.table, topic.geography) for topic in people.TOPICS if topic.leaves}, {
            "ethnicity-detailed": ("ts022", "msoa"), "country-of-birth-extended": ("cob190", "msoa"),
            "passports": ("ts013", "msoa"), "national-identity": ("ts028", "msoa"),
            "religion-detailed": ("ts031", "msoa"), "main-language": ("lang26", "lsoa"),
            "year-of-arrival": ("ts015", "lsoa")})
        self.assertEqual(people.MSOA_TOPICS, ("ethnicity-detailed", "country-of-birth-extended", "passports",
                                              "national-identity", "religion-detailed"))
        ethnic = topics["ethnicity-detailed"]
        keys = dict(people.categories(ethnic, nomis_zip("ts022", geography="msoa")))
        self.assertEqual(len(keys), 287)
        # Names recurring under another broad group get its prefix: Japanese under Asian and under Other.
        self.assertEqual((keys["asian-japanese"], keys["other-japanese"], keys["white-polish"]), ("Japanese", "Japanese", "Polish"))
        city = people.read_topic(ethnic, nomis_zip("ts022", geography="msoa"))["E02000001"]
        # Published counts for City of London 001: Asian Japanese 58, Korean 35; every resident once.
        self.assertEqual((city["asian-japanese"], city["asian-korean"], city["white-polish"]), (58, 35, 78))
        self.assertEqual(sum(city.values()), 8581)
        countries = people.read_topic(topics["country-of-birth-extended"], nomis_zip("cob190", geography="msoa"))
        self.assertIn("japan", countries["E02000001"])
        self.assertIn("korea-south", countries["E02000001"])
        # Each table is perturbed on its own (cell key perturbation), so totals can differ by a few.
        self.assertEqual(sum(countries["E02000001"].values()), 8580)
        arrival = dict(people.categories(topics["year-of-arrival"], nomis_zip("ts015", geography="lsoa")))
        self.assertEqual(list(arrival)[:2], ["born-in-the-uk", "arrived-before-1951"])

    def test_detailed_leaves_that_do_not_add_up_stop_the_load(self):
        topic = next(topic for topic in people.TOPICS if topic.id == "ethnicity-detailed")
        lines = (FIXTURES / "census2021-ts022-msoa.csv").read_text().splitlines()
        lines[2] = lines[2].replace("E02000001,8581,", "E02000001,8582,", 1)
        with self.assertRaisesRegex(people.CensusError, "categories add up to 8581, total 8582"):
            people.read_topic(topic, nomis_zip("ts022", "\n".join(lines), geography="msoa"))

    def test_two_leaves_with_one_id_are_rejected(self):
        topic = next(topic for topic in people.TOPICS if topic.id == "ethnicity-detailed")
        merged = people.Topic(topic.id, topic.table, topic.prefix, topic.total, (), geography="msoa", leaves=True)
        with self.assertRaisesRegex(people.CensusError, "two leaves share an id"):
            people.read_topic(merged, nomis_zip("ts022", geography="msoa"))

    def test_check_reads_every_topic_from_the_zips(self):
        with tempfile.TemporaryDirectory() as data:
            (Path(data) / "census").mkdir()
            for topic in people.TOPICS:
                (Path(data) / "census" / f"census2021-{topic.table}.zip").write_bytes(
                    nomis_zip(topic.table, geography=topic.geography).getvalue())
            out = io.StringIO()
            with redirect_stdout(out):
                people.check(data)
        self.assertIn("check: country-of-birth 2 LSOAs, every row adds up", out.getvalue())
        self.assertIn("check: country-of-birth-detailed 3 boroughs, every row adds up", out.getvalue())
        self.assertIn("check: ethnicity-detailed 3 MSOAs, every row adds up", out.getvalue())
        self.assertIn("check: country-of-birth-extended 2 MSOAs, every row adds up", out.getvalue())
        self.assertIn("check: main-language 2 LSOAs, every row adds up", out.getvalue())

    def test_districts_merged_since_2021_are_summed_into_their_successor(self):
        # Allerdale and Copeland became Cumberland (E06000063) in 2023; the LSOA names say which is which.
        ltla = (FIXTURES / "census2021-ts012-ltla.csv").read_text().splitlines()
        header, hartlepool = ltla[0], ltla[1].split(",", 3)[3]
        ltla_text = "\n".join([header, f'"2021","Allerdale","E07000026",{hartlepool}',
                               f'"2021","Copeland","E07000029",{hartlepool}', *ltla[1:]]) + "\n"
        lsoa = (FIXTURES / "census2021-ts021-lsoa.csv").read_text().splitlines()
        rest = lsoa[1].split(",", 3)[3]
        lsoa_text = "\n".join([lsoa[0], f"2021,Allerdale 007A,E01019078,{rest}",
                               f"2021,Copeland 001A,E01019079,{rest}", *lsoa[1:]]) + "\n"
        successors = people.ltla_successors(nomis_zip("ts012", ltla_text, "ltla"), nomis_zip("ts021", lsoa_text))
        self.assertEqual(successors, {"E07000026": "E06000063", "E07000029": "E06000063"})
        topic = next(topic for topic in people.TOPICS if topic.id == "country-of-birth-detailed")
        rows = people.roll_up(people.read_topic(topic, nomis_zip("ts012", ltla_text, "ltla")), successors)
        self.assertEqual(sorted(rows), ["E06000001", "E06000063", "E09000001", "E09000002"])
        self.assertEqual(rows["E06000063"]["england"], 2 * rows["E06000001"]["england"])

    def test_a_measures_suffix_in_the_header_is_ignored(self):
        text = (FIXTURES / "census2021-ts030-lsoa.csv").read_text()
        header, rest = text.split("\n", 1)
        suffixed = ",".join(name if not name.startswith("Religion") else f"{name}; measures: Value"
                            for name in header.split(","))
        rows = people.read_topic(people.TOPICS[1], nomis_zip("ts030", f"{suffixed}\n{rest}"))
        self.assertEqual(sorted(rows), ["E01000001", "E01000002"])

    def test_a_header_wrapped_onto_a_new_line_is_read(self):
        text = (FIXTURES / "census2021-ts003-lsoa.csv").read_text()
        wrapped = text.replace("types: Other, including", "types: Other,\n including", 1)
        self.assertNotEqual(wrapped, text)
        topic = next(topic for topic in people.TOPICS if topic.id == "household-type")
        self.assertEqual(people.read_topic(topic, nomis_zip("ts003", wrapped))["E01000002"]["other"], 18 + 3 + 43)

    def test_a_row_that_does_not_add_up_stops_the_load(self):
        lines = (FIXTURES / "census2021-ts030-lsoa.csv").read_text().splitlines()
        broken = lines[1].replace(",1475,", ",1476,", 1)
        with self.assertRaisesRegex(people.CensusError, "religion E01000001"):
            people.read_topic(people.TOPICS[1], nomis_zip("ts030", "\n".join([lines[0], broken]) + "\n"))

    def test_a_renamed_column_is_reported(self):
        text = (FIXTURES / "census2021-ts030-lsoa.csv").read_text().replace("Religion: Sikh", "Religion: Sikhism")
        with self.assertRaisesRegex(people.CensusError, "missing column 'Religion: Sikh'"):
            people.read_topic(people.TOPICS[1], nomis_zip("ts030", text))

    def test_only_requested_lsoas_are_kept(self):
        rows = people.read_topic(people.TOPICS[1], nomis_zip("ts030"), codes={"E01000002"})
        self.assertEqual(list(rows), ["E01000002"])

    def test_category_ids_are_unique_and_fit_the_schema(self):
        for topic in people.TOPICS:
            keys = [key for key, _label in people.categories(topic, nomis_zip(topic.table, geography=topic.geography))]
            self.assertEqual(len(keys), len(set(keys)), topic.id)
            self.assertIn(f"'{topic.id}'", TOPIC_MIGRATION)
            for key in keys:
                self.assertRegex(key, r"^[a-z0-9-]+$")


class PopulationTests(unittest.TestCase):
    def test_rows_below_the_header_are_read_by_column_name(self):
        rows = [
            ("Estimates by broad age groups and sex", None, None, None, None),
            ("LAD 2021 Code", "LAD 2021 Name", "LSOA 2021 Code", "LSOA 2021 Name", "Total"),
            ("E09000001", "City of London", "E01000001", "City of London 001A", 1_520),
            ("E09000001", "City of London", "E01000002", "City of London 001B", "1,401"),
            ("E06000001", "Hartlepool", "E01011949", "Hartlepool 009A", 1_898),
        ]
        self.assertEqual(people.population_rows(rows, {"E01000001", "E01000002"}),
                         {"E01000001": 1_520, "E01000002": 1_401})

    def test_a_sheet_without_the_header_is_rejected(self):
        with self.assertRaises(people.CensusError):
            people.population_rows([("Total", None)])


class ImmutableReleases:
    """A cursor over source_release whose trigger rejects any change to an existing release."""

    def __init__(self):
        self.releases = {}
        self.row = None

    def execute(self, sql, params):
        if sql.startswith("INSERT INTO source_release"):
            release_id, sha = params[0], params[3]
            if release_id in self.releases:
                if "DO NOTHING" not in sql:
                    raise RuntimeError("Source releases are immutable")
            else:
                self.releases[release_id] = sha
        elif sql.startswith("SELECT sha256 FROM source_release"):
            self.row = (self.releases[params[0]],)
        else:
            raise AssertionError(sql)
        return self

    def fetchone(self):
        return self.row


class SourceReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.census = [self.write("ts021.zip", nomis_zip("ts021").getvalue()),
                       self.write("ts003.zip", nomis_zip("ts003").getvalue())]
        self.population = self.write("population.xlsx", b"mid-2024")
        self.cur = ImmutableReleases()

    def write(self, name, data):
        path = Path(self.tmp.name) / name
        path.write_bytes(data)
        return str(path)

    def test_loading_the_same_files_again_changes_nothing(self):
        first = people.insert_releases(self.cur, self.census, self.population)
        before = dict(self.cur.releases)
        second = people.insert_releases(self.cur, self.census, self.population)
        self.assertEqual(first, second)
        self.assertEqual(before, self.cur.releases)
        self.assertEqual({first, people.POPULATION_SOURCE_ID}, set(self.cur.releases))

    def test_a_new_census_file_set_gets_a_new_release(self):
        first = people.insert_releases(self.cur, self.census[:1], self.population)
        second = people.insert_releases(self.cur, self.census, self.population)
        self.assertNotEqual(first, second)
        self.assertTrue(second.startswith(people.CENSUS_SOURCE_BASE + "-"))
        self.assertEqual({first, second, people.POPULATION_SOURCE_ID}, set(self.cur.releases))

    def test_a_changed_population_file_under_the_same_release_stops_the_load(self):
        people.insert_releases(self.cur, self.census, self.population)
        self.write("population.xlsx", b"mid-2025")
        with self.assertRaises(people.CensusError):
            people.insert_releases(self.cur, self.census, self.population)


class SchemaTests(unittest.TestCase):
    def test_parents_and_london_are_sums_of_lsoas(self):
        self.assertIn("SELECT msoa, topic, category, sum(count)", MIGRATION)
        self.assertIn("SELECT borough, topic, category, sum(count)", MIGRATION)
        self.assertIn("UPDATE census_category k SET london_count", MIGRATION)

    def test_borough_only_topics_survive_the_rebuild(self):
        # 047 redefines rebuild_area_people(): TS012's borough rows are loaded as they are and kept.
        self.assertIn("CREATE OR REPLACE FUNCTION public.rebuild_area_people()", TOPIC_MIGRATION)
        self.assertIn("c.topic <> 'country-of-birth-detailed'", TOPIC_MIGRATION)
        self.assertEqual(people.BOROUGH_TOPICS, ("country-of-birth-detailed",))

    def test_msoa_only_topics_survive_the_rebuild_and_sum_into_boroughs(self):
        # 059: the MSOA-only tables' rows are loaded as they are, kept, and summed into boroughs.
        listed = "(" + ", ".join(f"'{topic}'" for topic in people.MSOA_TOPICS) + ")"
        self.assertIn(f"NOT (g.kind = 'msoa' AND c.topic IN {listed})", TOPIC_MIGRATION)
        self.assertIn(f"WHERE m.kind = 'msoa' AND c.topic IN {listed}", TOPIC_MIGRATION)

    def test_density_uses_each_boundary_not_a_sum_of_children(self):
        self.assertIn("ST_Area(g.geometry::geography) / 1e6", MIGRATION)


if __name__ == "__main__":
    unittest.main()
