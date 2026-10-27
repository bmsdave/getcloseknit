"""People and homes per LSOA of the coverage (migration 015-people.sql; England since 107).

Sources (OGL v3.0), all in $AE_DATA (default ~/data):
  census/census2021-ts0NN.zip   Nomis bulk Census 2021 tables, LSOA csv inside
                                (TS003, TS004, TS007A, TS021, TS030, TS044, TS054, TS063, TS066,
                                TS067); TS012 (detailed country of birth) has local authority
                                csvs only, so it is read from its LTLA csv for every borough (any English
                                LAD; the 2021 districts merged since are summed into their successor);
                                TS013, TS022, TS028 and TS031 (passports, ethnic group, national
                                identity, religion; detailed) go down to MSOAs, read from their MSOA csvs;
                                TS015 (year of arrival) from its LSOA csv
  census/census2021-cob190.zip, census2021-lang26.zip
                                country of birth (190) per MSOA and main language (26) per LSOA from
                                the ONS API, written by area_analytics.census_api fetch
  population/sapelsoabroadage20222024.xlsx  ONS mid-2024 LSOA estimates

Each topic is split into categories that add up to the table's total; a row
that does not add up stops the load. LSOA rows are loaded and
rebuild_area_people() adds MSOA, borough, London and region sums in the database; a
borough-only topic (BOROUGH_TOPICS: TS012) is loaded on the boroughs and kept as it is; an
MSOA-only topic (MSOA_TOPICS) is loaded on the MSOAs and summed into boroughs and regions. A detailed
table (Topic.leaves) loads every leaf as its own category.

  python -m area_analytics.census_people check
  python -m area_analytics.census_people load <database-url>

`check` is stdlib only; `load` also needs openpyxl and psycopg.
"""

from __future__ import annotations

import csv
import hashlib
import io
import os
import re
import sys
import zipfile
from dataclasses import dataclass
from datetime import date

from . import coverage

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
ETL_VERSION = "close-knit-people-3"
# Source releases are immutable, so the census release id carries the content hash of the zips:
# the same files reuse their release, a new file set gets a new one.
CENSUS_SOURCE_BASE = "src-ons-census-2021-people"
POPULATION_SOURCE_ID = "src-ons-sape-lsoa-mid2024-broad-age"
POPULATION_FILE = os.path.join("population", "sapelsoabroadage20222024.xlsx")
POPULATION_SHEET = "Mid-2024 LSOA 2021"
POPULATION_YEAR = 2024
POPULATION_URL = (
    "https://www.ons.gov.uk/file?uri=/peoplepopulationandcommunity/populationandmigration/"
    "populationestimates/datasets/lowersuperoutputareamidyearpopulationestimatesnationalstatistics/"
    "mid2022revisednov2025tomid2024/sapelsoabroadage20222024.xlsx")
NOMIS_URL = "https://www.nomisweb.co.uk/output/census/2021/census2021-{table}.zip"
LSOA_CODE = re.compile(r"^E01[0-9]{6}$")
MSOA_CODE = re.compile(r"^E02[0-9]{6}$")
# A borough is any English local authority district (unitary E06, district E07, metropolitan E08, London E09).
BOROUGH_CODE = re.compile(r"^E0[6-9][0-9]{6}$")
# Nomis csv suffix → (codes kept, what they are, area_geography kind).
GEOGRAPHIES = {"lsoa": (LSOA_CODE, "LSOAs", "lsoa"), "msoa": (MSOA_CODE, "MSOAs", "msoa"),
               "ltla": (BOROUGH_CODE, "boroughs", "lad")}
ID_PREFIX = {"lsoa": "lsoa", "msoa": "msoa", "lad": "lad"}  # uk:lad: since step R2 (uk:lad: before)


@dataclass(frozen=True)
class Topic:
    id: str
    table: str
    prefix: str
    total: str
    # (category id, label, source columns summed into it)
    categories: tuple[tuple[str, str, tuple[str, ...]], ...]
    # "lsoa"; "msoa" for a table Nomis publishes down to MSOAs only; "ltla" for one it publishes for
    # local authorities only (every English LAD kept).
    geography: str = "lsoa"
    # A detailed table: every leaf column (one no other column extends) is a category, its id the slug of
    # its last part ("Middle East and Asia: Eastern Asia: Japan" → "japan"), `categories` left empty.
    leaves: bool = False
    # (top part, id prefix) when leaf names recur under different top parts ("asian-japanese").
    groups: tuple[tuple[str, str], ...] = ()


def _one(key: str, label: str, column: str) -> tuple[str, str, tuple[str, ...]]:
    return key, label, (column,)


