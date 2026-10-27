"""HMO and landlord licensing (migration 087): licensed HMOs per postcode, LSOA, MSOA and borough from each
London authority's public HMO licence register (Housing Act 2004 s.232), and its additional and selective
licensing schemes, from one config per authority in hmo/boroughs/<slug>.yaml.

  AE_WORK=~/data/aework/hmo python3 etl_hmo.py download [slug ...]
  AE_WORK=~/data/aework/hmo python3 etl_hmo.py load <database-url> [registers|schemes]

download fetches every register with status `published` into AE_WORK and writes manifest.json (url,
sha256, bytes, retrieved; or the error). load reads them, keeps only the property postcode of each licence,
counts licences per postcode inside the borough (postcode_civic), writes hmo_register for all 33
authorities, hmo_postcode, area_hmo (rebuild_area_hmo) and the `hmo-per-1000` metric (load_hmo_metric),
then stages a product release. `schemes` reloads licensing_scheme alone.

Registers come as CSV, XLSX, HTML tables or PDF (read with `pdftotext -layout`). Names, licence holders and
addresses are read past, never kept: only postcodes leave the parser.
"""
from __future__ import annotations

import csv
import hashlib
import html.parser
import json
import os
import re
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
import zipfile
from collections import Counter
from collections.abc import Iterable, Iterator, Mapping
from datetime import date
from pathlib import Path
from xml.etree import ElementTree

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "hmo"))
BOROUGHS = Path(__file__).resolve().parent / "hmo" / "boroughs"
ETL_VERSION = "close-knit-hmo-1"
SOURCE_PREFIX = "src-hmo-registers"
METRIC_ID = "hmo-per-1000"
STATUSES = ("published", "search-only", "on-request", "not-found")
FORMATS = ("csv", "xlsx", "html", "pdf")
# Light to dark, no judgement: the census layers' sequential palette.
COLOURS = ("#c7e9b4", "#7fcdbb", "#1d91c0", "#253494", "#081d58")
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 close-knit-etl"
# A UK postcode, spaced or not; London's areas are 1-2 letters. No word boundary in front: some registers
# glue it to the town ("KingstonKT1 3DA"); count() undoes a glued letter.
POSTCODE = re.compile(r"([A-Z]{1,2}[0-9][0-9A-Z]?)\s*([0-9][ABD-HJLNP-UW-Z]{2})\b", re.IGNORECASE)
SHEET_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

csv.field_size_limit(1 << 30)


# --- configs ------------------------------------------------------------------------------------

def configs() -> list[dict]:
    import yaml

    out = []
    for path in sorted(BOROUGHS.glob("*.yaml")):
        with open(path) as handle:
            out.append(yaml.safe_load(handle))
    return out


# --- postcodes ----------------------------------------------------------------------------------

def normalise_postcode(text: str | None) -> str | None:
    """'sw1a1aa' -> 'SW1A 1AA' (ONSPD pcds); None unless the whole text is one postcode."""
    match = POSTCODE.fullmatch((text or "").strip())
    return f"{match.group(1)} {match.group(2)}".upper() if match else None


def find_postcode(text: str | None) -> str | None:
    """The last postcode in a cell or record: an address ends with its own."""
    found = POSTCODE.findall(text or "")
    return f"{found[-1][0]} {found[-1][1]}".upper() if found else None


def _key(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip()).lower()


def table_postcodes(rows: Iterable[list[str]], column: str | None, include: str | None = None) -> Iterator[str | None]:
    """One entry per licence row after the header row (the first holding `column`); the postcode in that
    column. Without a column every non-empty row counts, by the last postcode anywhere in it. With `include`
    (a regex) only rows whose text matches count: registers that also list selective (non-HMO) licences."""
    rows = iter(rows)
    keep = re.compile(include, re.IGNORECASE) if include else None
    index = None
    if column:
        wanted = _key(column)
        for row in rows:
            keys = [_key(cell) for cell in row]
            if wanted in keys:
                index = keys.index(wanted)
                break
        else:
            raise ValueError(f"no header {column!r} in the register")
    for row in rows:
        if not any((cell or "").strip() for cell in row):
            continue
        if keep and not keep.search(" ".join(row)):
            continue
        if index is None:
            yield find_postcode(" ".join(row))
        else:
            yield find_postcode(row[index]) if index < len(row) else None


def csv_rows(path: str) -> Iterator[list[str]]:
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as handle:
        yield from csv.reader(handle)


def _column(ref: str) -> int:
    letters = re.match(r"[A-Z]+", ref).group(0)
    index = 0
    for letter in letters:
        index = index * 26 + ord(letter) - 64
    return index - 1


