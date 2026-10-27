"""Per-council configuration (boroughs/<slug>.yaml) and the adapters that read its documents.

A council is named by its slug ('ealing') or DfE code ('307'). Each config lists documents
(phase, year of entry, url, other_urls, format, units, method, counts, note) from the source
audit; documents of the same phase and year are read together and reviewed together.

An adapter is adapters/<slug>.py with

    def parse(doc: dict, files: list[str], config: dict) -> list[parsers.Offer]

where files are the local copies of doc['url'] followed by doc['other_urls'].
"""
from __future__ import annotations

import importlib
import os
import re
from collections import defaultdict
from pathlib import Path

import yaml

BOROUGHS = Path(__file__).resolve().parent / "boroughs"
ENTRY_POINT = {"primary": "reception", "secondary": "year7"}
EXTENSIONS = (".pdf", ".xlsx", ".xls", ".docx", ".csv", ".html", ".htm")


def slugs() -> list[str]:
    return sorted(path.stem for path in BOROUGHS.glob("*.yaml"))


def load_config(la: str | int) -> dict:
    key = str(la)
    for slug in slugs():
        if key == slug:
            return _read(slug)
    for slug in slugs():
        config = _read(slug)
        if str(config["la"]) == key:
            return config
    raise SystemExit(f"no council config for {la!r} (have: {', '.join(slugs())})")


def _read(slug: str) -> dict:
    with open(BOROUGHS / f"{slug}.yaml") as handle:
        return yaml.safe_load(handle)


def adapter(slug: str):
    """The council's adapter module, or None when it has not been written yet."""
    try:
        return importlib.import_module(f"{__package__}.adapters.{slug}")
    except ModuleNotFoundError as error:
        if error.name == f"{__package__}.adapters.{slug}":
            return None
        raise


def academic_year(year: int) -> str:
    """Year of entry 2026 -> '2026/27'."""
    return f"{year}/{(year + 1) % 100:02d}"


def groups(config: dict) -> dict[tuple[str, int], list[dict]]:
    """Documents by (phase, year), in config order."""
    out = defaultdict(list)
    for doc in config["docs"]:
        out[(doc["phase"], int(doc["year"]))].append(doc)
    return dict(out)


def extension(url: str, fmt: str | None) -> str:
    path = re.sub(r"[?#].*$", "", url).lower()
    for ext in EXTENSIONS:
        if path.endswith(ext):
            return ".html" if ext == ".htm" else ext
    if fmt in ("html", "xlsx", "docx"):
        return "." + fmt
    return ".pdf"  # pdf-table, pdf-text, scanned-pdf


def files(folder: str, phase: str, year: int, docs: list[dict]) -> list[tuple[dict, list[tuple[str, str]]]]:
    """For each doc of one phase-year: (doc, [(url, local path)]), main url first.
    Paths are <folder>/<phase>-<year>[-n].<ext>, numbered across the group from 2."""
    out, n = [], 0
    for doc in docs:
        pairs = []
        for url in [doc["url"], *(doc.get("other_urls") or [])]:
            n += 1
            name = f"{phase}-{year}" + (f"-{n}" if n > 1 else "") + extension(url, doc.get("format"))
            pairs.append((url, os.path.join(folder, name)))
        out.append((doc, pairs))
    return out
