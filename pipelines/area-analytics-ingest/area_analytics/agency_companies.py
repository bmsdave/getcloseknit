"""Estate and letting agency companies in London from Companies House (migration 051, agency_company).

Source: the Companies House free "Basic Company Data" bulk product, BasicCompanyDataAsOneFile-YYYY-MM-01.zip
(https://download.companieshouse.gov.uk/en_output.html, Open Government Licence v3.0). The zip holds one ~2.5 GB
CSV, so it is streamed row by row and never loaded into memory. Kept: active companies with SIC 68310 (real
estate agencies) or 68320 (management of real estate) whose registered postcode is a live London postcode in
postcode_civic (region E12000007). Kept per company: number, name, SIC codes, registered postcode and
incorporation date. Officers and persons with significant control are never read; the registered office is
often an accountant's address and is never shown as an office.

Stages (raw zip goes to ~/data/companies-house, work files to $AE_WORK, default ~/data/aework/companies-house):
  fetch MONTH  download BasicCompanyDataAsOneFile-MONTH.zip (MONTH is YYYY-MM-01)
  build URL    stream the newest zip's CSV, keep London agencies (postcodes read from the database at URL)
               -> agency_company.tsv and sources.json (psycopg needed)
  load URL     insert the source release, replace that release's rows, COPY the TSV (psycopg needed)
  verify URL [--limit N] [--workers 8]
               read each agency website (homepage + at most two contact/terms/privacy pages, politely: see
               agency_crawl.fetch) and tie its domain to a company by the company number printed there; domains
               are the websites in agency_office plus guesses for companies with no site yet; opted-out domains
               and shared hosts (portals, social networks) are skipped. Prints progress every 500 domains, the
               domains whose robots.txt refuses CloseKnitBot, and the counts, also on Ctrl-C (psycopg needed)

  check URL    print the coverage report (offices, companies, verified sites, Google ids) and count the offices
               whose SQL domain differs from the Python site_domain(website); a mismatch lists up to 20 rows
               and exits 1 (psycopg needed)

  uv run python -m area_analytics.agency_companies fetch 2026-10-01
  uv run --with 'psycopg[binary]' python -m area_analytics.agency_companies build postgresql://...
  uv run --with 'psycopg[binary]' python -m area_analytics.agency_companies load postgresql://...
  uv run --with 'psycopg[binary]' python -m area_analytics.agency_companies verify postgresql://... --limit 50
  uv run --with 'psycopg[binary]' python -m area_analytics.agency_companies check postgresql://...

The row shaping (normalise_header, company_row, tsv_line, source_release) is pure and dependency-free.
"""
from __future__ import annotations

import csv
import datetime
import glob
import hashlib
import io
import json
import os
import re
import sys
import urllib.request
import zipfile

from .agency_crawl.urls import first_website, homepage, is_shared_host, site_domain

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
RAW = os.path.join(DATA, "companies-house")
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "companies-house"))
SIC_CODES = ("68310", "68320")
LONDON_REGION = "E12000007"
CH_URL = "https://download.companieshouse.gov.uk/BasicCompanyDataAsOneFile-{month}.zip"
LICENCE = "OGL-UK-3.0"
ATTRIBUTION = "Contains public sector information licensed under the Open Government Licence v3.0."
ETL_VERSION = "close-knit-agency-companies-1"
COLUMNS = ("company_number", "name", "sic_codes", "registered_postcode", "incorporated")
SIC_FIELDS = tuple(f"SICCode.SicText_{n}" for n in range(1, 5))
USER_AGENT = "close-knit-ingest"


def normalise_header(record: dict) -> dict:
    """The record with whitespace stripped from its keys (the file has " CompanyNumber")."""
    return {key.strip(): value for key, value in record.items()}


def _clean(value) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def normalise_postcode(value) -> str | None:
    """Upper case with one space before the last three characters, or None when too short."""
    text = re.sub(r"\s+", "", str(value or "")).upper()
    return f"{text[:-3]} {text[-3:]}" if len(text) >= 5 else None


def _iso_date(value) -> str | None:
    try:
        return datetime.datetime.strptime((value or "").strip(), "%d/%m/%Y").date().isoformat()
    except ValueError:
        return None


def _array(values) -> str:
    """A Postgres text[] literal with every element double-quoted."""
    return "{" + ",".join('"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"' for v in values) + "}"