def xlsx_rows(path: str, sheet: str | None = None) -> Iterator[list[str]]:
    """Rows of one sheet (the first unless named) as text, with the stdlib only."""
    with zipfile.ZipFile(path) as book:
        names = set(book.namelist())
        strings = []
        if "xl/sharedStrings.xml" in names:
            for item in ElementTree.fromstring(book.read("xl/sharedStrings.xml")).iter(f"{SHEET_NS}si"):
                strings.append("".join(t.text or "" for t in item.iter(f"{SHEET_NS}t")))
        workbook = ElementTree.fromstring(book.read("xl/workbook.xml"))
        sheets = list(workbook.iter(f"{SHEET_NS}sheet"))
        chosen = next((s for s in sheets if sheet and _key(s.get("name")) == _key(sheet)), None)
        if sheet and chosen is None:
            raise ValueError(f"no sheet {sheet!r} (have {[s.get('name') for s in sheets]})")
        chosen = chosen if chosen is not None else sheets[0]
        rels = ElementTree.fromstring(book.read("xl/_rels/workbook.xml.rels"))
        target = next(r.get("Target") for r in rels if r.get("Id") == chosen.get(f"{REL_NS}id"))
        target = target.lstrip("/") if target.startswith("/") else "xl/" + target
        for row in ElementTree.fromstring(book.read(target)).iter(f"{SHEET_NS}row"):
            values: dict[int, str] = {}
            for cell in row.iter(f"{SHEET_NS}c"):
                kind = cell.get("t")
                if kind == "inlineStr":
                    text = "".join(t.text or "" for t in cell.iter(f"{SHEET_NS}t"))
                else:
                    v = cell.find(f"{SHEET_NS}v")
                    text = "" if v is None or v.text is None else v.text
                    if kind == "s" and text:
                        text = strings[int(text)]
                values[_column(cell.get("r"))] = text
            yield [values.get(i, "") for i in range(max(values) + 1)] if values else []


class _Tables(html.parser.HTMLParser):
    """Every <tr> of every table as its cells' text."""

    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []
        elif tag == "br" and self._cell is not None:
            self._cell.append(" ")

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._row is not None and self._cell is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def html_rows(path: str) -> list[list[str]]:
    parser = _Tables()
    with open(path, encoding="utf-8", errors="replace") as handle:
        parser.feed(handle.read())
    return parser.rows


def text_postcodes(text: str, register: Mapping) -> Iterator[str]:
    """PDF text: with `record_start` (a regex on a line's start) the first postcode of each record is one
    licence, and with `include` only records whose text matches count; `pick: last` takes the record's last
    postcode instead (registers that print the holder's address first) and `record_lines: n` reads only a
    record's first n lines. Without `record_start` every postcode in the text is one licence."""
    start = register.get("record_start")
    keep = re.compile(register["include"], re.IGNORECASE) if register.get("include") else None
    if keep and not start:
        raise ValueError("include needs record_start for PDF text")
    if not start:
        for outward, inward in POSTCODE.findall(text):
            yield f"{outward} {inward}".upper()
        return
    pattern = re.compile(start)
    record: list[str] = []

    last = register.get("pick") == "last"
    limit = register.get("record_lines")

    def first(lines: list[str]) -> str | None:
        if keep and not keep.search(" ".join(lines)):
            return None
        found = POSTCODE.findall(" ".join(lines[:limit] if limit else lines))
        return f"{found[-1 if last else 0][0]} {found[-1 if last else 0][1]}".upper() if found else None

    for line in text.splitlines():
        if pattern.match(line.strip()):
            if record and (postcode := first(record)):
                yield postcode
            record = [line]
        elif record:
            record.append(line)
    if record and (postcode := first(record)):
        yield postcode


def pdf_text(path: str) -> str:
    return subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", path, "-"], check=True,
                          capture_output=True, text=True).stdout


def register_postcodes(path: str, fmt: str, register: Mapping) -> Iterator[str | None]:
    """One entry per licence: its property postcode, or None when the row has none."""
    column = register.get("postcode_column")
    include = register.get("include")
    if fmt == "csv":
        return table_postcodes(csv_rows(path), column, include)
    if fmt == "xlsx":
        sheets = register.get("sheet")
        if isinstance(sheets, list):  # several sheets, each with its own header row
            return (postcode for sheet in sheets
                    for postcode in table_postcodes(xlsx_rows(path, sheet), column, include))
        return table_postcodes(xlsx_rows(path, sheets), column, include)
    if fmt == "html":
        return table_postcodes(html_rows(path), column, include)
    if fmt == "pdf":
        return text_postcodes(pdf_text(path), register)
    raise ValueError(f"unknown register format: {fmt}")


