import hashlib
import json
import pathlib
import csv

import pytest

from sari_rasa_data.analysis_pipeline import load_analysis_dataframe, resolve_analytics_range, sales_trend_summary
from sari_rasa_data.service import CANONICAL_DATASET_PATH, build_sales_trend_analytics


def test_full_range_trend_is_reconciled_sorted_json_safe_and_non_mutating():
    dataframe = load_analysis_dataframe(CANONICAL_DATASET_PATH)
    original = dataframe.copy(deep=True)
    result = sales_trend_summary(dataframe, "2026-07-01", "2026-07-15")
    assert result["summary"] == {"total_revenue": 745000, "unique_orders": 20, "total_quantity": 53, "average_order_value": 37250.0}
    assert [point["date"] for point in result["daily_sales"]] == sorted(point["date"] for point in result["daily_sales"])
    assert sum(point["total_revenue"] for point in result["daily_sales"]) == result["summary"]["total_revenue"]
    assert sum(point["total_quantity"] for point in result["daily_sales"]) == result["summary"]["total_quantity"]
    assert result["high_day"] == {"date": "2026-07-03", "total_revenue": 94000}
    assert result["low_day"] == {"date": "2026-07-11", "total_revenue": 22000}
    json.dumps(result, allow_nan=False)
    assert dataframe.equals(original)


def test_partial_single_day_and_inclusive_bounds():
    partial = build_sales_trend_analytics(CANONICAL_DATASET_PATH, "2026-07-03", "2026-07-05")
    assert [point["date"] for point in partial["daily_sales"]] == ["2026-07-03", "2026-07-04", "2026-07-05"]
    single = build_sales_trend_analytics(CANONICAL_DATASET_PATH, "2026-07-04", "2026-07-04")
    assert single["summary"] == {"total_revenue": 30000, "unique_orders": 1, "total_quantity": 2, "average_order_value": 30000.0}


@pytest.mark.parametrize(("start", "end"), [("2026/07/01", "2026-07-02"), ("2026-02-30", "2026-03-01"), ("2026-07-02", "2026-07-01")])
def test_invalid_ranges_are_rejected(start, end):
    with pytest.raises(ValueError):
        build_sales_trend_analytics(CANONICAL_DATASET_PATH, start, end)


def test_out_of_available_period_is_rejected():
    with pytest.raises(ValueError):
        build_sales_trend_analytics(CANONICAL_DATASET_PATH, "2026-08-01", "2026-08-03")


def test_filtered_summary_products_categories_reconcile():
    from sari_rasa_data.service import build_analytics_summary, build_categories_analytics, build_products_analytics
    summary = build_analytics_summary(CANONICAL_DATASET_PATH, "2026-07-03", "2026-07-05")
    products = build_products_analytics(CANONICAL_DATASET_PATH, "2026-07-03", "2026-07-05")["products"]
    categories = build_categories_analytics(CANONICAL_DATASET_PATH, "2026-07-03", "2026-07-05")["categories"]
    assert sum(item["total_revenue"] for item in products) == summary["total_revenue"]
    assert sum(item["total_quantity"] for item in products) == summary["total_quantity"]
    assert sum(item["total_revenue"] for item in categories) == summary["total_revenue"]


def test_dataset_boundaries_and_in_bound_empty_gap_are_derived_from_dataframe():
    dataframe = load_analysis_dataframe(CANONICAL_DATASET_PATH)
    sparse = dataframe.loc[dataframe["order_date"].isin(["2026-07-01", "2026-07-03"])].reset_index(drop=True)
    resolved = resolve_analytics_range(sparse, "2026-07-02", "2026-07-02")
    assert resolved["min_available_date"] == "2026-07-01"
    assert resolved["max_available_date"] == "2026-07-03"
    assert resolved["dataframe"].empty
    single = resolve_analytics_range(dataframe.loc[dataframe["order_date"] == "2026-07-04"].reset_index(drop=True))
    assert single["min_available_date"] == single["max_available_date"] == "2026-07-04"


def test_sparse_dataset_gap_returns_empty_for_all_analytics_builders(tmp_path):
    from sari_rasa_data.service import build_analytics_summary, build_categories_analytics, build_products_analytics
    with pathlib.Path(CANONICAL_DATASET_PATH).open(newline="", encoding="utf-8") as source:
        reader = csv.DictReader(source); rows = [row for row in reader if row["order_date"] in {"2026-07-01", "2026-07-03"}]; fields = reader.fieldnames
    sparse_path = tmp_path / "sparse.csv"
    with sparse_path.open("w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=fields); writer.writeheader(); writer.writerows(rows)
    summary = build_analytics_summary(sparse_path, "2026-07-02", "2026-07-02")
    assert summary == {"total_revenue": 0, "unique_orders": 0, "total_quantity": 0, "average_order_value": 0.0}
    assert build_products_analytics(sparse_path, "2026-07-02", "2026-07-02") == {"products": []}
    assert build_categories_analytics(sparse_path, "2026-07-02", "2026-07-02") == {"categories": []}
    trend = build_sales_trend_analytics(sparse_path, "2026-07-02", "2026-07-02")
    assert trend["daily_sales"] == [] and trend["available_period"] == {"min_available_date": "2026-07-01", "max_available_date": "2026-07-03"}


def test_canonical_csv_checksum_is_unchanged():
    assert hashlib.sha256(pathlib.Path(CANONICAL_DATASET_PATH).read_bytes()).hexdigest() == "54c27fb9d059b45561b7f9033a0ed83bdfa49349407d8a6a76d9a25e38f7bf8c"
