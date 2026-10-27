"""Attribution for per-home REST payloads (property, profile, address history, postcode homes).

The agent tools carry sources[] in their envelope; these v1 routes return the same source
rows (market_depth.source_rows: release, sourceUrl, licence, attribution text) plus the
publisher, for the active release's sources behind a home: HM Land Registry (sales, address
spine, INSPIRE parcel ids), OS Open UPRN (coordinates) and the EPC register (floor area,
building facts). DATA-LICENCES.md lists the same publishers.
"""
from typing import Any, Callable, Mapping

from .market_depth import source_rows

# Source release id prefix -> publisher (source_release has no publisher column).
HOME_PUBLISHERS = (
    ("src-hmlr-", "HM Land Registry"),
    ("src-os-open-uprn-", "Ordnance Survey"),
    ("src-mhclg-epc-", "Ministry of Housing, Communities and Local Government (EPC register)"),
    ("src-epc-", "Ministry of Housing, Communities and Local Government (EPC register)"),
)

HOME_SOURCES_SQL = """-- evidence:home-sources
SELECT s.id, s.source_url, s.licence, s.attribution, s.transformation_version
FROM active_product_release a
JOIN product_release_member m ON m.release_id = a.release_id
JOIN source_release s ON s.id = m.source_release_id
WHERE s.id LIKE ANY(%s)
ORDER BY s.id"""


def publisher(release_id: str) -> str | None:
    return next((name for prefix, name in HOME_PUBLISHERS if release_id.startswith(prefix)), None)


def home_sources(connection: Any) -> list[dict]:
    patterns = [f"{prefix}%" for prefix, _ in HOME_PUBLISHERS]
    return [{**row, "publisher": publisher(row["release"])}
            for row in source_rows(connection.execute(HOME_SOURCES_SQL, (patterns,)))]


def with_home_sources(connect: Callable[[], Any], payload: Mapping[str, Any]) -> dict:
    """The payload with a top-level `sources` list (one extra small query)."""
    with connect() as connection:
        return {**payload, "sources": home_sources(connection)}
