"""Distance of the last place offered, from each London council's on-time offer documents.

Per council (slug or DfE code, configs in pipelines/area-analytics-ingest/area_analytics/
school_admissions/boroughs/):

  fetch <la>              download every document once to ~/data/admissions/<YYYY-MM>/<slug>/
                          (<phase>-<year>[-n].<ext> + .sha256); failures go to fetch-errors.txt
  parse <la> [db-url]     run adapters/<slug>.py, match names to URNs, convert distances and write
                          ~/data/aework/admissions/review/<slug>-<phase>-<year>.csv; lists problems
  load <la> [db-url]      load each phase-year whose review file has no problems into
                          school_admission_observation under src-la-admissions-<slug>-<phase>-<year>
                          (delete + insert by that release); publishable only where the config's
                          licence_decision is 'approved'; `school_history_common.py stage` stages
                          every council's releases with the rest of the school history
  all [db-url]            fetch, parse and load every council that has an adapter

Distances are stored in metres (miles x 1609.344, rounded) with the printed cell in raw_value.
Exit status 1 when anything was not loaded; the review files say why.
"""
from __future__ import annotations

import glob
import hashlib
import os
import re
import sys
import urllib.error
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))

import school_history_common as common  # noqa: E402
from area_analytics.school_admissions import config as cfg  # noqa: E402
from area_analytics.school_admissions import parsers, review  # noqa: E402
from area_analytics.school_admissions.match import SchoolMatcher  # noqa: E402

RELEASE_PREFIX = "src-la-admissions"
ETL_VERSION = "close-knit-school-distances-1"


def folder(slug: str) -> str:
    path = os.path.join(common.raw_dir("admissions"), slug)
    os.makedirs(path, exist_ok=True)
    return path


def existing(slug: str, name: str) -> str | None:
    """The newest retrieved copy of a document, from any month."""
    found = sorted(glob.glob(os.path.join(common.DATA, "admissions", "*", slug, name)))
    return found[-1] if found else None


def fetch(la: str) -> list[str]:
    config = cfg.load_config(la)
    slug, here, errors, got = config["slug"], folder(config["slug"]), [], 0
    for (phase, year), docs in sorted(cfg.groups(config).items()):
        for _, pairs in cfg.files(here, phase, year, docs):
            for url, path in pairs:
                if existing(slug, os.path.basename(path)):
                    got += 1
                    continue
                try:
                    common.http_get(url, path)
                    got += 1
                except (urllib.error.URLError, OSError) as error:
                    errors.append(f"{os.path.basename(path)}\t{url}\t{error}")
    if errors:
        with open(os.path.join(here, "fetch-errors.txt"), "w") as handle:
            handle.write("\n".join(errors) + "\n")
    print(f"fetch {slug}: {got} documents on disk, {len(errors)} failed")
    return errors


def rule_id(entry_point: str, rule: str | None) -> str:
    if not rule:
        return entry_point
    return f"{entry_point}:" + re.sub(r"[^a-z0-9]+", "-", parsers.clean(rule).lower()).strip("-")


def to_row(offer: parsers.Offer, doc: dict, config: dict, phase: str, year: int,
           matcher: SchoolMatcher) -> dict:
    entry = offer.entry_point or cfg.ENTRY_POINT[phase]
    problem, metres, all_offered = None, None, None
    try:
        metres, all_offered = parsers.parse_distance(offer.raw_value, doc.get("units"))
    except ValueError as error:
        problem = str(error)
    urn = matcher.match(offer.school, phase)
    counts = (None, None, None) if doc.get("drop_counts") else (offer.applicants, offer.offers, offer.refused)
    return {"la": config["la"], "slug": config["slug"], "phase": phase, "year": year,
            "academic_year": cfg.academic_year(year), "entry_point": entry, "school": offer.school,
            "urn": urn, "matched_name": matcher.name.get(urn), "rule_id": rule_id(entry, offer.rule),
            "site": offer.site, "criterion": offer.criterion, "raw_value": offer.raw_value,
            "distance_metres": metres,
            "all_offered": offer.all_offered if offer.all_offered is not None else all_offered,
            "applicants": counts[0], "offers": counts[1], "refused": counts[2],
            "measurement_method": offer.method or doc.get("method") or "unknown",
            "source_url": offer.source_url or doc["url"], "page": offer.page, "problem": problem}


