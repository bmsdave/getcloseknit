"""Census 2021 map layers: one LSOA metric per category, from the People counts (migrations 015, 045, 047, 059).

For every LSOA loaded (all of England since migration 103) it reads the Census 2021 counts the People loader wrote into
`area_census_count` (area_analytics.census_people) and publishes the share of residents (ethnic
group and its 19 detailed groups, religion, age, country of birth by world region) or households
(household type, tenure, accommodation type) in each category:

  metric_value  census-<topic>-<category>: % of the topic's total, one decimal
                (sample = the topic total; suppressed where the LSOA has no counts)

The detailed tables add one layer per category with at least 1,000 residents in one region, listed in
census_picks.json (written by area_analytics.census_picks; web/src/lib/census-picks.ts holds the same):
ethnic group (TS022), country of birth (190, ONS API), passports held (TS013), national identity
(TS028) and religion (TS031) exist down to MSOAs only, so each LSOA carries its MSOA's share, marked
`fallback` (a wider area's figure), and the legend says "MSOA figures: each MSOA is one colour"; main
language (26, ONS API) and year of arrival (TS015) are per LSOA.

They go under their own source release `src-ons-census-2021-layers*` (OGL v3, copied from the People
release), then a product release that replaces any earlier build is staged and activated. The
category lists mirror web/src/lib/census-layers.ts (tests/test_census_layers.py checks).
Social rent is the older `social-renting` metric, so tenure here is owned and private rent only.

Descriptive only (user decision 2026-10-11): no London percentile is stored, the API refuses to
rank these metrics (area_api.evidence.is_descriptive_only) and they are never match criteria.

It reads and writes the LSOAs in chunks (CHUNK at a time), so all of England (~21M values) fits in memory.

  python3 etl_census_layers.py load <database-url>      (needs psycopg; about a minute for London,
                                                         ~15 minutes for England)
"""
from __future__ import annotations

import csv
import io
import json
import sys
from array import array
from collections.abc import Iterable, Mapping
from pathlib import Path

PERIOD = "2021-03-01"
SOURCE_BASE = "src-ons-census-2021-layers"
ETL_VERSION = "close-knit-census-layers-1"
# The price ramp's five steps (YlGnBu, as typical-price): a calm sequential ramp, never a traffic light.
CHUNK = 2000  # LSOAs read and written per step
COLOURS = ("#c7e9b4", "#7fcdbb", "#1d91c0", "#253494", "#081d58")
QUANTILES = (0.1, 0.3, 0.5, 0.7, 0.9)

# Ethnic makeup's 19 detailed TS021 categories, each its own layer inside its group (web: a group's
# subviews), after the five group layers, which they sum to: (category, legend words).
ETHNIC_DETAIL: tuple[tuple[str, str], ...] = (
    ("indian", "Indian"), ("pakistani", "Pakistani"), ("bangladeshi", "Bangladeshi"), ("chinese", "Chinese"),
    ("other-asian", "other Asian"),
    ("african", "Black African"), ("caribbean", "Black Caribbean"), ("other-black", "other Black"),
    ("mixed-white-asian", "mixed White and Asian"), ("mixed-white-black-african", "mixed White and Black African"),
    ("mixed-white-black-caribbean", "mixed White and Black Caribbean"), ("other-mixed", "other mixed or multiple"),
    ("white-british", "White British"), ("white-irish", "Irish"), ("gypsy-traveller", "Gypsy or Irish Traveller"),
    ("roma", "Roma"), ("other-white", "other White"),
    ("arab", "Arab"), ("any-other", "any other ethnic group"),
)
ETHNIC_DETAIL_IDS = tuple(f"census-ethnicity-{category}" for category, _ in ETHNIC_DETAIL)
# The detailed tables' categories published as layers (area_analytics.census_picks writes the file).
PICKS = json.loads((Path(__file__).with_name("census_picks.json")).read_text())["topics"]
# Topics whose counts exist down to MSOAs only (area_analytics.census_people.MSOA_TOPICS): each LSOA shows its MSOA's.
MSOA_TOPICS = tuple(entry["topic"] for entry in PICKS if entry["geography"] == "msoa")
MSOA_NOTE = "MSOA figures: each MSOA is one colour."

