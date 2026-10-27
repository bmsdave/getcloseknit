"""Close Knit growth and money forecast (estimates, not data).

Run: python3 docs/growth-2026-10/forecast.py
Prints the month-by-month tables for year 1 (Nov 2026 - Oct 2027) and the yearly view to year 10
for three scenarios. Every number is an assumption from docs/growth-2026-10/strategy-12m.md;
change the inputs here and re-run when real numbers arrive (usage report, partner reports).
"""

MONTHS = ["Nov 26", "Dec 26", "Jan 27", "Feb 27", "Mar 27", "Apr 27",
          "May 27", "Jun 27", "Jul 27", "Aug 27", "Sep 27", "Oct 27"]

BUYER_SHARE = 0.30   # share of monthly users who are buying
MOVER_SHARE = 0.40   # share who move home soon (broadband, removals, survey)
RENTER_SHARE = 0.50  # share who rent (guarantor, renters insurance)
FEE = {"conveyancing": 300, "mortgage": 400, "small": 20, "renter": 35}

SCENARIOS = {
    "worst": {
        "odds": 0.45,
        "mau_k": [0.3, 0.6, 1, 1.5, 2, 2.5, 3, 3.3, 3.6, 3.7, 4.3, 5],
        "stick": (0.05, 0.07),
        "partners_from": 6, "small_from": 7, "renter_from": 9,
        "conv_rate": 0.001, "mortgage_rate": 0.0008, "small_rate": 0.002, "renter_rate": 0.0005,
        "agents": [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3], "agent_price": 80,
        "relocation": [0] * 12,
        "ads": [0, 200, 300, 300, 200, 200, 200, 200, 200, 100, 200, 200],
        "creators": [0, 100, 100, 100, 100, 100, 100, 100, 100, 0, 100, 100],
        "one_off": {1: 90, 5: 900},
    },
    "base": {
        "odds": 0.40,
        "mau_k": [1.5, 4, 8, 10, 12, 14, 16, 18, 19, 19.5, 22, 25],
        "stick": (0.06, 0.12),
        "partners_from": 4, "small_from": 5, "renter_from": 6,
        "conv_rate": 0.0015, "mortgage_rate": 0.001, "small_rate": 0.003, "renter_rate": 0.001,
        "agents": [0, 0, 0, 0, 0, 0, 0, 0, 3, 6, 9, 12], "agent_price": 100,
        "relocation": [0, 0, 0, 0, 0, 0, 0, 0, 0, 300, 300, 600],
        "ads": [0, 300, 600, 800, 800, 1000, 1000, 1200, 1200, 600, 1500, 1500],
        "creators": [0, 200, 300, 300, 300, 300, 300, 400, 400, 200, 400, 400],
        "one_off": {1: 90, 3: 900},
    },
    "best": {
        "odds": 0.15,
        "mau_k": [5, 15, 30, 38, 45, 52, 58, 64, 68, 70, 85, 100],
        "stick": (0.08, 0.15),
        "partners_from": 3, "small_from": 4, "renter_from": 5,
        "conv_rate": 0.002, "mortgage_rate": 0.0012, "small_rate": 0.004, "renter_rate": 0.0015,
        "agents": [0, 0, 0, 0, 0, 0, 5, 10, 18, 22, 30, 40], "agent_price": 120,
        "relocation": [0, 0, 0, 0, 0, 0, 0, 800, 800, 800, 1600, 1600],
        "ads": [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 3500, 2000, 4500, 5000],
        "creators": [0, 300, 500, 500, 600, 600, 700, 800, 800, 400, 800, 800],
        "one_off": {1: 90, 3: 900},
    },
}
INFRA = 100  # VPS, domain, tools per month

# Years 2-10 (Nov-Oct years): revenue and costs in £k, end-of-year monthly users in thousands.
YEARS = {
    "worst": {"revenue": [15, 30, 40, 50, 55, 60, 60, 60, 60],
              "costs": [6, 8, 8, 10, 10, 10, 10, 10, 10],
              "mau_k": [8, 10, 12, 14, 15, 16, 16, 16, 16]},
    "base": {"revenue": [180, 450, 750, 1100, 1500, 1900, 2400, 2900, 3400],
             "costs": [90, 300, 520, 750, 1000, 1250, 1550, 1850, 2150],
             "mau_k": [70, 150, 250, 350, 450, 550, 650, 780, 900]},
    "best": {"revenue": [1200, 3000, 5000, 7000, 9500, 12000, 15000, 17500, 20000],
             "costs": [1000, 2500, 3800, 5000, 6500, 8000, 9800, 11300, 12800],
             "mau_k": [400, 1000, 1700, 2500, 3200, 3800, 4300, 4700, 5000]},
}


