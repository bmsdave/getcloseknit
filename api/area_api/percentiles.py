"""One London percentile rule for ETL, API and SQL (issue #221).

Competition ranking, the rule rank_areas_by_metric uses for ranks (#220): an area's
percentile is the share of ranked areas strictly below it, 100 * below / (n - 1), so
every member of a tie shares the lowest position in the group and the ends are 0 and
100. This is SQL percent_rank() (migrations 054 and 086), so stored and query-time
percentiles agree. Areas without a value get none. A metric on which every area is
equal is all 0; standouts.london_rank keeps its mid-rank standing with strict bounds
for the area tags, which need "better than 90%" rather than a percentile.

Stdlib only: deploy/tools/crime_rates.py imports it on the ETL host, where the api
package is not installed.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping


def competition_percentiles(values: Mapping[str, float | None]) -> dict[str, int]:
    """{key: 0-100} ascending (0 = lowest value); tied values share a percentile."""
    ordered = sorted(value for value in values.values() if value is not None)
    if len(ordered) < 2:
        return {key: 0 for key, value in values.items() if value is not None}
    first: dict[float, int] = {}
    for position, value in enumerate(ordered):
        first.setdefault(value, position)
    scale = 100 / (len(ordered) - 1)
    return {key: round(first[value] * scale) for key, value in values.items() if value is not None}


def regional_percentiles(values: Mapping[str, float | None], region_of: Mapping[str, str] | None = None,
                         rank: Callable[[Mapping[str, float | None]], dict[str, int]] = competition_percentiles
                         ) -> dict[str, int]:
    """`rank` within each area's region (England: migration 103's area_region), so a London area keeps its
    London percentile. Without a region map (London only, or before the table exists) one ranking for all;
    areas the map does not know are ranked together."""
    if not region_of:
        return rank(values)
    groups: dict[str | None, dict[str, float | None]] = {}
    for key, value in values.items():
        groups.setdefault(region_of.get(key), {})[key] = value
    out: dict[str, int] = {}
    for group in groups.values():
        out.update(rank(group))
    return out
