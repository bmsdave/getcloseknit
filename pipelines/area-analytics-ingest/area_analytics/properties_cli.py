import argparse
import json
from pathlib import Path

from .property_pack import build_property_pack


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a deterministic property pack from a reviewed transaction input"
    )
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    pack = build_property_pack(json.loads(arguments.input.read_text()))
    encoded = json.dumps(pack, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    arguments.output.write_text(encoded)


if __name__ == "__main__":
    main()
