"""Valuation calibration (AE-14).

Estimates stay grounded in achieved HMLR transactions. Reference-group
steps are descriptive comparisons, never causal attributions: their
order is presentational, shared samples are disclosed, and drivers the
records cannot see are named. A heuristic sensitivity band is only an
illustration; only a band fitted on held-out later sales is a
calibrated prediction interval. Estimates stay unavailable when
validation is insufficient. No literature-derived weights are used.
"""

MIN_REFERENCE_GROUP_N = 5
MIN_CALIBRATION_N = 20
MIN_HELD_OUT_N = 10

LOW_PRICE_MAX = 400000
HIGH_PRICE_MIN = 700000

ORDERING_NOTE = (
    "Reference steps are shown in the supplied order for readability; "
    "the order is presentational, not causal. Reordering the groups "
    "changes the intermediate path but not the final reference value."
)

OMITTED_DRIVERS_NOTE = (
    "Omitted drivers the records cannot see: exact location within "
    "the area, condition and layout, tenure mix, new-build effects, "
    "and market movement since each sale. Steps describe group "
    "medians; they do not attribute value to any driver."
)

HEURISTIC_INTERPRETATION = (
    "Heuristic sensitivity illustration around the point figure, not "
    "a calibrated prediction interval: it has no validation basis "
    "and must not be read as the likelihood of achieving a price."
)

CALIBRATION_BASIS = (
    "Calibrated on held-out later sales not used to select the band; "
    "training excluded every sale sharing an identity with a "
    "held-out sale (spatial-leakage control)."
)


def reference_group_median(transactions):
    """Pure arithmetic median of achieved prices; validity is separate."""
    prices = sorted(item["price"] for item in transactions)
    return {
        "median": _median(prices),
        "n": len(prices),
        "transactionIds": sorted(item["transactionId"]
                                 for item in transactions),
    }


def describe_reference_steps(anchor_price, groups):
    """Label each reference-group move as a descriptive comparison."""
    steps = []
    running = anchor_price
    previous_ids = set()
    for group in groups:
        summary = reference_group_median(group["transactions"])
        shared = sorted(previous_ids & set(summary["transactionIds"]))
        delta = summary["median"] - running
        running = summary["median"]
        steps.append({
            "name": group["name"],
            "kind": "reference-step",
            "kindOf": "descriptive-comparison",
            "label": _step_label(group["name"], summary),
            "median": summary["median"],
            "n": summary["n"],
            "deltaVsPrevious": delta,
            "cumulative": running,
            "sampleOverlap": {
                "sharedWithPrevious": shared,
                "sharedCount": len(shared),
            },
            "insufficient": summary["n"] < MIN_REFERENCE_GROUP_N,
            "validityNote": _validity_note(summary["n"]),
            "orderingNote": ORDERING_NOTE,
            "omittedDriversNote": OMITTED_DRIVERS_NOTE,
        })
        previous_ids = set(summary["transactionIds"])
    return {
        "anchorPrice": anchor_price,
        "steps": steps,
        "finalReference": running,
        "orderingNote": ORDERING_NOTE,
        "omittedDriversNote": OMITTED_DRIVERS_NOTE,
    }


def sensitivity_band(point_estimate, pct=0.1):
    """Heuristic band with no validation basis."""
    return {
        "kind": "heuristic-sensitivity-band",
        "pointEstimate": point_estimate,
        "pct": pct,
        "lower": round(point_estimate * (1 - pct)),
        "upper": round(point_estimate * (1 + pct)),
        "interpretation": HEURISTIC_INTERPRETATION,
    }


def calibrate_interval(errors, level=0.8):
    """Fit a prediction interval on held-out errors or stay uncalibrated."""
    ordered = sorted(errors)
    if len(ordered) < MIN_CALIBRATION_N:
        return {
            "status": "uncalibrated",
            "n": len(ordered),
            "level": level,
            "reason": (f"Only {len(ordered)} held-out errors; "
                       f"{MIN_CALIBRATION_N} are needed before a band "
                       "can claim calibration."),
        }
    tail = (1 - level) / 2
    return {
        "status": "calibrated",
        "kind": "calibrated-prediction-interval",
        "level": level,
        "n": len(ordered),
        "lowerOffset": _quantile(ordered, tail),
        "upperOffset": _quantile(ordered, 1 - tail),
        "validationBasis": CALIBRATION_BASIS,
    }


def apply_interval(point_estimate, calibration):
    """Apply a calibrated interval to a point figure."""
    if calibration.get("status") != "calibrated":
        return {
            "status": "uncalibrated",
            "reason": ("No calibrated interval available; show achieved "
                       "sales without an estimate band."),
        }
    lower = round(point_estimate * (1 + calibration["lowerOffset"]))
    upper = round(point_estimate * (1 + calibration["upperOffset"]))
    return {
        "status": "calibrated",
        "kind": "calibrated-prediction-interval",
        "pointEstimate": point_estimate,
        "lower": lower,
        "upper": upper,
        "level": calibration["level"],
        "n": calibration["n"],
        "validationBasis": calibration["validationBasis"],
    }


