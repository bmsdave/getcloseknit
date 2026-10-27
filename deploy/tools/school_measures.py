"""School performance measures loaded into school_observation (migration 048).

Each measure's id is school_observation.observation_kind; `columns` names the DfE performance
table column (compare-school-performance download-data, filter `source`) for each academic year
it is published. A year missing from `columns` was not published (2019/20-2021/22 for KS2,
2019/20-2020/21 for KS4/KS5), not forgotten. Column names are matched case-insensitively
(ESTAB/Estab). Columns marked here were checked against the header rows in the source audit;
etl_school_performance.py's tests check them against the downloaded files' header rows.
"""
from __future__ import annotations

from dataclasses import dataclass, field

KS2_YEARS = ("2015/16", "2016/17", "2017/18", "2018/19", "2022/23", "2023/24", "2024/25")
KS4_YEARS = ("2015/16", "2016/17", "2017/18", "2018/19", "2021/22", "2022/23", "2023/24", "2024/25")
KS5_YEARS = KS4_YEARS
# School census files exist from 2010/11 (2005/06-2009/10 answer 404); 2019/20 was not published.
CENSUS_YEARS = ("2010/11", "2011/12", "2012/13", "2013/14", "2014/15", "2015/16", "2016/17", "2017/18",
                "2018/19", "2020/21", "2021/22", "2022/23", "2023/24", "2024/25")
# Pupil absence (filter PUPILABSENCE): each file is the full academic year it is named for (meta file).
ABSENCE_YEARS = ("2023/24", "2024/25")


@dataclass(frozen=True)
class Measure:
    id: str
    label: str
    phase: str            # 'primary' | 'secondary' | 'sixth-form' | 'all'
    unit: str             # 'percent' | 'score' | 'progress' | 'grade' | 'pupils'
    source: str           # performance tables filter: KS2 | KS4 | KS5 | CENSUS | PUPILABSENCE
    columns: dict[str, str] = field(default_factory=dict)  # academic year -> column
    cohort_column: dict[str, str] = field(default_factory=dict)

    def column(self, academic_year: str) -> str | None:
        return self.columns.get(academic_year)


def _every(years: tuple[str, ...], column: str) -> dict[str, str]:
    return {year: column for year in years}


KS2_COHORT = _every(KS2_YEARS, "TELIG")      # published eligible pupil number
KS4_COHORT = _every(KS4_YEARS, "TPUP")       # pupils at the end of key stage 4
ALEVEL_COHORT = _every(KS5_YEARS, "TALLPUP_ALEV_1618")  # students entered for an AS or A level

