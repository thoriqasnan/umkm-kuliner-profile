import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from sari_rasa_data.dataframe import load_transactions_dataframe, transactions_to_dataframe
from sari_rasa_data.numpy_analysis import (
    column_to_numpy,
    max_value,
    mean_value,
    median_value,
    min_value,
    percentile_value,
    standard_deviation,
    summarize_numeric_column,
)

DATASET_PATH = Path(__file__).resolve().parents[1] / "data" / "transactions.csv"


@pytest.fixture
def canonical_dataframe():
    return load_transactions_dataframe(DATASET_PATH)


def _sample_dataframe():
    return transactions_to_dataframe(
        [
            {"order_id": "ORD-1", "order_date": "2026-07-01", "product_id": "P-1", "product_name": "Produk A", "category": "Makanan", "quantity": 2, "unit_price": 1000, "payment_method": "QRIS", "line_total": 2000},
            {"order_id": "ORD-2", "order_date": "2026-07-02", "product_id": "P-2", "product_name": "Produk B", "category": "Makanan", "quantity": 4, "unit_price": 1500, "payment_method": "Tunai", "line_total": 6000},
            {"order_id": "ORD-3", "order_date": "2026-07-03", "product_id": "P-3", "product_name": "Produk C", "category": "Minuman", "quantity": 6, "unit_price": 500, "payment_method": "QRIS", "line_total": 3000},
        ]
    )


# --- NumPy foundation ---


def test_column_to_numpy_returns_ndarray():
    dataframe = _sample_dataframe()
    array = column_to_numpy(dataframe, "quantity")

    assert isinstance(array, np.ndarray)


def test_column_to_numpy_values_match_source():
    dataframe = _sample_dataframe()
    array = column_to_numpy(dataframe, "quantity")

    assert list(array) == [2, 4, 6]


def test_column_to_numpy_does_not_mutate_dataframe():
    dataframe = _sample_dataframe()
    original = dataframe.copy(deep=True)

    array = column_to_numpy(dataframe, "line_total")
    array[0] = 999999

    pd.testing.assert_frame_equal(dataframe, original)


def test_column_to_numpy_rejects_unsupported_column():
    dataframe = _sample_dataframe()

    with pytest.raises(ValueError, match="unsupported column"):
        column_to_numpy(dataframe, "payment_method")


def test_column_to_numpy_rejects_missing_column():
    dataframe = _sample_dataframe().drop(columns=["quantity"])

    with pytest.raises(KeyError):
        column_to_numpy(dataframe, "quantity")


# --- statistics ---


def test_mean_value():
    assert mean_value(np.array([1, 2, 3])) == pytest.approx(2.0)


def test_median_value():
    assert median_value(np.array([1, 2, 3, 4])) == pytest.approx(2.5)


def test_min_value():
    assert min_value(np.array([5, 1, 3])) == 1


def test_max_value():
    assert max_value(np.array([5, 1, 3])) == 5


def test_standard_deviation_is_population():
    values = np.array([2, 4, 4, 4, 5, 5, 7, 9])
    assert standard_deviation(values) == pytest.approx(2.0)


def test_percentile_25():
    values = np.array([1, 2, 3, 4])
    assert percentile_value(values, 25) == pytest.approx(1.75)


def test_percentile_50_matches_median():
    values = np.array([1, 2, 3, 4])
    assert percentile_value(values, 50) == pytest.approx(median_value(values))


def test_percentile_75():
    values = np.array([1, 2, 3, 4])
    assert percentile_value(values, 75) == pytest.approx(3.25)


def test_percentile_lower_boundary_zero():
    values = np.array([1, 2, 3, 4])
    assert percentile_value(values, 0) == 1


def test_percentile_upper_boundary_hundred():
    values = np.array([1, 2, 3, 4])
    assert percentile_value(values, 100) == 4


def test_percentile_below_zero_is_rejected():
    with pytest.raises(ValueError, match="between 0 and 100"):
        percentile_value(np.array([1, 2, 3]), -1)


def test_percentile_above_hundred_is_rejected():
    with pytest.raises(ValueError, match="between 0 and 100"):
        percentile_value(np.array([1, 2, 3]), 101)


@pytest.mark.parametrize(
    "func, kwargs",
    [
        (mean_value, {}),
        (median_value, {}),
        (min_value, {}),
        (max_value, {}),
        (standard_deviation, {}),
    ],
)
def test_empty_array_statistics_raise_value_error(func, kwargs):
    with pytest.raises(ValueError, match="empty"):
        func(np.array([]), **kwargs)


def test_empty_array_percentile_raises_value_error():
    with pytest.raises(ValueError, match="empty"):
        percentile_value(np.array([]), 50)


def test_empty_array_summary_raises_value_error():
    with pytest.raises(ValueError, match="empty"):
        summarize_numeric_column(np.array([]))


# --- JSON / scalar types ---


def test_statistics_return_plain_python_scalars():
    values = np.array([1, 2, 3])

    assert type(mean_value(values)) is float
    assert type(median_value(values)) is float
    assert type(min_value(values)) is float
    assert type(max_value(values)) is float
    assert type(standard_deviation(values)) is float
    assert type(percentile_value(values, 50)) is float


def test_summary_dictionary_is_json_serializable():
    summary = summarize_numeric_column(np.array([1, 2, 3, 4, 5]))

    assert json.loads(json.dumps(summary)) == summary


# --- canonical integration ---


def test_canonical_pipeline_produces_dataframe_and_numpy_array(canonical_dataframe):
    quantity_array = column_to_numpy(canonical_dataframe, "quantity")

    assert canonical_dataframe.shape == (30, 9)
    assert quantity_array.shape == (30,)


def test_canonical_quantity_statistics_are_deterministic(canonical_dataframe):
    quantity = column_to_numpy(canonical_dataframe, "quantity")
    summary = summarize_numeric_column(quantity)

    assert summary["count"] == 30
    assert summary["mean"] == pytest.approx(1.7666666666666666)
    assert summary["median"] == pytest.approx(2.0)
    assert summary["min"] == pytest.approx(1.0)
    assert summary["max"] == pytest.approx(3.0)
    assert summary["std"] == pytest.approx(0.7156970184527962)
    assert summary["p25"] == pytest.approx(1.0)
    assert summary["p75"] == pytest.approx(2.0)


def test_canonical_line_total_statistics_are_deterministic(canonical_dataframe):
    line_total = column_to_numpy(canonical_dataframe, "line_total")
    summary = summarize_numeric_column(line_total)

    assert summary["count"] == 30
    assert summary["mean"] == pytest.approx(24833.333333333332)
    assert summary["median"] == pytest.approx(21000.0)
    assert summary["min"] == pytest.approx(8000.0)
    assert summary["max"] == pytest.approx(60000.0)
    assert summary["std"] == pytest.approx(14392.320483121855)
    assert summary["p25"] == pytest.approx(12750.0)
    assert summary["p75"] == pytest.approx(35500.0)
