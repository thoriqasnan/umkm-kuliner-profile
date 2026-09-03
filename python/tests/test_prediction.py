from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from sari_rasa_data.forecasting import (
    MINIMUM_PREDICTION_HISTORY_DAYS,
    SUPERVISED_FEATURE_COLUMNS,
    build_next_day_quantity_features,
    build_prediction_feature_row,
    load_daily_quantity_series,
)
from sari_rasa_data.model_artifact import export_model_artifact
from sari_rasa_data.prediction import predict_next_day


DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "transactions_ml.csv"


def daily(count=35):
    return pd.DataFrame({"date": pd.date_range("2026-01-01", periods=count), "quantity": range(1, count + 1)})


def test_prediction_row_has_exact_training_semantics_and_no_future_leakage():
    history = daily()
    row = build_prediction_feature_row(history)
    assert list(row.columns) == ["date", "forecast_date", *SUPERVISED_FEATURE_COLUMNS]
    assert row.iloc[0]["forecast_date"] == pd.Timestamp("2026-02-05")
    assert row.iloc[0]["day_of_week"] == 3
    assert row.iloc[0]["day_of_month"] == 5
    assert row.iloc[0]["month"] == 2
    assert row.iloc[0]["is_weekend"] == 0
    assert row.iloc[0]["lag_1_quantity"] == 35
    assert row.iloc[0]["lag_7_quantity"] == 29
    assert row.iloc[0]["lag_14_quantity"] == 22
    assert row.iloc[0]["rolling_mean_7"] == pytest.approx(np.mean(range(28, 35)))
    assert row.iloc[0]["rolling_mean_28"] == pytest.approx(np.mean(range(7, 35)))
    assert row.iloc[0]["rolling_median_7"] == 31

    extended = pd.concat((history, pd.DataFrame({"date": [pd.Timestamp("2026-02-05")], "quantity": [999999]})), ignore_index=True)
    training_row = build_next_day_quantity_features(extended).iloc[-1]
    assert row.iloc[0].loc[list(SUPERVISED_FEATURE_COLUMNS)].tolist() == training_row.loc[list(SUPERVISED_FEATURE_COLUMNS)].tolist()


def test_prediction_history_validation():
    with pytest.raises(ValueError, match=str(MINIMUM_PREDICTION_HISTORY_DAYS)):
        build_prediction_feature_row(daily(MINIMUM_PREDICTION_HISTORY_DAYS - 1))
    duplicate = daily(); duplicate.loc[2, "date"] = duplicate.loc[1, "date"]
    with pytest.raises(ValueError, match="unique"):
        build_prediction_feature_row(duplicate)
    unsorted = daily().iloc[::-1].reset_index(drop=True)
    with pytest.raises(ValueError, match="sorted"):
        build_prediction_feature_row(unsorted)
    for invalid in (-1, np.nan, np.inf, 1.5):
        frame = daily().astype({"quantity": "float64"}); frame.loc[3, "quantity"] = invalid
        with pytest.raises((ValueError, OverflowError)):
            build_prediction_feature_row(frame)


def test_transaction_source_normalizes_missing_calendar_dates(tmp_path):
    history = load_daily_quantity_series(DATA_PATH)
    assert len(history) == 731
    assert history["date"].diff().dropna().eq(pd.Timedelta(days=1)).all()


def test_fixed_artifact_prediction_is_deterministic_and_finite(tmp_path):
    artifact = tmp_path / "model.joblib"
    export_model_artifact(DATA_PATH, artifact)
    first = predict_next_day(DATA_PATH, artifact)
    second = predict_next_day(DATA_PATH, artifact)
    assert first == second
    assert first.forecast_date == "2026-01-01"
    assert np.isfinite(first.predicted_quantity)


def test_v2_prediction_rejects_dataset_hash_mismatch(tmp_path, monkeypatch):
    import sari_rasa_data.prediction as module
    monkeypatch.setattr(module, "load_model_artifact", lambda path: {
        "metadata": {"experiment_version": "2.0", "dataset_sha256": "a" * 64},
        "model": object(),
    })
    data = tmp_path / "wrong.csv"
    data.write_text("wrong V2 data", encoding="utf-8")
    with pytest.raises(ValueError, match="does not match"):
        module.predict_next_day(data, tmp_path / "model.joblib")


class FixedModel:
    def __init__(self, value):
        self.value = value

    def predict(self, row):
        return np.array([self.value])


def predict_from_daily(monkeypatch, frame, prediction):
    import sari_rasa_data.prediction as module
    monkeypatch.setattr(module, "load_model_artifact", lambda path: {
        "metadata": {
            "model_family": "hist_gradient_boosting",
            "artifact_schema_version": "1.0",
            "forecast_horizon_days": 1,
        },
        "model": FixedModel(prediction),
    })
    monkeypatch.setattr(module, "load_daily_quantity_series", lambda path: frame)
    return module.predict_next_day("history.csv", "model.joblib")


def test_business_context_uses_calendar_windows_ending_at_cutoff(monkeypatch):
    frame = daily(35)
    result = predict_from_daily(monkeypatch, frame, 40)
    assert result.data_through == "2026-02-04"
    assert result.forecast_date == "2026-02-05"
    assert result.trailing_7_day_average == pytest.approx(np.mean(range(29, 36)))
    assert result.trailing_28_day_average == pytest.approx(np.mean(range(8, 36)))
    assert result.vs_7_day_average_percent > 0
    assert result.vs_28_day_average_percent > 0


def test_business_context_negative_and_zero_average_comparisons(monkeypatch):
    negative = predict_from_daily(monkeypatch, daily(35), 10)
    assert negative.vs_7_day_average_percent < 0
    assert negative.vs_28_day_average_percent < 0

    zero_frame = daily(35).assign(quantity=0)
    zero = predict_from_daily(monkeypatch, zero_frame, 10)
    assert zero.trailing_7_day_average == 0
    assert zero.trailing_28_day_average == 0
    assert zero.vs_7_day_average_percent is None
    assert zero.vs_28_day_average_percent is None


def test_business_context_includes_zero_quantity_calendar_day_in_denominator(monkeypatch):
    frame = daily(35).assign(quantity=1)
    frame.loc[frame.index[-3], "quantity"] = 0
    result = predict_from_daily(monkeypatch, frame, 1)
    assert result.trailing_7_day_average == pytest.approx(6 / 7)
    assert result.trailing_28_day_average == pytest.approx(27 / 28)


def test_business_context_rejects_incomplete_history_and_nonfinite_prediction(monkeypatch):
    with pytest.raises(ValueError, match="continuous daily observations"):
        predict_from_daily(monkeypatch, daily(27), 10)
    for prediction in (-1, np.nan, np.inf):
        with pytest.raises(ValueError, match="finite and non-negative"):
            predict_from_daily(monkeypatch, daily(35), prediction)
