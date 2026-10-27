"""City of London (201): 'Starting Primary School' booklets of the Family Information Service.

The City has one maintained primary, The Aldgate School. Each booklet prints one sentence on the
previous round, e.g. 'The furthest distance a pupil was allocated a school place: 463.92 metres.'
(2021-2022: 'Distance last pupil was allocated a school place: ...'), next to 'There were no
appeals lodged for reception <year>', which gives the entry year the figure belongs to.
"""
from __future__ import annotations

import re

from ..parsers import Offer, clean, pdf_text

SCHOOL = "The Aldgate School"
DISTANCE = re.compile(r"(?:furthest distance|distance last pupil)[^:]*?(?:for (?P<for>\d{4})(?: entry)?)?"
                      r"(?::| was) (?P<value>\d[\d,]*(?:\.\d+)? metres)", re.I)
APPEALS = re.compile(r"appeals? lodged for reception (?:places in )?(\d{4})", re.I)


def parse(doc: dict, files: list[str], config: dict) -> list[Offer]:
    return [parse_text(pdf_text(path, layout=False), doc["year"]) for path in files]


def parse_text(text: str, year: int) -> Offer:
    text = clean(text)
    found = DISTANCE.findall(text)
    if len(found) != 1:
        raise ValueError(f"expected one last-distance sentence, found {len(found)}")
    stated, value = found[0]
    years = {stated} if stated else set(APPEALS.findall(text))
    if years != {str(year)}:
        raise ValueError(f"last distance is for {sorted(years)}, configured {year}")
    if SCHOOL not in text:
        raise ValueError(f"{SCHOOL} not named in the booklet")
    return Offer(school=SCHOOL, raw_value=value)