ASIAN = "Asian, Asian British or Asian Welsh"
BLACK = "Black, Black British, Black Welsh, Caribbean or African"
BLACK_AFRICAN = "Black, Black British, Black Welsh of African background"
BLACK_CARIBBEAN = "Black, Black British, Black Welsh or Caribbean background"
MIXED = "Mixed or Multiple ethnic groups"
ACTIVE = "Economically active (excluding full-time students)"
INACTIVE = "Economically inactive"
ONE = "One person household"
FAMILY = "Single family household"
MARRIED = f"{FAMILY}: Married or civil partnership couple"
COHABITING = f"{FAMILY}: Cohabiting couple family"
LONE = f"{FAMILY}: Lone parent family"
EU = "Europe: Other Europe: EU countries"
EU2001 = f"{EU}: Member countries in March 2001"
EU2011 = f"{EU}: Countries that joined the EU between April 2001 and March 2011"
REST_EUROPE = "Europe: Other Europe: Rest of Europe"
WEST_AFRICA = "Africa: Central and Western Africa"
EAST_AFRICA = "Africa: South and Eastern Africa"
ASIA = "Middle East and Asia"
AMERICAS = "The Americas and the Caribbean"
OCEANIA = "Antarctica and Oceania: Australasia"

TOPICS: tuple[Topic, ...] = (
    Topic("ethnicity", "ts021", "Ethnic group", "Total: All usual residents", (
        _one("white-british", "White British", "White: English, Welsh, Scottish, Northern Irish or British"),
        _one("white-irish", "Irish", "White: Irish"),
        _one("gypsy-traveller", "Gypsy or Irish Traveller", "White: Gypsy or Irish Traveller"),
        _one("roma", "Roma", "White: Roma"),
        _one("other-white", "Other White", "White: Other White"),
        _one("indian", "Indian", f"{ASIAN}: Indian"),
        _one("pakistani", "Pakistani", f"{ASIAN}: Pakistani"),
        _one("bangladeshi", "Bangladeshi", f"{ASIAN}: Bangladeshi"),
        _one("chinese", "Chinese", f"{ASIAN}: Chinese"),
        _one("other-asian", "Other Asian", f"{ASIAN}: Other Asian"),
        _one("african", "Black African", f"{BLACK}: African"),
        _one("caribbean", "Black Caribbean", f"{BLACK}: Caribbean"),
        _one("other-black", "Other Black", f"{BLACK}: Other Black"),
        _one("mixed-white-asian", "Mixed White and Asian", f"{MIXED}: White and Asian"),
        _one("mixed-white-black-african", "Mixed White and Black African", f"{MIXED}: White and Black African"),
        _one("mixed-white-black-caribbean", "Mixed White and Black Caribbean",
             f"{MIXED}: White and Black Caribbean"),
        _one("other-mixed", "Other mixed background", f"{MIXED}: Other Mixed or Multiple ethnic groups"),
        _one("arab", "Arab", "Other ethnic group: Arab"),
        _one("any-other", "Any other group", "Other ethnic group: Any other ethnic group"),
    )),
    Topic("religion", "ts030", "Religion", "Total: All usual residents", (
        _one("no-religion", "No religion", "No religion"),
        _one("christian", "Christian", "Christian"),
        _one("muslim", "Muslim", "Muslim"),
        _one("hindu", "Hindu", "Hindu"),
        _one("jewish", "Jewish", "Jewish"),
        _one("sikh", "Sikh", "Sikh"),
        _one("buddhist", "Buddhist", "Buddhist"),
        _one("other", "Another religion", "Other religion"),
        _one("not-answered", "Chose not to answer", "Not answered"),
    )),
    Topic("qualification", "ts067", "Highest level of qualification",
          "Total: All usual residents aged 16 years and over", (
        _one("degree", "Degree or higher", "Level 4 qualifications and above"),
        _one("a-levels", "A levels or similar", "Level 3 qualifications"),
        _one("gcses", "Five or more GCSEs or similar", "Level 2 qualifications"),
        _one("some-gcses", "Some GCSEs or similar", "Level 1 and entry level qualifications"),
        _one("apprenticeship", "Apprenticeship", "Apprenticeship"),
        _one("other", "Other, including from abroad", "Other qualifications"),
        _one("none", "No qualifications", "No qualifications"),
    )),
    Topic("occupation", "ts063", "Occupation (current)",
          "Total: All usual residents aged 16 years and over in employment the week before the census", (
        _one("managers", "Managers and directors", "1. Managers, directors and senior officials"),
        _one("professional", "Professionals", "2. Professional occupations"),
        _one("associate-professional", "Technical and associate professionals",
             "3. Associate professional and technical occupations"),
        _one("administrative", "Office and admin", "4. Administrative and secretarial occupations"),
        _one("skilled-trades", "Skilled trades", "5. Skilled trades occupations"),
        _one("caring-leisure", "Caring, leisure and other services",
             "6. Caring, leisure and other service occupations"),
        _one("sales", "Sales and customer service", "7. Sales and customer service occupations"),
        _one("operatives", "Machine operators and drivers", "8. Process, plant and machine operatives"),
        _one("elementary", "Elementary jobs", "9. Elementary occupations"),
    )),
    Topic("economic-activity", "ts066", "Economic activity status",
          "Total: All usual residents aged 16 years and over", (
        _one("employee", "Employee", f"{ACTIVE}: In employment: Employee"),
        ("self-employed", "Self-employed", (f"{ACTIVE}: In employment: Self-employed with employees",
                                            f"{ACTIVE}: In employment: Self-employed without employees")),
        _one("unemployed", "Looking for work", f"{ACTIVE}: Unemployed"),
        ("student", "Full-time student", ("Economically active and a full-time student",
                                          f"{INACTIVE}: Student")),
        _one("retired", "Retired", f"{INACTIVE}: Retired"),
        _one("home-family", "Looking after home or family", f"{INACTIVE}: Looking after home or family"),
        _one("sick-disabled", "Long-term sick or disabled", f"{INACTIVE}: Long-term sick or disabled"),
        _one("other-inactive", "Other, not working", f"{INACTIVE}: Other"),
    )),
    Topic("tenure", "ts054", "Tenure of household", "Total: All households", (
        _one("owned-outright", "Owned outright", "Owned: Owns outright"),
        _one("mortgage", "Owned with a mortgage", "Owned: Owns with a mortgage or loan"),
        _one("shared-ownership", "Shared ownership", "Shared ownership"),
        _one("council", "Social rent from the council", "Social rented: Rents from council or Local Authority"),
        _one("other-social", "Social rent from a housing association", "Social rented: Other social rented"),
        _one("private-rent", "Private rent", "Private rented"),
        _one("rent-free", "Lives rent free", "Lives rent free"),
    )),
    Topic("accommodation", "ts044", "Accommodation type", "Total: All households", (
        _one("detached", "Detached house", "Detached"),
        _one("semi-detached", "Semi-detached house", "Semi-detached"),
        _one("terraced", "Terraced house", "Terraced"),
        _one("purpose-built-flat", "Flat in a purpose-built block", "In a purpose-built block of flats or tenement"),
        _one("converted-flat", "Flat in a converted house", "Part of a converted or shared house, including bedsits"),
        _one("other-converted", "Flat in another converted building",
             "Part of another converted building, for example, former school, church or warehouse"),
        _one("commercial", "Home in a commercial building",
             "In a commercial building, for example, in an office building, hotel or over a shop"),
        _one("temporary", "Caravan or temporary home", "A caravan or other mobile or temporary structure"),
    )),
    # TS007A has five-year bands, so the groups break at 15 (its 15 to 19 band cannot split at 16).
    Topic("age", "ts007a", "Age", "Total", (
        ("0-14", "0 to 14", ("Aged 4 years and under", "Aged 5 to 9 years", "Aged 10 to 14 years")),
        ("15-24", "15 to 24", ("Aged 15 to 19 years", "Aged 20 to 24 years")),
        ("25-44", "25 to 44", ("Aged 25 to 29 years", "Aged 30 to 34 years", "Aged 35 to 39 years",
                               "Aged 40 to 44 years")),
        ("45-64", "45 to 64", ("Aged 45 to 49 years", "Aged 50 to 54 years", "Aged 55 to 59 years",
                               "Aged 60 to 64 years")),
        ("65-plus", "65 and over", ("Aged 65 to 69 years", "Aged 70 to 74 years", "Aged 75 to 79 years",
                                    "Aged 80 to 84 years", "Aged 85 years and over")),
    )),
    # TS003 leaves, each counted once. Families all aged 66 and over (nearly all older couples) join
    # "Couple, no children"; couples whose children are all non-dependent join "Couple with children";
    # "Other" is other single-family households and every multi-family or shared household.
    Topic("household-type", "ts003", "Household composition", "Total", (
        ("one-person", "One person", (f"{ONE}: Aged 66 years and over", f"{ONE}: Other")),
        ("couple-no-children", "Couple, no children", (f"{FAMILY}: All aged 66 years and over",
                                                       f"{MARRIED}: No children", f"{COHABITING}: No children")),
        ("couple-children", "Couple with children", (
            f"{MARRIED}: Dependent children", f"{MARRIED}: All children non-dependent",
            f"{COHABITING}: With dependent children", f"{COHABITING}: All children non-dependent")),
        ("lone-parent", "Lone parent", (f"{LONE}: With dependent children", f"{LONE}: All children non-dependent")),
        ("other", "Other, including shared", (
            f"{FAMILY}: Other single family household: Other family composition",
            "Other household types: With dependent children",
            "Other household types: Other, including all full-time students and all aged 66 years and over")),
    )),
    # TS004's leaves, by world region (LSOA). ONS's EU14 are the members before 2004 (France, Germany, ...), EU8
    # the eight that joined in 2004 (Poland, Lithuania, ...), EU2 Romania and Bulgaria; "other EU" is Croatia,
    # Cyprus and Malta. Labels name them in plain words, never ONS's codes.
    Topic("country-of-birth", "ts004", "Country of birth", "Total", (
        _one("uk", "United Kingdom", "Europe: United Kingdom"),
        _one("eu14", "EU members before 2004 (France, Germany, Italy, …)", "Europe: EU countries: European Union EU14"),
        _one("eu8", "Joined the EU in 2004 (Poland, Lithuania, …)", "Europe: EU countries: European Union EU8"),
        _one("eu2", "Romania and Bulgaria", "Europe: EU countries: European Union EU2"),
        _one("other-eu", "Croatia, Cyprus and Malta", "Europe: EU countries: All other EU countries"),
        _one("other-europe", "Europe outside the EU", "Europe: Non-EU countries: All other non-EU countries"),
        _one("africa", "Africa", "Africa"),
        _one("middle-east-asia", "Middle East and Asia", "Middle East and Asia"),
        _one("americas-caribbean", "The Americas and the Caribbean", "The Americas and the Caribbean"),
        _one("oceania-other", "Oceania, Antarctica and other", "Antarctica and Oceania (including Australasia) and Other"),
        _one("british-overseas", "British Overseas Territories", "British Overseas"),
    )),
    # TS012's 59 leaves in 58 categories (the two "UK, not otherwise specified" join), for boroughs (LADs) only:
    # ONS publishes the detailed countries for local authorities, never for LSOAs.
    Topic("country-of-birth-detailed", "ts012", "Country of birth", "Total: All usual residents", (
        _one("england", "England", "Europe: United Kingdom: England"),
        _one("northern-ireland", "Northern Ireland", "Europe: United Kingdom: Northern Ireland"),
        _one("scotland", "Scotland", "Europe: United Kingdom: Scotland"),
        _one("wales", "Wales", "Europe: United Kingdom: Wales"),
        ("uk-not-specified", "UK, part not stated", ("Europe: United Kingdom: Great Britain not otherwise specified",
                                                     "Europe: United Kingdom: United Kingdom not otherwise specified")),
        _one("ireland", "Ireland", f"{EU2001}: Ireland"),
        _one("france", "France", f"{EU2001}: France"),
        _one("germany", "Germany", f"{EU2001}: Germany"),
        _one("italy", "Italy", f"{EU2001}: Italy"),
        _one("portugal", "Portugal", f"{EU2001}: Portugal (including Madeira and the Azores)"),
        _one("spain", "Spain", f"{EU2001}: Spain (including Canary Islands)"),
        _one("other-eu-2001", "Other EU members of 2001", f"{EU2001}: Other member countries in March 2001"),
        _one("lithuania", "Lithuania", f"{EU2011}: Lithuania"),
        _one("poland", "Poland", f"{EU2011}: Poland"),
        _one("romania", "Romania", f"{EU2011}: Romania"),
        _one("other-eu-2011", "Other EU members that joined 2004–2007", f"{EU2011}: Other EU countries"),
        _one("croatia", "Croatia", f"{EU}: Countries that joined the EU between April 2011 and March 2021: Croatia"),
        _one("turkey", "Turkey", f"{REST_EUROPE}: Turkey"),
        _one("other-europe", "Other Europe (not EU)", f"{REST_EUROPE}: Other Europe"),
        _one("north-africa", "North Africa", "Africa: North Africa"),
        _one("ghana", "Ghana", f"{WEST_AFRICA}: Ghana"),
        _one("nigeria", "Nigeria", f"{WEST_AFRICA}: Nigeria"),
        _one("other-west-africa", "Other Central and West Africa", f"{WEST_AFRICA}: Other Central and Western Africa"),
        _one("kenya", "Kenya", f"{EAST_AFRICA}: Kenya"),
        _one("somalia", "Somalia", f"{EAST_AFRICA}: Somalia"),
        _one("south-africa", "South Africa", f"{EAST_AFRICA}: South Africa"),
        _one("zimbabwe", "Zimbabwe", f"{EAST_AFRICA}: Zimbabwe"),
        _one("other-east-africa", "Other South and East Africa", f"{EAST_AFRICA}: Other South and Eastern Africa"),
        _one("africa-not-specified", "Africa, country not stated", "Africa: Africa not otherwise specified"),
        _one("iran", "Iran", f"{ASIA}: Middle East: Iran"),
        _one("iraq", "Iraq", f"{ASIA}: Middle East: Iraq"),
        _one("other-middle-east", "Other Middle East", f"{ASIA}: Middle East: Other Middle East"),
        _one("china", "China", f"{ASIA}: Eastern Asia: China"),
        _one("hong-kong", "Hong Kong", f"{ASIA}: Eastern Asia: Hong Kong (Special Administrative Region of China)"),
        _one("other-east-asia", "Other East Asia", f"{ASIA}: Eastern Asia: Other Eastern Asia"),
        _one("afghanistan", "Afghanistan", f"{ASIA}: Southern Asia: Afghanistan"),
        _one("india", "India", f"{ASIA}: Southern Asia: India"),
        _one("pakistan", "Pakistan", f"{ASIA}: Southern Asia: Pakistan"),
        _one("bangladesh", "Bangladesh", f"{ASIA}: Southern Asia: Bangladesh"),
        _one("sri-lanka", "Sri Lanka", f"{ASIA}: Southern Asia: Sri Lanka"),
        _one("other-south-asia", "Other South Asia", f"{ASIA}: Southern Asia: Other Southern Asia"),
        _one("philippines", "Philippines", f"{ASIA}: South-East Asia: Philippines"),
        _one("malaysia", "Malaysia", f"{ASIA}: South-East Asia: Malaysia"),
        _one("singapore", "Singapore", f"{ASIA}: South-East Asia: Singapore"),
        _one("other-south-east-asia", "Other South-East Asia", f"{ASIA}: South-East Asia: Other South-East Asia"),
        _one("central-asia", "Central Asia", f"{ASIA}: Central Asia"),
        _one("united-states", "United States", f"{AMERICAS}: North America: United States"),
        _one("canada", "Canada", f"{AMERICAS}: North America: Canada"),
        _one("other-north-america", "Other North America", f"{AMERICAS}: North America: Other North America"),
        _one("central-america", "Central America", f"{AMERICAS}: Central America: All Central American countries"),
        _one("south-america", "South America", f"{AMERICAS}: South America: All South American countries"),
        _one("jamaica", "Jamaica", f"{AMERICAS}: The Caribbean: Jamaica"),
        _one("other-caribbean", "Other Caribbean", f"{AMERICAS}: The Caribbean: Other Caribbean"),
        _one("australia", "Australia", f"{OCEANIA}: Australia"),
        _one("new-zealand", "New Zealand", f"{OCEANIA}: New Zealand"),
        _one("other-australasia", "Other Australasia", f"{OCEANIA}: Other Australasia"),
        _one("other-oceania", "Other Oceania and Antarctica", "Antarctica and Oceania: Other Oceania and Antarctica"),
        _one("other", "Other", "Other"),
    ), geography="ltla"),
    # Detailed tables, every leaf its own category (Topic.leaves). Per MSOA, the lowest ONS publishes them:
    # TS022 ethnic group (287 write-in groups, ids prefixed by the broad group, since names such as
    # "Japanese" recur under Asian and Other), the API's country of birth (190, census_api), TS013
    # passports held, TS028 national identity and TS031 religion. Per LSOA: the API's main language (26)
    # and TS015 year of arrival.
    Topic("ethnicity-detailed", "ts022", "Ethnic group (detailed)", "Total: All usual residents", (),
          geography="msoa", leaves=True, groups=(
              (ASIAN, "asian"), (BLACK_AFRICAN, "black-african"), (BLACK_CARIBBEAN, "black-caribbean"),
              (MIXED, "mixed"), ("Other ethnic group", "other"), ("White", "white"))),
    Topic("country-of-birth-extended", "cob190", "Country of birth (extended)", "Total: All usual residents", (),
          geography="msoa", leaves=True),
    Topic("passports", "ts013", "Passports held", "Total: All usual residents", (), geography="msoa", leaves=True),
    Topic("national-identity", "ts028", "National identity (detailed)", "Total: All usual residents", (),
          geography="msoa", leaves=True),
    Topic("religion-detailed", "ts031", "Religion (detailed)", "Total: All Usual Residents", (),
          geography="msoa", leaves=True),
    Topic("main-language", "lang26", "Main language (detailed)", "Total: All usual residents aged 3 years and over",
          (), leaves=True),
    Topic("year-of-arrival", "ts015", "Year of arrival in the UK", "Total: All usual residents", (), leaves=True),
)
# Topics loaded on boroughs only; rebuild_area_people() (migration 047) keeps their rows as they are.
BOROUGH_TOPICS = tuple(topic.id for topic in TOPICS if topic.geography == "ltla")
# Topics loaded on MSOAs only; rebuild_area_people() (migration 059) keeps them and sums them into boroughs.
MSOA_TOPICS = tuple(topic.id for topic in TOPICS if topic.geography == "msoa")


