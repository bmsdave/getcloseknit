"""Kensington and Chelsea (207): the primary and secondary admissions brochures and the bi-borough
'How places were offered for each school in the Bi-borough area' PDF.

The bi-borough admissions service lays both out as Hammersmith & Fulham's: a 'How places were
offered in <year>' box on each school's brochure page, and in the standalone file a heading per
school ('<School>  Places available = 180 (Applications received = 598)') with criterion rows.
Only the 'Kensington and Chelsea Secondary Schools' part of the standalone file is read; its
Westminster schools belong to Westminster's series.
"""
from __future__ import annotations

import re
import subprocess

from ..parsers import Offer, clean, pdf_text
from .hammersmith_fulham import brochure, standalone

BI_BOROUGH = "How places were offered for each school in the Bi-borough area"


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    out = []
    for path in files:
        try:
            text = pdf_text(path)
        except subprocess.CalledProcessError as error:
            raise ValueError(f"{path}: unreadable PDF (pdftotext exit {error.returncode})") from error
        if BI_BOROUGH in clean(text):
            stated = set(re.findall(r"\b(20\d\d)\b", clean(text)[:1500]))
            if stated and str(doc["year"]) not in stated:
                raise ValueError(f"{path}: bi-borough file for {sorted(stated)}, configured {doc['year']}")
            part = text.split("Kensington and Chelsea Secondary Schools", 1)[-1].split("Westminster Secondary Schools", 1)[0]
            out += standalone(part)
        else:
            out += brochure(path, doc["year"])
    return out
