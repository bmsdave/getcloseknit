"""AE-36: bounded read-only evidence operations for assistant workflows.

Thin wrappers over the AE-06 EvidenceReader and the AE-18/AE-30
presentation semantics. No new SQL, no analytics writes, no separate
ingestion, no messaging, purchases, scraping, or profile persistence.
Every operation returns a plain-dict envelope with supporting sources;
failures map to the public contract's structured reasons; missing values
stay unknown and are never zeroed or invented.
"""
from typing import Any, Callable, Mapping

from . import evidence
from .evidence import EvidenceReader

TOOL_OPERATIONS = (
    "lookup_areas",
    "retrieve_evidence",
    "compare_shortlist",
    "prepare_brief",
)
MAX_AGENT_RESULTS = 10
MIN_COMPARE_AREAS = 2
MAX_COMPARE_AREAS = 4
SCHEMA = "agent-evidence.v1"

_ERROR_REASONS = {
    "MalformedQuery": "invalid-query",
    "AreaNotFound": "area-not-found",
    "MetricNotFound": "metric-not-found",
    "PeriodNotFound": "period-not-found",
}
_UNAVAILABLE_REASONS = {
    "ReleaseUnavailable": "release-unavailable",
    "Cancelled": "request-cancelled",
}


def lookup_areas(
    connect: Callable[[], Any],
    query: str,
    limit: int | None = None,
    cancel: Callable[[], bool] | None = None,
) -> dict:
    """Bounded area lookup; excessive limits are refused, never clamped."""
    if _cancelled(cancel):
        return _unavailable("request-cancelled", "evidence request was cancelled")
    bound = evidence.DEFAULT_SEARCH_LIMIT if limit is None else limit
    if not isinstance(bound, int) or isinstance(bound, bool) or bound < 1:
        return _error("invalid-query", "search limit must be at least 1")
    if bound > MAX_AGENT_RESULTS:
        return {
            "status": "unavailable", "reason": "result-limit-exceeded",
            "message": f"assistant lookups return at most {MAX_AGENT_RESULTS}",
            "maxAllowed": MAX_AGENT_RESULTS,
        }
    try:
        payload = EvidenceReader(connect=connect).search_areas(
            query, limit=bound, cancel=cancel)
    except evidence.EvidenceError as error:
        return _failure(error)
    release = payload["productReleaseId"]
    return {
        "status": "ok", "operation": "lookup_areas", "schemaVersion": SCHEMA,
        "productReleaseId": release, "results": payload["results"],
        "sources": [{"label": "area search", "release": release, "observedAt": ""}],
    }


def retrieve_evidence(
    connect: Callable[[], Any],
    geography_id: str,
    metric_id: str,
    period: str,
    options: Mapping[str, Any] | None = None,
) -> dict:
    """Single-area evidence with sources; missing values stay unknown.

    ``options`` carries ``expected_release`` and ``cancel`` when needed.
    """
    opts = options or {}
    if _cancelled(opts.get("cancel")):
        return _unavailable("request-cancelled", "evidence request was cancelled")
    try:
        payload = EvidenceReader(connect=connect).get_area(
            geography_id, metric_id, period, cancel=opts.get("cancel"))
    except evidence.EvidenceError as error:
        return _failure(error)
    release = payload["productReleaseId"]
    expected_release = opts.get("expected_release")
    if expected_release is not None and expected_release != release:
        return _mismatch(expected_release, release)
    summary = payload["summary"]
    rows = payload["metricTimeline"] + payload["priceTimeline"]
    return {
        "status": "ok", "operation": "retrieve_evidence", "schemaVersion": SCHEMA,
        "productReleaseId": release, "evidence": payload,
        "sources": _timeline_sources(rows, period),
        "unavailable": _missing_value(payload, geography_id, metric_id, period),
    }


