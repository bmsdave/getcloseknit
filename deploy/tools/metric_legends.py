"""Legend stops that follow the data, applied to metric_definition (idempotent).

Income: London MSOAs run from about £60k (10th percentile) to £108k (98th); the old scale (£30k..£80k+)
put a third of London in its top colour. Mirrors web/src/lib/fixtures.ts.

  python3 deploy/tools/metric_legends.py postgresql://...
"""
import json
import sys

LEGENDS = {
    "income": [
        {"value": 55000, "colour": "#2a6f97", "label": "£55k"},
        {"value": 75000, "colour": "#8ecae6", "label": "£75k"},
        {"value": 95000, "colour": "#f4d35e", "label": "£95k"},
        {"value": 110000, "colour": "#e07a1f", "label": "£110k+"},
    ],
}

SQL = "UPDATE metric_definition SET definition = jsonb_set(definition::jsonb, '{legend}', %s::jsonb) WHERE id = %s"


def main(url: str) -> None:
    import psycopg

    with psycopg.connect(url) as connection:
        for metric_id, stops in LEGENDS.items():
            changed = connection.execute(SQL, (json.dumps(stops), metric_id)).rowcount
            print(f"metric_legends: {metric_id} {'updated' if changed else 'not found'}")


if __name__ == "__main__":
    main(sys.argv[1])
