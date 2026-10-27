"""Coverage for the deploy ETLs: English LADs, regions and boxes (see area_analytics.coverage).

    import area_coverage as coverage   # not "coverage": that name is the coverage.py package
    cov = coverage.from_env()            # CLOSE_KNIT_ETL_COVERAGE=england (default) | london
    cov.lad_codes / cov.bbox_wgs84 / cov.bbox_bng / cov.contains_point(lon, lat)
    coverage.regional_percentiles(values, coverage.load_area_regions(cur))

Use this instead of hard-coded E09 lists, "E12000007" and London bboxes.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))
from area_analytics.coverage import *  # noqa: E402,F401,F403
