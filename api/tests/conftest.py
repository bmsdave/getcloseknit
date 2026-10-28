import pytest

try:
    import area_api.app as app_module
except ImportError:  # pragma: no cover - API extras not installed; the HTTP tests skip
    app_module = None


@pytest.fixture(autouse=True)
def _no_area_regions():
    """The area -> region map (area_api.regions) is process-wide: each test starts with an empty one, so a fake
    connection never sees the regions query unless the test loads it (regions.clear_cache(), then its rows)."""
    from area_api import regions, repository

    regions.set_for_tests({})
    repository.forget_match_inputs()  # match inputs are held per release, process-wide too
    yield
    regions.clear_cache()


@pytest.fixture(autouse=True)
def _fresh_rate_limiter():
    """The app's limiter is process-wide: without this, requests from earlier tests use up the
    allowance and a later test gets a 429. Tests about limits set their own in setUp, which runs after."""
    if app_module is not None:
        app_module.rate_limiter.reset()
    yield
