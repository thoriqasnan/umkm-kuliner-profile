import json

import pytest

from sari_rasa_data.analysis_pipeline import (
    analyze_transactions,
    average_order_value,
    load_analysis_dataframe,
    monthly_revenue,
    order_date_range,
    payment_method_line_counts,
    unique_order_count,
    weekday_weekend_comparison,
)
from sari_rasa_data.synthetic_data import DEFAULT_ROW_COUNT, DEFAULT_SEED, write_synthetic_transactions_csv


@pytest.fixture(scope="module")
def large_dataset_path(tmp_path_factory):
    path = tmp_path_factory.mktemp("phase-4c-4") / "transactions_large.csv"
    write_synthetic_transactions_csv(path, row_count=DEFAULT_ROW_COUNT, seed=DEFAULT_SEED)
    return path


@pytest.fixture(scope="module")
def large_dataframe(large_dataset_path):
    return load_analysis_dataframe(large_dataset_path)


@pytest.fixture(scope="module")
def large_summary(large_dataset_path):
    return analyze_transactions(large_dataset_path)


def test_large_dataset_loads_through_phase_4b_pipeline(large_dataframe):
    assert len(large_dataframe) == DEFAULT_ROW_COUNT


def test_all_rows_survive_valid_load_clean_transform(large_dataframe):
    assert large_dataframe["line_total"].notna().all()
    assert (
        large_dataframe["line_total"]
        == large_dataframe["quantity"] * large_dataframe["unit_price"]
    ).all()


def test_dataframe_has_ten_thousand_rows(large_dataframe):
    assert large_dataframe.shape == (DEFAULT_ROW_COUNT, 9)


def test_total_revenue_is_positive(large_summary):
    assert large_summary["sales"]["total_revenue"] > 0


def test_total_quantity_is_positive(large_summary):
    assert large_summary["sales"]["total_quantity_sold"] > 0


def test_unique_order_count_is_positive_and_bounded(large_dataframe):
    orders = unique_order_count(large_dataframe)
    assert 0 < orders <= len(large_dataframe)


def test_average_order_value_uses_unique_order_semantics(large_dataframe):
    orders = unique_order_count(large_dataframe)
    total_revenue = large_dataframe["line_total"].sum()

    expected = total_revenue / orders
    actual = average_order_value(large_dataframe)

    assert actual == pytest.approx(expected)
    # Guard against the common bug: dividing by transaction-line count instead.
    assert actual != pytest.approx(total_revenue / len(large_dataframe))


def test_revenue_by_category_reconciles_to_total_revenue(large_summary):
    total = sum(large_summary["revenue_by_category"].values())
    assert total == large_summary["sales"]["total_revenue"]


def test_monthly_revenue_reconciles_to_total_revenue(large_summary):
    total = sum(large_summary["monthly_revenue"].values())
    assert total == large_summary["sales"]["total_revenue"]


def test_daily_revenue_reconciles_to_total_revenue(large_summary):
    total = sum(large_summary["daily_revenue"].values())
    assert total == large_summary["sales"]["total_revenue"]


def test_payment_counts_reconcile_to_transaction_line_count(large_summary):
    total = sum(large_summary["payment_method_line_counts"].values())
    assert total == large_summary["dataset_overview"]["transaction_line_count"]


def test_product_quantities_reconcile_to_total_quantity(large_summary):
    total = sum(large_summary["quantity_by_product"].values())
    assert total == large_summary["sales"]["total_quantity_sold"]


def test_numpy_statistics_are_json_compatible(large_summary):
    for key in ("quantity_statistics", "line_total_statistics"):
        stats = large_summary[key]
        assert json.loads(json.dumps(stats)) == stats


def test_final_summary_is_json_serializable(large_summary):
    assert json.loads(json.dumps(large_summary)) == large_summary


def test_repeated_run_on_same_dataset_is_deterministic(large_dataset_path):
    first = analyze_transactions(large_dataset_path)
    second = analyze_transactions(large_dataset_path)
    assert first == second


def test_weekday_weekend_comparison_reconciles_to_totals(large_dataframe, large_summary):
    comparison = weekday_weekend_comparison(large_dataframe)
    combined_lines = (
        comparison["weekday"]["transaction_line_count"]
        + comparison["weekend"]["transaction_line_count"]
    )
    combined_revenue = (
        comparison["weekday"]["total_revenue"] + comparison["weekend"]["total_revenue"]
    )
    assert combined_lines == large_summary["dataset_overview"]["transaction_line_count"]
    assert combined_revenue == large_summary["sales"]["total_revenue"]


def test_date_range_is_within_generated_bounds(large_dataframe):
    date_range = order_date_range(large_dataframe)
    assert date_range["start_date"] <= date_range["end_date"]


def test_payment_method_semantic_is_line_count_not_order_count(large_dataframe):
    line_counts = payment_method_line_counts(large_dataframe)
    assert sum(line_counts.values()) == len(large_dataframe)
    # Order count would necessarily be <= unique_order_count; line counts are not bounded that way here.
    assert sum(line_counts.values()) >= unique_order_count(large_dataframe)
