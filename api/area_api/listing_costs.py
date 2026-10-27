"""Monthly and upfront costs of buying a listed home, for the extension card's `costs` block.

Stamp Duty Land Tax is a port of web/src/lib/stamp-duty.ts (England, individuals, the table in force
on SDLT_IN_FORCE_ON) and must stay in step with it: api/tests/test_listing_costs.py mirrors the web tool's
cases. The mortgage is a plain repayment loan on the user's own assumptions (kept on their device).
A comparison aid, never a quote or mortgage advice.
"""
from __future__ import annotations

import math
from typing import Any, Mapping

# (from, to, rate %): `from` exclusive, `to` inclusive; None = and above.
STANDARD_BANDS = ((0, 125_000, 0), (125_000, 250_000, 2), (250_000, 925_000, 5),
                  (925_000, 1_500_000, 10), (1_500_000, None, 12))
FIRST_TIME_BUYER_BANDS = ((0, 300_000, 0), (300_000, 500_000, 5))
FIRST_TIME_BUYER_MAX_PRICE = 500_000
ADDITIONAL_SURCHARGE_PCT = 5
ADDITIONAL_MIN_PRICE = 40_000
NON_RESIDENT_SURCHARGE_PCT = 2
SDLT_IN_FORCE_ON = "2026-10-05"


def stamp_duty(price: float, first_time_buyer: bool = False, additional_property: bool = False,
               non_uk_resident: bool = False) -> dict:
    """SDLT due on a residential purchase: {total, regime, surchargePct}, rounded down to the pound."""
    if not isinstance(price, (int, float)) or math.isnan(price) or price < 0:
        raise ValueError("price must be zero or more")
    first_time = first_time_buyer and not additional_property and price <= FIRST_TIME_BUYER_MAX_PRICE
    surcharge = 0
    if additional_property and price >= ADDITIONAL_MIN_PRICE:
        surcharge += ADDITIONAL_SURCHARGE_PCT
    if non_uk_resident:
        surcharge += NON_RESIDENT_SURCHARGE_PCT
    tax = 0.0
    for low, high, rate in FIRST_TIME_BUYER_BANDS if first_time else STANDARD_BANDS:
        top = price if high is None else min(price, high)
        tax += max(0, top - low) * (rate + surcharge) / 100
    return {"total": math.floor(tax + 1e-9), "regime": "first-time-buyer" if first_time else "standard",
            "surchargePct": surcharge}


def monthly_repayment(loan: float, rate_pct: float, years: int) -> float:
    """A repayment mortgage's monthly payment."""
    months = years * 12
    if loan <= 0:
        return 0.0
    rate = rate_pct / 100 / 12
    if rate == 0:
        return loan / months
    return loan * rate / (1 - (1 + rate) ** -months)


def council_tax_yearly(civic: Mapping[str, Any] | None, band: str | None) -> float | None:
    """The borough's yearly council tax for the listing's band (civic.v1), None when unknown."""
    tax = (civic or {}).get("councilTax") or {}
    return next((row["amount"] for row in tax.get("bands") or [] if row["band"] == band and row["amount"]), None)


def council_tax_by_band(civic: Mapping[str, Any] | None) -> dict[str, int]:
    """The borough's council tax a month for bands A-H (civic.v1), so the extension can price the band it
    reads on the page without sending it. Bands without an amount are left out."""
    tax = (civic or {}).get("councilTax") or {}
    return {row["band"]: round(row["amount"] / 12) for row in tax.get("bands") or []
            if row["band"] in tuple("ABCDEFGH") and row["amount"]}


def costs_block(price: int, assumptions: Mapping[str, Any], council_tax: float | None,
                service_charge_yearly: int | None, ground_rent_yearly: int | None, chips: list[str]) -> dict:
    """The card's `costs` block for an asking price and the buyer's assumptions."""
    deposit = round(price * assumptions["depositPct"] / 100)
    mortgage = monthly_repayment(price - deposit, assumptions["ratePct"], assumptions["years"])
    parts = [{"label": "Mortgage", "amount": round(mortgage)}]
    for label, yearly in (("Council tax", council_tax), ("Service charge", service_charge_yearly),
                          ("Ground rent", ground_rent_yearly)):
        if yearly:
            parts.append({"label": label, "amount": round(yearly / 12)})
    duty = stamp_duty(price, assumptions["firstTime"], assumptions["additionalHome"])
    return {"type": "costs", "monthly": sum(part["amount"] for part in parts), "parts": parts,
            "upfront": [{"label": "Deposit", "amount": deposit}, {"label": "Stamp duty", "amount": duty["total"]}],
            "assumptions": dict(assumptions), "chips": chips}
