"""conftest.py's per-test resets for plain unittest runs (gate.sh runs `python -m unittest discover`, which never
reads conftest.py). Discovery imports this module first (sorted names), so every TestCase run afterwards starts with
an empty area -> region map and a fresh rate limiter, as under pytest. No tests here."""
import unittest

from area_api import regions

try:
    import area_api.app as app_module
except ImportError:  # pragma: no cover - API extras not installed; the HTTP tests skip
    app_module = None

_run = unittest.TestCase.run


def _isolated_run(self, result=None):
    regions.set_for_tests({})
    if app_module is not None:
        app_module.rate_limiter.reset()
    try:
        return _run(self, result)
    finally:
        regions.clear_cache()


if not getattr(unittest.TestCase.run, "_close_knit_isolated", False):
    _isolated_run._close_knit_isolated = True
    unittest.TestCase.run = _isolated_run
