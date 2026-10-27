from typing import Any, Mapping


def private_response_headers() -> dict[str, str]:
    """Personalized responses must never sit in a shared cache."""
    return {"Cache-Control": "no-store"}


def analytics_event(profile: Mapping[str, Any]) -> dict[str, Any] | None:
    if not profile.get("analyticsConsent"):
        return None
    if profile.get("schemaVersion") == "preference-profile.v2":
        return _analytics_event_v2(profile)
    destinations = profile.get("commuteDestinations", [])
    factors = profile.get("factors", [])
    return {
        "market": profile.get("market"),
        "budgetBand": round(profile.get("maximumBudget", 0) / 50_000) * 50_000,
        "bedrooms": profile.get("bedrooms"),
        "forecastHorizon": profile.get("forecastHorizon"),
        "factorWeights": {item["factorId"]: item["weight"] for item in factors},
        "destinationCount": len(destinations),
        "destinationModes": sorted({item.get("mode") for item in destinations}),
        "schoolPhases": profile.get("school", {}).get("phases", []),
    }


def _analytics_event_v2(profile: Mapping[str, Any]) -> dict[str, Any]:
    """The same redacted record for the ordered list (v4 My match): the kinds of criteria in their order, never a
    place, a label, a zone or a value (a place's id is made from its label, so it is never kept)."""
    criteria = profile.get("criteria") or []
    places = [item for item in criteria if item.get("kind") == "place"]

    def kind(item: Mapping[str, Any]) -> str:
        if item.get("kind") == "range":
            return f"range:{item.get('layer')}"
        return str(item.get("kind"))

    return {
        "market": profile.get("market"),
        "budgetBand": round(profile.get("maximumBudget", 0) / 50_000) * 50_000,
        "bedrooms": profile.get("bedrooms"),
        "criteriaOrder": [kind(item) for item in criteria],
        "mustCount": sum(1 for item in criteria if item.get("must")),
        "destinationCount": len(places),
        "destinationModes": sorted({item.get("mode") for item in places}),
    }
