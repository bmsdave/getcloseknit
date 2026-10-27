"""Council tax bands for an area (migration 082): how many homes sit in each band A-H, the most common and
the middle band, the mean band (A = 1 ... H = 8) against London areas of the same kind, and a typical bill:
the middle home's band ratio × the borough's average Band D (council_tax, migration 019).

VOA Council Tax: stock of properties (CTSOP1.1) per LSOA; MSOAs and boroughs are sums of their LSOAs.
Aggregates about homes on the valuation list, never one home's band: VOA publishes no open bulk file of
those (FLAGS.md).
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction
from typing import Any

from . import envelope, evidence, schools

SCHEMA_VERSION = "area-council-tax.v1"
METRIC_ID = "council-tax-band-mean"
BANDS = "ABCDEFGH"
# Council Tax: the statutory proportion of Band D for each band (Local Government Finance Act 1992, s5).
RATIO = dict(zip(BANDS, (Fraction(n, 9) for n in (6, 7, 8, 9, 11, 13, 15, 18))))
MIN_HOMES = 50  # fewer homes than this: no mean band (as the map metric)
CAVEATS = [
    "Homes on the VOA valuation list at 31 March 2025, rounded by VOA to the nearest 10.",
    "Bands come from 1991 values (England), not today's prices; a home's own band is on the VOA's "
    "council tax search.",
    "The typical bill is the middle home's band at the borough's average Band D, parish precepts included; "
    "discounts and exemptions are not.",
]

WEIGHTED = " + ".join(f"{i + 1} * t.band_{band.lower()}" for i, band in enumerate(BANDS))
BANDS_SQL = f"""-- evidence:council-tax-bands
SELECT * FROM (
  SELECT t.*, g.kind::text AS kind,
    round(100 * percent_rank() OVER (PARTITION BY rr.region_code, g.kind ORDER BY ({WEIGHTED})::float8 / t.total))::int AS region_percentile
  FROM area_council_tax_band t JOIN area_geography g ON g.id = t.geography_id
  LEFT JOIN area_region rr ON rr.area_id = g.id
  WHERE t.total > 0) x
WHERE geography_id = %s"""

# The borough the area sits in (itself for a borough) and its latest average Band D.
BOROUGH_SQL = """-- evidence:council-tax-borough
SELECT b.id, b.name, c.financial_year, c.band_d, c.source_release_id
FROM area_geography g
LEFT JOIN area_geography m ON m.id = g.parent_id
JOIN area_geography b ON b.id = CASE g.kind WHEN 'lad' THEN g.id WHEN 'msoa' THEN g.parent_id ELSE m.parent_id END
LEFT JOIN LATERAL (SELECT financial_year, band_d, source_release_id FROM council_tax
                   WHERE 'uk:lad:' || borough_code = b.id ORDER BY financial_year DESC LIMIT 1) c ON true
WHERE g.id = %s"""

SOURCES_SQL = """-- evidence:council-tax-sources
SELECT s.id, s.source_url, s.licence, s.attribution FROM source_release s WHERE s.id = ANY(%s) ORDER BY s.id"""


def bill(band: str, band_d: float) -> int:
    """A year's bill in whole pounds for `band` at this Band D."""
    return int((Decimal(str(band_d)) * RATIO[band].numerator / RATIO[band].denominator)
               .quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _one(connection: Any, sql: str, area_id: str) -> Mapping[str, Any] | None:
    rows = list(connection.execute(sql, (area_id,)))
    return rows[0] if rows else None


def council_tax_value(connection: Any, area_id: str) -> dict | None:
    """The band block for one area, or None when migration 082 is not applied or nothing is loaded.
    A savepoint keeps a missing table from poisoning the caller's transaction."""
    try:
        savepoint = getattr(connection, "transaction", None)
        if savepoint is not None:
            with savepoint():
                return _value(connection, area_id)
        return _value(connection, area_id)
    except Exception:  # noqa: BLE001 - an unloaded layer is a normal state, not an error
        return None


def _value(connection: Any, area_id: str) -> dict | None:
    row = _one(connection, BANDS_SQL, area_id)
    if not row or not row["total"]:
        return None
    counts = [int(row[f"band_{band.lower()}"]) for band in BANDS]
    total = int(row["total"])
    most_common = BANDS[counts.index(max(counts))]  # a tie names the lower band
    running, median = 0, BANDS[-1]
    for band, homes in zip(BANDS, counts):
        running += homes
        if 2 * running >= total:
            median = band
            break
    weighted = sum((i + 1) * homes for i, homes in enumerate(counts))
    mean = float((Decimal(weighted) / Decimal(total)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    borough = _one(connection, BOROUGH_SQL, area_id)
    band_d = borough.get("band_d") if borough else None
    period = str(row["period"])[:7]
    return {
        "geographyId": area_id,
        "period": period,
        "bands": [{"band": band, "homes": homes, "share": round(homes / total, 4)} for band, homes in zip(BANDS, counts)],
        "homes": total,
        "mostCommon": most_common,
        "medianBand": median,
        "meanBand": mean if total >= MIN_HOMES else None,
        "regionPercentile": row["region_percentile"] if total >= MIN_HOMES else None,
        "borough": {"id": borough["id"], "name": borough["name"]} if borough else None,
        "typicalBill": None if band_d is None else {
            "band": median, "amount": bill(median, float(band_d)), "bandD": float(band_d),
            "financialYear": borough["financial_year"]},
        # The VOA bands first, then the borough's Band D.
        "sourceVersions": [row["source_release_id"]] + (
            [borough["source_release_id"]] if borough and borough.get("source_release_id") else []),
    }


def area_council_tax(reader: evidence.EvidenceReader, area_id: str, cancel: Callable[[], bool] | None = None) -> dict:
    """area-council-tax.v1 for one LSOA, MSOA or borough; value is null before the bands are loaded."""
    evidence._check_cancelled(cancel)
    if not schools.AREA_PATTERN.match(area_id or ""):
        raise evidence.MalformedQuery(f"invalid area id: {area_id}")
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        if not list(connection.execute(schools.AREA_EXISTS_SQL, (area_id,))):
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        value = council_tax_value(connection, area_id)
        sources = [{"release": row["id"], "sourceUrl": row["source_url"], "licence": row["licence"],
                    "attribution": row["attribution"]}
                   for row in connection.execute(SOURCES_SQL, (value["sourceVersions"],))] if value else []
    observed = value is not None and value["meanBand"] is not None
    rows = [{"kind": "metric-observation", "geographyId": area_id, "metricId": METRIC_ID, "period": value["period"],
             "value": value["meanBand"], "quality": "observed" if observed else "suppressed",
             "sampleCount": value["homes"], "regionPercentile": value["regionPercentile"],
             "sourceVersion": value["sourceVersions"][0]}] if value else []
    return envelope.wrap(value, schema_version=SCHEMA_VERSION, release_id=release_id,
                         confidence="high" if observed else "none", evidence=rows, sources=sources, caveats=CAVEATS)
