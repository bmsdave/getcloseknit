"""One error taxonomy for REST and MCP: exception -> (status, code)."""
from psycopg.errors import QueryCanceled

from . import evidence
from .custom_criteria import InvalidCriterion
from .matching import InvalidMatchRequest
from .objections import InvalidObjection, ObjectionConflict, ObjectionLimit, ObjectionNotFound
from .repository import CorrectionError
from .toolspec import InvalidToolArguments, ToolNotFound

_CODES: list[tuple[type[Exception], int, str]] = [
    (InvalidToolArguments, 400, "invalid-arguments"),
    (InvalidMatchRequest, 400, "invalid-profile"),
    (InvalidCriterion, 400, "invalid-criterion"),
    (evidence.MalformedQuery, 400, "invalid-query"),
    (CorrectionError, 400, "invalid-correction-report"),
    (InvalidObjection, 400, "invalid-objection"),
    (ObjectionConflict, 409, "objection-exists"),
    (ObjectionLimit, 429, "too-many-requests"),
    (ObjectionNotFound, 404, "objection-not-found"),
    (ToolNotFound, 404, "tool-not-found"),
    (evidence.AreaNotFound, 404, "area-not-found"),
    (evidence.SchoolNotFound, 404, "school-not-found"),
    (evidence.AddressNotFound, 404, "address-not-found"),
    (evidence.PropertyNotFound, 404, "property-not-found"),
    (evidence.PropertyAmbiguous, 409, "property-ambiguous"),
    (evidence.MetricNotFound, 404, "metric-not-found"),
    (evidence.PeriodNotFound, 404, "period-not-found"),
    (evidence.ReleaseUnavailable, 503, "release-unavailable"),
    (evidence.Cancelled, 503, "request-cancelled"),
    # statement_timeout (repository._pool) cut a query short.
    (QueryCanceled, 503, "query-timeout"),
]


def classify(error: Exception) -> tuple[str, str]:
    status, code = status_and_code(error)
    # Unexpected failures carry SQL, paths or stack details: the caller only learns the code.
    return code, "internal error" if code == "internal-error" else str(error)


def status_and_code(error: Exception) -> tuple[int, str]:
    for kind, status, code in _CODES:
        if isinstance(error, kind):
            return status, code
    return 500, "internal-error"
