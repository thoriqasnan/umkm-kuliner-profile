import math

import numpy as np
import pandas as pd
import pytest

from sari_rasa_data.baseline_forecasting import (
    PREVIOUS_DAY,
    PREVIOUS_WEEK,
    TRAILING_SEVEN_DAY_MEAN,
    evaluate_validation_baselines,
    mean_absolute_error,
    previous_day_forecast,
    previous_week_forecast,
    root_mean_squared_error,
    trailing_seven_day_mean_forecast,
)
from sari_rasa_data.forecasting import (
    TARGET_COLUMN,
    build_daily_quantity_series,
    build_next_day_quantity_features,
    chronological_split,
)
from sari_rasa_data.ml_synthetic_data import generate_ml_transactions


def _daily(count=60):
    return pd.DataFrame(
        {
            "date": pd.date_range("2024-01-01", periods=count, freq="D"),
            "quantity": np.arange(1, count + 1),
        }
    )


@pytest.fixture(scope="module")
def seeded_frames():
    transactions = pd.DataFrame(generate_ml_transactions())
    daily = build_daily_quantity_series(transactions)
    supervised = build_next_day_quantity_features(daily)
    return daily, supervised, chronological_split(supervised)


def test_previous_day_and_previous_week_reuse_aligned_lag_features():
    supervised = build_next_day_quantity_features(_daily())
    first = supervised.iloc[0]
    assert previous_day_forecast(supervised).iloc[0] == first["lag_1_quantity"] == 29
    assert previous_week_forecast(supervised).iloc[0] == first["lag_7_quantity"] == 23
    assert first[TARGET_COLUMN] == 30


def test_trailing_mean_uses_exactly_seven_days_before_forecast():
    daily = _daily()
    supervised = build_next_day_quantity_features(daily)
    forecast_date = supervised.iloc[0]["forecast_date"]
    prediction = trailing_seven_day_mean_forecast(daily, [forecast_date]).iloc[0]
    assert prediction == pytest.approx(daily.iloc[22:29]["quantity"].mean())
    assert prediction != supervised.iloc[0]["rolling_mean_7"]


def test_baseline_predictions_do_not_use_forecast_or_future_actuals():
    daily = _daily()
    supervised = build_next_day_quantity_features(daily)
    first = supervised.iloc[[0]].copy()
    original = (
        previous_day_forecast(first).iloc[0],
        previous_week_forecast(first).iloc[0],
        trailing_seven_day_mean_forecast(daily, first["forecast_date"]).iloc[0],
    )

    forecast_index = daily.index[daily["date"] == first.iloc[0]["forecast_date"]][0]
    changed_daily = daily.copy()
    changed_daily.loc[forecast_index:, "quantity"] = 1_000_000
    changed_frame = first.copy()
    changed_frame[TARGET_COLUMN] = 1_000_000
    changed = (
        previous_day_forecast(changed_frame).iloc[0],
        previous_week_forecast(changed_frame).iloc[0],
        trailing_seven_day_mean_forecast(changed_daily, first["forecast_date"]).iloc[0],
    )
    assert changed == original


def test_mae_and_rmse_are_correct():
    actual = [1, 2, 3]
    predicted = [2, 2, 5]
    assert mean_absolute_error(actual, predicted) == pytest.approx(1.0)
    assert root_mean_squared_error(actual, predicted) == pytest.approx(math.sqrt(5 / 3))


def test_metrics_handle_large_finite_values_without_output_overflow():
    actual = [1e308, 0.0]
    predicted = [0.0, 0.0]
    assert math.isfinite(mean_absolute_error(actual, predicted))
    assert mean_absolute_error(actual, predicted) == pytest.approx(5e307)
    assert math.isfinite(root_mean_squared_error(actual, predicted))
    assert root_mean_squared_error(actual, predicted) == pytest.approx(1e308 / math.sqrt(2))


@pytest.mark.parametrize("metric", [mean_absolute_error, root_mean_squared_error])
def test_metrics_reject_mismatch_empty_nan_and_infinity(metric):
    with pytest.raises(ValueError, match="lengths"):
        metric([1, 2], [1])
    with pytest.raises(ValueError, match="empty"):
        metric([], [])
    with pytest.raises(ValueError, match="finite"):
        metric([1, np.nan], [1, 2])
    with pytest.raises(ValueError, match="finite"):
        metric([1, 2], [1, np.inf])
    with pytest.raises(ValueError, match="differences"):
        metric([1e308], [-1e308])


def test_validation_evaluator_reports_only_supplied_validation_partition(seeded_frames):
    daily, _, splits = seeded_frames
    report = evaluate_validation_baselines(splits["validation"], daily)
    assert report["evaluation_split"] == "validation"
    assert report["validation_rows"] == len(splits["validation"]) == 105
    assert report["validation_start"] == "2025-06-04"
    assert report["validation_end"] == "2025-09-16"
    assert report["validation_end"] < splits["test"]["forecast_date"].min().date().isoformat()
    assert all(result["validation_rows"] == 105 for result in report["baselines"])


def test_test_target_changes_cannot_affect_validation_evaluation(seeded_frames):
    daily, _, splits = seeded_frames
    before = evaluate_validation_baselines(splits["validation"], daily)
    changed_test = splits["test"].copy()
    changed_test[TARGET_COLUMN] = 1_000_000
    assert not changed_test[TARGET_COLUMN].equals(splits["test"][TARGET_COLUMN])
    after = evaluate_validation_baselines(splits["validation"], daily)
    assert after == before


def test_seeded_dataset_has_deterministic_validation_ranking(seeded_frames):
    daily, _, splits = seeded_frames
    report = evaluate_validation_baselines(splits["validation"], daily)
    names = [result["baseline"] for result in report["baselines"]]
    assert names == [PREVIOUS_WEEK, PREVIOUS_DAY, TRAILING_SEVEN_DAY_MEAN]
    assert report["baseline_to_beat"] == PREVIOUS_WEEK
