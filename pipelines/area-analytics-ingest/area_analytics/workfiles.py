"""Work files of the place loaders: plain for a London build, gzipped for a wider coverage (England's
TSVs and OSM exports run to gigabytes; the ETL disk is small).

    path = workfiles.name(WORK, "fsq_place.tsv", COVERAGE)   # .../fsq_place.tsv or .../fsq_place.tsv.gz
    with workfiles.open_text(path, "w") as handle: ...
"""
from __future__ import annotations

import gzip
import os


def name(folder: str, base: str, scope) -> str:
    """`base` in `folder`, with .gz unless the coverage is London (whose files keep their old names)."""
    return os.path.join(folder, base if scope.name == "london" else base + ".gz")


def open_text(path: str, mode: str = "r"):
    """A text handle on a plain or .gz file (mode "r" or "w")."""
    if path.endswith(".gz"):
        return gzip.open(path, mode + "t", encoding="utf-8", newline="", compresslevel=6)
    return open(path, mode, encoding="utf-8", newline="")
