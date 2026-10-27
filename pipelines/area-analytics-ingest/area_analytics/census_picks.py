"""The detailed Census 2021 categories published as map layers, one list for the ETL and the web.

Every leaf of the detailed tables (census_people, Topic.leaves) with at least FLOOR residents in one
region of the coverage (England by default, CLOSE_KNIT_ETL_COVERAGE=london for London only) becomes its own layer, picked from a searchable list (below that most areas are 0 and the map says
nothing). Detailed religion keeps only what TS030 lacks (the beliefs under "No religion" and "Other
religion", not "No religion: No religion"); its main religions are layers per LSOA already. From the files in $AE_DATA/census it
writes:

  deploy/tools/census_picks.json   read by deploy/tools/etl_census_layers.py
  web/src/lib/census-picks.ts      read by web/src/lib/census-layers.ts

  python -m area_analytics.census_picks write

Run it again only when the tables or the rules here change; tests check the two files agree.
"""

from __future__ import annotations

import csv
import io
import json
import sys
import zipfile
from pathlib import Path

from . import census_people as people, coverage

REPO = Path(__file__).resolve().parents[3]
JSON_PATH = REPO / "deploy" / "tools" / "census_picks.json"
TS_PATH = REPO / "web" / "src" / "lib" / "census-picks.ts"
FLOOR = 1000
ETHNIC_GROUPS = {"asian": "Asian", "black-african": "Black African", "black-caribbean": "Black Caribbean",
                 "mixed": "Mixed", "other": "Other", "white": "White"}


def _ethnic(key: str, label: str) -> tuple[str, str]:
    group = next(name for prefix, name in ETHNIC_GROUPS.items() if key.startswith(prefix + "-"))
    return f"{label} ({group})", f"{group}: {label}"


def _arrival(_key: str, label: str) -> tuple[str, str]:
    short = label.replace("Arrived before ", "Before ").replace("Arrived ", "").replace(" to ", "–")
    return short, label[0].lower() + label[1:]


# (topic, metric id prefix, web item, universe, (category, label) → (pick label, legend words)).
PUBLISHED = (
    ("ethnicity-detailed", "census-ethnic-", "ethnicity", "residents", _ethnic),
    ("country-of-birth-extended", "census-birth-country-", "country-of-birth", "residents",
     lambda _key, label: (label, f"born in {label}")),
    ("religion-detailed", "census-belief-", "religion", "residents", lambda _key, label: (label, label)),
    ("year-of-arrival", "census-arrival-", "year-of-arrival", "residents", _arrival),
    ("main-language", "census-language-", "main-language", "residents aged 3+",
     lambda _key, label: (label, f"main language {label}")),
    ("passports", "census-passport-", "passports", "residents", lambda _key, label: (label, f"passport: {label}")),
    ("national-identity", "census-identity-", "national-identity", "residents",
     lambda _key, label: (label, f"identity: {label}")),
)


def covered_codes(topic: people.Topic, path: str, cov: coverage.Coverage) -> dict[str, str]:
    """{area code: region code} for the table's areas inside the coverage (England by default)."""
    with zipfile.ZipFile(path) as archive, archive.open(f"census2021-{topic.table}-{topic.geography}.csv") as raw:
        reader = csv.reader(io.TextIOWrapper(raw, encoding="utf-8-sig"))
        next(reader)
        regions = {row[2]: coverage.region_of_code(row[2]) for row in reader}
    return {code: region for code, region in regions.items() if cov.contains_region(region)}


def build(data: str = people.DATA, cov: coverage.Coverage | None = None) -> list[dict]:
    """A leaf is a pick when at least FLOOR residents of one region have it (London's 1,000 floor,
    applied region by region); perMille is its share across the whole coverage."""
    cov = cov or coverage.from_env()
    topics = {topic.id: topic for topic in people.TOPICS}
    built = []
    for topic_id, prefix, item, universe, wording in PUBLISHED:
        topic = topics[topic_id]
        path = people.zip_path(topic, data)
        regions = covered_codes(topic, path, cov)
        rows = people.read_topic(topic, path, set(regions))
        total = sum(sum(counts.values()) for counts in rows.values())
        picks = []
        for key, label, leaf in people.leaf_paths(topic, path):
            by_region: dict[str, int] = {}
            for code, counts in rows.items():
                by_region[regions[code]] = by_region.get(regions[code], 0) + counts[key]
            covered = sum(by_region.values())
            parts = leaf.split(": ")
            if max(by_region.values(), default=0) < FLOOR \
                    or (topic_id == "religion-detailed" and (len(parts) == 1 or parts[-1] == parts[0])):
                continue
            pick_label, words = wording(key, label)
            picks.append({"category": key, "label": pick_label, "words": words,
                          "perMille": round(1000 * covered / total, 2)})
        built.append({"topic": topic_id, "table": topic.table.upper(), "geography": topic.geography,
                      "item": item, "universe": universe, "prefix": prefix, "picks": picks})
    ids = [entry["prefix"] + pick["category"] for entry in built for pick in entry["picks"]]
    if len(ids) != len(set(ids)):
        raise ValueError("two picks share a metric id")
    return built


def typescript(built: list[dict]) -> str:
    ids = "\n".join(f'  "{entry["prefix"]}{pick["category"]}",' for entry in built for pick in entry["picks"])
    topics = ",\n".join(
        "  {\n"
        f'    topic: "{entry["topic"]}", table: "{entry["table"]}", geography: "{entry["geography"]}", '
        f'item: "{entry["item"]}", universe: "{entry["universe"]}", prefix: "{entry["prefix"]}",\n'
        "    picks: [\n" + "\n".join(
            f'      [{json.dumps(pick["category"])}, {json.dumps(pick["label"], ensure_ascii=False)}, '
            f'{json.dumps(pick["words"], ensure_ascii=False)}, {pick["perMille"]}],' for pick in entry["picks"])
        + "\n    ],\n  }" for entry in built)
    return f'''/**
 * Generated by pipelines/area-analytics-ingest/area_analytics/census_picks.py from the Census 2021 files
 * (do not edit): each detailed category with at least {FLOOR:,} residents in London is a map layer of its own.
 * deploy/tools/census_picks.json holds the same list for the ETL.
 */

export const CENSUS_PICK_IDS = [
{ids}
] as const;

export interface CensusPickTopic {{
  topic: string;
  /** ONS table (TS022) or ONS API extract (COB190, LANG26). */
  table: string;
  /** "msoa": each LSOA shows its MSOA's share (ONS publishes the table no lower). */
  geography: "msoa" | "lsoa";
  /** The People item (lib/census-layers.ts) the picks sit in. */
  item: string;
  universe: string;
  prefix: string;
  /** [category, pick label, legend words, London share per thousand]. */
  picks: readonly (readonly [string, string, string, number])[];
}}

export const CENSUS_PICK_TOPICS: readonly CensusPickTopic[] = [
{topics},
];
'''


def write(data: str = people.DATA) -> None:
    built = build(data)
    JSON_PATH.write_text(json.dumps({"floor": FLOOR, "topics": built}, indent=1, ensure_ascii=False) + "\n")
    TS_PATH.write_text(typescript(built))
    print(f"write: {sum(len(entry['picks']) for entry in built)} picks in {len(built)} topics -> "
          f"{JSON_PATH.relative_to(REPO)}, {TS_PATH.relative_to(REPO)}")


if __name__ == "__main__":
    if sys.argv[1:] == ["write"]:
        write()
    else:
        sys.exit(__doc__)