# Country of birth by world region (TS004, per LSOA): (category, view label, legend words).
BIRTH_REGIONS: tuple[tuple[str, str, str], ...] = (
    ("uk", "UK", "born in the UK"),
    ("eu14", "EU before 2004", "born in an older EU member (France, Germany, Italy, Spain, Portugal, Ireland, Greece, …)"),
    ("eu8", "Joined EU 2004", "born in a country that joined the EU in 2004 (Poland, Lithuania, Latvia, Estonia, Czechia, Slovakia, Hungary, Slovenia)"),
    ("eu2", "Romania, Bulgaria", "born in Romania or Bulgaria"),
    ("other-eu", "Croatia, Cyprus, Malta", "born in Croatia, Cyprus or Malta"),
    ("other-europe", "Europe, non-EU", "born in Europe outside the EU (Turkey, Ukraine, Albania, Switzerland, …)"),
    ("africa", "Africa", "born in Africa"),
    ("middle-east-asia", "Middle East & Asia", "born in the Middle East or Asia"),
    ("americas-caribbean", "Americas & Caribbean", "born in the Americas or the Caribbean"),
    ("oceania-other", "Oceania & other", "born in Oceania, Antarctica or elsewhere"),
    ("british-overseas", "British Overseas", "born in a British Overseas Territory"),
)
# (topic, universe, ((metric id, label, categories summed), ...)), in web order.
LAYERS: tuple[tuple[str, str, tuple[tuple[str, str, tuple[str, ...]], ...]], ...] = (
    ("ethnicity", "residents", (
        ("census-ethnicity-asian", "Asian", ("indian", "pakistani", "bangladeshi", "chinese", "other-asian")),
        ("census-ethnicity-black", "Black", ("african", "caribbean", "other-black")),
        ("census-ethnicity-mixed", "Mixed or multiple", ("mixed-white-asian", "mixed-white-black-african",
                                                         "mixed-white-black-caribbean", "other-mixed")),
        ("census-ethnicity-white", "White", ("white-british", "white-irish", "gypsy-traveller", "roma", "other-white")),
        ("census-ethnicity-other", "other ethnic group", ("arab", "any-other")),
        *((metric, words, (category,)) for metric, (category, words) in zip(ETHNIC_DETAIL_IDS, ETHNIC_DETAIL)),
    )),
    ("religion", "residents", (
        ("census-religion-christian", "Christian", ("christian",)),
        ("census-religion-muslim", "Muslim", ("muslim",)),
        ("census-religion-hindu", "Hindu", ("hindu",)),
        ("census-religion-jewish", "Jewish", ("jewish",)),
        ("census-religion-sikh", "Sikh", ("sikh",)),
        ("census-religion-buddhist", "Buddhist", ("buddhist",)),
        ("census-religion-none", "no religion", ("no-religion",)),
        ("census-religion-other", "another religion", ("other",)),
    )),
    ("age", "residents", (
        ("census-age-0-14", "aged 0–14", ("0-14",)),
        ("census-age-15-24", "aged 15–24", ("15-24",)),
        ("census-age-25-44", "aged 25–44", ("25-44",)),
        ("census-age-45-64", "aged 45–64", ("45-64",)),
        ("census-age-65-plus", "aged 65 and over", ("65-plus",)),
    )),
    ("household-type", "households", (
        ("census-household-one-person", "one person", ("one-person",)),
        ("census-household-couple-no-children", "couple, no children", ("couple-no-children",)),
        ("census-household-couple-children", "couple with children", ("couple-children",)),
        ("census-household-lone-parent", "lone parent", ("lone-parent",)),
        ("census-household-other", "other, including shared", ("other",)),
    )),
    ("tenure", "households", (
        ("census-tenure-owned", "owned (outright, mortgage or shared)", ("owned-outright", "mortgage", "shared-ownership")),
        ("census-tenure-private-rent", "private rent", ("private-rent",)),
    )),
    ("accommodation", "households", (
        ("census-accommodation-detached", "detached house", ("detached",)),
        ("census-accommodation-semi-detached", "semi-detached house", ("semi-detached",)),
        ("census-accommodation-terraced", "terraced house", ("terraced",)),
        ("census-accommodation-flat", "flat", ("purpose-built-flat", "converted-flat", "other-converted", "commercial")),
        ("census-accommodation-other", "caravan or temporary home", ("temporary",)),
    )),
    ("country-of-birth", "residents", tuple(
        (f"census-birth-{category}", words, (category,)) for category, _, words in BIRTH_REGIONS)),
    *((entry["topic"], entry["universe"], tuple(
        (entry["prefix"] + pick["category"], pick["words"], (pick["category"],)) for pick in entry["picks"]))
      for entry in PICKS),
)