def company_row(record: dict, london_postcodes: set[str]) -> dict | None:
    """One table row from a header-normalised CSV record, or None when it is not an active London agency."""
    if (record.get("CompanyStatus") or "").strip() != "Active":
        return None
    number, name = _clean(record.get("CompanyNumber")), _clean(record.get("CompanyName"))
    codes = []
    for field in SIC_FIELDS:
        code = (record.get(field) or "").split(" - ")[0].strip()
        if code and code not in codes:
            codes.append(code)
    postcode = normalise_postcode(record.get("RegAddress.PostCode"))
    if number is None or name is None or not set(codes) & set(SIC_CODES) or postcode not in london_postcodes:
        return None
    return {"company_number": number, "name": name, "sic_codes": _array(codes), "registered_postcode": postcode,
            "incorporated": _iso_date(record.get("IncorporationDate"))}


def _escape(value) -> str:
    """One COPY text-format field (NULL is the empty string)."""
    if value is None:
        return ""
    return str(value).replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def tsv_line(row: dict) -> str:
    return "\t".join(_escape(row[column]) for column in COLUMNS)


def file_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def source_release(sources: dict) -> tuple:
    """(id, url, release_date, sha256, licence, attribution, caveats) for the loaded extract."""
    month = sources["month"]
    return (f"src-companies-house-basic-{month}", CH_URL.format(month=month), month, sources["sha256"], LICENCE,
            ATTRIBUTION,
            [f"Companies House basic company data snapshot {month}, retrieved {sources['retrieved']}: active "
             f"companies with SIC {' or '.join(SIC_CODES)} and a registered postcode in London.",
             "The registered office is often an accountant's or a solicitor's address, not where the agency "
             "trades, and is never shown as an office.",
             "SIC codes are self-declared by the company; a firm can trade as an agent without one, or keep one "
             "it no longer uses.",
             "Officers and persons with significant control are not read."])


