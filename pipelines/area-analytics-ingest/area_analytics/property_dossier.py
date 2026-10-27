"""Honest property dossiers (AE-13).

Builds a useful dossier from known transactions even when floor area
or valuation is unavailable. Source observations stay separate from
derived hypotheses and user-confirmed facts: certificate changes are
described with dates and uncertainty, and nothing infers building work
or a legal tenure change from records alone. Optional valuation and
peer sections share one available/unavailable shape.
"""

SCHEMA_VERSION = "property-dossier.v1"

AREA_CONFLICT_RELATIVE = 0.05
AREA_CONFLICT_ABSOLUTE_SQM = 2.0
STALE_CERTIFICATE_YEARS = 10


def build_property_dossier(identity, sales, epc_current=None,
                           epc_history=None, valuation=None,
                           peers=None, confirmed_facts=None):
    """Assemble a dossier that never fabricates completeness."""
    history = list(epc_history or [])
    ordered_sales = sorted(list(sales or []),
                           key=lambda item: str(item.get("saleDate", "")))
    observations = _sale_observations(ordered_sales)
    observations.extend(_certificate_observations(epc_current, history))
    hypotheses = _certificate_hypotheses(epc_current, history)
    hypotheses.extend(_tenure_hypotheses(ordered_sales))
    contradictions = _contradictions(ordered_sales, epc_current, history)
    dossier = {
        "schemaVersion": SCHEMA_VERSION,
        "identityId": _identity_id(identity),
        "observations": observations,
        "hypotheses": hypotheses,
        "confirmedFacts": list(confirmed_facts or []),
        "contradictions": contradictions,
        "dataGaps": _data_gaps(ordered_sales, epc_current,
                               history, valuation, peers),
        "events": _events(observations, hypotheses),
        "saleHistory": [_sale_entry(item) for item in ordered_sales],
        "floorArea": _floor_area(epc_current, history),
        "valuation": _optional_section(valuation, "valuation"),
        "peers": _optional_section(peers, "peer comparison"),
    }
    return dossier


def _identity_id(identity):
    if isinstance(identity, str):
        return identity
    if hasattr(identity, "identity_id"):
        return identity.identity_id
    return str(identity.get("identityId", identity.get("identity_id", "")))


def _sale_observations(ordered_sales):
    return [{
        "kind": "sale",
        "kindOf": "observed",
        "date": str(item.get("saleDate", "")),
        "summary": _sale_summary(item),
        "source": "HM Land Registry Price Paid Data (achieved price)",
    } for item in ordered_sales]


def _sale_summary(item):
    return (f"Achieved sale of £{item.get('price')} on "
            f"{item.get('saleDate', '')} "
            f"(tenure recorded as {item.get('tenure', 'unknown')}).")


def _certificate_observations(epc_current, history):
    observations = []
    for record in history:
        observations.append(_certificate_observation(record, True))
    if epc_current is not None:
        observations.append(_certificate_observation(epc_current, False))
    return observations


def _certificate_observation(record, superseded):
    note = "superseded by a later certificate"
    if superseded:
        note = note + "; kept for history, not current fact"
    return {
        "kind": "certificate",
        "kindOf": "observed",
        "date": str(record.get("lodgementDate", "")),
        "summary": _certificate_summary(record, superseded),
        "source": "Domestic Energy Performance Certificate",
        "staleNote": note if superseded else None,
    }


def _certificate_summary(record, superseded):
    status = "superseded certificate" if superseded else "current certificate"
    return (f"{status} {record.get('certificateId', '')} lodged "
            f"{record.get('lodgementDate', '')}: rating "
            f"{record.get('energyRating', 'unknown')}, area "
            f"{record.get('floorAreaSqm', 'unknown')} sqm.")


def _certificate_hypotheses(epc_current, history):
    if epc_current is None or not history:
        return []
    ordered = sorted(history,
                     key=lambda item: str(item.get("lodgementDate", "")))
    return [_certificate_change(previous, epc_current) for previous in ordered]


def _certificate_change(previous, current):
    old_date = str(previous.get("lodgementDate", ""))
    new_date = str(current.get("lodgementDate", ""))
    return {
        "kind": "certificate-change",
        "kindOf": "inferred",
        "summary": (f"Certificate {previous.get('certificateId', '')} "
                    f"({old_date}) was replaced by "
                    f"{current.get('certificateId', '')} ({new_date})."),
        "detail": _change_detail(previous, current, old_date, new_date),
        "uncertainty": ("Records alone do not establish building work; "
                        "differences may reflect remeasurement, data entry, "
                        "or inspection method rather than the home changing."),
    }


def _change_detail(previous, current, old_date, new_date):
    bits = [f"lodged {old_date} then {new_date}"]
    if previous.get("energyRating") != current.get("energyRating"):
        bits.append(f"rating {previous.get('energyRating')} "
                    f"to {current.get('energyRating')}")
    if previous.get("floorAreaSqm") != current.get("floorAreaSqm"):
        bits.append(f"recorded area {previous.get('floorAreaSqm')} "
                    f"to {current.get('floorAreaSqm')} sqm")
    return "Observed change: " + "; ".join(bits) + "."


