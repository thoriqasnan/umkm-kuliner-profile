import json
from pathlib import Path

import pytest

from sari_rasa_data.data_loader import load_transactions_csv
from sari_rasa_data.data_transform import (
    clean_transaction,
    clean_transactions,
    transform_transaction,
    transform_transactions,
)

DATASET_PATH = Path(__file__).resolve().parents[1] / "data" / "transactions.csv"


def _valid_transaction() -> dict[str, object]:
    return {
        "order_id": "ORD-TEST-001",
        "order_date": "2026-07-01",
        "product_id": "PRD-001",
        "product_name": "Nasi Goreng",
        "category": "Makanan",
        "quantity": 2,
        "unit_price": 15000,
        "payment_method": "QRIS",
    }


def test_clean_transaction_trims_text_fields():
    transaction = _valid_transaction()
    transaction["order_id"] = "  ORD-TEST-001  "
    transaction["product_name"] = "  Nasi Goreng  "

    cleaned = clean_transaction(transaction)

    assert cleaned["order_id"] == "ORD-TEST-001"
    assert cleaned["product_name"] == "Nasi Goreng"


@pytest.mark.parametrize(
    ("dirty", "expected"),
    [(" makanan ", "Makanan"), ("MINUMAN", "Minuman"), ("CaMiLaN", "Camilan")],
)
def test_clean_transaction_normalizes_known_categories(dirty, expected):
    transaction = _valid_transaction()
    transaction["category"] = dirty

    assert clean_transaction(transaction)["category"] == expected


@pytest.mark.parametrize(
    ("dirty", "expected"),
    [(" qris ", "QRIS"), ("TRANSFER", "Transfer"), ("TuNaI", "Tunai")],
)
def test_clean_transaction_normalizes_known_payment_methods(dirty, expected):
    transaction = _valid_transaction()
    transaction["payment_method"] = dirty

    assert clean_transaction(transaction)["payment_method"] == expected


def test_clean_transaction_preserves_numeric_values():
    cleaned = clean_transaction(_valid_transaction())

    assert cleaned["quantity"] == 2
    assert cleaned["unit_price"] == 15000


def test_transform_transaction_adds_line_total():
    transformed = transform_transaction(_valid_transaction())

    assert transformed["line_total"] == 30000


@pytest.mark.parametrize(
    ("field", "value"),
    [("quantity", -5), ("unit_price", -100)],
)
def test_clean_transaction_does_not_repair_invalid_numbers(field, value):
    transaction = _valid_transaction()
    transaction[field] = value

    with pytest.raises(ValueError, match=field):
        clean_transaction(transaction)


def test_clean_transaction_rejects_invalid_date():
    transaction = _valid_transaction()
    transaction["order_date"] = "01-07-2026"

    with pytest.raises(ValueError, match="YYYY-MM-DD"):
        clean_transaction(transaction)


def test_clean_transaction_rejects_empty_required_text():
    transaction = _valid_transaction()
    transaction["product_name"] = "   "

    with pytest.raises(ValueError, match="product_name"):
        clean_transaction(transaction)


@pytest.mark.parametrize(
    ("field", "value"),
    [("category", "Dessert"), ("payment_method", "Kartu Kredit")],
)
def test_clean_transaction_rejects_unknown_normalized_values(field, value):
    transaction = _valid_transaction()
    transaction[field] = value

    with pytest.raises(ValueError, match=rf"unknown {field}"):
        clean_transaction(transaction)


def test_transform_transaction_does_not_mutate_input():
    transaction = _valid_transaction()
    original = transaction.copy()

    transform_transaction(transaction)

    assert transaction == original
    assert "line_total" not in transaction


def test_clean_transactions_returns_new_dictionaries():
    transaction = _valid_transaction()

    cleaned = clean_transactions([transaction])

    assert cleaned[0] == transaction
    assert cleaned[0] is not transaction


def test_transform_transactions_preserves_input_order():
    first = _valid_transaction()
    second = _valid_transaction()
    second["order_id"] = "ORD-TEST-002"

    transformed = transform_transactions([first, second])

    assert [item["order_id"] for item in transformed] == [
        "ORD-TEST-001",
        "ORD-TEST-002",
    ]


def test_canonical_dataset_loads_cleans_and_transforms():
    loaded = load_transactions_csv(DATASET_PATH)

    transformed = transform_transactions(loaded)

    assert len(transformed) == 30
    assert transformed[0]["line_total"] == 36000


def test_transformed_canonical_dataset_is_json_serializable():
    transformed = transform_transactions(load_transactions_csv(DATASET_PATH))

    serialized = json.dumps(transformed)

    assert json.loads(serialized) == transformed
