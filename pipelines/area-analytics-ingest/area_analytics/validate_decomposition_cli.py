"""Score the decomposition out of sample against an index-only restatement.

Each pair is a repeat sale: the earlier price restated to the later sale's date
by the published index, and the reference groups that were true at the later
date. The decomposition has to beat the index on median absolute percentage
error, or its extra components are not earning their place and the run fails.
"""

import argparse
import json
from pathlib import Path
from statistics import median
from typing import Any, Mapping, Sequence

from .decompose import ReferenceGroup, decompose


def score(pairs: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    if not pairs:
        raise ValueError("no repeat-sale pairs to score")
    decomposition_errors: list[float] = []
    index_errors: list[float] = []
    for pair in pairs:
        actual = int(pair["laterPrice"])
        if actual <= 0:
            raise ValueError("a repeat-sale pair needs a positive later price")
        estimate = decompose(
            float(pair["floorAreaSquareMetres"]),
            _group(pair["baseline"]),
            [_group(step) for step in pair["steps"]],
        ).estimate
        decomposition_errors.append(_absolute_percentage_error(estimate, actual))
        index_errors.append(_absolute_percentage_error(int(pair["indexOnlyPrediction"]), actual))
    decomposition_error = round(median(decomposition_errors), 2)
    index_error = round(median(index_errors), 2)
    return {
        "schemaVersion": "decomposition-validation.v1",
        "pairs": len(pairs),
        "medianAbsolutePercentageError": {
            "decomposition": decomposition_error,
            "indexOnly": index_error,
        },
        "status": "passed" if decomposition_error < index_error else "failed",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Score the decomposition against index-only restatement")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()
    report = score(json.loads(arguments.input.read_text())["pairs"])
    encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if arguments.output:
        arguments.output.write_text(encoded)
    errors = report["medianAbsolutePercentageError"]
    print(
        f"{report['pairs']} repeat-sale pairs: decomposition {errors['decomposition']}% "
        f"vs index-only {errors['indexOnly']}% median absolute error — {report['status']}"
    )
    return 0 if report["status"] == "passed" else 1


def _group(entry: Mapping[str, Any]) -> ReferenceGroup:
    return ReferenceGroup(
        label=entry["label"],
        median_price_per_square_metre=float(entry["medianPricePerSquareMetre"]),
        sample_count=int(entry["sampleCount"]),
    )


def _absolute_percentage_error(prediction: int, actual: int) -> float:
    return abs(prediction - actual) / actual * 100


if __name__ == "__main__":
    raise SystemExit(main())