def _tenure_hypotheses(ordered_sales):
    tenures = sorted({str(item.get("tenure", "")) for item in ordered_sales
                      if str(item.get("tenure", "")).strip()})
    if len(tenures) < 2:
        return []
    dates = [str(item.get("saleDate", "")) for item in ordered_sales]
    return [{
        "kind": "possible-tenure-difference",
        "kindOf": "inferred",
        "summary": (f"Sales record tenure as {tenures[0]} then {tenures[1]} "
                    f"between {min(dates)} and {max(dates)}."),
        "detail": ("Tenure values differ between sale records; confirm "
                   "against the title register before acting, as records "
                   "alone do not establish what changed legally."),
        "uncertainty": ("May reflect recording practice, boundary or flat "
                        "identity ambiguity, or a genuine legal change."),
    }]


def _contradictions(ordered_sales, epc_current, history):
    found = []
    area_note = _area_contradiction(epc_current, history)
    if area_note is not None:
        found.append(area_note)
    stale_note = _stale_contradiction(ordered_sales, epc_current, history)
    if stale_note is not None:
        found.append(stale_note)
    return found


def _area_contradiction(epc_current, history):
    areas = _known_areas(epc_current, history)
    if len(areas) < 2 or not _areas_conflict(areas):
        return None
    return {
        "kind": "conflicting-floor-area",
        "detail": (f"Certificates record different floor areas "
                   f"({', '.join(str(area) for area in sorted(areas))} sqm); "
                   f"no single area is adopted until remeasured."),
    }


def _known_areas(epc_current, history):
    records = list(history or [])
    if epc_current is not None:
        records.append(epc_current)
    return [float(item["floorAreaSqm"]) for item in records
            if item.get("floorAreaSqm") is not None]


def _areas_conflict(areas):
    spread = max(areas) - min(areas)
    if spread > AREA_CONFLICT_ABSOLUTE_SQM:
        return True
    smallest = min(area for area in areas if area > 0) if min(areas) > 0 else 0
    return bool(smallest) and spread / smallest > AREA_CONFLICT_RELATIVE


def _stale_contradiction(ordered_sales, epc_current, history):
    dates = [str(item.get("saleDate", "")) for item in ordered_sales]
    for record in list(history or []) + ([epc_current] if epc_current else []):
        dates.append(str(record.get("lodgementDate", "")))
    known = sorted(date for date in dates if date)
    if not known or epc_current is None:
        return None
    lodged = str(epc_current.get("lodgementDate", ""))
    if known[-1][:4].isdigit() and lodged[:4].isdigit():
        if int(known[-1][:4]) - int(lodged[:4]) > STALE_CERTIFICATE_YEARS:
            return {"kind": "stale-certificate",
                    "detail": _stale_detail(epc_current, known[-1])}
    return None


def _stale_detail(epc_current, newest):
    return (f"Current certificate {epc_current.get('certificateId', '')} "
            f"was lodged {epc_current.get('lodgementDate', '')}; newer "
            f"evidence dated {newest} exists, so its facts may be stale.")


def _data_gaps(ordered_sales, epc_current, history, valuation, peers):
    gaps = []
    if not ordered_sales:
        gaps.append({"missing": "sales",
                     "note": "No achieved-sale records linked yet."})
    if not _known_areas(epc_current, history):
        gaps.append({"missing": "floorArea",
                     "note": "No floor area recorded; per-sqm figures withheld."})
    if valuation is None:
        gaps.append({"missing": "valuation",
                     "note": "No valuation inputs; sale history shown without one."})
    if peers is None:
        gaps.append({"missing": "peers",
                     "note": "No peer comparison available for this property."})
    return gaps


def _events(observations, hypotheses):
    events = []
    for entry in observations:
        events.append({"kind": entry["kind"], "kindOf": "observed",
                       "date": entry.get("date", ""),
                       "summary": entry.get("summary", "")})
    for entry in hypotheses:
        events.append({"kind": entry["kind"], "kindOf": "inferred",
                       "date": "",
                       "summary": entry.get("summary", "")})
    return sorted(events, key=lambda item: (str(item.get("date", "")),
                                            str(item.get("kind", ""))))


def _sale_entry(item):
    return {
        "transactionId": item.get("transactionId", ""),
        "price": item.get("price"),
        "saleDate": item.get("saleDate", ""),
        "tenure": item.get("tenure", ""),
        "kindOf": "observed",
    }


def _floor_area(epc_current, history):
    areas = _known_areas(epc_current, history)
    if not areas:
        return {"status": "unknown", "floorAreaSqm": None,
                "note": "No certificate records a floor area."}
    if _areas_conflict(areas):
        return {"status": "conflicting", "floorAreaSqm": None,
                "areasSqm": sorted(areas),
                "note": "Certificates disagree; area withheld, see "
                        "contradictions."}
    latest = _latest_area(epc_current, history)
    return {"status": "known", "floorAreaSqm": latest,
            "note": "Latest certificate area; earlier values in history."}


def _latest_area(epc_current, history):
    if epc_current is not None and epc_current.get("floorAreaSqm") is not None:
        return float(epc_current["floorAreaSqm"])
    dated = sorted((item for item in history
                    if item.get("floorAreaSqm") is not None),
                   key=lambda item: str(item.get("lodgementDate", "")))
    return float(dated[-1]["floorAreaSqm"]) if dated else None


def _optional_section(provided, name):
    if provided is None:
        return {"status": "unavailable",
                "reason": f"No {name} inputs; section withheld rather "
                          f"than estimated."}
    section = {"status": "available"}
    section.update(dict(provided))
    return section
