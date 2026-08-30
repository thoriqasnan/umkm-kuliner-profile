"""Deterministic large synthetic transaction generator for Phase 4C-4.

This module generates a large (default 10,000-line) synthetic UMKM
transaction dataset that is separate from the small 30-row canonical
regression fixture at ``python/data/transactions.csv``. The canonical file
stays untouched; this module only ever writes to a different path such as
``python/data/transactions_large.csv``.

Generated rows use the exact Phase 4B schema (``REQUIRED_TRANSACTION_FIELDS``)
and intentionally omit ``line_total``, which remains a value derived by the
verified Phase 4B transformation pipeline rather than raw input data.

Reproducibility: every row is produced from a single ``random.Random(seed)``
instance. The same ``row_count`` and ``seed`` always produce byte-identical
output. ``DEFAULT_SEED`` below is the seed used to generate the committed
large dataset for this project.

The generator is not pure noise. It encodes a few explainable, moderate
patterns so later analysis has something real to discover:

- weekend dates (Saturday/Sunday) are weighted higher than weekday dates;
- each of the 9 covered months has its own demand multiplier, with a
  December peak and a February/March lull;
- 24 catalog products carry different popularity weights, so some products
  sell far more often than others;
- payment methods are weighted so QRIS is the most common method; and
- a small fraction of lines (about 0.4%) simulate bulk/catering orders with
  a much larger quantity than normal.

These are generation-time *design intentions*, not guaranteed analysis
results — the actual numbers must be read from running the analysis
pipeline over the generated data, not assumed from this docstring.
"""

import csv
import random
from datetime import date, timedelta
from pathlib import Path
from typing import Sequence

from sari_rasa_data.transactions import REQUIRED_TRANSACTION_FIELDS, Transaction

DEFAULT_ROW_COUNT = 10_000
DEFAULT_SEED = 20260901

DATASET_START_DATE = date(2025, 9, 1)
DATASET_END_DATE = date(2026, 5, 31)

PAYMENT_METHODS = ("QRIS", "Transfer", "Tunai")
PAYMENT_METHOD_WEIGHTS = (0.5, 0.3, 0.2)

LINE_COUNT_CHOICES = (1, 2, 3, 4)
LINE_COUNT_WEIGHTS = (0.5, 0.3, 0.15, 0.05)

QUANTITY_CHOICES = (1, 2, 3, 4, 5)
QUANTITY_WEIGHTS = (0.35, 0.3, 0.2, 0.1, 0.05)

BULK_LINE_PROBABILITY = 0.004
BULK_QUANTITY_RANGE = (10, 20)

MONTH_DEMAND_MULTIPLIERS = {
    9: 0.90,
    10: 1.00,
    11: 1.05,
    12: 1.35,
    1: 1.15,
    2: 0.85,
    3: 0.90,
    4: 1.00,
    5: 1.05,
}

WEEKEND_MULTIPLIER = 1.4

PRODUCT_CATALOG = (
    {"product_id": "PRD-L01", "product_name": "Nasi Goreng Spesial", "category": "Makanan", "unit_price": 22000, "weight": 12},
    {"product_id": "PRD-L02", "product_name": "Mie Ayam", "category": "Makanan", "unit_price": 18000, "weight": 10},
    {"product_id": "PRD-L03", "product_name": "Sate Ayam", "category": "Makanan", "unit_price": 25000, "weight": 8},
    {"product_id": "PRD-L04", "product_name": "Soto Ayam", "category": "Makanan", "unit_price": 20000, "weight": 7},
    {"product_id": "PRD-L05", "product_name": "Nasi Ayam Bakar", "category": "Makanan", "unit_price": 26000, "weight": 6},
    {"product_id": "PRD-L06", "product_name": "Gado-Gado", "category": "Makanan", "unit_price": 17000, "weight": 5},
    {"product_id": "PRD-L07", "product_name": "Bakso", "category": "Makanan", "unit_price": 19000, "weight": 9},
    {"product_id": "PRD-L08", "product_name": "Rendang", "category": "Makanan", "unit_price": 30000, "weight": 4},
    {"product_id": "PRD-L09", "product_name": "Ayam Penyet", "category": "Makanan", "unit_price": 23000, "weight": 6},
    {"product_id": "PRD-L10", "product_name": "Nasi Uduk", "category": "Makanan", "unit_price": 15000, "weight": 5},
    {"product_id": "PRD-L11", "product_name": "Es Teh Manis", "category": "Minuman", "unit_price": 5000, "weight": 14},
    {"product_id": "PRD-L12", "product_name": "Es Jeruk", "category": "Minuman", "unit_price": 8000, "weight": 10},
    {"product_id": "PRD-L13", "product_name": "Kopi Susu", "category": "Minuman", "unit_price": 12000, "weight": 9},
    {"product_id": "PRD-L14", "product_name": "Jus Alpukat", "category": "Minuman", "unit_price": 15000, "weight": 6},
    {"product_id": "PRD-L15", "product_name": "Es Campur", "category": "Minuman", "unit_price": 12000, "weight": 5},
    {"product_id": "PRD-L16", "product_name": "Teh Tawar", "category": "Minuman", "unit_price": 4000, "weight": 6},
    {"product_id": "PRD-L17", "product_name": "Es Kelapa Muda", "category": "Minuman", "unit_price": 10000, "weight": 5},
    {"product_id": "PRD-L18", "product_name": "Air Mineral", "category": "Minuman", "unit_price": 4000, "weight": 7},
    {"product_id": "PRD-L19", "product_name": "Pisang Goreng", "category": "Camilan", "unit_price": 10000, "weight": 8},
    {"product_id": "PRD-L20", "product_name": "Tahu Isi", "category": "Camilan", "unit_price": 7000, "weight": 7},
    {"product_id": "PRD-L21", "product_name": "Risoles", "category": "Camilan", "unit_price": 9000, "weight": 5},
    {"product_id": "PRD-L22", "product_name": "Cireng", "category": "Camilan", "unit_price": 6000, "weight": 6},
    {"product_id": "PRD-L23", "product_name": "Kerupuk", "category": "Camilan", "unit_price": 3000, "weight": 4},
    {"product_id": "PRD-L24", "product_name": "Martabak Mini", "category": "Camilan", "unit_price": 15000, "weight": 4},
)


