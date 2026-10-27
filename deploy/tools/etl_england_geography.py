"""England statistical geography: every English LSOA, MSOA and LAD (kind 'lad') as one SQL load.

Inputs: the merged boundary files boundaries.py writes (geom-lsoa.json, geom-msoa.json, geom-lad.json:
ONS 2021 LSOA/MSOA BGC, LAD May 2026 BGC) and the LSOA -> MSOA -> LAD lookup of the coverage list
(area_analytics/england_lsoa_lookup.csv.gz, from the ONS Postcode Directory). Output: a gzipped SQL
script (COPY data inline) that inserts the missing area_geography rows, parents first; the insert builds the
regions, England and the country above the LADs and gives every area its region (trigger area_geography_tree,
migration 123), which the script then checks. Rows that exist (London) are left as they are: area_geography is
insert-only, so London keeps its ids, names and geometry.

    BOUNDARIES_OUT=~/data/england-2026-10/core/boundaries \\
      python3 deploy/tools/etl_england_geography.py OUT.sql.gz [--no-transaction] [--coverage london|england]
    gunzip -c OUT.sql.gz | psql -v ON_ERROR_STOP=1 ...
"""
import argparse
import csv
import gzip
import json
import os

import area_coverage

SOURCES = {  # level (the DB kind) -> (file, code field, name field, id prefix)
    "lad": ("geom-lad.json", "LAD26CD", "LAD26NM", "lad"),
    "msoa": ("geom-msoa.json", "MSOA21CD", "MSOA21NM", "msoa"),
    "lsoa": ("geom-lsoa.json", "LSOA21CD", "LSOA21NM", "lsoa"),
}


def parents(cov):
    """{area id: parent id} for the coverage's LSOAs and MSOAs (boroughs have none)."""
    out = {}
    for lsoa, (msoa, lad) in area_coverage.lsoa_lookup().items():
        if lad in cov.lad_codes:
            out[f"uk:lsoa:{lsoa}"] = f"uk:msoa:{msoa}"
            out[f"uk:msoa:{msoa}"] = f"uk:lad:{lad}"
    return out


def rows(folder, cov):
    """(id, kind, code, name, parent id, geojson) rows, boroughs then msoas then lsoas."""
    parent = parents(cov)
    wanted = {"lad": set(cov.lad_codes),
              "msoa": {pid.rsplit(":", 1)[1] for cid, pid in parent.items() if cid.startswith("uk:lsoa:")},
              "lsoa": {cid.rsplit(":", 1)[1] for cid in parent if cid.startswith("uk:lsoa:")}}
    for level in ("lad", "msoa", "lsoa"):
        name, code_field, name_field, prefix = SOURCES[level]
        with open(os.path.join(folder, name), encoding="utf-8") as handle:
            features = json.load(handle)["features"]
        seen = set()
        for feature in features:
            code = feature["properties"][code_field]
            if code not in wanted[level] or code in seen:
                continue
            seen.add(code)
            area_id = f"uk:{prefix}:{code}"
            yield (area_id, level, code, feature["properties"][name_field].strip(), parent.get(area_id, ""),
                   json.dumps(feature["geometry"], separators=(",", ":")))
        missing = wanted[level] - seen
        if missing:
            raise SystemExit(f"{level}: {len(missing)} areas without a boundary, e.g. {sorted(missing)[:3]}")
        print(f"{level}: {len(seen)} areas", flush=True)


BODY_HEAD = """CREATE TEMP TABLE staging_england_geography (
    id text, kind geography_kind, official_code text, name text, parent_id text, geojson text
) ON COMMIT DROP;
COPY staging_england_geography FROM stdin WITH (FORMAT csv);
"""

BODY_TAIL = """\\.
-- Parents first (the hierarchy trigger checks them); existing rows (London) stay untouched.
INSERT INTO area_geography (id, kind, official_code, name, parent_id, geometry)
SELECT s.id, s.kind, s.official_code, s.name, NULLIF(s.parent_id, ''),
       CASE WHEN ST_IsValid(ST_Multi(ST_GeomFromGeoJSON(s.geojson)))
            THEN ST_Multi(ST_GeomFromGeoJSON(s.geojson))
            ELSE ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(s.geojson)), 3)) END
FROM staging_england_geography s
WHERE NOT EXISTS (SELECT 1 FROM area_geography g WHERE g.id = s.id)
ORDER BY CASE s.kind WHEN 'lad' THEN 0 WHEN 'msoa' THEN 1 ELSE 2 END, s.id;
DO $$
DECLARE missing integer;
BEGIN
    SELECT count(*) INTO missing FROM staging_england_geography s
    WHERE NOT EXISTS (SELECT 1 FROM area_region r WHERE r.area_id = s.id);
    IF missing > 0 THEN
        RAISE EXCEPTION 'England geography: % areas without a region', missing;
    END IF;
END;
$$;
"""


def write(out, folder, cov, transaction=True):
    with gzip.open(out, "wt", encoding="utf-8", compresslevel=6) as handle:
        if transaction:
            handle.write("BEGIN;\n")
        handle.write(BODY_HEAD)
        writer = csv.writer(handle, lineterminator="\n")
        count = 0
        for row in rows(folder, cov):
            writer.writerow(row)
            count += 1
        handle.write(BODY_TAIL)
        if transaction:
            handle.write("COMMIT;\n")
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("out")
    parser.add_argument("--boundaries", default=os.environ.get("BOUNDARIES_OUT", "/tmp/aedata"))
    parser.add_argument("--coverage", default=None, help="england (default) or london")
    parser.add_argument("--no-transaction", action="store_true", help="leave BEGIN/COMMIT to the caller")
    args = parser.parse_args()
    cov = area_coverage.get(args.coverage) if args.coverage else area_coverage.from_env()
    count = write(args.out, args.boundaries, cov, transaction=not args.no_transaction)
    print(f"{args.out}: {count} rows ({cov.name})")


if __name__ == "__main__":
    main()
