"""School income, spending and reserves into school_finance (migration 056).

Source (OGL v3.0): DfE Financial Benchmarking and Insights Tool, data sources page:
  * CFR (Consistent Financial Reporting), local-authority maintained schools, financial year April-March:
    CFR_<year>_Full_Data_Workbook.xlsx, sheet "CFR Data" (DfE's own groupings: revenue reserve B01+B02+B06,
    in-year balance, grant funding, self-generated funding, total income, staff total, premises, total spend).
  * AAR (Academies Accounts Return), academies, academic year September-August: AAR_<year>_download.xlsx, sheets
    "Academies" (per academy, central trust costs apportioned by the trust) and "Central Services" (per trust:
    "Sum of Trust + Academy Revenue Reserve").
Totals are kept in pounds as published (AAR rounds to £1,000); "DNS", "n/s", "NULL" and blanks stay null. A
school in a CFR federation that does not return its own figures gets a row naming the lead school and no money.
An academy listed twice (it changed trust in the year) keeps the row of the trust it ended the year in.

  fetch [folder]          download FILES into folder (default ~/data/school-finance/<YYYY-MM>/)
  load [db-url] [folder]  one source release per workbook; replaces school_finance for the schools in `school`

  .ae-venv/bin/python deploy/tools/etl_school_finance.py fetch
  .ae-venv/bin/python deploy/tools/etl_school_finance.py load [database-url] [folder]
"""
from __future__ import annotations

import os
import sys
from collections import Counter
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import school_history_common as common  # noqa: E402

SOURCE = "school-finance"
BASE = "https://financial-benchmarking-and-insights-tool.education.gov.uk/files/"
# accounts -> (file, period, source release, release date)
FILES = {
    "CFR": ("CFR_2025-26_Full_Data_Workbook.xlsx", "2025-26", "src-dfe-cfr-2025-26", date(2026, 9, 30)),
    "AAR": ("AAR_2024-25_download.xlsx", "2024-25", "src-dfe-aar-2024-25", date(2026, 4, 22)),
}
CFR_COLUMNS = {
    "No pupils (including dual registrations)": "pupils_fte",
    "Revenue Reserve: B01 + B02 + B06": "revenue_reserve",
    "In-year Balance: Total Income (I01:I17 - E30) - Total Expenditure (E01:E29 + E31 + E32)": "in_year_balance",
    "Grant Funding: (I01:I07) + I15 + I16": "grant_funding",
    "Self Generated Funding: (I08a/b:I13) + I17": "self_generated_income",
    "Total Income: I01:I17 - E30": "total_income",
    "Staff Total: (E01:E03) + E05 + (E07: E11) + E26": "staff_costs",
    "Premises: (E12:E14) + E04 + E28b": "premises_costs",
    "Total Expenditure: (E01:E29 + E31 + E32)": "total_expenditure",
}
AAR_COLUMNS = {
    "Number of pupils in academy (FTE) plus dual subsidiary registrations": "pupils_fte",
    "Revenue Reserve": "revenue_reserve", "In year balance": "in_year_balance",
    "Total Grant Funding": "grant_funding", "Total Self Generated Funding": "self_generated_income",
    "Total Income": "total_income", "Total Staff Costs": "staff_costs", "Premises Costs": "premises_costs",
    "Total Expenditure": "total_expenditure",
}
MONEY = [c for c in CFR_COLUMNS.values() if c != "pupils_fte"]
TRUST_KIND = {"Multi Academy Trust (MAT)": "MAT", "Single Academy Trust (SAT)": "SAT"}
ATTRIBUTION = {
    "CFR": ("Department for Education, Consistent Financial Reporting (CFR) 2025-26, Financial Benchmarking and "
            "Insights Tool. Contains public sector information licensed under the Open Government Licence v3.0."),
    "AAR": ("Department for Education, Academies Accounts Return (AAR) 2024/25, Financial Benchmarking and "
            "Insights Tool. Contains public sector information licensed under the Open Government Licence v3.0."),
}
CAVEATS = {
    "CFR": [
        "Maintained school accounts for the financial year April 2025 to March 2026, as the school returned them.",
        "Not comparable with academies' accounts (AAR): a different year and different accounting.",
        "Where schools are federated, the lead school's figures cover the whole federation.",
    ],
    "AAR": [
        "Academy accounts for the academic year September 2024 to August 2025, rounded to £1,000.",
        "Not comparable with maintained schools' accounts (CFR): a different year and different accounting.",
        "In a multi-academy trust the reserves belong to the trust; the academy's figures include the share of "
        "central costs the trust gives it.",
    ],
}
ETL_VERSION = "close-knit-school-finance-1"