class CensusError(ValueError):
    pass


def _header(name: str) -> str:
    """Nomis headers mix ': ' and ':' between levels, some end in '; measures: Value' and a long
    one may wrap onto a new line or keep a space before the suffix ("British Overseas ; measures");
    compare them in one form."""
    name = re.sub(r";\s*measures\s*:\s*Value$", "", re.sub(r"\s+", " ", name).strip()).strip()
    return re.sub(r"\s*:\s*", ": ", name)


def zip_path(topic: Topic, data: str = DATA) -> str:
    return os.path.join(data, "census", f"census2021-{topic.table}.zip")


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def leaf_category(topic: Topic, path: str) -> tuple[str, str]:
    """(category id, label) of one leaf of a detailed table, from its path below the table's prefix."""
    parts = path.split(": ")
    label = parts[-1].strip()
    if topic.groups:
        return f"{dict(topic.groups)[parts[0]]}-{slug(label)}", label
    return slug(label), label


def _leaves(topic: Topic, header: list[str]) -> list[tuple[str, str, str]]:
    """(category id, label, column) for each leaf column of a detailed table, in the csv's order."""
    prefix = _header(f"{topic.prefix}: ")
    total = _header(f"{topic.prefix}: {topic.total}")
    own = [name for name in header if name.startswith(prefix) and name != total]
    found = [(*leaf_category(topic, name[len(prefix):]), name) for name in own
             if not any(other.startswith(name + ": ") for other in own)]
    ids = [key for key, _label, _name in found]
    if len(ids) != len(set(ids)):
        raise CensusError(f"{topic.table}: two leaves share an id: {sorted({k for k in ids if ids.count(k) > 1})}")
    return found