def previous_review(slug: str, phase: str, year: int) -> list[dict] | None:
    """The nearest earlier year's review rows for the same phase, if parsed."""
    for earlier in range(year - 1, year - 8, -1):
        path = review.review_path(slug, phase, earlier)
        if os.path.exists(path):
            return review.read_review(path)
    return None


def accepted(docs: list[dict]) -> list[str]:
    return [text for doc in docs for text in (doc.get("accept") or [])]


def parse(la: str, cur) -> dict:
    """{(phase, year): problems}; writes one review file per phase-year that has documents read."""
    config = cfg.load_config(la)
    slug, module = config["slug"], cfg.adapter(config["slug"])
    if module is None:
        raise SystemExit(f"parse {slug}: no adapter (adapters/{slug}.py)")
    resolver = common.load_resolver(cur)
    matcher = SchoolMatcher.from_db(cur, common.LONDON_LAS[int(config["la"])], config.get("aliases"),
                                    resolver.names(int(config["la"])))
    status = {}
    for (phase, year), docs in sorted(cfg.groups(config).items()):
        rows, unread = [], []
        for doc, pairs in cfg.files(folder(slug), phase, year, docs):
            paths = [existing(slug, os.path.basename(path)) for _, path in pairs]
            if None in paths:
                unread.append(f"{doc['url']}: not fetched")
                continue
            try:
                offers = module.parse(doc, paths, config)
            except (NotImplementedError, ValueError) as error:  # scanned, or not the document expected
                unread.append(f"{doc['url']}: {error}")
                continue
            rows += [to_row(offer, doc, config, phase, year, matcher) for offer in offers]
        if not rows and unread:
            stale = review.review_path(slug, phase, year)
            if os.path.exists(stale):
                os.remove(stale)
            status[(phase, year)] = unread
            print(f"parse {slug} {phase} {year}: nothing read ({'; '.join(unread)})")
            continue
        path = review.write_review(rows, review.review_path(slug, phase, year))
        found = unread + review.problems(rows, previous_review(slug, phase, year), accepted(docs))
        status[(phase, year)] = found
        print(f"parse {slug} {phase} {year}: {len(rows)} rows, {len(found)} problems -> {path}")
        for problem in found[:12]:
            print(f"    {problem}")
    return status


def doc_sha256(slug: str, pairs: list[tuple[str, str]]) -> str:
    shas = [common.recorded_sha256(existing(slug, os.path.basename(path))) for _, path in pairs]
    if len(shas) == 1:
        return shas[0]
    return hashlib.sha256("\n".join(sorted(shas)).encode()).hexdigest()


def caveats(config: dict, docs: list[dict]) -> list[str]:
    out = []
    for doc in docs:
        units, method = doc.get("units") or "the printed units", doc.get("method") or "unstated"
        out.append(f"Distance of the last place offered as printed in {units} ({method} measurement), "
                   "stored in metres (1 mile = 1609.344 m) with the printed value kept.")
        if doc.get("basis"):
            out.append(f"Basis: {doc['basis']}.")
        if doc.get("note"):
            out.append(f"Document note: {doc['note']}")
        if doc.get("drop_counts"):
            out.append(f"Applicant, offer and refusal counts left out: {doc['drop_counts']}")
    if config.get("licence_decision") != "approved":
        out.append(common.REUSE_CAVEAT)
    out.append("Release date is the date the document was retrieved.")
    return out