def fetch(month: str) -> None:
    if not re.fullmatch(r"\d{4}-\d{2}-01", month):
        sys.exit("fetch: MONTH must look like 2026-10-01")
    os.makedirs(RAW, exist_ok=True)
    path = os.path.join(RAW, f"BasicCompanyDataAsOneFile-{month}.zip")
    request = urllib.request.Request(CH_URL.format(month=month), headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response, open(path + ".tmp", "wb") as out:
        while block := response.read(1 << 20):
            out.write(block)
    os.replace(path + ".tmp", path)
    print("fetch:", path, os.path.getsize(path), "bytes")


def london_postcodes(url: str) -> set[str]:
    import psycopg

    with psycopg.connect(url) as conn:
        return {pc for (pc,) in conn.execute(
            "SELECT postcode FROM postcode_civic WHERE region_code = %s AND terminated IS NULL", (LONDON_REGION,))}


def csv_records(archive):
    """Header-normalised records streamed from the CSV inside the zip at `archive` (a path or file object).

    Decoded as utf-8-sig: a byte order mark would otherwise stay in the first header and silently empty the load."""
    with zipfile.ZipFile(archive) as bundle:
        name = next(n for n in bundle.namelist() if n.lower().endswith(".csv"))
        with bundle.open(name) as raw:
            for record in csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")):
                yield normalise_header(record)


def write_agencies(archive, postcodes: set[str], out) -> tuple[int, int]:
    """Write the London agencies in the zip to the text file `out`; returns (companies read, agencies kept)."""
    read = kept = 0
    for record in csv_records(archive):
        read += 1
        row = company_row(record, postcodes)
        if row is not None:
            out.write(tsv_line(row) + "\n")
            kept += 1
    return read, kept


def build(url: str) -> None:
    archives = sorted(glob.glob(os.path.join(RAW, "BasicCompanyDataAsOneFile-*.zip")))
    if not archives:
        sys.exit(f"build: no BasicCompanyDataAsOneFile-*.zip in {RAW}; run fetch first")
    archive = archives[-1]
    month = re.search(r"(\d{4}-\d{2}-01)\.zip$", archive).group(1)
    postcodes = london_postcodes(url)
    os.makedirs(WORK, exist_ok=True)
    with open(os.path.join(WORK, "agency_company.tsv"), "w", newline="", encoding="utf-8") as out:
        read, kept = write_agencies(archive, postcodes, out)
    if kept == 0:
        sys.exit(f"build: 0 agencies kept of {read} companies and {len(postcodes)} London postcodes; "
                 "check the CSV header and the postcode_civic load before loading")
    with open(os.path.join(WORK, "sources.json"), "w", encoding="utf-8") as handle:
        json.dump({"month": month, "sha256": file_sha256(archive), "retrieved": datetime.date.today().isoformat(),
                   "rows_read": read, "rows": kept, "london_postcodes": len(postcodes)}, handle, indent=1)
    print(f"build: {kept} agencies of {read} companies, {len(postcodes)} London postcodes")


# load: the file is staged, then upserted by company number so a newer month (new release id) updates rows in
# place; agency_site_company references company_number, so its rows for vanished companies go first.
STAGING_SQL = """CREATE TEMP TABLE staging_agency_company (company_number text, name text, sic_codes text[],
                 registered_postcode text, incorporated date) ON COMMIT DROP"""
UPSERT_SQL = """INSERT INTO agency_company (company_number, name, sic_codes, registered_postcode, incorporated,
                                            source_release_id)
SELECT company_number, name, sic_codes, registered_postcode, incorporated, %s FROM staging_agency_company
ON CONFLICT (company_number) DO UPDATE SET name = EXCLUDED.name, sic_codes = EXCLUDED.sic_codes,
  registered_postcode = EXCLUDED.registered_postcode, incorporated = EXCLUDED.incorporated,
  source_release_id = EXCLUDED.source_release_id"""
DELETE_SITES_SQL = """DELETE FROM agency_site_company
WHERE company_number NOT IN (SELECT company_number FROM staging_agency_company)"""
DELETE_COMPANIES_SQL = """DELETE FROM agency_company
WHERE company_number NOT IN (SELECT company_number FROM staging_agency_company)"""


def load(url: str) -> None:
    import psycopg

    with open(os.path.join(WORK, "sources.json"), encoding="utf-8") as handle:
        sources = json.load(handle)
    source_id, source_url, released, sha, licence, attribution, caveats = source_release(sources)
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s)
               ON CONFLICT (id) DO NOTHING""",
            (source_id, source_url, released, sha, licence, attribution, ETL_VERSION, caveats))
        cur.execute(STAGING_SQL)
        with open(os.path.join(WORK, "agency_company.tsv"), encoding="utf-8") as handle, cur.copy(
                f"COPY staging_agency_company ({', '.join(COLUMNS)}) FROM STDIN WITH (FORMAT text, NULL '')") as copy:
            while chunk := handle.read(1 << 20):
                copy.write(chunk)
        if cur.execute("SELECT count(*) FROM staging_agency_company").fetchone()[0] == 0:
            sys.exit("load: the TSV has no companies; refusing to delete the loaded ones")
        cur.execute(UPSERT_SQL, (source_id,))
        cur.execute(DELETE_SITES_SQL)
        cur.execute(DELETE_COMPANIES_SQL)
        print("load:", cur.execute("SELECT count(*) FROM agency_company").fetchone()[0], "rows")


# One website per office domain (the first office's), so verify starts from the scheme and host the site uses.
OFFICE_SITES_SQL = """SELECT DISTINCT ON (domain) domain, website FROM agency_office
WHERE website IS NOT NULL AND domain IS NOT NULL ORDER BY domain, id"""
OPT_OUT_SQL = "SELECT DISTINCT domain FROM agency_opt_out WHERE domain IS NOT NULL"
UNSITED_SQL = """SELECT company_number, name FROM agency_company c
WHERE NOT EXISTS (SELECT 1 FROM agency_site_company s WHERE s.company_number = c.company_number)"""
DELETE_DOMAIN_SQL = "DELETE FROM agency_site_company WHERE domain = ANY(%s)"
INSERT_SITE_SQL = """INSERT INTO agency_site_company (domain, company_number, page_url, redress_scheme,
                                                      office_postcode, verified_at)
VALUES (%(domain)s, %(company_number)s, %(page_url)s, %(redress_scheme)s, %(office_postcode)s, now())"""


PROGRESS_EVERY = 500  # verify prints a counts-only progress line after this many domains


def verify_domains(office_domains, unsited_companies, opted_out, candidates) -> list[str]:
    """Sorted domains to read: the offices' websites plus guesses for unsited companies, minus opt-outs and shared
    hosts (portals and social networks, urls.SHARED_HOSTS)."""
    domains = set(office_domains)
    for _, name in unsited_companies:
        domains.update(candidates(name))
    return sorted(d for d in domains - set(opted_out) if not is_shared_host(d))


def site_urls(domain: str, website: str | None = None) -> list[str]:
    """The homepages verify tries for a domain, in order.

    An office domain starts from its website's own scheme and host (first value of a multi-value tag) and, when
    that is dead, tries https://www.<domain>/ once; a guessed domain (no website) is read once as https://<domain>/."""
    if website is None:
        return [f"https://{domain}/"]
    first = homepage(first_website(website)) or f"https://{domain}/"
    return list(dict.fromkeys([first, f"https://www.{domain}/"]))