def count(postcodes: Iterable[str | None], borough: set[str]) -> tuple[Counter, int]:
    """Licences per postcode inside the borough, and how many rows had none there (holder addresses
    elsewhere, withheld addresses, typos)."""
    counts: Counter = Counter()
    unmatched = 0
    for postcode in postcodes:
        # "...LondonN1 2AB" reads as "NN1 2AB": the town's last letter glued on.
        if postcode and postcode not in borough and postcode[1].isalpha() and postcode[1:] in borough:
            postcode = postcode[1:]
        if postcode and postcode in borough:
            counts[postcode] += 1
        else:
            unmatched += 1
    return counts, unmatched


# --- schemes -------------------------------------------------------------------------------------

def _ward_key(name: str) -> str:
    """'St Mary's & St James' Ward', 'St Marys and St James' and 'St Marys St James' are one ward."""
    name = re.sub(r"[’']", "", name.lower().replace("&", " "))
    name = re.sub(r"\band\b", " ", name)
    name = re.sub(r"\bward\b|\.", " ", name)
    return re.sub(r"[^a-z0-9]+", "", re.sub(r"s\b", "", name))


def scheme_rows(config: Mapping, wards: Mapping[str, str], today: str | None = None) -> tuple[list, list[str]]:
    """licensing_scheme rows (id, borough, kind, ward codes or None, ward names, streets, start, end, url) for
    schemes not yet ended, and the ward names that match no ward of the borough (`wards`: code -> name). A
    scheme on named streets (`streets:`) has no wards: [] and its streets. `ward_aliases` in the config maps a
    ward abolished in 2022 to the current wards that succeeded it (approximate)."""
    today = today or date.today().isoformat()
    by_key = {_ward_key(name): code for code, name in wards.items()}
    rows, unmatched = [], []
    for n, scheme in enumerate(config.get("schemes") or [], start=1):
        end = str(scheme["end"]) if scheme.get("end") else None
        if end and end < today:
            continue
        streets = list(scheme.get("streets") or [])
        names = None if scheme.get("wards", "all") == "all" or streets else list(scheme["wards"])
        codes = [] if streets else None
        if names is not None:
            codes = []
            aliases = config.get("ward_aliases") or {}
            for name in names:
                found = [by_key.get(_ward_key(current)) for current in aliases.get(name, [name])]
                if all(found):
                    codes += [code for code in found if code not in codes]
                else:
                    unmatched.append(f"{config['slug']}: {name}")
        rows.append([f"{config['code']}:{scheme['kind']}:{n}", config["code"], scheme["kind"], codes, names,
                     streets or None, str(scheme["start"]) if scheme.get("start") else None, end, scheme["url"]])
    return rows, unmatched


# --- metric --------------------------------------------------------------------------------------

def legend(values: Iterable[float]) -> list[dict]:
    """Quintile stops over LSOA values, light (few) to dark (many)."""
    ordered = sorted(values)
    if not ordered:
        return []
    cuts = [ordered[int(len(ordered) * q)] for q in (0.2, 0.4, 0.6, 0.8)] + [ordered[-1]]
    return [{"value": round(v, 1), "colour": c, "label": f"{round(v, 1):g}"} for v, c in zip(cuts, COLOURS)]


def definition(lsoa_values: list[float], month: str) -> dict:
    return {
        "label": "Licensed HMOs per 1,000 homes", "shortLabel": "HMOs",
        "description": ("Houses in multiple occupation on the borough's public licence register, per 1,000 "
                        "households (Census 2021). It counts licensed shared houses, not the people in them."),
        "legend": legend(lsoa_values),
        "sourceId": "hmo-registers", "sourceName": "London borough HMO licence registers",
        "methodologyPath": "/guide/people-and-homes", "freshness": month,
        "caveats": [
            "Licensed HMOs only: unlicensed HMOs, and small HMOs outside an additional licensing scheme, are missing.",
            "Each borough updates its register at different times; the retrieval date is on the register list.",
            "Grey areas: the borough has not published its register in bulk (not published), never zero.",
            "Counted by the property's postcode; rows without one in the borough are left out.",
        ],
    }


def source_caveats(registers: list[dict]) -> list[str]:
    published = [r["slug"] for r in registers if r["status"] == "published"]
    return [f"{len(published)} of 33 London authorities' HMO registers counted: {', '.join(published)}.",
            "Counts by postcode only; names, licence holders and addresses are not kept."]


