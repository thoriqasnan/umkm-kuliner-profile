import csv
from datetime import date
from pathlib import Path

import pytest

from sari_rasa_data.transactions import (
    REQUIRED_TRANSACTION_FIELDS,
    parse_transaction_row,
)

DATASET_PATH = Path(__file__).resolve().parents[1] / "data" / "transactions.csv"


def _valid_row() -> dict[str, str]:
    return {
        "order_id": "ORD-001",
        "order_date": "2026-07-01",
        "product_id": "PRD-001",
        "product_name": "Nasi Goreng",
        "category": "Makanan",
        "quantity": "2",
        "unit_price": "18000",
        "payment_method": "QRIS",
    }


def _read_dataset() -> tuple[list[str], list[dict[str, str]]]:
    with DATASET_PATH.open(encoding="utf-8", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        return reader.fieldnames or [], list(reader)


def test_dataset_file_exists():
    assert DATASET_PATH.is_file()


def test_dataset_is_non_empty_and_intentionally_small():
    _, rows = _read_dataset()
    assert 20 <= len(rows) <= 40


def test_dataset_has_expected_columns():
    columns, _ = _read_dataset()
    assert tuple(columns) == REQUIRED_TRANSACTION_FIELDS


def test_parse_transaction_row_accepts_and_normalizes_valid_row():
    transaction = parse_transaction_row(_valid_row())

    assert transaction["order_date"] == date(2026, 7, 1)
    assert transaction["quantity"] == 2
    assert transaction["unit_price"] == 18000


def test_parse_transaction_row_rejects_missing_required_field():
    row = _valid_row()
    del row["product_id"]

    with pytest.raises(KeyError, match="product_id"):
        parse_transaction_row(row)


@pytest.mark.parametrize("quantity", ["0", "-1", "two"])
def test_parse_transaction_row_rejects_invalid_quantity(quantity):
    row = _valid_row()
    row["quantity"] = quantity

    with pytest.raises(ValueError, match="quantity"):
        parse_transaction_row(row)


@pytest.mark.parametrize("unit_price", ["-1", "free"])
def test_parse_transaction_row_rejects_invalid_unit_price(unit_price):
    row = _valid_row()
    row["unit_price"] = unit_price

    with pytest.raises(ValueError, match="unit_price"):
        parse_transaction_row(row)


@pytest.mark.parametrize("order_date", ["01-07-2026", "20260701", "2026-02-30"])
def test_parse_transaction_row_enforces_iso_date(order_date):
    row = _valid_row()
    row["order_date"] = order_date

    with pytest.raises(ValueError, match="YYYY-MM-DD"):
        parse_transaction_row(row)


def test_all_canonical_dataset_rows_satisfy_schema():
    _, rows = _read_dataset()
    parsed_rows = [parse_transaction_row(row) for row in rows]

    assert len(parsed_rows) == len(rows)


def test_dataset_has_reusable_business_variation():
    _, rows = _read_dataset()

    assert len({row["order_date"] for row in rows}) > 1
    assert len({row["product_id"] for row in rows}) > 1
    assert len({row["category"] for row in rows}) > 1
    assert len({row["payment_method"] for row in rows}) > 1
    assert len({row["quantity"] for row in rows}) > 1
    assert len({row["unit_price"] for row in rows}) > 1
    assert len({row["product_id"] for row in rows}) < len(rows)
