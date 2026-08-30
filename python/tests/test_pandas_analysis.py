import json
from pathlib import Path

import pandas as pd
import pytest

from sari_rasa_data.aggregations import (
    daily_revenue,
    quantity_by_product,
    revenue_by_category,
    total_revenue,
)
from sari_rasa_data.data_loader import load_transactions_csv
from sari_rasa_data.data_transform import transform_transactions
from sari_rasa_data.dataframe import (
    load_transactions_dataframe,
    transactions_to_dataframe,
)
from sari_rasa_data.pandas_analysis import (
    filter_by_category,
    filter_by_date_range,
    filter_by_payment_method,
    pandas_daily_revenue,
    pandas_quantity_by_product,
    pandas_revenue_by_category,
    pandas_total_revenue,
    product_quantity_ranking,
)

DATASET_PATH = Path(__file__).resolve().parents[1] / "data" / "transactions.csv"


@pytest.fixture
def canonical_dataframe():
    return load_transactions_dataframe(DATASET_PATH)


def test_filter_by_category(canonical_dataframe):
    filtered = filter_by_category(canonical_dataframe, "Makanan")

    assert len(filtered) == 15
    assert set(filtered["category"]) == {"Makanan"}


def test_filter_by_payment_method(canonical_dataframe):
    filtered = filter_by_payment_method(canonical_dataframe, "QRIS")

    assert len(filtered) == 12
    assert set(filtered["payment_method"]) == {"QRIS"}


def test_filter_by_date_range_is_inclusive(canonical_dataframe):
    filtered = filter_by_date_range(
        canonical_dataframe, "2026-07-01", "2026-07-02"
    )

    assert len(filtered) == 5
    assert set(filtered["order_date"]) == {"2026-07-01", "2026-07-02"}


def test_filter_by_category_rejects_unknown_value(canonical_dataframe):
    with pytest.raises(ValueError, match="unknown category"):
        filter_by_category(canonical_dataframe, "Dessert")


def test_filter_by_payment_rejects_unknown_value(canonical_dataframe):
    with pytest.raises(ValueError, match="unknown payment_method"):
        filter_by_payment_method(canonical_dataframe, "Kartu Kredit")


@pytest.mark.parametrize("invalid_date", ["01-07-2026", "20260701", "2026-02-30"])
def test_filter_by_date_range_rejects_invalid_date(
    canonical_dataframe, invalid_date
):
    with pytest.raises(ValueError, match="YYYY-MM-DD"):
        filter_by_date_range(canonical_dataframe, invalid_date, "2026-07-15")


def test_filter_by_date_range_rejects_reversed_range(canonical_dataframe):
    with pytest.raises(ValueError, match="must not be later"):
        filter_by_date_range(canonical_dataframe, "2026-07-15", "2026-07-01")


def test_filters_do_not_mutate_source_dataframe(canonical_dataframe):
    original = canonical_dataframe.copy(deep=True)

    filter_by_category(canonical_dataframe, "Minuman")
    filter_by_payment_method(canonical_dataframe, "Tunai")
    filter_by_date_range(canonical_dataframe, "2026-07-01", "2026-07-03")

    pd.testing.assert_frame_equal(canonical_dataframe, original)


def test_pandas_aggregations_for_repeated_groups():
    dataframe = transactions_to_dataframe(
        [
            {"order_id": "ORD-1", "order_date": "2026-07-01", "product_id": "P-1", "product_name": "Produk A", "category": "Makanan", "quantity": 2, "unit_price": 1000, "payment_method": "QRIS", "line_total": 2000},
            {"order_id": "ORD-2", "order_date": "2026-07-01", "product_id": "P-1", "product_name": "Produk A", "category": "Makanan", "quantity": 3, "unit_price": 1000, "payment_method": "Tunai", "line_total": 3000},
        ]
    )

    assert pandas_total_revenue(dataframe) == 5000
    assert pandas_revenue_by_category(dataframe) == {"Makanan": 5000}
    assert pandas_quantity_by_product(dataframe) == {"Produk A": 5}
    assert pandas_daily_revenue(dataframe) == {"2026-07-01": 5000}


def test_empty_dataframe_behavior():
    dataframe = transactions_to_dataframe([])

    assert pandas_total_revenue(dataframe) == 0
    assert pandas_revenue_by_category(dataframe) == {}
    assert pandas_quantity_by_product(dataframe) == {}
    assert pandas_daily_revenue(dataframe) == {}
    assert filter_by_category(dataframe, "Makanan").empty
    assert filter_by_payment_method(dataframe, "QRIS").empty
    assert filter_by_date_range(dataframe, "2026-07-01", "2026-07-15").empty
    assert product_quantity_ranking(dataframe) == []


def test_pandas_outputs_are_json_serializable(canonical_dataframe):
    output = {
        "total_revenue": pandas_total_revenue(canonical_dataframe),
        "revenue_by_category": pandas_revenue_by_category(canonical_dataframe),
        "quantity_by_product": pandas_quantity_by_product(canonical_dataframe),
        "daily_revenue": pandas_daily_revenue(canonical_dataframe),
        "product_ranking": product_quantity_ranking(canonical_dataframe),
    }

    assert json.loads(json.dumps(output)) == output


def test_product_ranking_is_quantity_descending(canonical_dataframe):
    ranking = product_quantity_ranking(canonical_dataframe)

    assert ranking[0] == {"product_name": "Es Teh", "quantity": 9}
    assert ranking[-1] == {"product_name": "Kopi Susu", "quantity": 3}


def test_product_ranking_has_deterministic_ties():
    dataframe = transactions_to_dataframe(
        [
            {"order_id": "ORD-1", "order_date": "2026-07-01", "product_id": "P-B", "product_name": "Produk B", "category": "Makanan", "quantity": 2, "unit_price": 1000, "payment_method": "QRIS", "line_total": 2000},
            {"order_id": "ORD-2", "order_date": "2026-07-02", "product_id": "P-A", "product_name": "Produk A", "category": "Makanan", "quantity": 2, "unit_price": 1000, "payment_method": "Tunai", "line_total": 2000},
        ]
    )

    assert product_quantity_ranking(dataframe) == [
        {"product_name": "Produk A", "quantity": 2},
        {"product_name": "Produk B", "quantity": 2},
    ]


def test_canonical_pandas_results_match_verified_values(canonical_dataframe):
    assert canonical_dataframe.shape == (30, 9)
    assert pandas_total_revenue(canonical_dataframe) == 745000
    assert pandas_revenue_by_category(canonical_dataframe) == {
        "Camilan": 120000,
        "Makanan": 504000,
        "Minuman": 121000,
    }


def test_pandas_results_equal_phase_4b_aggregations(canonical_dataframe):
    transformed = transform_transactions(load_transactions_csv(DATASET_PATH))

    assert pandas_total_revenue(canonical_dataframe) == total_revenue(transformed)
    assert pandas_revenue_by_category(canonical_dataframe) == revenue_by_category(
        transformed
    )
    assert pandas_quantity_by_product(canonical_dataframe) == quantity_by_product(
        transformed
    )
    assert pandas_daily_revenue(canonical_dataframe) == daily_revenue(transformed)