def evaluate_backtest(records, cutoff_month, level=0.8,
                      leakage_key="identityId"):
    """Backtest coverage on held-out later sales with leakage control."""
    train, held_out = _split_holdout(records, cutoff_month)
    kept, excluded = _remove_leakage(train, held_out, leakage_key)
    fit, calibrate = _split_fit_calibrate(kept)
    prediction = _median([item["price"] for item in fit]) if fit else None
    errors = _relative_errors(calibrate, prediction)
    calibration = calibrate_interval(errors, level)
    if prediction is None or len(held_out) < MIN_HELD_OUT_N:
        return _insufficient(kept, excluded, held_out, errors,
                             calibration, prediction)
    return _complete_report(records, cutoff_month, level, kept, excluded,
                            held_out, prediction, calibration)


def build_valuation_estimate(identity_id, achieved_sales, point_estimate,
                             steps_report, backtest):
    """Assemble a dossier valuation section; suppress when unvalidated."""
    ordered = sorted(achieved_sales or [],
                     key=lambda item: str(item.get("saleDate", "")))
    reason = _suppression_reason(ordered, backtest)
    if reason is not None:
        return {"status": "unavailable", "reason": reason,
                "identityId": identity_id,
                "achievedSales": [_achieved_entry(item) for item in ordered]}
    band = apply_interval(point_estimate, backtest["calibration"])
    return {
        "status": "available",
        "kindOf": "estimated",
        "identityId": identity_id,
        "achievedSales": [_achieved_entry(item) for item in ordered],
        "pointEstimate": point_estimate,
        "interval": band,
        "referenceSteps": steps_report,
        "validationBasis": _validation_basis(backtest),
        "interpretation": (
            "Achieved sales above are the primary evidence. The point "
            "figure is a reference median; the band is a calibrated "
            "prediction interval at the stated level, not a precise "
            "price. Reference steps below are descriptive comparisons."),
    }


def _median(values):
    count = len(values)
    if count == 0:
        return 0
    middle = count // 2
    if count % 2:
        return values[middle]
    total = values[middle - 1] + values[middle]
    return total // 2 if total % 2 == 0 else total / 2


def _quantile(ordered, rank):
    if len(ordered) == 1:
        return ordered[0]
    position = rank * (len(ordered) - 1)
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    frac = position - low
    return ordered[low] + (ordered[high] - ordered[low]) * frac


def _step_label(name, summary):
    return (f"Descriptive comparison: {name} achieved median "
            f"£{summary['median']:,} across {summary['n']} sales.")


def _validity_note(count):
    if count < MIN_REFERENCE_GROUP_N:
        return (f"Only {count} sales; below the {MIN_REFERENCE_GROUP_N} "
                "needed for a reference group, so treat as context only.")
    return f"{count} achieved sales support this descriptive comparison."


def _split_holdout(records, cutoff_month):
    train = [item for item in records
             if str(item.get("saleMonth", "")) < cutoff_month]
    held_out = [item for item in records
                if str(item.get("saleMonth", "")) >= cutoff_month]
    return train, held_out


def _remove_leakage(train, held_out, leakage_key):
    held_keys = {str(item.get(leakage_key, "")) for item in held_out}
    kept = [item for item in train
            if str(item.get(leakage_key, "")) not in held_keys]
    return kept, len(train) - len(kept)


def _split_fit_calibrate(kept):
    ordered = sorted(kept, key=lambda item: str(item.get("saleMonth", "")))
    half = len(ordered) // 2
    return ordered[:half], ordered[half:]


def _relative_errors(sample, prediction):
    if not prediction:
        return []
    return [(item["price"] - prediction) / prediction for item in sample]


def _insufficient(kept, excluded, held_out, errors, calibration,
                  prediction):
    return {
        "status": "insufficient",
        "reason": _insufficient_reason(prediction, held_out, calibration),
        "trainN": len(kept),
        "trainTransactionIds": sorted(item["transactionId"]
                                      for item in kept),
        "leakageExcluded": excluded,
        "testN": len(held_out),
        "calibrationN": len(errors),
        "calibration": calibration,
    }


def _insufficient_reason(prediction, held_out, calibration):
    if prediction is None:
        return "No leakage-controlled training sales to fit a reference."
    if len(held_out) < MIN_HELD_OUT_N:
        return (f"Only {len(held_out)} held-out later sales; "
                f"{MIN_HELD_OUT_N} are needed for validation.")
    return calibration.get("reason", "Validation sample insufficient.")