def compare_shortlist(
    connect: Callable[[], Any],
    geography_ids: list,
    metric_id: str,
    period: str,
    options: Mapping[str, Any] | None = None,
) -> dict:
    """Two-to-four area comparison on one release; unknown never ranks.

    ``options`` carries ``expected_release`` and ``cancel`` when needed.
    """
    shape = _check_shortlist_shape(geography_ids)
    if shape is not None:
        return shape
    opts = options or {}
    if _cancelled(opts.get("cancel")):
        return _unavailable("request-cancelled", "evidence request was cancelled")
    try:
        details = [EvidenceReader(connect=connect).get_area(
            geography_id, metric_id, period, cancel=opts.get("cancel"))
            for geography_id in geography_ids]
    except evidence.EvidenceError as error:
        return _failure(error)
    release = details[0]["productReleaseId"]
    expected_release = opts.get("expected_release")
    if expected_release is not None and expected_release != release:
        return _mismatch(expected_release, release)
    columns = [_compare_column(detail, metric_id) for detail in details]
    _mark_leaders(columns)
    sources = _comparison_sources(details, period)
    return {
        "status": "ok", "operation": "compare_shortlist", "schemaVersion": SCHEMA,
        "productReleaseId": release, "metricId": metric_id, "period": period,
        "columns": columns, "sources": sources,
        "conclusions": _comparison_conclusions(columns, sources),
        "uncertainty": _comparison_uncertainty(columns, details),
    }


def prepare_brief(
    comparison: dict | None,
    profile: Mapping[str, Any] | None = None,
    candidates: list | None = None,
    include_private: bool = False,
    generated_at: str | None = None,
) -> dict:
    """Sourced brief from a comparison plus user-supplied candidates.

    Listing URLs and notes are treated as entered data: never fetched,
    labelled unverified. Private destinations stay out unless asked for,
    and coordinates never leave the profile. Pure: writes nothing.
    """
    entries = list(candidates or [])
    if comparison is None and not entries:
        return _error("brief-needs-evidence",
                       "a brief needs a comparison or at least one candidate")
    sections = [
        _needs_section(profile, include_private),
        *([_assumed_section(profile)] if profile else []),
        _constraints_section(profile),
        _tradeoffs_section(comparison),
        _candidates_section(entries, include_private),
        _evidence_section(comparison, entries),
        _open_questions_section(comparison),
        _limits_section(include_private),
    ]
    release = _brief_release(comparison)
    return {
        "status": "ok", "operation": "prepare_brief", "schemaVersion": SCHEMA,
        "title": "Decision brief", "generatedAt": generated_at or "",
        "release": release, "redacted": not include_private,
        "sections": sections,
    }


def render_brief_markdown(brief: dict) -> str:
    """Render a prepared brief as Markdown; unknown stays unknown."""
    head = [f"# {brief['title']}", "",
            f"Release {brief['release']} · "
            + ("Redacted — private destinations and notes stay out unless included"
               if brief["redacted"] else "Includes private fields you chose to include"),
            ""]
    body = [line for section in brief["sections"]
            for line in [f"## {section['heading']}", ""]
            + [f"- {item['text']}" for item in section["lines"]] + [""]]
    return "\n".join(head + body)


def _cancelled(cancel: Callable[[], bool] | None) -> bool:
    return cancel is not None and cancel()


def _error(reason: str, message: str) -> dict:
    return {"status": "error", "reason": reason, "message": message}


def _unavailable(reason: str, message: str) -> dict:
    return {"status": "unavailable", "reason": reason, "message": message}


def _failure(error: Exception) -> dict:
    name = type(error).__name__
    if name in _UNAVAILABLE_REASONS:
        return _unavailable(_UNAVAILABLE_REASONS[name], str(error))
    return _error(_ERROR_REASONS.get(name, "invalid-query"), str(error))


def _mismatch(expected: str, actual: str) -> dict:
    response = _unavailable(
        "release-mismatch",
        f"expected release {expected} but the active release is {actual}")
    response["expectedRelease"] = expected
    response["actualRelease"] = actual
    return response


def _timeline_sources(rows: list, period: str) -> list:
    seen: dict = {}
    for row in rows:
        if row["period"] != period:
            continue
        key = (row["metricId"], row["sourceVersion"], row["period"])
        seen[key] = {"label": row["metricId"], "release": row["sourceVersion"],
                     "observedAt": row["period"], "carrier": row["carrier"]}
    return sorted(seen.values(), key=lambda s: (s["label"], s["release"]))


def _missing_value(payload: dict, geography_id: str, metric_id: str, period: str) -> list:
    if payload["summary"]["value"] is not None:
        return []
    return [{"code": "value-missing",
             "message": f"no validated {metric_id} values for {geography_id}"
                        f" in {period} — unknown, never zero"}]


def _check_shortlist_shape(geography_ids: Any) -> dict | None:
    if not isinstance(geography_ids, list) or len(geography_ids) < MIN_COMPARE_AREAS:
        return _error("invalid-query", "comparison needs at least two areas")
    if len(geography_ids) > MAX_COMPARE_AREAS:
        return _error("invalid-query", "comparison covers at most four areas")
    if len(set(geography_ids)) != len(geography_ids):
        return _error("invalid-query", "comparison needs distinct areas, not a duplicate")
    for geography_id in geography_ids:
        if not evidence.GEOGRAPHY_PATTERN.match(geography_id or ""):
            return _error("invalid-query", f"invalid geography id: {geography_id}")
    return None


