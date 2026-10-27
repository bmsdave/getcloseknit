import argparse
import json
from pathlib import Path

from .value_pack import build_value_pack


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a deterministic analytics value pack")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    payload = json.loads(arguments.input.read_text())
    pack = build_value_pack(
        payload["metricId"], payload["period"], payload["source"], payload["values"]
    )
    encoded = json.dumps(pack, indent=2, sort_keys=True) + "\n"
    arguments.output.write_text(encoded)


if __name__ == "__main__":
    main()