TOPIC_LABELS = {"ethnicity": "Ethnic makeup", "ethnicity-detailed": "Ethnic makeup", "religion": "Religion",
                "religion-detailed": "Religion", "age": "Residents' age", "household-type": "Household type",
                "tenure": "Tenure", "accommodation": "Accommodation type", "country-of-birth": "Country of birth",
                "country-of-birth-extended": "Country of birth", "year-of-arrival": "Year of arrival",
                "main-language": "Main language", "passports": "Passports held",
                "national-identity": "National identity"}
VIEW_LABELS = {"census-religion-none": "No religion", "census-religion-other": "Other", "census-ethnicity-other": "Other",
               "census-ethnicity-mixed": "Mixed", "census-household-other": "Other", "census-accommodation-other": "Other",
               "census-tenure-owned": "Owned", "census-accommodation-semi-detached": "Semi",
               **{f"census-birth-{category}": label for category, label, _ in BIRTH_REGIONS},
               **{entry["prefix"] + pick["category"]: pick["label"] + (" (MSOA figures)" if entry["geography"] == "msoa" else "")
                  for entry in PICKS for pick in entry["picks"]}}
TABLES = {"ethnicity": "TS021", "religion": "TS030", "age": "TS007A", "household-type": "TS003", "tenure": "TS054",
          "accommodation": "TS044", "country-of-birth": "TS004", **{entry["topic"]: entry["table"] for entry in PICKS}}
METRIC_IDS = tuple(metric for _, _, views in LAYERS for metric, _, _ in views)
MSOA_METRIC_IDS = tuple(metric for topic, _, views in LAYERS if topic in MSOA_TOPICS for metric, _, _ in views)
_BY_METRIC = {metric: (topic, universe, words) for topic, universe, views in LAYERS for metric, words, _ in views}

COUNTS_SQL = """
SELECT c.geography_id, c.topic, c.category, c.count
FROM area_census_count c
JOIN area_geography g ON g.id = c.geography_id AND g.kind = 'lsoa'
WHERE c.topic = ANY(%s) AND g.id = ANY(%s)"""

# An MSOA-only topic: every LSOA with its MSOA's counts.
MSOA_COUNTS_SQL = """
SELECT l.id AS geography_id, c.topic, c.category, c.count
FROM area_geography l
JOIN area_census_count c ON c.geography_id = l.parent_id
WHERE l.kind = 'lsoa' AND c.topic = ANY(%s) AND l.id = ANY(%s)"""


def topic_shares(topic: str, counts: Mapping[str, int]) -> dict[str, float]:
    """{metric id: % of the topic's total} for one LSOA; {} without counts."""
    total = sum(counts.values())
    if total <= 0:
        return {}
    views = next(views for name, _, views in LAYERS if name == topic)
    return {metric: round(100 * sum(counts.get(category, 0) for category in categories) / total, 1)
            for metric, _, categories in views}


def value_rows(counts: Mapping[str, Mapping[str, Mapping[str, int]]], period: str = PERIOD) -> list[list]:
    """metric_value rows (no London percentile) from {lsoa id: {topic: {category: count}}}, by LSOA; an
    MSOA-only topic's counts are the LSOA's MSOA's, so its rows are `fallback` (a wider area's figure)."""
    rows = []
    for gid in sorted(counts):
        for topic, _, views in LAYERS:
            topic_counts = counts[gid].get(topic, {})
            shares = topic_shares(topic, topic_counts)
            quality = "fallback" if topic in MSOA_TOPICS else "observed"
            total = sum(topic_counts.values())
            for metric, _, _ in views:
                if metric in shares:
                    rows.append([gid, metric, period, shares[metric], "", total, quality])
                else:
                    rows.append([gid, metric, period, "", "", "", "suppressed"])
    return rows


