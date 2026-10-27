"""The area price tables London builds in SQL from per-home rows, rebuilt in Python from postcode-placed sales.

Each function mirrors one London build so England's rows mean the same thing (file:function it ports):
  price_index_rows    etl_price_release.build + price_index (the £/m² metric, LSOA -> MSOA -> borough
                      fallback under 20 sales, ranked within the region)
  growth_rows         095 rebuild_area_price_growth / price_growth_window
  price_band_rows     103 rebuild_area_price_bands (same-carrier restatement, typical-price layers)
  type_price_rows     020 rebuild_area_type_prices
  market_depth_rows   095 rebuild_market_depth (dwellings: VOA CTSOP homes, not the London UPRN list)
  zone_rows           057 rebuild_zone_analytics (sector, district and borough £/m² index and distribution;
                      street names from OS Open Names instead of London's address spine)
Rounding follows Postgres: round(double precision) is half-to-even (Python round), round(numeric) is
half-away-from-zero (numeric_round).

A sale here is a `Sale` tuple from sales.tsv.gz (etl_england_prices.py link). Stdlib only.
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from statistics import median
from typing import NamedTuple

MINIMUM_SAMPLE = 20            # price_index.MINIMUM_SAMPLE
WINDOW_MONTHS = 12             # price_index.WINDOW_MONTHS
TYPES = ("D", "S", "T", "F")


class Sale(NamedTuple):
    lsoa: str            # official code, E01...
    day: date
    month: int           # year * 12 + month - 1
    price: int
    ptype: str           # D/S/T/F/O
    new_build: bool
    tenure: str          # F/L/U
    category: str        # A/B
    floor: float | None
    postcode: str        # formatted, "TS24 7AB"
    dwelling: str
    street: str


def month_index(day: date) -> int:
    return day.year * 12 + day.month - 1


def index_day(index: int) -> date:
    return date(index // 12, index % 12 + 1, 1)


def ppm_of(price: int, floor: float | None) -> float | None:
    """load_sales (097): price / floor when the floor is 15-1,000 m² and the result £500-£40,000."""
    if not floor or not 15 <= floor <= 1000:
        return None
    value = price / floor
    return round(value, 2) if 500 <= value <= 40000 else None


def qualifies(sale: Sale) -> bool:
    """price_index.qualifies: the gates of the £/m² index."""
    if sale.category != "A" or sale.ptype == "O" or not sale.floor:
        return False
    if not 15 <= sale.floor <= 1000 or sale.price < 20_000:
        return False
    return 500 <= sale.price / sale.floor <= 40_000


def percentile_cont(ordered: list[float], q: float) -> float:
    """Postgres percentile_cont on sorted values."""
    position = q * (len(ordered) - 1)
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def round_numeric(value: float, places: int = 0) -> float:
    """Postgres round(numeric, n): half away from zero."""
    quantum = Decimal(1).scaleb(-places)
    return float(Decimal(repr(value)).quantize(quantum, rounding=ROUND_HALF_UP))


class Areas:
    """Ids and parents: LSOA code -> (MSOA code, LAD code), the region of each id."""

    def __init__(self, lookup: Mapping[str, tuple[str, str]], region_of_lad: Callable[[str], str | None]):
        self.lookup = lookup
        self.region_of_lad = region_of_lad
        self.msoa_lad = {msoa: lad for msoa, lad in lookup.values()}

    def parents(self, lsoa: str) -> tuple[str, str]:
        msoa, lad = self.lookup[lsoa]
        return f"uk:msoa:{msoa}", f"uk:lad:{lad}"

    def region(self, geography_id: str) -> str | None:
        kind, code = geography_id.split(":")[1:]
        if kind == "borough":
            return self.region_of_lad(code)
        if kind == "msoa":
            lad = self.msoa_lad.get(code)
        else:
            lad = self.lookup.get(code, (None, None))[1]
        return self.region_of_lad(lad) if lad else None


def competition_percentiles(values: Mapping[str, float]) -> dict[str, int]:
    """Ascending 0-100, ties share one (round(100 * percent_rank()))."""
    ordered = sorted(values.values())
    if len(ordered) < 2:
        return {key: 0 for key in values}
    first: dict[float, int] = {}
    for position, value in enumerate(ordered):
        first.setdefault(value, position)
    scale = 100 / (len(ordered) - 1)
    return {key: round(first[value] * scale) for key, value in values.items()}


def regional_percentiles(values: Mapping[str, float | None], region: Callable[[str], str | None]) -> dict[str, int]:
    groups: dict[str | None, dict[str, float]] = defaultdict(dict)
    for key, value in values.items():
        if value is not None:
            groups[region(key)][key] = value
    out: dict[str, int] = {}
    for group in groups.values():
        out.update(competition_percentiles(group))
    return out


# --- £/m² index --------------------------------------------------------------------------------

class Series:
    """price_index.Series: one area's (month, £/m²) sorted, for window medians."""

    def __init__(self, sales: list[tuple[int, float]]):
        sales.sort()
        self.months = [m for m, _ in sales]
        self.values = [v for _, v in sales]

    def window(self, end: int) -> list[float]:
        return self.values[bisect_left(self.months, end - WINDOW_MONTHS + 1):bisect_right(self.months, end)]