def check_domain(fetcher, urls, known, postcodes, opted_out):
    """check_site on each of `urls` in turn until one is not dead; returns the last (status, domain, rows)."""
    from .agency_crawl.verify import check_site  # agency_crawl.verify imports this module

    for url in urls:
        result = check_site(fetcher, url, known, postcodes, opted_out)
        if result[0] != "dead":
            break
    return result


def verify_counts_text(counts: dict) -> str:
    return (f"{counts['verified']} verified / {counts['none']} no number / {counts['blocked']} blocked / "
            f"{counts['robots']} refused by robots.txt / {counts['dead']} dead / {counts['opted_out']} opted out")


def verify_summary(done: int, total: int, counts: dict, robots_domains) -> list[str]:
    """The lines verify ends with: the domains whose robots.txt refuses CloseKnitBot, then the counts (last).

    done < total means the run was stopped (Ctrl-C) after `done` domains."""
    lines = []
    if robots_domains:
        lines.append("verify: robots.txt refuses CloseKnitBot on: " + ", ".join(sorted(robots_domains)))
    reach = f"{total} domains" if done >= total else f"stopped after {done} of {total} domains"
    lines.append(f"verify: {reach}: {verify_counts_text(counts)}")
    return lines


def domains_to_replace(domain: str, status: str, final: str | None) -> list[str] | None:
    """The domains whose agency_site_company rows a check replaces, or None when it must write nothing (blocked,
    dead, opted_out and robots keep the domain's earlier rows and add none).

    Verified: the input and the final domain. No number: only the input domain, and only when no redirect led to
    another site (a failed contact page must not wipe a verified site reached through a guess)."""
    if status == "verified":
        return sorted({domain, final})
    if status == "none" and final == domain:
        return [domain]
    return None


def verify(url: str, limit: int | None = None, workers: int = 8) -> None:
    import psycopg
    from concurrent.futures import ThreadPoolExecutor, as_completed

    from .agency_crawl import verify as site
    from .agency_crawl.fetch import Fetcher

    # autocommit: the reads open no transaction, and each domain's replacement below is a real transaction of its own
    with psycopg.connect(url, autocommit=True) as conn:
        known = {n for (n,) in conn.execute("SELECT company_number FROM agency_company")}
        opted_out = {d for (d,) in conn.execute(OPT_OUT_SQL)}
        websites = dict(conn.execute(OFFICE_SITES_SQL).fetchall())  # office domain -> one of its websites
        domains = verify_domains(websites, conn.execute(UNSITED_SQL).fetchall(), opted_out, site.candidate_domains)
        postcodes = london_postcodes(url)
        if limit is not None:
            domains = domains[:limit]
        fetcher = Fetcher()
        counts = {"verified": 0, "none": 0, "blocked": 0, "robots": 0, "dead": 0, "opted_out": 0}
        robots, done = [], 0
        pool = ThreadPoolExecutor(max_workers=workers)
        try:
            futures = {pool.submit(check_domain, fetcher, site_urls(d, websites.get(d)), known, postcodes,
                                   opted_out): d for d in domains}
            for future in as_completed(futures):
                domain = futures[future]
                try:
                    status, final, rows = future.result()
                except Exception as error:  # one bad site must not stop the run
                    print(f"verify: {domain}: {type(error).__name__}: {error}", file=sys.stderr)
                    status, final, rows = "dead", None, []
                counts[status] += 1
                if status == "robots":
                    robots.append(domain)
                replaced = domains_to_replace(domain, status, final)
                if replaced is not None:  # a site that could not be read keeps its earlier rows
                    with conn.transaction():
                        conn.execute(DELETE_DOMAIN_SQL, (replaced,))
                        for row in rows:
                            conn.execute(INSERT_SITE_SQL, row)
                done += 1
                if done % PROGRESS_EVERY == 0:
                    print(f"verify: {done}/{len(domains)} domains so far: {verify_counts_text(counts)}", flush=True)
        finally:  # Ctrl-C: drop the queued domains (what was written is committed) and still print the summary
            pool.shutdown(wait=False, cancel_futures=True)
            print("\n".join(verify_summary(done, len(domains), counts, robots)))