def _label(value: float) -> str:
    return f"{value:g}%"


def legend(shares: Iterable[float]) -> list[dict]:
    """Five steps at the 10th–90th percentiles of LSOA shares; steps that coincide are kept once."""
    ordered = sorted(shares)
    if not ordered:
        return []
    stops: list[dict] = []
    for index, q in enumerate(QUANTILES):
        raw = ordered[int((len(ordered) - 1) * q)]
        value = round(raw, 1) if raw < 10 else round(raw)
        if stops and value <= stops[-1]["value"]:
            continue
        stops.append({"value": value, "colour": COLOURS[index], "label": _label(value)})
    if len(stops) == 1:  # every area at one value (a country nearly nobody was born in): a ramp needs two steps
        value = round(stops[0]["value"] + (0.1 if stops[0]["value"] < 10 else 1), 1)
        stops.append({"value": value, "colour": COLOURS[1], "label": _label(value)})
    stops[-1]["label"] += "+"
    return stops


def legend_title(metric_id: str) -> str:
    topic, universe, words = _BY_METRIC[metric_id]
    scope = ", MSOA figures" if topic in MSOA_TOPICS else ""
    return f"% of {universe}, {words} (Census 2021{scope})"


def definition(metric_id: str, lsoa_shares: list[float]) -> dict:
    topic, universe, words = _BY_METRIC[metric_id]
    view = VIEW_LABELS.get(metric_id, words[0].upper() + words[1:])
    msoa = topic in MSOA_TOPICS
    return {
        "label": f"{TOPIC_LABELS[topic]}: {view}", "shortLabel": TOPIC_LABELS[topic],
        "description": (f"{legend_title(metric_id)}: the share of each area's {universe} counted in this category "
                        f"on census day, 21 March 2021 (ONS table {TABLES[topic]}). "
                        + (f"{MSOA_NOTE} ONS publishes this table down to MSOAs (about 8,000 residents) only, "
                           "so every area in an MSOA shows the MSOA's share. " if msoa else "")
                        + "It describes the area; it is never ranked or used to match areas."),
        "legend": legend(lsoa_shares),
        "sourceId": "ons-census-2021", "sourceName": "Office for National Statistics, Census 2021",
        "methodologyPath": "/guide/people-and-homes", "freshness": "2021-03",
        "caveats": [
            *([f"{MSOA_NOTE} ONS table {TABLES[topic]} is published down to MSOAs only."] if msoa else []),
            *(["A write-in group counts the people who wrote it under the broad group named in brackets; the "
               "same name under another broad group is a layer of its own."] if topic == "ethnicity-detailed" else []),
            "Census day fell during the pandemic: some students and workers were counted away from their usual area.",
            "Small numbers are adjusted by the ONS to protect privacy (targeted record swapping).",
            "Census 2021 counts: Office for National Statistics, Nomis bulk tables and the ONS API. "
            "Contains public sector information licensed under the Open Government Licence v3.0.",
        ],
    }


def copy_rows(cur, table: str, columns: str, rows) -> None:
    buffer = io.StringIO()
    csv.writer(buffer).writerows(rows)
    buffer.seek(0)
    with cur.copy(f"COPY {table} ({columns}) FROM STDIN WITH (FORMAT csv)") as copy:
        copy.write(buffer.read())


def upsert_definition(cur, metric: str, shares: list[float], source_id: str) -> None:
    cur.execute(
        """INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
           VALUES (%s, 'lsoa', '%%', 'higher-is-more', %s, %s)
           ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition,
             source_release_id = EXCLUDED.source_release_id""",
        (metric, json.dumps(definition(metric, shares)), source_id))