def _number(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None  # DNS, n/s, n/a, NULL, blank


def _urn(value) -> str | None:
    text = str(value or "").strip().removesuffix(".0")
    return text if len(text) == 6 and text.isdigit() else None


def sheet_rows(path: str, sheet: str, header_row: int):
    """Dicts of one sheet; header_row is the 0-based row holding the column names."""
    import openpyxl

    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    rows = book[sheet].iter_rows(values_only=True)
    for _ in range(header_row):
        next(rows)
    header = [str(h).strip() if h is not None else "" for h in next(rows)]
    for row in rows:
        yield dict(zip(header, row))


def cfr_records(rows, schools: set[str]) -> list[dict]:
    rows = list(rows)
    lead_urn = {str(r["LAEstab"]): _urn(r["URN"]) for r in rows}
    out = []
    for row in rows:
        urn = _urn(row["URN"])
        if urn not in schools:
            continue
        record = {ours: _number(row.get(theirs)) for theirs, ours in CFR_COLUMNS.items()}
        record.update(urn=urn, period_months=int(_number(row.get("Period covered by return")) or 0) or None,
                      not_supplied_reason=None, federation_lead_urn=None)
        federated = (row.get("Federated submission") or "No").strip()
        if federated == "Lead school":
            record["federation_lead_urn"] = urn
        elif federated == "Non returning school":
            lead = lead_urn.get(str(row.get("Lead school in federation")))
            record.update({c: None for c in MONEY}, federation_lead_urn=lead,
                          not_supplied_reason="Reported with its federation, under the lead school")
        elif str(row.get("Did Not Supply flag")).strip() == "Y":
            record["not_supplied_reason"] = "The school did not supply a return"
        out.append(record)
    return out


def aar_records(academies, central, schools: set[str]) -> list[dict]:
    academies = [row for row in academies if _urn(row.get("URN"))]
    in_trust = Counter(str(row["Company Number"]) for row in academies
                       if not row.get("Date left or closed if in period"))
    trusts = {str(row["Company Number"]): _number(row.get("Sum of Trust + Academy Revenue Reserve")) for row in central}
    by_urn: dict[str, list[dict]] = {}
    for row in academies:
        by_urn.setdefault(_urn(row["URN"]), []).append(row)
    out = []
    for urn, rows in sorted(by_urn.items()):
        if urn not in schools:
            continue
        staying = [r for r in rows if not r.get("Date left or closed if in period")]
        if len(staying) != 1:
            continue  # left or ambiguous: no figures rather than the wrong trust's
        row = staying[0]
        kind = TRUST_KIND.get((row.get("MAT SAT or Central Services") or "").strip())
        company = str(row["Company Number"])
        record = {ours: _number(row.get(theirs)) for theirs, ours in AAR_COLUMNS.items()}
        record.update(urn=urn, period_months=int(_number(row.get("Period covered by return")) or 0) or None,
                      not_supplied_reason=None, federation_lead_urn=None, trust_kind=kind,
                      trust_company_number=company, trust_name=(row.get("Trust or Company Name") or "").strip() or None,
                      trust_revenue_reserve=trusts.get(company) if kind == "MAT" else None,
                      trust_academies=in_trust.get(company) or None)
        if all(record[c] is None for c in MONEY):
            record["not_supplied_reason"] = "No finance data were supplied"
        out.append(record)
    return out


def fetch(folder: str) -> dict[str, str]:
    paths = {}
    for accounts, (name, *_rest) in FILES.items():
        paths[accounts] = os.path.join(folder, name)
        common.http_get(BASE + name, paths[accounts])
    return paths


def load(cur, paths: dict[str, str]) -> int:
    schools = {row[0] for row in cur.execute("SELECT urn FROM school").fetchall()}
    found = {
        "CFR": cfr_records(sheet_rows(paths["CFR"], "CFR Data", 0), schools),
        "AAR": aar_records(sheet_rows(paths["AAR"], "Academies", 1), sheet_rows(paths["AAR"], "Central Services", 1),
                           schools),
    }
    cur.execute("DELETE FROM school_finance")
    columns = ["urn", "accounts", "period", "period_months", *CFR_COLUMNS.values(), "not_supplied_reason",
               "federation_lead_urn", "trust_kind", "trust_company_number", "trust_name", "trust_revenue_reserve",
               "trust_academies"]
    for accounts, (name, period, release, released) in FILES.items():
        common.register_release(cur, release, BASE + name, common.recorded_sha256(paths[accounts]), "OGL-3.0",
                                ATTRIBUTION[accounts], CAVEATS[accounts], released, ETL_VERSION)
        rows = [{"trust_kind": None, "trust_company_number": None, "trust_name": None, "trust_revenue_reserve": None,
                 "trust_academies": None, **r, "accounts": accounts, "period": period, "release": release}
                for r in found[accounts]]
        cur.executemany(
            f"""INSERT INTO school_finance ({', '.join(columns)}, source_release_id)
                VALUES ({', '.join(f'%({c})s' for c in columns)}, %(release)s)""", rows)
        print(f"load {release}: {len(rows)} of {len(schools)} schools, "
              f"{sum(1 for r in rows if r['revenue_reserve'] is not None)} with a revenue reserve")
    return sum(len(v) for v in found.values())


def main(argv: list[str]) -> None:
    if len(argv) < 2 or argv[1] not in ("fetch", "load"):
        raise SystemExit(__doc__)
    if argv[1] == "fetch":
        print(fetch(argv[2] if len(argv) > 2 else common.raw_dir(SOURCE)))
        return
    import psycopg

    folder = argv[3] if len(argv) > 3 else common.raw_dir(SOURCE)
    with psycopg.connect(argv[2] if len(argv) > 2 else common.DEFAULT_DB_URL) as conn, conn.cursor() as cur:
        load(cur, fetch(folder))


if __name__ == "__main__":
    main(sys.argv)