COVERAGE_SQL = {
    "offices": "SELECT count(*) FROM agency_office",
    "offices_with_website": "SELECT count(*) FROM agency_office WHERE website IS NOT NULL",
    "offices_by_source": "SELECT coalesce(sources[1], 'none'), count(*) FROM agency_office GROUP BY 1 ORDER BY 2 DESC, 1",
    "companies": "SELECT count(*) FROM agency_company",
    "companies_verified_site": """SELECT count(*) FROM agency_company c
        WHERE EXISTS (SELECT 1 FROM agency_site_company s WHERE s.company_number = c.company_number)""",
    "companies_with_office": "SELECT count(DISTINCT company_number) FROM agency_office",
    "verified_domains": "SELECT count(DISTINCT domain) FROM agency_site_company",
    "website_offices": "SELECT count(*) FROM agency_office WHERE id LIKE 'web:%'",
    "google_ids": """SELECT count(*) FROM agency_office o
        JOIN agency_google_place g ON g.place_id = o.id WHERE g.google_place_id IS NOT NULL""",
}
TWIN_SQL = "SELECT website, domain FROM agency_office WHERE website IS NOT NULL"


def _percent(part: int, whole: int) -> int:
    return round(100 * part / whole) if whole else 0


MISMATCH_ROWS_SHOWN = 20


def twin_mismatches(pairs) -> list[tuple]:
    """(website, sql_domain, python_domain) for each pair whose SQL domain differs from the Python domain of the
    website's first value (the view takes the first of a multi-value tag the same way)."""
    rows = []
    for website, domain in pairs:
        python_domain = site_domain(first_website(website))
        if python_domain != domain:
            rows.append((website, domain, python_domain))
    return rows


def domain_twin_mismatches(pairs) -> int:
    """How many (website, domain) pairs have a SQL domain that differs from site_domain(website)."""
    return len(twin_mismatches(pairs))


def coverage_report(counts: dict) -> list[str]:
    """The lines `check` prints, from plain numbers (pure).

    counts keys: offices, offices_with_website, offices_by_source (dict, first source -> offices), companies,
    companies_verified_site, companies_with_office, verified_domains, website_offices, google_ids (offices with
    a Google place id), twin_mismatches (see domain_twin_mismatches). Percentages are rounded, 0 when empty."""
    offices, companies = counts["offices"], counts["companies"]
    by_source = ", ".join(f"{source} {n}" for source, n in counts["offices_by_source"].items())
    return [
        f"offices {offices} (website {_percent(counts['offices_with_website'], offices)}%)",
        f"offices by first source: {by_source or 'none'}",
        f"companies {companies}: verified site {_percent(counts['companies_verified_site'], companies)}%, "
        f"office {_percent(counts['companies_with_office'], companies)}%",
        f"sites: verified domains {counts['verified_domains']}, website offices {counts['website_offices']}",
        f"google ids {_percent(counts['google_ids'], offices)}%",
        f"domain twin mismatches {counts['twin_mismatches']}",
    ]


def check(url: str) -> None:
    import psycopg

    with psycopg.connect(url) as conn:
        counts = {key: conn.execute(sql).fetchone()[0] for key, sql in COVERAGE_SQL.items() if key != "offices_by_source"}
        counts["offices_by_source"] = dict(conn.execute(COVERAGE_SQL["offices_by_source"]).fetchall())
        mismatches = twin_mismatches(conn.execute(TWIN_SQL).fetchall())
        counts["twin_mismatches"] = len(mismatches)
    print("\n".join(coverage_report(counts)))
    if mismatches:
        for website, sql_domain, python_domain in mismatches[:MISMATCH_ROWS_SHOWN]:
            print(f"mismatch: website {website!r} sql {sql_domain!r} python {python_domain!r}")
        sys.exit(1)


def main(argv: list[str]) -> None:
    stage = argv[1] if len(argv) > 1 else ""
    if stage == "fetch" and len(argv) == 3:
        fetch(argv[2])
    elif stage == "build" and len(argv) == 3:
        build(argv[2])
    elif stage == "load" and len(argv) == 3:
        load(argv[2])
    elif stage == "verify" and len(argv) >= 3:
        options = argv[3:]
        limit = int(options[options.index("--limit") + 1]) if "--limit" in options else None
        workers = int(options[options.index("--workers") + 1]) if "--workers" in options else 8
        verify(argv[2], limit, workers)
    elif stage == "check" and len(argv) == 3:
        check(argv[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