# --- download and load ---------------------------------------------------------------------------

def path(name: str) -> str:
    return os.path.join(WORK, name)


def sha256(name: str) -> str:
    digest = hashlib.sha256()
    with open(path(name), "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def manifest() -> dict:
    try:
        with open(path("manifest.json")) as handle:
            return json.load(handle)
    except FileNotFoundError:
        return {}


def fetch(url: str, target: str) -> None:
    """urllib first; curl when Python cannot verify a council's certificate chain (a missing intermediate,
    which curl's system trust store completes)."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=300) as response, open(target, "wb") as out:
            while chunk := response.read(1 << 20):
                out.write(chunk)
    except urllib.error.URLError as error:
        if not isinstance(getattr(error, "reason", None), ssl.SSLCertVerificationError):
            raise
        subprocess.run(["curl", "-fsSL", "--max-time", "300", "-A", USER_AGENT, "-o", target, url], check=True)


def download(only: list[str]) -> None:
    os.makedirs(WORK, exist_ok=True)
    files = manifest()
    for config in configs():
        register = config["register"]
        if register["status"] != "published" or (only and config["slug"] not in only):
            continue
        name = f"{config['slug']}.{register['format']}"
        try:
            fetch(register["url"], path(name) + ".tmp")
            os.replace(path(name) + ".tmp", path(name))
            files[config["slug"]] = {"file": name, "url": register["url"], "sha256": sha256(name),
                                     "bytes": os.path.getsize(path(name)), "retrieved": date.today().isoformat()}
            print(f"download: {name} {files[config['slug']]['bytes'] // 1024} KiB "
                  f"sha256 {files[config['slug']]['sha256']}", flush=True)
        except Exception as error:  # noqa: BLE001 - one council's site failing never stops the rest
            files[config["slug"]] = {"url": register["url"], "error": f"{type(error).__name__}: {error}"[:300]}
            print(f"download: {config['slug']} FAILED {files[config['slug']]['error']}", flush=True)
    with open(path("manifest.json"), "w") as handle:
        json.dump(files, handle, indent=1, sort_keys=True)


def parse_all(borough_postcodes: Mapping[str, set[str]]) -> list[dict]:
    """One result per authority: status, counts and the file's provenance."""
    files = manifest()
    results = []
    for config in configs():
        register, slug = config["register"], config["slug"]
        result = {"slug": slug, "code": config["code"], "status": register["status"], "counts": Counter(),
                  "unmatched": None, "file": files.get(slug, {}), "register": register,
                  "note": " ".join(str(config.get("notes") or "").split())[:500] or None}
        if register["status"] == "published":
            entry = files.get(slug)
            if not entry or "error" in entry:
                result["status"] = "failed"
                result["note"] = (entry or {}).get("error", "not downloaded")
            else:
                try:
                    found = register_postcodes(path(entry["file"]), register["format"], register)
                    result["counts"], result["unmatched"] = count(found, borough_postcodes.get(config["code"], set()))
                    if not result["counts"]:
                        raise ValueError("no licence with a postcode in the borough")
                except Exception as error:  # noqa: BLE001 - a changed file fails its borough only
                    result["status"], result["note"] = "failed", f"{type(error).__name__}: {error}"[:300]
        print(f"parse: {slug} {result['status']} {sum(result['counts'].values())} licences"
              + (f", {result['unmatched']} without a borough postcode" if result["unmatched"] else ""), flush=True)
        results.append(result)
    return results


def _copy(cur, table: str, columns: str, rows) -> None:
    with cur.copy(f"COPY {table} ({columns}) FROM STDIN") as copy:
        for row in rows:
            copy.write_row(row)


def _source(cur, results: list[dict] | None) -> str:
    """A new source release for this load; `results` None for a schemes-only load."""
    month = date.today().strftime("%Y-%m")
    base = f"{SOURCE_PREFIX}-{month}"
    taken = {row["id"] for row in cur.execute("SELECT id FROM source_release WHERE id LIKE %s", (base + "%",))}
    revision = 1
    while (base if revision == 1 else f"{base}-r{revision}") in taken:
        revision += 1
    source_id = base if revision == 1 else f"{base}-r{revision}"
    digest = hashlib.sha256("".join(sorted(r["file"].get("sha256", "") for r in results or [])).encode()).hexdigest()
    cur.execute(
        """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
             attribution, transformation_version, geography_vintage, validation_status, caveats)
           VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s)""",
        (source_id, "https://www.legislation.gov.uk/ukpga/2004/34/section/232", date.today(), digest,
         "Public registers (Housing Act 2004 s.232); counts only, see DATA-LICENCES.md",
         "Contains public sector information from London boroughs' HMO licence registers.", ETL_VERSION,
         source_caveats(results) if results is not None else ["Licensing schemes only."]))
    return source_id


def load(url: str, part: str | None) -> None:
    import psycopg
    from psycopg.rows import dict_row

    import stage_release

    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        wards_by_borough: dict[str, dict[str, str]] = {}
        for row in cur.execute(
                "SELECT DISTINCT p.borough_code, p.ward_code, n.name FROM postcode_civic p "
                "JOIN civic_name n ON n.code = p.ward_code WHERE p.terminated IS NULL"):
            wards_by_borough.setdefault(row["borough_code"], {})[row["ward_code"]] = row["name"]
        results = None
        if part in (None, "registers"):
            borough_postcodes: dict[str, set[str]] = {}
            for row in cur.execute("SELECT borough_code, postcode FROM postcode_civic"):
                borough_postcodes.setdefault(row["borough_code"], set()).add(row["postcode"])
            results = parse_all(borough_postcodes)
        old_schemes = {row["source_release_id"] for row in cur.execute(
            "SELECT DISTINCT source_release_id FROM licensing_scheme")}
        old_metric = {row["source_release_id"] for row in cur.execute(
            "SELECT source_release_id FROM metric_definition WHERE id = %s", (METRIC_ID,))}
        source_id = _source(cur, results)

        unmatched_wards: list[str] = []
        schemes = []
        for config in configs():
            rows, missing = scheme_rows(config, wards_by_borough.get(config["code"], {}))
            schemes += [row + [source_id] for row in rows]
            unmatched_wards += missing
        cur.execute("DELETE FROM licensing_scheme")
        _copy(cur, "licensing_scheme", "id, borough_code, kind, wards, ward_names, streets, start_date, end_date, url,"
              " source_release_id", schemes)
        print(f"load: {len(schemes)} licensing schemes"
              + (f"; unmatched wards: {', '.join(unmatched_wards)}" if unmatched_wards else ""), flush=True)
        # A schemes-only load keeps the release that carries the counts and the metric.
        old = old_schemes - old_metric if results is None else old_schemes | old_metric

        if results is not None:
            cur.execute("DELETE FROM hmo_postcode")
            cur.execute("DELETE FROM hmo_register")
            _copy(cur, "hmo_register", "borough_code, status, url, page, format, licences, unmatched, updated,"
                  " retrieved, terms, note, source_release_id",
                  [[r["code"], r["status"], r["register"].get("url"), r["register"].get("page"),
                    r["register"].get("format") if r["register"]["status"] == "published" else None,
                    sum(r["counts"].values()) if r["status"] == "published" else None, r["unmatched"],
                    r["register"].get("updated"), r["file"].get("retrieved") or r["register"].get("retrieved"),
                    r["register"].get("terms"), r["note"], source_id] for r in results])
            _copy(cur, "hmo_postcode", "borough_code, postcode, licences, source_release_id",
                  [[r["code"], postcode, n, source_id] for r in results if r["status"] == "published"
                   for postcode, n in sorted(r["counts"].items())])
            areas = cur.execute("SELECT rebuild_area_hmo(%s) AS n", (source_id,)).fetchone()["n"]
            values = [row["per_1000_homes"] for row in cur.execute(
                "SELECT a.per_1000_homes FROM area_hmo a JOIN area_geography g ON g.id = a.geography_id "
                "WHERE g.kind = 'lsoa' AND a.per_1000_homes IS NOT NULL")]
            month = date.today().strftime("%Y-%m")
            metric = cur.execute("SELECT load_hmo_metric(%s, %s, %s) AS n",
                                 (source_id, month + "-01", json.dumps(definition(values, month)))).fetchone()["n"]
            published = [r["slug"] for r in results if r["status"] == "published"]
            print(json.dumps({"published": len(published), "areas": areas, "metric_rows": metric,
                              "licences": sum(sum(r["counts"].values()) for r in results),
                              "not_loaded": {r["slug"]: r["status"] for r in results if r["status"] != "published"}}),
                  flush=True)
        stage_release.stage(cur, "hmo", [source_id], replace=tuple(sorted(old)))
        print(f"load: {source_id}")


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "download":
        download(sys.argv[2:])
    elif len(sys.argv) in (3, 4) and sys.argv[1] == "load":
        load(sys.argv[2], sys.argv[3] if len(sys.argv) == 4 else None)
    else:
        sys.exit(__doc__)
