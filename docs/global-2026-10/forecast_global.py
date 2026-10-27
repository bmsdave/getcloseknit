"""Close Knit "most likely" forecast, London alone and London + global layer (estimates, not data).

Run: python3 docs/global-2026-10/forecast_global.py
Reuses the model in docs/growth-2026-10/forecast.py with the inputs from docs/global-2026-10/strategy.md
(assessment of 2026-10-20). Change the inputs and re-run when real numbers arrive.
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "growth-2026-10"))
import forecast as f  # noqa: E402

# London, most likely: site public in Jan 2027, search traffic ramps in the second half.
LONDON = {
    "odds": 1.0,
    "mau_k": [0.1, 0.3, 1.5, 1.4, 2.0, 2.5, 3.2, 3.8, 4.2, 4.0, 5.5, 7.0],
    "stick": (0.05, 0.08),
    "partners_from": 6, "small_from": 6, "renter_from": 8,
    "conv_rate": 0.001, "mortgage_rate": 0.0006, "small_rate": 0.002, "renter_rate": 0.0005,
    "agents": [0] * 10 + [1, 2], "agent_price": 80,
    "relocation": [0] * 12,
    "ads": [0, 0, 200, 300, 300, 300, 300, 300, 300, 100, 400, 400],
    "creators": [0, 0, 100, 100, 100, 100, 100, 100, 100, 0, 100, 100],
    "one_off": {1: 90, 3: 900},
}
# With the global layer the owner's attention is split: London partners start a month later.
LONDON_WITH_GLOBAL = {**LONDON, "partners_from": 7, "small_from": 7, "renter_from": 9}

# Global layer: MVP built Nov-Dec, public with the site in Jan; country/city pages ramp slowly in search.
GLOBAL_MAU_K = [0, 0, 0.3, 0.6, 1.0, 1.5, 2.2, 3.0, 3.8, 4.5, 6.0, 8.0]
PAGES_PER_VISITOR = 2.5
EXPAT_PER_VISITOR = 0.006  # £: ~2% click a partner, ~10% sign up, ~£30 (Wise, HousingAnywhere, eSIM)
EXPAT_FROM = 6             # month: expat partners from Apr 2027
ADS_RPM = 3.0              # £ per 1000 pages, contextual only
ADS_MIN_PAGES_K = 100      # CLOSE_KNIT_DISPLAY_ADS goes on only from 100k pages a month
API_B2B = [0] * 11 + [300]  # first paid API or relocation pilot
GLOBAL_COST = [0, 50, 550, 50, 50, 50, 50, 50, 50, 50, 50, 50]  # tiles/storage; licence check in Jan


def global_revenue(i: int) -> float:
    visitors = GLOBAL_MAU_K[i] * 1000
    pages_k = GLOBAL_MAU_K[i] * PAGES_PER_VISITOR
    expat = visitors * EXPAT_PER_VISITOR if i + 1 >= EXPAT_FROM else 0
    ads = pages_k * ADS_RPM if pages_k >= ADS_MIN_PAGES_K else 0
    return expat + ads + API_B2B[i]


def main() -> None:
    for title, london, with_global in (("London only", LONDON, False),
                                       ("London + global", LONDON_WITH_GLOBAL, True)):
        print(f"\n### Year 1, most likely: {title}\n")
        print("| Month | London MAU | Global MAU | Spend | London revenue | Global revenue | Cumulative |")
        print("|---|---|---|---|---|---|---|")
        cum = total_london = total_global = total_spend = 0.0
        for i, r in enumerate(f.month_rows(london)):
            g_rev = global_revenue(i) if with_global else 0
            spend = r["spend"] + (GLOBAL_COST[i] if with_global else 0)
            cum += r["revenue"] + g_rev - spend
            total_london, total_global, total_spend = (total_london + r["revenue"], total_global + g_rev,
                                                       total_spend + spend)
            g_mau = f.users(GLOBAL_MAU_K[i] * 1000) if with_global else "—"
            print(f"| {r['month']} | {f.users(r['mau'])} | {g_mau} | {f.money(spend)} | {f.money(r['revenue'])} | "
                  f"{f.money(g_rev)} | {f.money(cum) if cum >= 0 else '−' + f.money(-cum)} |")
        net = total_london + total_global - total_spend
        print(f"\nYear 1 {title}: revenue {f.money(total_london + total_global)} "
              f"(London {f.money(total_london)}, global {f.money(total_global)}), spend {f.money(total_spend)}, "
              f"net {f.money(net) if net >= 0 else '−' + f.money(-net)}")


if __name__ == "__main__":
    main()