def _build_date_range(start: date, end: date) -> list[date]:
    """Return every calendar date from ``start`` to ``end`` inclusive."""
    if end < start:
        raise ValueError("end date must not be before start date")
    day_count = (end - start).days + 1
    return [start + timedelta(days=offset) for offset in range(day_count)]


def _date_weight(day: date) -> float:
    """Return the relative demand weight for one calendar date."""
    weekday_multiplier = WEEKEND_MULTIPLIER if day.weekday() >= 5 else 1.0
    month_multiplier = MONTH_DEMAND_MULTIPLIERS.get(day.month, 1.0)
    return weekday_multiplier * month_multiplier


def _weighted_sample_without_replacement(
    rng: random.Random,
    population: Sequence[str],
    weights: Sequence[float],
    k: int,
) -> list[str]:
    """Return ``k`` distinct items chosen without replacement, honoring weights."""
    pool_ids = list(population)
    pool_weights = list(weights)
    chosen = []
    for _ in range(min(k, len(pool_ids))):
        picked = rng.choices(pool_ids, weights=pool_weights, k=1)[0]
        index = pool_ids.index(picked)
        chosen.append(pool_ids.pop(index))
        pool_weights.pop(index)
    return chosen


def generate_synthetic_transactions(
    row_count: int = DEFAULT_ROW_COUNT,
    seed: int = DEFAULT_SEED,
) -> list[Transaction]:
    """Return a deterministic list of synthetic transaction-line dictionaries.

    Each dictionary uses the Phase 4B schema fields only (no ``line_total``).
    Multiple consecutive lines may share one ``order_id`` to represent a
    single order containing several products. The same ``row_count`` and
    ``seed`` always produce the identical list.
    """
    if row_count <= 0:
        raise ValueError("row_count must be a positive integer")

    rng = random.Random(seed)
    dates = _build_date_range(DATASET_START_DATE, DATASET_END_DATE)
    date_weights = [_date_weight(day) for day in dates]

    product_ids = [product["product_id"] for product in PRODUCT_CATALOG]
    product_weights = [product["weight"] for product in PRODUCT_CATALOG]
    catalog_by_id = {product["product_id"]: product for product in PRODUCT_CATALOG}

    transactions: list[Transaction] = []
    order_number = 0
    lines_remaining = row_count

    while lines_remaining > 0:
        order_number += 1
        order_id = f"ORD-LARGE-{order_number:06d}"
        order_date = rng.choices(dates, weights=date_weights, k=1)[0].isoformat()
        payment_method = rng.choices(
            PAYMENT_METHODS, weights=PAYMENT_METHOD_WEIGHTS, k=1
        )[0]

        planned_line_count = rng.choices(
            LINE_COUNT_CHOICES, weights=LINE_COUNT_WEIGHTS, k=1
        )[0]
        line_count = min(planned_line_count, lines_remaining)

        chosen_product_ids = _weighted_sample_without_replacement(
            rng, product_ids, product_weights, line_count
        )

        for product_id in chosen_product_ids:
            product = catalog_by_id[product_id]
            quantity = rng.choices(QUANTITY_CHOICES, weights=QUANTITY_WEIGHTS, k=1)[0]
            if rng.random() < BULK_LINE_PROBABILITY:
                quantity = rng.randint(*BULK_QUANTITY_RANGE)

            transactions.append(
                {
                    "order_id": order_id,
                    "order_date": order_date,
                    "product_id": product["product_id"],
                    "product_name": product["product_name"],
                    "category": product["category"],
                    "quantity": quantity,
                    "unit_price": product["unit_price"],
                    "payment_method": payment_method,
                }
            )

        lines_remaining -= line_count

    return transactions


def write_synthetic_transactions_csv(
    path: Path | str,
    row_count: int = DEFAULT_ROW_COUNT,
    seed: int = DEFAULT_SEED,
) -> int:
    """Generate deterministic synthetic transactions and write them as CSV.

    Returns the number of transaction lines written. Never touches the
    canonical ``python/data/transactions.csv`` fixture.
    """
    transactions = generate_synthetic_transactions(row_count=row_count, seed=seed)
    file_path = Path(path)
    with file_path.open("w", encoding="utf-8", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=REQUIRED_TRANSACTION_FIELDS)
        writer.writeheader()
        writer.writerows(transactions)
    return len(transactions)