def _compare_column(detail: dict, metric_id: str) -> dict:
    summary = detail["summary"]
    observed = summary["value"] is not None
    return {
        "geographyId": summary["geographyId"], "name": summary["name"],
        "metricId": metric_id, "period": summary["period"],
        "state": "observed" if observed else "unknown",
        "value": summary["value"], "unit": None,
        "carrier": summary["carrier"], "quality": summary["quality"],
        "sourceVersion": summary["sourceVersion"], "leader": False,
        "productReleaseId": detail["productReleaseId"],
    }


def _mark_leaders(columns: list) -> None:
    observed = [c for c in columns if c["state"] == "observed"]
    if not observed:
        return
    best = max(c["value"] for c in observed)
    for column in observed:
        column["leader"] = column["value"] == best


def _comparison_sources(details: list, period: str) -> list:
    rows = [row for detail in details
            for row in detail["metricTimeline"] + detail["priceTimeline"]]
    return _timeline_sources(rows, period)


def _claim(source: dict) -> dict:
    return {"release": source["release"], "observedAt": source["observedAt"]}


def _source_for(sources: list, column: dict) -> dict:
    for source in sources:
        if source["release"] == column["sourceVersion"] \
                and source["observedAt"] == column["period"]:
            return source
    return {"label": column["metricId"], "release": column["sourceVersion"],
            "observedAt": column["period"]}


def _comparison_conclusions(columns: list, sources: list) -> list:
    observed = [c for c in columns if c["state"] == "observed"]
    missing = [c for c in columns if c["state"] == "unknown"]
    if not observed:
        return [{"text": "No compared area has published values — nothing to rank.",
                 "claims": []}]
    if len(observed) == 1:
        only = observed[0]
        names = " and ".join(c["name"] for c in missing)
        return [{"text": f"Only {only['name']} has published values ({only['value']});"
                         f" {names} unknown, never ranked above an observed value.",
                 "claims": [_claim(_source_for(sources, only))]}]
    parts = " and ".join(f"{c['name']} ({c['value']})" for c in observed)
    carriers = {c["carrier"] for c in observed}
    caveat = ("carriers differ, so read each against its own source below, "
              "not as one ranking") if len(carriers) > 1 else \
             "read each against its own source below"
    return [{"text": f"Observed values: {parts} — {caveat}.",
             "claims": [_claim(_source_for(sources, c)) for c in observed]}]


def _comparison_uncertainty(columns: list, details: list) -> list:
    notes = [f"{c['name']}: no validated values — unknown, never ranked."
             for c in columns if c["state"] == "unknown"]
    carriers = {c["carrier"] for c in columns if c["state"] == "observed"}
    if len(carriers) > 1:
        notes.append("Observed areas use different carriers — values are not directly"
                     " comparable; each claim below traces to its own source.")
    notes.append(f"Compared on release {details[0]['productReleaseId']}.")
    return notes


def _brief_release(comparison: dict | None) -> str:
    if comparison and comparison.get("status") == "ok":
        return comparison.get("productReleaseId", "")
    return "uncompared — items below carry their own versions"


def _needs_section(profile: Mapping[str, Any] | None, include_private: bool) -> dict:
    if not profile:
        return _section("needs", "Stated needs",
                        [{"text": "No preference profile supplied — needs are unknown.",
                          "kind": "unknown"}])
    band = round((profile.get("maximumBudget") or 0) / 50000) * 50000
    lines = [
        {"text": f"Looking to {profile.get('market', 'buy')}: budget band around"
                 f" £{band:,} (rounded; exact figures stay in the profile).",
         "kind": "fact"},
        {"text": f"{profile.get('bedrooms')} bedrooms needed.", "kind": "fact"},
        _weighted_line(profile),
        *_journey_lines(profile, include_private),
        *([] if profile.get("places") and not profile.get("commuteDestinations")
          else [_destinations_line(profile, include_private)]),
    ]
    return _section("needs", "Stated needs", lines)


def _journey_lines(profile: Mapping[str, Any], include_private: bool) -> list:
    """Each place's journey as it counts in the score, as the web brief states it."""
    lines = []
    for index, place in enumerate(profile.get("places") or [], start=1):
        name = f"\u201c{place.get('label')}\u201d" if include_private else f"Your place {index}"
        must = " (a must)" if place.get("must") else ""
        lines.append({"text": f"Journey to {name}: weight {place.get('weight')} of 5,"
                              f" limit {place.get('targetMinutes')} min{must}.", "kind": "fact"})
    return lines