def month_rows(s: dict) -> list[dict]:
    rows = []
    for i, name in enumerate(MONTHS):
        m = i + 1
        mau = s["mau_k"][i] * 1000
        lo, hi = s["stick"]
        dau = mau * (lo + (hi - lo) * i / 11)

        def mau_at(month: int) -> float:
            return s["mau_k"][month - 1] * 1000 if month >= 1 else 0.0

        conv = mau_at(m - 4) * BUYER_SHARE * s["conv_rate"] * FEE["conveyancing"] if m - 4 >= s["partners_from"] else 0
        mort = mau_at(m - 1) * BUYER_SHARE * s["mortgage_rate"] * FEE["mortgage"] if m - 1 >= s["partners_from"] else 0
        small = mau * MOVER_SHARE * s["small_rate"] * FEE["small"] if m >= s["small_from"] else 0
        renter = mau * RENTER_SHARE * s["renter_rate"] * FEE["renter"] if m >= s["renter_from"] else 0
        agents = s["agents"][i] * s["agent_price"]
        revenue = conv + mort + small + renter + agents + s["relocation"][i]
        spend = INFRA + s["ads"][i] + s["creators"][i] + s["one_off"].get(m, 0)
        rows.append({"month": name, "mau": mau, "dau": dau, "revenue": revenue, "spend": spend,
                     "referrals": conv + mort + small + renter, "b2b": agents + s["relocation"][i]})
    return rows


def money(x: float) -> str:
    return f"£{x / 1000:.1f}k" if x >= 1000 else f"£{x:.0f}"


def users(x: float) -> str:
    return f"{x / 1000:.1f}k" if x >= 1000 else f"{x:.0f}"


def main() -> None:
    for name, s in SCENARIOS.items():
        rows = month_rows(s)
        print(f"\n### Year 1 by month: {name} ({s['odds']:.0%})\n")
        print("| Month | MAU | DAU | Spend | Revenue | of it B2B | Net | Cumulative |")
        print("|---|---|---|---|---|---|---|---|")
        cum = 0.0
        for r in rows:
            net = r["revenue"] - r["spend"]
            cum += net
            print(f"| {r['month']} | {users(r['mau'])} | {users(r['dau'])} | {money(r['spend'])} | "
                  f"{money(r['revenue'])} | {money(r['b2b'])} | {money(net) if net >= 0 else '−' + money(-net)} | "
                  f"{money(cum) if cum >= 0 else '−' + money(-cum)} |")
        total_rev = sum(r["revenue"] for r in rows)
        total_spend = sum(r["spend"] for r in rows)
        print(f"\nYear 1 {name}: revenue {money(total_rev)}, spend {money(total_spend)}, "
              f"net {money(total_rev - total_spend)}")
    print("\n### Years 1-10 (revenue / costs / profit, £k; users at year end)\n")
    print("| Year | " + " | ".join(f"{n} ({SCENARIOS[n]['odds']:.0%})" for n in SCENARIOS) + " |")
    print("|---|" + "---|" * len(SCENARIOS))
    y1 = {n: month_rows(s) for n, s in SCENARIOS.items()}
    for year in range(1, 11):
        cells = []
        for n in SCENARIOS:
            if year == 1:
                rev = sum(r["revenue"] for r in y1[n]) / 1000
                cost = sum(r["spend"] for r in y1[n]) / 1000
                mau = y1[n][-1]["mau"] / 1000
            else:
                rev, cost, mau = (YEARS[n]["revenue"][year - 2], YEARS[n]["costs"][year - 2],
                                  YEARS[n]["mau_k"][year - 2])
            cells.append(f"£{rev:,.0f}k / £{cost:,.0f}k / £{rev - cost:,.0f}k · {mau:,.0f}k MAU")
        print(f"| {year} | " + " | ".join(cells) + " |")
    for year in (5, 10):
        ev = sum(SCENARIOS[n]["odds"] * YEARS[n]["revenue"][year - 2] for n in SCENARIOS)
        print(f"\nProbability-weighted revenue, year {year}: £{ev:,.0f}k")


if __name__ == "__main__":
    main()