def _complete_report(records, cutoff_month, level, kept, excluded,
                     held_out, prediction, calibration):
    test_errors = _relative_errors(held_out, prediction)
    band = apply_interval(prediction, calibration)
    fitted = band["status"] == "calibrated"
    coverage = _coverage(held_out, band) if fitted else None
    return {
        "status": "complete" if band["status"] == "calibrated"
        else "insufficient",
        "reason": None if band["status"] == "calibrated"
        else band.get("reason"),
        "cutoffMonth": cutoff_month,
        "level": level,
        "trainN": len(kept),
        "trainTransactionIds": sorted(item["transactionId"]
                                      for item in kept),
        "leakageExcluded": excluded,
        "calibrationN": calibration.get("n", 0),
        "testN": len(held_out),
        "coverage": coverage,
        "errorSpread": _error_spread(test_errors),
        "calibration": calibration,
        "byGroup": _group_splits(held_out, kept, prediction, band),
    }


def _coverage(held_out, band):
    inside = sum(1 for item in held_out
                 if band["lower"] <= item["price"] <= band["upper"])
    return inside / len(held_out) if held_out else 0.0


def _error_spread(errors):
    ordered = sorted(errors)
    if not ordered:
        return {"n": 0, "medianSigned": None, "p10": None,
                "p90": None, "medianAbsolute": None}
    absolute = sorted(abs(value) for value in ordered)
    return {
        "n": len(ordered),
        "medianSigned": _quantile(ordered, 0.5),
        "p10": _quantile(ordered, 0.1),
        "p90": _quantile(ordered, 0.9),
        "medianAbsolute": _quantile(absolute, 0.5),
    }


def _group_splits(held_out, kept, prediction, band):
    densities = _density_labels(held_out, kept)
    splits = {}
    fields = (("tenure", "tenure"), ("propertyType", "propertyType"),
              ("priceBand", None), ("evidenceDensity", None))
    for field, key in fields:
        splits[field] = _split_field(held_out, field, key, densities,
                                     prediction, band)
    return splits


def _split_field(held_out, field, key, densities, prediction, band):
    cells = {}
    for item in held_out:
        label = _cell_label(item, field, key, densities)
        cells.setdefault(label, []).append(item)
    scored = {}
    for label in sorted(cells, key=str):
        members = cells[label]
        errors = _relative_errors(members, prediction)
        scored[str(label)] = {
            "n": len(members),
            "coverage": _coverage(members, band)
            if band["status"] == "calibrated" else None,
            "medianSignedError": _error_spread(errors)["medianSigned"],
        }
    return scored


def _cell_label(item, field, key, densities):
    if field == "priceBand":
        return _price_band(item["price"])
    if field == "evidenceDensity":
        return densities.get(item["transactionId"], "sparse")
    return item.get(key, "unknown")


def _price_band(price):
    if price < LOW_PRICE_MAX:
        return "under-400k"
    if price < HIGH_PRICE_MIN:
        return "400k-to-700k"
    return "over-700k"


def _density_labels(held_out, kept):
    cell_counts = {}
    for item in kept:
        cell = (item.get("tenure", "unknown"),
                item.get("propertyType", "unknown"))
        cell_counts[cell] = cell_counts.get(cell, 0) + 1
    labels = {}
    for item in held_out:
        cell = (item.get("tenure", "unknown"),
                item.get("propertyType", "unknown"))
        dense = cell_counts.get(cell, 0) >= MIN_REFERENCE_GROUP_N
        labels[item["transactionId"]] = "adequate" if dense else "sparse"
    return labels


def _suppression_reason(ordered, backtest):
    if not ordered:
        return "No achieved sales anchor this property; no estimate shown."
    if backtest is None or backtest.get("status") != "complete":
        detail = (backtest or {}).get("reason") or "no backtest available"
        return f"Validation insufficient, estimate withheld: {detail}"
    if backtest.get("calibration", {}).get("status") != "calibrated":
        return ("Validation insufficient, estimate withheld: interval "
                "is not calibrated on held-out sales.")
    return None


def _achieved_entry(item):
    return {
        "transactionId": item.get("transactionId", ""),
        "price": item.get("price"),
        "saleDate": item.get("saleDate", ""),
        "tenure": item.get("tenure", ""),
        "kindOf": "observed",
    }


def _validation_basis(backtest):
    return {
        "cutoffMonth": backtest.get("cutoffMonth"),
        "level": backtest.get("level"),
        "trainN": backtest.get("trainN"),
        "testN": backtest.get("testN"),
        "coverage": backtest.get("coverage"),
        "leakageExcluded": backtest.get("leakageExcluded"),
        "errorSpread": backtest.get("errorSpread"),
        "byGroup": backtest.get("byGroup"),
        "note": CALIBRATION_BASIS,
    }
