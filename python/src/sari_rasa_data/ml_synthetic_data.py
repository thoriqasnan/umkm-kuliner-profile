"""Deterministic transaction generator for time-series forecasting practice.

This Phase 5 dataset is deliberately separate from both the canonical analytics
fixture and the Phase 4 large integration dataset.  Daily demand is generated
chronologically so it contains learnable calendar, trend, continuity, and
promotion signals while retaining irreducible random variation.
"""

import csv
import random
from datetime import date, timedelta
from pathlib import Path

from sari_rasa_data.synthetic_data import (
    PAYMENT_METHODS,
    PAYMENT_METHOD_WEIGHTS,
    PRODUCT_CATALOG,
    _weighted_sample_without_replacement,
)
from sari_rasa_data.transactions import REQUIRED_TRANSACTION_FIELDS, Transaction


ML_DEFAULT_SEED = 20260901
ML_DATASET_START_DATE = date(2024, 1, 1)
ML_DATASET_END_DATE = date(2025, 12, 31)

ML_WEEKDAY_MULTIPLIERS = (0.90, 0.92, 0.96, 1.00, 1.08, 1.30, 1.24)
ML_MONTH_MULTIPLIERS = {
    1: 1.05,
    2: 0.92,
    3: 0.95,
    4: 0.98,
    5: 1.00,
    6: 1.02,
    7: 1.04,
    8: 1.00,
    9: 0.96,
    10: 1.02,
    11: 1.08,
    12: 1.20,
}

# Promotions are known calendar windows, but are not included in the first
# feature frame.  They create useful, non-perfect external variation for later
# forecasting lessons rather than leaking future target values into rows.
ML_PROMOTION_WINDOWS = (
    (date(2024, 3, 25), date(2024, 4, 7), 1.24),
    (date(2024, 12, 15), date(2024, 12, 24), 1.30),
    (date(2025, 3, 17), date(2025, 3, 30), 1.24),
    (date(2025, 12, 15), date(2025, 12, 24), 1.30),
)

_CANONICAL_DATASET_PATH = (
    Path(__file__).resolve().parents[2] / "data" / "transactions.csv"
)


def promotion_multiplier(day: date) -> float:
    """Return the configured demand multiplier for a known promotion date."""
    for start, end, multiplier in ML_PROMOTION_WINDOWS:
        if start <= day <= end:
            return multiplier
    return 1.0


def is_promotion_date(day: date) -> bool:
    """Return whether ``day`` belongs to a configured promotion window."""
    return promotion_multiplier(day) > 1.0


def _product_weights(progress: float) -> list[float]:
    """Return catalog weights with small, gradual product-mix evolution."""
    weights = []
    for index, product in enumerate(PRODUCT_CATALOG):
        evolution = 1.0
        if index in (2, 12, 19):
            evolution += 0.18 * progress
        elif index in (5, 15, 22):
            evolution -= 0.10 * progress
        weights.append(float(product["weight"]) * evolution)
    return weights


def _daily_quantities(
    rng: random.Random, start_date: date, end_date: date
) -> list[tuple[date, int]]:
    """Generate chronological aggregate demand with moderate AR continuity."""
    if end_date < start_date:
        raise ValueError("end date must not be before start date")

    day_count = (end_date - start_date).days + 1
    previous_demand = 72.0
    previous_structural = 72.0
    quantities = []

    for offset in range(day_count):
        day = start_date + timedelta(days=offset)
        progress = offset / max(day_count - 1, 1)
        growth = 1.0 + (0.16 * progress)
        structural = (
            72.0
            * growth
            * ML_WEEKDAY_MULTIPLIERS[day.weekday()]
            * ML_MONTH_MULTIPLIERS[day.month]
            * promotion_multiplier(day)
        )
        continuity = 0.38 * (previous_demand - previous_structural)
        demand = max(18, round(structural + continuity + rng.gauss(0.0, 7.5)))
        quantities.append((day, demand))
        previous_demand = float(demand)
        previous_structural = structural

    return quantities


def generate_ml_transactions(
    seed: int = ML_DEFAULT_SEED,
    start_date: date = ML_DATASET_START_DATE,
    end_date: date = ML_DATASET_END_DATE,
) -> list[Transaction]:
    """Return deterministic transaction lines for the configured daily series."""
    rng = random.Random(seed)
    catalog_by_id = {
        str(product["product_id"]): product for product in PRODUCT_CATALOG
    }
    product_ids = list(catalog_by_id)
    transactions: list[Transaction] = []
    order_number = 0
    total_days = (end_date - start_date).days + 1

    for day_index, (order_day, daily_quantity) in enumerate(
        _daily_quantities(rng, start_date, end_date)
    ):
        remaining = daily_quantity
        progress = day_index / max(total_days - 1, 1)
        product_weights = _product_weights(progress)

        while remaining > 0:
            order_number += 1
            line_count = min(rng.choices((1, 2, 3), (0.58, 0.30, 0.12), k=1)[0], remaining)
            selected = _weighted_sample_without_replacement(
                rng, product_ids, product_weights, line_count
            )
            payment_method = rng.choices(
                PAYMENT_METHODS, weights=PAYMENT_METHOD_WEIGHTS, k=1
            )[0]

            for line_index, product_id in enumerate(selected):
                lines_left = len(selected) - line_index
                maximum = min(5, remaining - (lines_left - 1))
                quantity = rng.randint(1, maximum)
                product = catalog_by_id[product_id]
                transactions.append(
                    {
                        "order_id": f"ORD-ML-{order_number:07d}",
                        "order_date": order_day.isoformat(),
                        "product_id": str(product["product_id"]),
                        "product_name": str(product["product_name"]),
                        "category": str(product["category"]),
                        "quantity": quantity,
                        "unit_price": int(product["unit_price"]),
                        "payment_method": payment_method,
                    }
                )
                remaining -= quantity

    return transactions


def write_ml_transactions_csv(
    path: Path | str,
    seed: int = ML_DEFAULT_SEED,
    start_date: date = ML_DATASET_START_DATE,
    end_date: date = ML_DATASET_END_DATE,
) -> int:
    """Write a reproducible ML dataset without allowing canonical overwrite."""
    file_path = Path(path)
    if file_path.resolve() == _CANONICAL_DATASET_PATH.resolve():
        raise ValueError("the canonical analytics dataset cannot be overwritten")

    transactions = generate_ml_transactions(seed, start_date, end_date)
    with file_path.open("w", encoding="utf-8", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=REQUIRED_TRANSACTION_FIELDS)
        writer.writeheader()
        writer.writerows(transactions)
    return len(transactions)
