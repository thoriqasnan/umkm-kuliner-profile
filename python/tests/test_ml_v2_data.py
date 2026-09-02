import csv
from datetime import date
from pathlib import Path

import pytest

from sari_rasa_data.application_catalog import APPLICATION_PRODUCT_CATALOG
from sari_rasa_data.ml_v2_data import daily_row_counts, iter_v2_transactions, write_v2_transactions_csv
from sari_rasa_data.transactions import REQUIRED_TRANSACTION_FIELDS


def test_small_v2_generation_is_exact_deterministic_and_boundary_complete():
    kwargs = {"row_count": 2000, "seed": 42, "start_date": date(2026, 1, 1), "end_date": date(2026, 1, 10)}
    first = list(iter_v2_transactions(**kwargs))
    second = list(iter_v2_transactions(**kwargs))
    assert first == second
    assert len(first) == 2000
    assert first[0]["order_date"] == "2026-01-01"
    assert first[-1]["order_date"] == "2026-01-10"
    assert {row["order_date"] for row in first} == {date(2026, 1, day).isoformat() for day in range(1, 11)}


def test_v2_rows_follow_catalog_and_schema():
    rows = list(iter_v2_transactions(row_count=1000, seed=7, start_date=date(2026, 2, 1), end_date=date(2026, 2, 5)))
    catalog = {str(item["product_id"]): item for item in APPLICATION_PRODUCT_CATALOG}
    assert all(tuple(row) == REQUIRED_TRANSACTION_FIELDS for row in rows)
    assert len(rows) == len({(row["order_id"], row["product_id"]) for row in rows})
    for row in rows:
        product = catalog[row["product_id"]]
        assert (row["product_name"], row["category"], row["unit_price"]) == (product["product_name"], product["category"], product["unit_price"])
        assert isinstance(row["quantity"], int) and row["quantity"] > 0
    assert {row["product_id"] for row in rows} == set(catalog)


def test_v2_writer_and_allocation_are_exact(tmp_path):
    destination = tmp_path / "v2.csv"
    count = write_v2_transactions_csv(destination, row_count=500, seed=1, start_date=date(2026, 3, 1), end_date=date(2026, 3, 4))
    with destination.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert count == len(rows) == 500
    assert sum(value for _, value in daily_row_counts(500, 1, date(2026, 3, 1), date(2026, 3, 4))) == 500


def test_v2_writer_refuses_canonical_fixture():
    canonical = Path(__file__).resolve().parents[1] / "data" / "transactions.csv"
    with pytest.raises(ValueError, match="canonical"):
        write_v2_transactions_csv(canonical, row_count=1000)
