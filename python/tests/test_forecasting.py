import pandas as pd
import pytest

from sari_rasa_data.forecasting import (
    SUPERVISED_FEATURE_COLUMNS,
    TARGET_COLUMN,
    build_daily_quantity_series,
    build_next_day_quantity_features,
    chronological_split,
)


def _daily_quantities(count=40):
    return pd.DataFrame(
        {
            "date": pd.date_range("2024-01-01", periods=count, freq="D"),
            "quantity": range(1, count + 1),
        }
    )


def test_daily_series_is_continuous_sorted_and_reconciled():
    transactions = pd.DataFrame(
        {
            "order_date": ["2024-01-03", "2024-01-01", "2024-01-01"],
            "quantity": [5, 2, 3],
        }
    )
    daily = build_daily_quantity_series(transactions)
    assert daily["date"].tolist() == list(pd.date_range("2024-01-01", "2024-01-03"))
    assert daily["quantity"].tolist() == [5, 0, 5]
    assert daily["date"].is_unique
    assert daily["quantity"].sum() == transactions["quantity"].sum()


def test_daily_series_rejects_empty_negative_and_fractional_input():
    with pytest.raises(ValueError):
        build_daily_quantity_series(pd.DataFrame(columns=["order_date", "quantity"]))
    for invalid in (-1, 1.5):
        with pytest.raises(ValueError):
            build_daily_quantity_series(pd.DataFrame({"order_date": ["2024-01-01"], "quantity": [invalid]}))
    with pytest.raises(ValueError, match="order_date"):
        build_daily_quantity_series(pd.DataFrame({"order_date": [None], "quantity": [1]}))


def test_supervised_columns_alignment_and_warm_up_policy():
    daily = _daily_quantities()
    result = build_next_day_quantity_features(daily)
    assert set(SUPERVISED_FEATURE_COLUMNS).issubset(result.columns)
    assert TARGET_COLUMN in result
    assert len(result) == len(daily) - 29

    first = result.iloc[0]
    origin_index = 28
    assert first["date"] == daily.iloc[origin_index]["date"]
    assert first["forecast_date"] == daily.iloc[origin_index + 1]["date"]
    assert first[TARGET_COLUMN] == daily.iloc[origin_index + 1]["quantity"]
    assert first["lag_1_quantity"] == daily.iloc[origin_index]["quantity"]
    assert first["lag_7_quantity"] == daily.iloc[origin_index - 6]["quantity"]
    assert first["lag_14_quantity"] == daily.iloc[origin_index - 13]["quantity"]


def test_rolling_features_use_only_values_before_cutoff():
    daily = _daily_quantities()
    result = build_next_day_quantity_features(daily)
    first = result.iloc[0]
    assert first["rolling_mean_7"] == pytest.approx(daily.iloc[21:28]["quantity"].mean())
    assert first["rolling_mean_28"] == pytest.approx(daily.iloc[:28]["quantity"].mean())
    assert first["rolling_median_7"] == pytest.approx(daily.iloc[21:28]["quantity"].median())

    changed_future = daily.copy()
    changed_future.loc[29:, "quantity"] = 1_000_000
    changed = build_next_day_quantity_features(changed_future).iloc[0]
    for column in SUPERVISED_FEATURE_COLUMNS:
        assert changed[column] == first[column]
    assert changed[TARGET_COLUMN] != first[TARGET_COLUMN]


def test_features_preserve_zero_demand_and_reject_bad_calendar():
    daily = _daily_quantities()
    daily.loc[28, "quantity"] = 0
    result = build_next_day_quantity_features(daily)
    assert result.iloc[0]["lag_1_quantity"] == 0

    with pytest.raises(ValueError, match="continuous"):
        build_next_day_quantity_features(daily.drop(index=10).reset_index(drop=True))
    with pytest.raises(ValueError, match="sorted"):
        build_next_day_quantity_features(daily.sort_values("date", ascending=False))


def test_too_short_series_produces_no_supervised_rows():
    assert build_next_day_quantity_features(_daily_quantities(28)).empty


def test_chronological_split_is_deterministic_ordered_and_disjoint():
    supervised = build_next_day_quantity_features(_daily_quantities(129))
    first = chronological_split(supervised)
    second = chronological_split(supervised)
    assert all(first[name].equals(second[name]) for name in first)
    assert [len(first[name]) for name in ("train", "validation", "test")] == [70, 15, 15]
    assert first["train"]["forecast_date"].max() < first["validation"]["forecast_date"].min()
    assert first["validation"]["forecast_date"].max() < first["test"]["forecast_date"].min()
    combined = pd.concat(first.values(), ignore_index=True)
    assert combined["forecast_date"].is_unique
    assert combined["forecast_date"].is_monotonic_increasing


def test_split_rejects_too_short_unsorted_or_invalid_fractions():
    frame = pd.DataFrame({"forecast_date": pd.date_range("2024-01-01", periods=3)})
    with pytest.raises(ValueError):
        chronological_split(frame.iloc[:2])
    with pytest.raises(ValueError, match="sorted"):
        chronological_split(frame.sort_values("forecast_date", ascending=False))
    with pytest.raises(ValueError):
        chronological_split(frame, train_fraction=0.9, validation_fraction=0.2)