def leaf_paths(topic: Topic, source: str | io.BufferedIOBase) -> list[tuple[str, str, str]]:
    """(category id, label, path below the prefix) of each leaf of a detailed table, from its csv header."""
    with zipfile.ZipFile(source) as archive, archive.open(f"census2021-{topic.table}-{topic.geography}.csv") as raw:
        header = [_header(name) for name in next(csv.reader(io.TextIOWrapper(raw, encoding="utf-8-sig")))]
    prefix = len(_header(f"{topic.prefix}: "))
    return [(key, label, name[prefix:]) for key, label, name in _leaves(topic, header)]


def categories(topic: Topic, source: str | io.BufferedIOBase | None = None) -> tuple[tuple[str, str], ...]:
    """(category id, label) in the loader's order; a detailed table's come from its csv header (`source`)."""
    if not topic.leaves:
        return tuple((key, label) for key, label, _columns in topic.categories)
    return tuple((key, label) for key, label, _path in leaf_paths(topic, source))


def read_topic(topic: Topic, source: str | io.BufferedIOBase, codes: set[str] | None = None) -> dict[str, dict[str, int]]:
    """Area code (LSOA, MSOA for an MSOA table, borough for an LTLA table) → category → count,
    from a Nomis bulk zip (path or file object)."""
    member = f"census2021-{topic.table}-{topic.geography}.csv"
    code_pattern = GEOGRAPHIES[topic.geography][0]
    with zipfile.ZipFile(source) as archive, archive.open(member) as raw:
        reader = csv.reader(io.TextIOWrapper(raw, encoding="utf-8-sig"))
        header = [_header(name) for name in next(reader)]
        index = {name: position for position, name in enumerate(header)}
        code_at = index.get("geography code")
        if code_at is None:
            raise CensusError(f"{member}: no 'geography code' column")

        def column(name: str) -> int:
            full = _header(f"{topic.prefix}: {name}")
            if full not in index:
                raise CensusError(f"{member}: missing column {full!r}")
            return index[full]

        total_at = column(topic.total)
        if topic.leaves:
            parts = [(key, [index[name]]) for key, _label, name in _leaves(topic, header)]
        else:
            parts = [(key, [column(name) for name in columns]) for key, _label, columns in topic.categories]
        rows: dict[str, dict[str, int]] = {}
        for record in reader:
            code = record[code_at]
            if not code_pattern.match(code) or (codes is not None and code not in codes):
                continue
            counts = {key: sum(int(record[at]) for at in ats) for key, ats in parts}
            total = int(record[total_at])
            if sum(counts.values()) != total:
                raise CensusError(f"{topic.id} {code}: categories add up to {sum(counts.values())}, total {total}")
            rows[code] = counts
    return rows


