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