EMPTY = Series([])


def carrier_value(own: list[float], parents: list[tuple[str, list[float]]]):
    """price_index.carrier_value: (value, own n, quality, carrier id, carrier n)."""
    if len(own) >= MINIMUM_SAMPLE:
        return round(median(own), 2), len(own), "observed", None, None
    for carrier_id, sample in parents:
        if len(sample) >= MINIMUM_SAMPLE:
            return round(median(sample), 2), len(own), "fallback", carrier_id, len(sample)
    return None, len(own), "suppressed", None, None


def index_series(sales: Iterable[Sale], areas: Areas, first: int) -> dict[str, dict[str, Series]]:
    """Qualifying sales per LSOA, MSOA and LAD (ids), from the month before the first window."""
    found: dict[str, dict[str, list]] = {"lsoa": defaultdict(list), "msoa": defaultdict(list),
                                         "borough": defaultdict(list)}
    for sale in sales:
        if sale.month < first - WINDOW_MONTHS + 1 or not qualifies(sale) or sale.lsoa not in areas.lookup:
            continue
        point = (sale.month, sale.price / sale.floor)
        msoa, lad = areas.parents(sale.lsoa)
        found["lsoa"][f"uk:lsoa:{sale.lsoa}"].append(point)
        found["msoa"][msoa].append(point)
        found["borough"][lad].append(point)
    return {kind: {gid: Series(points) for gid, points in by.items()} for kind, by in found.items()}


def price_index_rows(series: Mapping[str, Mapping[str, Series]], areas: Areas, periods: Iterable[int]):
    """metric_value cells (gid, period, value, percentile|None, n, quality, carrier id, carrier n) for every
    English LSOA, MSOA and LAD in each period; LSOA percentiles within the region."""
    lsoas = sorted(areas.lookup)
    msoas = sorted({msoa for msoa, _ in areas.lookup.values()})
    msoa_lad = {msoa: lad for msoa, lad in areas.lookup.values()}
    lads = sorted(set(msoa_lad.values()))
    s_lsoa, s_msoa, s_lad = series["lsoa"], series["msoa"], series["borough"]
    for index in periods:
        cells = {}
        for code in lsoas:
            msoa, lad = areas.parents(code)
            own = s_lsoa.get(f"uk:lsoa:{code}", EMPTY).window(index)
            if len(own) >= MINIMUM_SAMPLE:
                cells[f"uk:lsoa:{code}"] = carrier_value(own, [])
                continue
            cells[f"uk:lsoa:{code}"] = carrier_value(own, [(msoa, s_msoa.get(msoa, EMPTY).window(index)),
                                                           (lad, s_lad.get(lad, EMPTY).window(index))])
        for code in msoas:
            lad = f"uk:lad:{msoa_lad[code]}"
            cells[f"uk:msoa:{code}"] = carrier_value(s_msoa.get(f"uk:msoa:{code}", EMPTY).window(index),
                                                     [(lad, s_lad.get(lad, EMPTY).window(index))])
        for code in lads:
            cells[f"uk:lad:{code}"] = carrier_value(s_lad.get(f"uk:lad:{code}", EMPTY).window(index), [])
        ranks = regional_percentiles({gid: cell[0] for gid, cell in cells.items() if gid.startswith("uk:lsoa:")},
                                     areas.region)
        period = index_day(index)
        for gid, (value, n, quality, carrier, carrier_n) in cells.items():
            yield gid, period, value, ranks.get(gid), n, quality, carrier, carrier_n