# A fresh search's weights (DEFAULT_PROFILE in web/src/lib/fixtures.ts): the budget counts at 3,
# every priority starts Off. Weights still at these values are assumptions, never "weights you set".
DEFAULT_WEIGHTS = {"affordability": 3}


def _factor_label(factor_id: str) -> str:
    return "Price" if factor_id == "affordability" else factor_id.replace("-", " ").capitalize()


def _chosen_factors(profile: Mapping[str, Any]) -> list:
    return [f for f in profile.get("factors", [])
            if f.get("weight", 0) > 0 and f.get("weight") != DEFAULT_WEIGHTS.get(f["factorId"], 0)]


def _weighted_line(profile: Mapping[str, Any]) -> dict:
    chosen = _chosen_factors(profile)
    if not chosen:
        return {"text": "You haven't picked any priorities yet.", "kind": "unknown"}
    names = ", ".join(f"{_factor_label(f['factorId'])} ({f['weight']} of 5)" for f in chosen)
    return {"text": f"Priorities you picked: {names}. These are your weights, not an"
                    " objective ranking.", "kind": "fact"}


def _assumed_section(profile: Mapping[str, Any]) -> dict:
    """Defaults the household never set, as the web brief lists them (decision-brief.ts)."""
    factors = profile.get("factors", [])
    lines = [{"text": f"{_factor_label(f['factorId'])} counts at its standard weight"
                      f" ({f['weight']} of 5).", "kind": "estimate"}
             for f in factors
             if f.get("weight", 0) > 0 and f.get("weight") == DEFAULT_WEIGHTS.get(f["factorId"], 0)]
    # Places replace the legacy commute factor: with a place set, its journey is scored, not left out.
    placed = bool(profile.get("places"))
    off = [_factor_label(f["factorId"]).lower() for f in factors
           if f.get("weight", 0) == 0 and not (placed and f["factorId"] == "commute")]
    if off:
        lines.append({"text": f"Left out of your score: {', '.join(off)}.", "kind": "estimate"})
    if not lines:
        lines.append({"text": "Nothing assumed: every figure above is one you set.", "kind": "fact"})
    return _section("assumed", "Assumed (you didn't set these)", lines)


def _destinations_line(profile: Mapping[str, Any], include_private: bool) -> dict:
    destinations = profile.get("commuteDestinations", [])
    if not destinations:
        return {"text": "No commute destinations recorded.", "kind": "unknown"}
    if not include_private:
        return {"text": f"{len(destinations)} commute destination(s) on file — redacted"
                        " from this brief until you include them.", "kind": "unknown"}
    names = ", ".join(f"\u201c{d['label']}\u201d ({d['mode']},"
                      f" target {d['targetMinutes']} min)" for d in destinations)
    return {"text": f"Commute to {names} — labels you entered; coordinates never leave"
                    " the profile.", "kind": "fact"}


def _constraints_section(profile: Mapping[str, Any] | None) -> dict:
    bounds = [_bound_line(f) for f in (profile or {}).get("factors", [])
              if f.get("minimumUtility") is not None or f.get("maximumUtility") is not None]
    if not bounds:
        bounds = [{"text": "You haven't set any must-haves, so no area is ruled out.",
                   "kind": "unknown"}]
    return _section("constraints", "Your must-haves", bounds)


def _bound_line(factor: Mapping[str, Any]) -> dict:
    limits = []
    if factor.get("minimumUtility") is not None:
        limits.append(f"at least {factor['minimumUtility']} out of 100")
    if factor.get("maximumUtility") is not None:
        limits.append(f"at most {factor['maximumUtility']} out of 100")
    return {"text": f"{_factor_label(factor['factorId'])} scores {' and '.join(limits)}.",
            "kind": "constraint"}


def _tradeoffs_section(comparison: dict | None) -> dict:
    if comparison and comparison.get("status") == "ok":
        lines = [{"text": f"Compared on release {comparison['productReleaseId']}.",
                  "kind": "fact"}]
        lines += [{"text": c["text"], "kind": "tradeoff"}
                  for c in comparison["conclusions"]]
        lines += [{"text": note, "kind": "unknown"}
                  for note in comparison["uncertainty"]]
        return _section("trade-offs", "Trade-offs", lines)
    reason = (comparison or {}).get("reason", "no comparison on file")
    return _section("trade-offs", "Trade-offs",
                    [{"text": f"Area comparison unavailable ({reason}) — trade-offs"
                              " cannot be stated, only guessed at.", "kind": "unknown"}])