def load(la: str, cur) -> list[str]:
    """Loads every reviewed phase-year without problems; returns what was not loaded."""
    config = cfg.load_config(la)
    slug, name = config["slug"], config["name"]
    approved = config.get("licence_decision") == "approved"
    failed = []
    for (phase, year), docs in sorted(cfg.groups(config).items()):
        path = review.review_path(slug, phase, year)
        if not os.path.exists(path):
            failed.append(f"{phase} {year}: no review file (parse read nothing or was not run)")
            continue
        rows = review.read_review(path)
        found = review.problems(rows, previous_review(slug, phase, year), accepted(docs))
        if found:
            failed.append(f"{phase} {year}: {len(found)} problems in {path}")
            continue
        pairs = [pair for _, group in cfg.files(folder(slug), phase, year, docs) for pair in group]
        release_id = f"{RELEASE_PREFIX}-{slug}-{phase}-{year}"
        retrieved = date.fromtimestamp(os.path.getmtime(existing(slug, os.path.basename(pairs[0][1]))))
        common.register_release(
            cur, release_id, docs[0]["url"], doc_sha256(slug, pairs),
            "OGL-3.0" if approved else f"{name} Council copyright; re-use not confirmed",
            f"{name} Council, school admissions: on-time offers for {cfg.academic_year(year)} ({phase})."
            + (" Contains public sector information licensed under the Open Government Licence v3.0."
               if approved else ""),
            caveats(config, docs), retrieved, ETL_VERSION)
        cur.execute("DELETE FROM school_admission_observation WHERE source_release_id = %s", (release_id,))
        # Accepted unmatched rows stay in the review file only; rows that say nothing are dropped.
        keep = [r for r in rows if r["urn"] and (
            r["distance_metres"] is not None or r["all_offered"] is not None
            or any(r[k] is not None for k in ("applicants", "offers", "refused")))]
        inserted = 0
        for r in keep:
            cur.execute(
                """INSERT INTO school_admission_observation (urn, academic_year, rule_id, school_site_id,
                     measurement_method, last_offer_distance_metres, source_url, source_release_id,
                     entry_point, all_offered, last_offer_criterion, applicants, offers, refused,
                     raw_value, publishable)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT DO NOTHING""",
                (r["urn"], r["academic_year"], r["rule_id"], r["site"], r["measurement_method"],
                 r["distance_metres"], r["source_url"], release_id, r["entry_point"], r["all_offered"],
                 r["criterion"], r["applicants"], r["offers"], r["refused"], r["raw_value"], approved))
            inserted += cur.rowcount
        if inserted < len(keep):
            print(f"    {len(keep) - inserted} rows already held by another release, kept as they were")
        print(f"load {slug} {phase} {year}: {inserted} rows ({release_id}, publishable={approved})")
    for line in failed:
        print(f"not loaded {slug} {line}")
    return failed


def main(argv: list[str]) -> None:
    if len(argv) < 2 or argv[1] not in ("fetch", "parse", "load", "all"):
        raise SystemExit(__doc__)
    command = argv[1]
    if command == "fetch":
        if len(argv) < 3:
            raise SystemExit(__doc__)
        sys.exit(1 if fetch(argv[2]) else 0)
    import psycopg

    if command == "all":
        url = argv[2] if len(argv) > 2 else common.DEFAULT_DB_URL
        targets = [slug for slug in cfg.slugs() if cfg.adapter(slug)]
    else:
        if len(argv) < 3:
            raise SystemExit(__doc__)
        url = argv[3] if len(argv) > 3 else common.DEFAULT_DB_URL
        targets = [argv[2]]
    bad = False
    for la in targets:
        if command == "all":
            bad |= bool(fetch(la))
        with psycopg.connect(url) as conn, conn.cursor() as cur:
            if command in ("parse", "all"):
                bad |= any(parse(la, cur).values())
            if command in ("load", "all"):
                bad |= bool(load(la, cur))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main(sys.argv)