def growth_window(now, base) -> tuple[float | None, str | None, int | None]:
    """095 price_growth_window on (value, quality, carrier, n) cells."""
    if base is None or base[0] is None or base[0] <= 0:
        return None, None, None
    counts = [count for count in (now[3], base[3]) if count is not None]
    n = min(counts) if counts else None  # Postgres least() ignores NULLs
    if now[1] == "observed" and base[1] == "observed":
        return round_numeric(100 * (now[0] / base[0] - 1), 1), "observed", n
    if now[1] == "fallback" and base[1] == "fallback" and now[2] is not None and now[2] == base[2]:
        return round_numeric(100 * (now[0] / base[0] - 1), 1), "fallback", n
    return None, "mixed", n


def growth_rows(cells: Mapping[tuple[str, int], tuple], latest: int):
    """area_price_growth rows: (gid, period, then (growth, quality, n) for 1, 3, 5, 10 and 20 years).

    `cells` maps (gid, month index) -> (value, quality, carrier, carrier n) for values > 0 (095 passes
    carrier_sample_count, NULL on observed rows)."""
    gids = sorted({gid for gid, index in cells if index == latest})
    for gid in gids:
        now = cells[(gid, latest)]
        out = [gid, index_day(latest)]
        for years in (1, 3, 5, 10, 20):
            out.extend(growth_window(now, cells.get((gid, latest - 12 * years))))
        yield tuple(out)


# --- typical price bands -------------------------------------------------------------------------

def price_band_rows(sales: Iterable[Sale], areas: Areas, cells: Mapping[tuple[str, int], tuple],
                    latest: int, first: int):
    """103 rebuild_area_price_bands: in-window sales restated to `latest` by their LSOA's £/m² index when
    both ends are observed, or fallbacks from the same carrier. Returns (band rows, adjusted count, window count).
    Band row: (gid, type '*'|D|S|T|F, window_start, period, sales, p10, p25, p50, p75, p90)."""
    window_start = month_index(date(index_day(latest).year - 3, 1, 1))
    groups: dict[tuple[str, str], list[float]] = defaultdict(list)
    in_window = adjusted = 0
    for sale in sales:
        if (sale.category != "A" or sale.ptype not in TYPES or sale.price < 20000
                or not window_start <= sale.month <= latest or sale.lsoa not in areas.lookup):
            continue
        in_window += 1
        gid = f"uk:lsoa:{sale.lsoa}"
        at = cells.get((gid, max(sale.month, first)))
        now = cells.get((gid, latest))
        if at is None or now is None or not at[0] or not now[0] or not 0.25 <= now[0] / at[0] <= 6:
            continue
        same = (at[1] == "observed" and now[1] == "observed") or (
            at[1] == "fallback" and now[1] == "fallback" and at[2] is not None and at[2] == now[2])
        if not same:
            continue
        adjusted += 1
        price = sale.price * now[0] / at[0]
        msoa, lad = areas.parents(sale.lsoa)
        for geography in (gid, msoa, lad):
            groups[(geography, sale.ptype)].append(price)
            groups[(geography, "*")].append(price)
    rows = []
    start, period = index_day(window_start), index_day(latest)
    for (gid, ptype), prices in sorted(groups.items()):
        prices.sort()
        rows.append((gid, ptype, start, period, len(prices),
                     *(round(percentile_cont(prices, q)) for q in (0.1, 0.25, 0.5, 0.75, 0.9))))
    return rows, adjusted, in_window


TYPICAL_KINDS = (("*", "typical-price"), ("F", "typical-price-flat"), ("T", "typical-price-terraced"),
                 ("S", "typical-price-semi"), ("D", "typical-price-detached"))


def typical_price_rows(bands: Iterable[tuple], areas: Areas, period: date):
    """The typical-price layers: an LSOA's band median with 20+ sales, else its MSOA's (20+), else its
    borough's (5+); ranked within the region. Row: (gid, metric, period, value, pct, n, quality)."""
    band = {(row[0], row[1]): (row[4], row[7]) for row in bands}
    chosen = []
    for code in sorted(areas.lookup):
        gid = f"uk:lsoa:{code}"
        msoa, lad = areas.parents(code)
        for ptype, metric in TYPICAL_KINDS:
            own, mid, wide = band.get((gid, ptype)), band.get((msoa, ptype)), band.get((lad, ptype))
            if own and own[0] >= 20:
                chosen.append((gid, metric, own[1], own[0], "observed"))
            elif mid and mid[0] >= 20:
                chosen.append((gid, metric, mid[1], mid[0], "fallback"))
            elif wide and wide[0] >= 5:
                chosen.append((gid, metric, wide[1], wide[0], "fallback"))
            else:
                chosen.append((gid, metric, None, own[0] if own else 0, "suppressed"))
    ranks: dict[tuple[str, str], int] = {}
    for _ptype, metric in TYPICAL_KINDS:
        values = {gid: value for gid, m, value, _n, _q in chosen if m == metric and value is not None}
        for gid, pct in regional_percentiles(values, areas.region).items():
            ranks[(gid, metric)] = pct
    for gid, metric, value, n, quality in chosen:
        yield gid, metric, period, value, ranks.get((gid, metric)), n, quality