def _candidates_section(entries: list, include_private: bool) -> dict:
    if not entries:
        return _section("candidates", "Property candidates",
                        [{"text": "No property candidates selected — add one from your own"
                                  " figures to compare asking against achieved prices.",
                          "kind": "unknown"}])
    lines = [line for entry in entries
             for line in _candidate_lines(entry, include_private)]
    return _section("candidates", "Property candidates", lines)


def _candidate_lines(entry: Mapping[str, Any], include_private: bool) -> list:
    lines = [{"text": f"{entry.get('address', 'Unnamed candidate')} — you entered,"
                      " unverified.", "kind": "estimate"}]
    if entry.get("askingAmount") is not None:
        lines.append({"text": f"Asking £{entry['askingAmount']:,} (you entered,"
                              " unverified — never a price opinion).",
                      "kind": "estimate"})
    lines.append(_reference_line(entry))
    notes = entry.get("notes")
    if notes and include_private:
        lines.append({"text": f"Private note: {notes}", "kind": "fact"})
    elif notes:
        lines.append({"text": "A private note is on file — redacted from this brief"
                              " until you include it.", "kind": "unknown"})
    return lines


def _reference_line(entry: Mapping[str, Any]) -> dict:
    url = (entry.get("referenceUrl") or "").strip()
    if not url:
        return {"text": "No listing reference attached.", "kind": "unknown"}
    if url.startswith("http://") or url.startswith("https://"):
        return {"text": f"Reference (never fetched): {url} (you entered, unverified).",
                "kind": "fact"}
    return {"text": "A reference was recorded but is not shown as a link (unsafe URL).",
            "kind": "unknown"}


def _evidence_section(comparison: dict | None, entries: list) -> dict:
    lines = []
    if comparison and comparison.get("status") == "ok":
        for column in comparison["columns"]:
            lines.append(_column_evidence_line(column))
        lines += [{"text": f"{s['label']}: release {s['release']},"
                           f" observed {s['observedAt']}.", "kind": "fact"}
                  for s in comparison["sources"]]
    else:
        lines.append({"text": "No area comparison on file — no carrier-level evidence"
                              " to list.", "kind": "unknown"})
    if entries:
        lines.append({"text": "Candidate asking figures are entered and unverified; they"
                              " are never combined with official records.", "kind": "fact"})
    return _section("evidence", "Evidence and sources", lines)


def _column_evidence_line(column: dict) -> dict:
    if column["state"] != "observed":
        return {"text": f"{column['name']}: not published — unknown, never ranked.",
                "kind": "unknown"}
    return {"text": f"{column['metricId']} · {column['name']}: {column['value']} —"
                    f" carrier {column['carrier']}, {column['quality']},"
                    f" {column['sourceVersion']}.", "kind": "fact"}


def _open_questions_section(comparison: dict | None) -> dict:
    if comparison and comparison.get("status") == "ok":
        missing = [c["name"] for c in comparison["columns"] if c["state"] == "unknown"]
        if missing:
            return _section("open-questions", "Open questions",
                            [{"text": f"Open: find evidence for {' and '.join(missing)}"
                                      " — unknown, never a verified fact.", "kind": "question"}])
    return _section("open-questions", "Open questions",
                    [{"text": "No open questions recorded — add the ones that would"
                              " change the decision.", "kind": "unknown"}])


def _limits_section(include_private: bool) -> dict:
    privacy = ("You chose to include precise destinations and private notes — check"
               " the preview before showing anyone." if include_private else
               "Redacted by default: precise commute destinations and private notes"
               " stay out unless you include them.")
    return _section("limits", "Uncertainty and limits", [
        {"text": "Uncertain estimates stay estimates: area scenarios are never"
                 " a price opinion.", "kind": "fact"},
        {"text": "Asking figures are entered and unverified; achieved prices are"
                 " official records; the two are never combined.", "kind": "fact"},
        {"text": "Pending questions are investigation prompts, not verified facts.",
         "kind": "fact"},
        {"text": privacy, "kind": "fact"},
        {"text": "This brief is never sent anywhere automatically.", "kind": "fact"},
    ])


def _section(section_id: str, heading: str, lines: list) -> dict:
    return {"id": section_id, "heading": heading, "lines": lines}
