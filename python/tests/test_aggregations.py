import json
from pathlib import Path

import pytest

from sari_rasa_data.aggregations import (
    daily_revenue,
    quantity_by_product,
    revenue_by_category,
    summarize_transactions,
    total_quantity_sold,
    total_revenue,
)
from sari_rasa_data.data_loader import load_transactions_csv
from sari_rasa_data.data_transform import clean_transactions, transform_transactions

DATASET_PATH = Path(__file__).resolve().parents[1] / "data" / "transactions.csv"


def _transactions() -> list[dict[str, object]]:
    return [
        {"order_id": "ORD-001", "order_date": "2026-07-01", "product_id": "PRD-001", "product_name": "Nasi Goreng", "category": "Makanan", "quantity": 2, "unit_price": 15000, "payment_method": "QRIS", "line_total": 30000},
        {"order_id": "ORD-001", "order_date": "2026-07-01", "product_id": "PRD-006", "product_name": "Es Teh", "category": "Minuman", "quantity": 3, "unit_price": 5000, "payment_method": "QRIS", "line_total": 15000},
        {"order_id": "ORD-002", "order_date": "2026-07-02", "product_id": "PRD-001", "product_name": "Nasi Goreng", "category": "Makanan", "quantity": 1, "unit_price": 15000, "payment_method": "Tunai", "line_total": 15000},
    ]


def _canonical_summary() -> dict[str, int | dict[str, int]]:
    loaded = load_transactions_csv(DATASET_PATH)
    cleaned = clean_transactions(loaded)
    transformed = transform_transactions(cleaned)
    return summarize_transactions(transformed)


def test_total_revenue_sums_line_totals():
    assert total_revenue(_transactions()) == 60000


def test_total_quantity_sold_sums_transaction_lines():
    assert total_quantity_sold(_transactions()) == 6


def test_revenue_by_category_accumulates_repeated_category():
    assert revenue_by_category(_transactions()) == {"Makanan": 45000, "Minuman": 15000}


def test_quantity_by_product_accumulates_repeated_product():
    assert quantity_by_product(_transactions()) == {"Es Teh": 3, "Nasi Goreng": 3}


def test_daily_revenue_accumulates_repeated_date():
    assert daily_revenue(_transactions()) == {"2026-07-01": 45000, "2026-07-02": 15000}


@pytest.mark.parametrize(
    ("aggregation", "expected"),
    [(total_revenue, 0), (total_quantity_sold, 0), (revenue_by_category, {}), (quantity_by_product, {}), (daily_revenue, {})],
)
def test_aggregations_have_predictable_empty_behavior(aggregation, expected):
    assert aggregation([]) == expected


def test_summary_has_predictable_empty_behavior():
    assert summarize_transactions([]) == {"total_revenue": 0, "total_quantity_sold": 0, "revenue_by_category": {}, "quantity_by_product": {}, "daily_revenue": {}}


def test_grouped_results_have_deterministic_key_order():
    summary = summarize_transactions(list(reversed(_transactions())))
    assert list(summary["revenue_by_category"]) == ["Makanan", "Minuman"]
    assert list(summary["quantity_by_product"]) == ["Es Teh", "Nasi Goreng"]
    assert list(summary["daily_revenue"]) == ["2026-07-01", "2026-07-02"]


def test_summary_is_json_serializable():
    summary = summarize_transactions(_transactions())
    assert json.loads(json.dumps(summary)) == summary


def test_canonical_dataset_complete_pipeline_results():
    assert _canonical_summary() == {
        "total_revenue": 745000,
        "total_quantity_sold": 53,
        "revenue_by_category": {"Camilan": 120000, "Makanan": 504000, "Minuman": 121000},
        "quantity_by_product": {"Es Teh": 9, "Jus Jeruk": 4, "Kopi Susu": 3, "Mie Goreng": 4, "Nasi Ayam": 5, "Nasi Goreng": 6, "Pisang Goreng": 6, "Sate Ayam": 4, "Soto Ayam": 6, "Tahu Isi": 6},
        "daily_revenue": {"2026-07-01": 68000, "2026-07-02": 37000, "2026-07-03": 94000, "2026-07-04": 30000, "2026-07-05": 72000, "2026-07-06": 54000, "2026-07-07": 34000, "2026-07-08": 32000, "2026-07-09": 39000, "2026-07-10": 94000, "2026-07-11": 22000, "2026-07-12": 27000, "2026-07-13": 40000, "2026-07-14": 46000, "2026-07-15": 56000},
    }


def test_aggregations_do_not_mutate_transactions():
    transactions = _transactions()
    original = [transaction.copy() for transaction in transactions]
    summarize_transactions(transactions)
    assert transactions == original


def test_aggregation_requires_transformed_records():
    transaction = _transactions()[0]
    del transaction["line_total"]
    with pytest.raises(KeyError, match="line_total"):
        total_revenue([transaction])
