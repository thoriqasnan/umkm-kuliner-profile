"""Streaming deterministic 750K-transaction generator for ML experiment V2."""

import csv
import hashlib
import math
import random
from collections.abc import Iterator
from datetime import date, timedelta
from pathlib import Path

from sari_rasa_data.application_catalog import APPLICATION_PRODUCT_CATALOG
from sari_rasa_data.synthetic_data import (
    PAYMENT_METHODS,
    PAYMENT_METHOD_WEIGHTS,
    _weighted_sample_without_replacement,
)
from sari_rasa_data.transactions import REQUIRED_TRANSACTION_FIELDS, Transaction

V2_DEFAULT_SEED = 20260902
V2_DEFAULT_ROW_COUNT = 750_000
V2_START_DATE = date(2024, 10, 9)
V2_END_DATE = date(2026, 9, 1)
V2_DATASET_IDENTITY = "sari_rasa_ml_synthetic_transactions_v2"
V2_DEFAULT_PATH = Path(__file__).resolve().parents[2] / "data" / "transactions_ml_v2.csv"

WEEKDAY_MULTIPLIERS = (0.90, 0.93, 0.97, 1.00, 1.08, 1.27, 1.20)
MONTH_MULTIPLIERS = {1: 1.04, 2: 0.94, 3: 0.97, 4: 1.01, 5: 1.03, 6: 1.00,
                     7: 1.02, 8: 1.01, 9: 0.97, 10: 1.00, 11: 1.07, 12: 1.16}
EVENT_WINDOWS = (
    (date(2024, 12, 18), date(2024, 12, 27), 1.16),
    (date(2025, 3, 24), date(2025, 4, 6), 1.13),
    (date(2025, 12, 18), date(2025, 12, 27), 1.17),
    (date(2026, 3, 9), date(2026, 3, 22), 1.14),
)
SPIKE_DATES = {date(2025, 6, 14), date(2025, 11, 29), date(2026, 6, 20)}
_CANONICAL_PATH = Path(__file__).resolve().parents[2] / "data" / "transactions.csv"


def _dates(start_date: date, end_date: date) -> list[date]:
    if end_date < start_date:
        raise ValueError("end date must not be before start date")
    return [start_date + timedelta(days=i) for i in range((end_date - start_date).days + 1)]


def event_multiplier(day: date) -> float:
    for start, end, multiplier in EVENT_WINDOWS:
        if start <= day <= end:
            return multiplier
    return 1.0


def daily_row_counts(row_count: int, seed: int, start_date: date, end_date: date) -> list[tuple[date, int]]:
    """Allocate exactly ``row_count`` lines across every date without truncation."""
    days = _dates(start_date, end_date)
    if not isinstance(row_count, int) or row_count < len(days):
        raise ValueError("row_count must be an integer at least equal to the day count")
    rng = random.Random(seed)
    residual = 0.0
    weights = []
    for index, day in enumerate(days):
        progress = index / max(len(days) - 1, 1)
        innovation = rng.gauss(0.0, 0.045)
        residual = 0.55 * residual + innovation
        weight = (1.0 + 0.14 * progress) * WEEKDAY_MULTIPLIERS[day.weekday()]
        weight *= MONTH_MULTIPLIERS[day.month] * event_multiplier(day) * math.exp(residual)
        if day in SPIKE_DATES:
            weight *= 1.28
        weights.append(weight)
    remaining = row_count - len(days)
    exact = [remaining * weight / sum(weights) for weight in weights]
    counts = [1 + math.floor(value) for value in exact]
    remainders = sorted(range(len(days)), key=lambda i: (exact[i] - math.floor(exact[i]), -i), reverse=True)
    for index in remainders[:row_count - sum(counts)]:
        counts[index] += 1
    assert sum(counts) == row_count
    return list(zip(days, counts, strict=True))


def iter_v2_transactions(
    row_count: int = V2_DEFAULT_ROW_COUNT,
    seed: int = V2_DEFAULT_SEED,
    start_date: date = V2_START_DATE,
    end_date: date = V2_END_DATE,
) -> Iterator[Transaction]:
    """Yield deterministic schema-valid rows in chronological order."""
    rng = random.Random(seed + 1)
    allocation = daily_row_counts(row_count, seed, start_date, end_date)
    catalog = {str(item["product_id"]): item for item in APPLICATION_PRODUCT_CATALOG}
    product_ids = list(catalog)
    order_number = 0
    total_days = len(allocation)
    for day_index, (day, day_rows) in enumerate(allocation):
        progress = day_index / max(total_days - 1, 1)
        weights = []
        for index, item in enumerate(APPLICATION_PRODUCT_CATALOG):
            evolution = 1.0 + (0.20 * progress if index in (2, 6, 9) else 0.0)
            evolution -= 0.10 * progress if index in (3, 7, 10) else 0.0
            weights.append(float(item["weight"]) * evolution)
        remaining = day_rows
        while remaining:
            order_number += 1
            line_count = min(rng.choices((1, 2, 3, 4), (0.48, 0.31, 0.16, 0.05), k=1)[0], remaining)
            chosen = _weighted_sample_without_replacement(rng, product_ids, weights, line_count)
            payment = rng.choices(PAYMENT_METHODS, weights=PAYMENT_METHOD_WEIGHTS, k=1)[0]
            for product_id in chosen:
                product = catalog[product_id]
                quantity = rng.choices((1, 2, 3, 4, 5), (0.36, 0.30, 0.19, 0.10, 0.05), k=1)[0]
                if rng.random() < 0.003:
                    quantity = rng.randint(8, 16)
                yield {
                    "order_id": f"ORD-MLV2-{order_number:08d}",
                    "order_date": day.isoformat(),
                    "product_id": str(product["product_id"]),
                    "product_name": str(product["product_name"]),
                    "category": str(product["category"]),
                    "quantity": quantity,
                    "unit_price": int(product["unit_price"]),
                    "payment_method": payment,
                }
            remaining -= line_count


def write_v2_transactions_csv(path: Path | str = V2_DEFAULT_PATH, **kwargs: object) -> int:
    destination = Path(path)
    if destination.resolve() == _CANONICAL_PATH.resolve():
        raise ValueError("the canonical analytics dataset cannot be overwritten")
    destination.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with destination.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=REQUIRED_TRANSACTION_FIELDS)
        writer.writeheader()
        for row in iter_v2_transactions(**kwargs):
            writer.writerow(row)
            count += 1
    return count


def sha256_file(path: Path | str) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    written = write_v2_transactions_csv()
    print(f"wrote {written} rows to {V2_DEFAULT_PATH}")
    print(f"sha256 {sha256_file(V2_DEFAULT_PATH)}")