def read_population(path: str, codes: set[str] | None = None) -> dict[str, int]:
    """LSOA code → mid-year usual residents from the ONS broad-age workbook."""
    import openpyxl

    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        return population_rows(book[POPULATION_SHEET].iter_rows(values_only=True), codes)
    finally:
        book.close()


def population_rows(rows, codes: set[str] | None = None) -> dict[str, int]:
    """Find the header row (it holds 'LSOA 2021 Code' and 'Total'), then read below it."""
    found: dict[str, int] = {}
    code_at = total_at = None
    for row in rows:
        if code_at is None:
            cells = [str(cell).strip() if cell is not None else "" for cell in row]
            if "LSOA 2021 Code" in cells and "Total" in cells:
                code_at, total_at = cells.index("LSOA 2021 Code"), cells.index("Total")
            continue
        code = row[code_at]
        if not isinstance(code, str) or not LSOA_CODE.match(code) or (codes is not None and code not in codes):
            continue
        found[code] = int(str(row[total_at]).replace(",", ""))
    if code_at is None:
        raise CensusError("population sheet has no 'LSOA 2021 Code' / 'Total' header")
    return found


def _sha256(paths: list[str]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        with open(path, "rb") as handle:
            for block in iter(lambda: handle.read(1 << 20), b""):
                digest.update(block)
    return digest.hexdigest()


def census_release_date(paths: list[str]) -> date:
    """The newest LSOA (or LTLA) csv inside the zips: when Nomis last published these tables."""
    newest = date(2022, 1, 1)
    for path in paths:
        with zipfile.ZipFile(path) as archive:
            for info in archive.infolist():
                if info.filename.endswith(("-lsoa.csv", "-msoa.csv", "-ltla.csv")):
                    newest = max(newest, date(*info.date_time[:3]))
    return newest


def ltla_successors(source: str | io.BufferedIOBase, lsoa_source: str | io.BufferedIOBase) -> dict[str, str]:
    """{2021 LAD code: current LAD code} for the districts merged since Census 2021 (Cumbria, North
    Yorkshire, Somerset in 2023), from the LTLA csv's names and the LSOA csv's names ("Allerdale 001A"),
    each LSOA placed in its current LAD by coverage.lsoa_lookup()."""
    def rows(src, member):
        with zipfile.ZipFile(src) as archive, archive.open(member) as raw:
            reader = csv.reader(io.TextIOWrapper(raw, encoding="utf-8-sig"))
            header = [_header(name) for name in next(reader)]
            name_at, code_at = header.index("geography"), header.index("geography code")
            return [(row[name_at], row[code_at]) for row in reader]

    current: dict[str, set[str]] = {}
    lookup = coverage.lsoa_lookup()
    for name, code in rows(lsoa_source, "census2021-ts021-lsoa.csv"):
        if code in lookup:
            current.setdefault(name.rsplit(" ", 1)[0], set()).add(lookup[code][1])
    out = {}
    for name, code in rows(source, "census2021-ts012-ltla.csv"):
        if BOROUGH_CODE.match(code) and not coverage.is_english_lad(code) and name in current:
            if len(current[name]) != 1:
                raise CensusError(f"ts012: {name} ({code}) lies in {sorted(current[name])}")
            out[code] = next(iter(current[name]))
    return out


def roll_up(rows: dict[str, dict[str, int]], successors: dict[str, str]) -> dict[str, dict[str, int]]:
    """Sum the rows of merged districts into their successor; other codes stay as they are."""
    out: dict[str, dict[str, int]] = {}
    for code, counts in rows.items():
        target = out.setdefault(successors.get(code, code), dict.fromkeys(counts, 0))
        for key, count in counts.items():
            target[key] += count
    return out


def read_all(codes: dict[str, set[str]] | None = None, data: str = DATA) -> dict[str, dict[str, dict[str, int]]]:
    """{topic: {code: {category: count}}}; `codes` keeps only these codes per geography ("lsoa", "msoa", "ltla").
    LTLA tables are read whole, merged districts summed into their successor, then filtered."""
    out = {}
    for topic in TOPICS:
        wanted = None if codes is None else codes[topic.geography]
        if topic.geography == "ltla":
            successors = ltla_successors(zip_path(topic, data), os.path.join(data, "census", "census2021-ts021.zip"))
            rows = roll_up(read_topic(topic, zip_path(topic, data)), successors)
            out[topic.id] = rows if wanted is None else {code: c for code, c in rows.items() if code in wanted}
        else:
            out[topic.id] = read_topic(topic, zip_path(topic, data), wanted)
    return out


def check(data: str = DATA) -> None:
    """Read every England LSOA (every MSOA for the MSOA tables, every LTLA for TS012) of every table;
    stops at the first row that does not add up."""
    for topic in TOPICS:
        rows = read_topic(topic, zip_path(topic, data))
        print(f"check: {topic.id} {len(rows)} {GEOGRAPHIES[topic.geography][1]}, every row adds up")


SOURCE_SQL = """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
    attribution, transformation_version, geography_vintage, validation_status, caveats)
  VALUES (%s, %s, now(), %s, %s, 'OGL-3.0', %s, %s, '2021', 'passed', %s)
  ON CONFLICT (id) DO NOTHING"""


def census_source_id(sha256: str) -> str:
    return f"{CENSUS_SOURCE_BASE}-{sha256[:12]}"


def insert_release(cur, release_id: str, url: str, released: date, sha256: str, attribution: str,
                   caveats: list[str]) -> None:
    """Adds the release once; a release id already holding other files stops the load."""
    cur.execute(SOURCE_SQL, (release_id, url, released, sha256, attribution, ETL_VERSION, caveats))
    stored = cur.execute("SELECT sha256 FROM source_release WHERE id = %s", (release_id,)).fetchone()[0]
    if stored != sha256:
        raise CensusError(f"{release_id} was loaded from other files (sha256 {stored[:12]}); "
                          "give the new files a new release id")


def insert_releases(cur, census_paths: list[str], population_path: str) -> str:
    """Census and population source releases; returns the census release id."""
    census_sha = _sha256(census_paths)
    census_id = census_source_id(census_sha)
    insert_release(
        cur, census_id, NOMIS_URL.format(table="ts0NN"), census_release_date(census_paths), census_sha,
        "ONS Census 2021 tables TS003, TS004, TS007A, TS012, TS013, TS015, TS021, TS022, TS028, TS030, TS031, TS044, "
        "TS054, TS063, TS066, TS067 via Nomis; country of birth (190 categories) and main language (26) via the ONS "
        "API. Source: Office for National Statistics licensed under the Open Government Licence v3.0.",
        ["Counts are from Census day, 21 March 2021, during coronavirus restrictions.",
         "ONS adjusts small counts slightly to protect privacy, so MSOA and borough sums of LSOAs can "
         "differ a little from figures ONS publishes for those areas.",
         "Occupation counts people in work in the week before the census.",
         "Age groups follow the census's five-year bands: 0 to 14, 15 to 24, 25 to 44, 45 to 64, "
         "65 and over.",
         "Detailed country of birth (TS012) is published for local authorities only: it is never split into "
         "smaller areas; the districts merged in 2023 (Cumbria, North Yorkshire, Somerset) are summed.",
         "Detailed ethnic group (TS022), country of birth (190), passports held (TS013), national identity "
         "(TS028) and religion (TS031) are published down to MSOAs only: they are never split into LSOAs."])
    insert_release(
        cur, POPULATION_SOURCE_ID, POPULATION_URL, date(2025, 11, 7), _sha256([population_path]),
        "ONS mid-2024 Lower layer Super Output Area population estimates (revised November 2025). Source: "
        "Office for National Statistics licensed under the Open Government Licence v3.0.",
        ["Estimates of usual residents on 30 June 2024, not a count.",
         "Density divides residents by the land area of the generalised boundary; parks, rivers and "
         "industrial land count as area."])
    return census_id


def load(url: str, data: str = DATA) -> None:
    import psycopg

    census_paths = [zip_path(topic, data) for topic in TOPICS]
    population_path = os.path.join(data, POPULATION_FILE)
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        geographies = {name: {row[0] for row in cur.execute(
            "SELECT official_code FROM area_geography WHERE kind = %s", (kind,))}
            for name, (_pattern, _words, kind) in GEOGRAPHIES.items()}
        codes = geographies["lsoa"]
        topics = read_all(geographies, data)
        population = read_population(population_path, codes)
        for topic in TOPICS:
            wanted = geographies[topic.geography]
            if set(topics[topic.id]) != wanted:
                raise CensusError(f"{topic.id}: {len(wanted - set(topics[topic.id]))} "
                                  f"{GEOGRAPHIES[topic.geography][1]} missing")
        missing_population = codes - set(population)
        if missing_population:
            raise CensusError(f"population: {len(missing_population)} LSOAs missing")

        census_id = insert_releases(cur, census_paths, population_path)

        cur.execute("DELETE FROM area_census_count")
        cur.execute("DELETE FROM census_category")
        with cur.copy("COPY census_category (topic, category, label, position) FROM STDIN") as copy:
            for topic in TOPICS:
                for position, (key, label) in enumerate(categories(topic, zip_path(topic, data))):
                    copy.write_row((topic.id, key, label, position))
        with cur.copy("COPY area_census_count (geography_id, topic, category, count, source_release_id) "
                      "FROM STDIN") as copy:
            for topic in TOPICS:
                prefix = ID_PREFIX[GEOGRAPHIES[topic.geography][2]]
                for code, counts in topics[topic.id].items():
                    for key, count in counts.items():
                        copy.write_row((f"uk:{prefix}:{code}", topic.id, key, count, census_id))

        cur.execute("DELETE FROM area_population")
        cur.execute("CREATE TEMP TABLE people_population (code text PRIMARY KEY, population integer) ON COMMIT DROP")
        with cur.copy("COPY people_population (code, population) FROM STDIN") as copy:
            for code, count in population.items():
                copy.write_row((code, count))
        cur.execute(
            """INSERT INTO area_population (geography_id, population, population_year, area_km2, source_release_id)
               SELECT g.id, p.population, %s, ST_Area(g.geometry::geography) / 1e6, %s
               FROM people_population p JOIN area_geography g ON g.official_code = p.code AND g.kind = 'lsoa'""",
            (POPULATION_YEAR, POPULATION_SOURCE_ID))
        parents = cur.execute("SELECT rebuild_area_people()").fetchone()[0]
        print(f"load: {len(codes)} LSOAs, {len(geographies['msoa'])} MSOAs, {len(geographies['ltla'])} boroughs, "
              f"{len(TOPICS)} census topics, {parents} MSOA/borough census rows, "
              f"{sum(population.values())} residents (mid-{POPULATION_YEAR})")


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "check":
        check()
    elif stage == "load" and len(sys.argv) == 3:
        load(sys.argv[2])
    else:
        sys.exit(__doc__)