MEASURES: tuple[Measure, ...] = (
    Measure("ks2-rwm-expected", "Expected standard in reading, writing and maths (%)", "primary",
            "percent", "KS2", _every(KS2_YEARS, "PTRWM_EXP"), KS2_COHORT),
    Measure("ks2-rwm-higher", "Higher standard in reading, writing and maths (%)", "primary",
            "percent", "KS2", _every(KS2_YEARS, "PTRWM_HIGH"), KS2_COHORT),
    Measure("ks2-reading-score", "Average scaled score in reading", "primary", "score", "KS2",
            _every(KS2_YEARS, "READ_AVERAGE"), KS2_COHORT),
    Measure("ks2-maths-score", "Average scaled score in maths", "primary", "score", "KS2",
            _every(KS2_YEARS, "MAT_AVERAGE"), KS2_COHORT),
    Measure("ks2-gps-score", "Average scaled score in grammar, punctuation and spelling", "primary",
            "score", "KS2", _every(KS2_YEARS, "GPS_AVERAGE"), KS2_COHORT),
    Measure("ks2-gps-expected", "Expected standard in grammar, punctuation and spelling (%)", "primary",
            "percent", "KS2", _every(KS2_YEARS, "PTGPS_EXP"), KS2_COHORT),
    # Progress columns exist but are empty in 2023/24 and 2024/25 (no KS1 baseline).
    Measure("ks2-reading-progress", "Reading progress", "primary", "progress", "KS2",
            _every(KS2_YEARS[:5], "READPROG"), KS2_COHORT),
    Measure("ks2-writing-progress", "Writing progress", "primary", "progress", "KS2",
            _every(KS2_YEARS[:5], "WRITPROG"), KS2_COHORT),
    Measure("ks2-maths-progress", "Maths progress", "primary", "progress", "KS2",
            _every(KS2_YEARS[:5], "MATPROG"), KS2_COHORT),
    # Attainment 8 moved to 9-1 grade points in 2016/17: 2015/16 scores are on the old scale.
    Measure("ks4-attainment8", "Attainment 8", "secondary", "score", "KS4",
            _every(KS4_YEARS, "ATT8SCR"), KS4_COHORT),
    # P8MEA is 'NA' for every school in 2024/25 (no KS2 2020 baseline): not published.
    Measure("ks4-progress8", "Progress 8", "secondary", "progress", "KS4",
            _every(KS4_YEARS[:-1], "P8MEA"), KS4_COHORT),
    # 2015/16 has only the old A*-C measures.
    Measure("ks4-em-grade5", "Grade 5+ in English and maths (%)", "secondary", "percent", "KS4",
            _every(KS4_YEARS[1:], "PTL2BASICS_95"), KS4_COHORT),
    Measure("ks4-em-grade4", "Grade 4+ in English and maths (%)", "secondary", "percent", "KS4",
            _every(KS4_YEARS[1:], "PTL2BASICS_94"), KS4_COHORT),
    Measure("ks4-ebacc-aps", "EBacc average point score", "secondary", "score", "KS4",
            _every(KS4_YEARS[2:], "EBACCAPS"), KS4_COHORT),
    Measure("ks5-alevel-aps", "A level average point score per entry", "sixth-form", "score", "KS5",
            _every(KS5_YEARS, "TALLPPE_ALEV_1618"), ALEVEL_COHORT),
    Measure("ks5-alevel-grade", "A level average grade per entry", "sixth-form", "grade", "KS5",
            _every(KS5_YEARS, "TALLPPEGRD_ALEV_1618"), ALEVEL_COHORT),
    # 2021/22 and 2022/23 publish only lagged value added (VA_INS_ALEV_19 …), not that year's.
    Measure("ks5-alevel-va", "A level value added", "sixth-form", "progress", "KS5",
            {year: "VA_INS_ALEV" for year in ("2015/16", "2016/17", "2017/18", "2018/19", "2023/24", "2024/25")}),
    Measure("ks5-students", "Students aged 16-18 in the sixth form", "sixth-form", "pupils", "KS5",
            _every(KS5_YEARS, "TPUP1618")),
    # "Total number of pupils on roll (all ages)" is TOTPUPSENDN until 2013/14, NOR from 2014/15.
    Measure("pupils", "Pupils on roll", "all", "pupils", "CENSUS",
            {year: "TOTPUPSENDN" if year < "2014/15" else "NOR" for year in CENSUS_YEARS}),
    # January census shares as DfE publishes them (census meta file); "NA" is kept as not published.
    Measure("census-girls-percent", "Girls on roll (%)", "all", "percent", "CENSUS",
            _every(CENSUS_YEARS[1:], "PNORG")),
    Measure("census-boys-percent", "Boys on roll (%)", "all", "percent", "CENSUS",
            _every(CENSUS_YEARS[1:], "PNORB")),
    Measure("census-fsm6-percent", "Eligible for free school meals in the past 6 years (%)", "all", "percent",
            "CENSUS", _every(CENSUS_YEARS[1:], "PNUMFSMEVER")),
    Measure("census-eal-percent", "First language not English (%)", "all", "percent", "CENSUS",
            _every(CENSUS_YEARS, "PNUMEAL")),
    # SEN support and EHC plans as now defined start in 2014/15 (SEND reforms).
    Measure("census-sen-support-percent", "SEN support (%)", "all", "percent", "CENSUS",
            _every(CENSUS_YEARS[4:], "PSENELK")),
    Measure("census-ehcp-percent", "Education, health and care plan (%)", "all", "percent", "CENSUS",
            _every(CENSUS_YEARS[4:], "PSENELSE")),
    Measure("absence-overall-percent", "Overall absence (% of sessions)", "all", "percent", "PUPILABSENCE",
            _every(ABSENCE_YEARS, "PERCTOT")),
    Measure("absence-persistent-percent", "Persistent absentees (% of pupils missing 10%+ of sessions)", "all",
            "percent", "PUPILABSENCE", _every(ABSENCE_YEARS, "PPERSABS10")),
)

BY_ID = {measure.id: measure for measure in MEASURES}


def measures(source: str | None = None, phase: str | None = None) -> list[Measure]:
    return [m for m in MEASURES if (source is None or m.source == source) and (phase is None or m.phase == phase)]


def download_year(academic_year: str) -> str:
    """'2024/25' -> '2024-2025', the performance tables' year parameter."""
    start = int(academic_year[:4])
    return f"{start}-{start + 1}"
