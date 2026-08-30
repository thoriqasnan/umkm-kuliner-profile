import json
from pathlib import Path

import pandas as pd

from sari_rasa_data.data_loader import load_transactions_csv
from sari_rasa_data.data_transform import transform_transactions
from sari_rasa_data.dataframe import (
    TRANSACTION_COLUMNS,
    dataframe_to_records,
    load_transactions_dataframe,
    transactions_to_dataframe,
)

DATASET_PATH = Path(__file__).resolve().parents[1] / "data" / "transactions.csv"


def _transformed_transactions() -> list[dict[str, object]]:
    return [
        {
            "order_id": "ORD-TEST-001",
            "order_date": "2026-07-01",
            "product_id": "PRD-001",
            "product_name": "Nasi Goreng",
            "category": "Makanan",
            "quantity": 2,
            "unit_price": 15000,
            "payment_method": "QRIS",
            "line_total": 30000,
        },
        {
            "order_id": "ORD-TEST-002",
            "order_date": "2026-07-02",
            "product_id": "PRD-006",
            "product_name": "Es Teh",
            "category": "Minuman",
            "quantity": 3,
            "unit_price": 5000,
            "payment_method": "Tunai",
            "line_total": 15000,
        },
    ]


def test_transformed_transactions_convert_to_dataframe():
    dataframe = transactions_to_dataframe(_transformed_transactions())

    assert isinstance(dataframe, pd.DataFrame)
    assert dataframe.shape == (2, 9)


def test_dataframe_has_expected_columns_in_order():
    dataframe = transactions_to_dataframe(_transformed_transactions())

    assert tuple(dataframe.columns) == TRANSACTION_COLUMNS


def test_dataframe_numeric_columns_have_integer_dtype():
    dataframe = transactions_to_dataframe(_transformed_transactions())

    assert pd.api.types.is_integer_dtype(dataframe["quantity"])
    assert pd.api.types.is_integer_dtype(dataframe["unit_price"])
    assert pd.api.types.is_integer_dtype(dataframe["line_total"])


def test_dataframe_values_match_source_records():
    records = _transformed_transactions()

    dataframe = transactions_to_dataframe(records)

    assert dataframe.loc[0, "product_name"] == records[0]["product_name"]
    assert dataframe.loc[1, "line_total"] == records[1]["line_total"]


def test_dataframe_creation_does_not_mutate_input():
    records = _transformed_transactions()
    original = [record.copy() for record in records]

    transactions_to_dataframe(records)

    assert records == original


def test_empty_input_has_predictable_columns():
    dataframe = transactions_to_dataframe([])

    assert dataframe.empty
    assert tuple(dataframe.columns) == TRANSACTION_COLUMNS


def test_canonical_csv_uses_phase_4b_pipeline():
    loaded = load_transactions_csv(DATASET_PATH)
    transformed = transform_transactions(loaded)

    expected = transactions_to_dataframe(transformed)
    actual = load_transactions_dataframe(DATASET_PATH)

    pd.testing.assert_frame_equal(actual, expected)


def test_canonical_dataframe_has_30_rows():
    dataframe = load_transactions_dataframe(DATASET_PATH)

    assert dataframe.shape == (30, 9)


def test_dataframe_to_records_preserves_contract():
    source = _transformed_transactions()
    dataframe = transactions_to_dataframe(source)

    assert dataframe_to_records(dataframe) == source


def test_dataframe_to_records_are_json_serializable():
    dataframe = load_transactions_dataframe(DATASET_PATH)
    records = dataframe_to_records(dataframe)

    assert json.loads(json.dumps(records)) == records
