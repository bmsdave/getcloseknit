from typing import Sequence


def empirical_percentile(value: float, region_values: Sequence[float]) -> int:
    if not region_values:
        raise ValueError("regional reference distribution is empty")
    below = sum(candidate < value for candidate in region_values)
    equal = sum(candidate == value for candidate in region_values)
    return round((below + equal / 2) / len(region_values) * 100)


def preference_utility(percentile: float, direction: str) -> float:
    if not 0 <= percentile <= 100:
        raise ValueError("percentile must be between 0 and 100")
    if direction == "higher":
        return percentile
    if direction == "lower":
        return 100 - percentile
    if direction == "target-range":
        return max(0, 100 - abs(percentile - 50) * 2)
    raise ValueError(f"unsupported direction: {direction}")