def chunk_counts(cur, lsoas: list[str], topics: list[str]) -> dict[str, dict[str, dict[str, int]]]:
    """{lsoa id: {topic: {category: count}}} for one chunk of LSOAs (an MSOA-only topic: the MSOA's counts)."""
    counts: dict[str, dict[str, dict[str, int]]] = {gid: {} for gid in lsoas}
    lsoa_topics = [topic for topic in topics if topic not in MSOA_TOPICS]
    for sql, wanted in ((COUNTS_SQL, lsoa_topics), (MSOA_COUNTS_SQL, list(MSOA_TOPICS))):
        for row in cur.execute(sql, (wanted, lsoas)):
            counts[row["geography_id"]].setdefault(row["topic"], {})[row["category"]] = row["count"]
    return counts


def load(url: str) -> None:
    import psycopg
    from psycopg.rows import dict_row

    import stage_release

    topics = [topic for topic, _, _ in LAYERS]
    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        loaded = [row["source_release_id"] for row in cur.execute(
            "SELECT DISTINCT source_release_id FROM area_census_count WHERE topic = ANY(%s)", (topics,))]
        if len(loaded) != 1:
            raise SystemExit(f"expected one Census People load in area_census_count, found {loaded}")
        census = cur.execute(
            "SELECT id, source_url, to_char(release_date, 'YYYY-MM-DD') AS release_date, sha256, licence,"
            " attribution FROM source_release WHERE id = %s", (loaded[0],)).fetchone()
        lsoas = sorted(row["id"] for row in cur.execute("SELECT id FROM area_geography WHERE kind = 'lsoa'"))

        taken = {row["id"] for row in cur.execute(
            "SELECT id FROM source_release WHERE id LIKE %s", (SOURCE_BASE + "%",))}
        revision = 1
        while (SOURCE_BASE if revision == 1 else f"{SOURCE_BASE}-r{revision}") in taken:
            revision += 1
        source_id = SOURCE_BASE if revision == 1 else f"{SOURCE_BASE}-r{revision}"
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s)""",
            (source_id, census["source_url"], census["release_date"], census["sha256"], census["licence"],
             census["attribution"], ETL_VERSION,
             ["Share of each LSOA's residents or households per Census 2021 category, from the People counts.",
              "Detailed tables published down to MSOAs only (TS013, TS022, TS028, TS031, country of birth): "
              "each LSOA carries its MSOA's share.",
              "Descriptive only: no London percentile is stored."]))
        old = sorted({row["source_release_id"] for row in cur.execute(
            "SELECT source_release_id FROM metric_definition WHERE id = ANY(%s)", (list(METRIC_IDS),))})
        # An earlier build's rows go too, including layers no longer published (the borough countries of TS012).
        cur.execute("DELETE FROM metric_value WHERE metric_id = ANY(%s) OR source_release_id = ANY(%s)",
                    (list(METRIC_IDS), old))
        for metric in METRIC_IDS:  # the rows need their definitions first; legends follow below
            upsert_definition(cur, metric, [], source_id)
        by_metric: dict[str, array] = {metric: array("d") for metric in METRIC_IDS}
        tally = {"rows": 0, "observed": 0, "fallback": 0}
        columns = ("geography_id, metric_id, period, value, region_percentile, sample_count, quality,"
                   " source_release_id")
        for start in range(0, len(lsoas), CHUNK):
            values = value_rows(chunk_counts(cur, lsoas[start:start + CHUNK], topics))
            for row in values:
                tally["rows"] += 1
                if row[6] != "suppressed":
                    tally[row[6]] += 1
                    by_metric[row[1]].append(row[3])
            copy_rows(cur, "metric_value", columns, [row + [source_id] for row in values])
        observed, fallback = tally["observed"], tally["fallback"]
        print(json.dumps({"lsoas": len(lsoas), **tally}), flush=True)
        for metric in METRIC_IDS:  # legends from every LSOA's share, once all are read
            upsert_definition(cur, metric, list(by_metric[metric]), source_id)
        stage_release.stage(cur, "census-layers", [source_id], replace=tuple(old))
        print(f"load: {source_id}: {len(METRIC_IDS)} metrics ({len(MSOA_METRIC_IDS)} painted from MSOA figures), "
              f"{observed} observed and {fallback} MSOA-figure LSOA values")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "load":
        load(sys.argv[2])
    else:
        sys.exit(__doc__)