# --- price by type (borough 30 years, MSOA 36 months) ----------------------------------------------

def type_price_rows(sales: Iterable[Sale], areas: Areas, latest: int):
    """020 rebuild_area_type_prices. Row: (gid, type, years_back, window_months, window_end, sales,
    median_price, ppm_sales, p25_ppm, median_ppm, p75_ppm)."""
    groups: dict[tuple, tuple[list[int], list[float]]] = defaultdict(lambda: ([], []))
    for sale in sales:
        if sale.category != "A" or sale.month > latest or sale.lsoa not in areas.lookup:
            continue
        back = latest - sale.month
        if back >= 360:
            continue
        msoa, lad = areas.parents(sale.lsoa)
        ppm = ppm_of(sale.price, sale.floor)
        keys = [(lad, sale.ptype, back // 12, 12), (lad, "*", back // 12, 12)]
        if back < 36:
            keys += [(msoa, sale.ptype, 0, 36), (msoa, "*", 0, 36)]
        for key in keys:
            prices, ppms = groups[key]
            prices.append(sale.price)
            if ppm is not None:
                ppms.append(ppm)
    for (gid, ptype, years_back, months), (prices, ppms) in sorted(groups.items()):
        prices.sort()
        ppms.sort()
        quart = [round(percentile_cont(ppms, q), 2) for q in (0.25, 0.5, 0.75)] if ppms else [None, None, None]
        yield (gid, ptype, years_back, months, index_day(latest - 12 * years_back), len(prices),
               round(percentile_cont(prices, 0.5)), len(ppms), *quart)


# --- local market depth (LSOA, MSOA) --------------------------------------------------------------

def market_depth_rows(sales: Iterable[Sale], areas: Areas, period_end: date, dwellings: Mapping[str, int],
                      growth: Mapping[str, tuple]):
    """095 rebuild_market_depth with VOA CTSOP homes as the dwellings (London counts its UPRN list).
    Row: (gid, period_end, sales_12m, dwellings, dwellings_sold_12m, turnover_percent, tenure_known_12m,
    leasehold_share, new_build_n, resale_n, new_build_median, resale_median, premium, growth_period,
    then growth/quality/n for 1, 3, 5 and 10 years)."""
    def months_before(day: date, months: int) -> date:
        index = month_index(day) - months
        return date(index // 12, index % 12 + 1, min(day.day, 28 if index % 12 + 1 == 2 else 30
                                                     if index % 12 + 1 in (4, 6, 9, 11) else 31))

    start_36, start_12 = months_before(period_end, 36), months_before(period_end, 12)
    stats: dict[str, dict] = defaultdict(lambda: {"n12": 0, "known": 0, "lease": 0, "nb": [], "rs": [],
                                                  "sold": set()})
    for sale in sales:
        if sale.category != "A" or sale.day <= start_36 or sale.lsoa not in areas.lookup:
            continue
        in_12 = sale.day > start_12
        ppm = ppm_of(sale.price, sale.floor)
        msoa, _lad = areas.parents(sale.lsoa)
        for gid in (f"uk:lsoa:{sale.lsoa}", msoa):
            area = stats[gid]
            if in_12:
                area["n12"] += 1
                area["known"] += sale.tenure in ("F", "L")
                area["lease"] += sale.tenure == "L"
                area["sold"].add(sale.dwelling)
            if ppm is not None:
                (area["nb"] if sale.new_build else area["rs"]).append(ppm)
    for gid in sorted(set(stats) | set(dwellings)):
        area = stats.get(gid) or {"n12": 0, "known": 0, "lease": 0, "nb": [], "rs": [], "sold": set()}
        homes = dwellings.get(gid, 0)
        sold = min(len(area["sold"]), homes) if homes else 0
        nb, rs = sorted(area["nb"]), sorted(area["rs"])
        nb_median = percentile_cont(nb, 0.5) if nb else None
        rs_median = percentile_cont(rs, 0.5) if rs else None
        g = growth.get(gid)
        yield (gid, period_end, area["n12"], homes, sold,
               round_numeric(100.0 * sold / homes, 2) if homes > 0 else None,
               area["known"], round_numeric(area["lease"] / area["known"], 3) if area["known"] else None,
               len(nb), len(rs),
               round(nb_median) if len(nb) >= 10 else None, round(rs_median) if len(rs) >= 10 else None,
               round_numeric(100 * (nb_median / rs_median - 1), 1)
               if len(nb) >= 10 and len(rs) >= 10 and rs_median > 0 else None,
               *(g[1:14] if g else (None,) * 13))


# --- postcode sector / district zones --------------------------------------------------------------

def zone_rows(sales: Iterable[Sale], areas: Areas, latest: int, cpih: Mapping[date, float],
              street_names: Mapping[str, Mapping[str, str]]):
    """057 rebuild_zone_analytics' three tables. Returns (distribution, index, street) row lists.
    `street_names`: {postcode district: {UPPER NAME: Name}} (OS Open Names)."""
    recent24: dict[tuple[str, str], list[float]] = defaultdict(list)
    yearly: dict[tuple[str, str, str, int], list[float]] = defaultdict(list)
    streets: dict[tuple[str, str], tuple[list[float], list[float]]] = defaultdict(lambda: ([], []))
    latest_day = index_day(latest)
    for sale in sales:
        if sale.category != "A" or sale.ptype not in TYPES or sale.month > latest:
            continue
        ppm = ppm_of(sale.price, sale.floor)
        if ppm is None or " " not in sale.postcode or sale.lsoa not in areas.lookup:
            continue
        sector, district = sale.postcode[:-2], sale.postcode.split(" ")[0]
        back = latest - sale.month
        year = latest_day.year - back // 12
        kind = "flat" if sale.ptype == "F" else "house"
        if back < 24:
            recent24[("sector", sector)].append(ppm)
            recent24[("district", district)].append(ppm)
        if year >= 2004:
            lad = areas.parents(sale.lsoa)[1]
            for zone in (("sector", sector), ("district", district), ("borough", lad)):
                yearly[(*zone, "all", year)].append(ppm)
                yearly[(*zone, kind, year)].append(ppm)
        if back < 60:
            name = street_names.get(district, {}).get(sale.street)
            if name:
                floors, ppms = streets[(sector, name)]
                floors.append(sale.floor)
                ppms.append(ppm)
    distribution = []
    for (kind, code), values in sorted(recent24.items()):
        if len(values) < 20:
            continue
        values.sort()
        p = [percentile_cont(values, q) for q in (0.01, 0.09, 0.25, 0.5, 0.75, 0.91, 0.99)]
        counts = [0] * 20
        for value in values:
            if p[6] > p[0]:
                bucket = int((value - p[0]) * 20 / (p[6] - p[0])) + 1 if value >= p[0] else 0
                bucket = min(max(bucket, 1), 20)
            else:
                bucket = 1
            counts[bucket - 1] += 1
        edges = [round(p[0] + i * (p[6] - p[0]) / 20) for i in range(21)]
        distribution.append((kind, code, latest_day, len(values), *(round(x) for x in p[1:6]), edges, counts))
    cpi_years: dict[int, list[float]] = defaultdict(list)
    for month, value in cpih.items():
        if month_index(month) <= latest:
            cpi_years[latest_day.year - (latest - month_index(month)) // 12].append(value)
    cpi = {year: sum(values) / len(values) for year, values in cpi_years.items()}
    medians = {key: (len(values), percentile_cont(sorted(values), 0.5)) for key, values in yearly.items()}
    index_rows = []
    for (kind, code, group, year), (n, middle) in sorted(medians.items()):
        base = medians.get((kind, code, group, 2004))
        nominal = 100 * middle / base[1] if n >= 10 and base and base[0] >= 10 else None
        deflator = cpi[year] / cpi[2004] if year in cpi and 2004 in cpi else None
        index_rows.append((kind, code, group, year, n, round(middle),
                           round_numeric(nominal, 1) if nominal is not None else None,
                           round_numeric(nominal / deflator, 1) if nominal is not None and deflator else None))
    street_rows = []
    for (sector, name), (floors, ppms) in sorted(streets.items()):
        if len(ppms) >= 5:
            street_rows.append((sector, name, len(ppms), round(percentile_cont(sorted(floors), 0.5)),
                                round(percentile_cont(sorted(ppms), 0.5))))
    return distribution, index_rows, street_rows
