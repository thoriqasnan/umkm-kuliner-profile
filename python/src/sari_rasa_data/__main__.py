"""Phase 4A-3 entry point: run the Python foundation as a small example.

Execute the package directly with:

    PYTHONPATH=python/src python -m sari_rasa_data

This is a learning example, not a production CLI. It has no database,
network, or filesystem side effects: it only calls the existing functions
in foundation.py and prints their result as JSON.
"""

import json

from sari_rasa_data.foundation import count_by_category, normalize_order, total_quantity

SAMPLE_ORDER = {
    "customer_name": "Budi",
    "items": [
        {"name": "Nasi Goreng", "category": "Makanan", "quantity": 2, "unit_price": 15000},
        {"name": "Es Teh", "category": "Minuman", "quantity": 3, "unit_price": 5000},
    ],
}


def build_example_report() -> dict:
    """Combine results from foundation.py into one JSON-compatible report.

    All validation, totals, and grouping come from foundation.py; this
    function only composes their results and adds no business logic itself.
    """
    return {
        "order": normalize_order(SAMPLE_ORDER),
        "total_quantity": total_quantity(SAMPLE_ORDER["items"]),
        "count_by_category": count_by_category(SAMPLE_ORDER["items"]),
    }


def main() -> None:
    report = build_example_report()
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
