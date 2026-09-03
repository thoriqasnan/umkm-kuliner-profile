"""Next-day quantity prediction domain service."""

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from sari_rasa_data.forecasting import SUPERVISED_FEATURE_COLUMNS, build_prediction_feature_row, load_daily_quantity_series
from sari_rasa_data.model_artifact import load_model_artifact
from sari_rasa_data.ml_v2_experiment import load_v2_daily_quantity_series
from sari_rasa_data.ml_v2_data import sha256_file


@dataclass(frozen=True)
class PredictionResult:
    forecast_date: str
    predicted_quantity: float
    data_through: str
    trailing_7_day_average: float
    trailing_28_day_average: float
    vs_7_day_average_percent: float | None
    vs_28_day_average_percent: float | None
    model_family: str
    artifact_version: str
    forecast_horizon_days: int


def predict_next_day(data_path: Path | str, artifact_path: Path | str) -> PredictionResult:
    artifact = load_model_artifact(artifact_path)
    if artifact["metadata"].get("experiment_version") == "2.0":
        if sha256_file(data_path) != artifact["metadata"]["dataset_sha256"]:
            raise ValueError("V2 dataset does not match the serving artifact")
        loader = load_v2_daily_quantity_series
    else:
        loader = load_daily_quantity_series
    daily = loader(data_path)
    row = build_prediction_feature_row(daily)
    prediction = float(artifact["model"].predict(row.loc[:, SUPERVISED_FEATURE_COLUMNS])[0])
    if not np.isfinite(prediction) or prediction < 0:
        raise ValueError("model prediction must be finite and non-negative")
    if len(daily) < 28:
        raise ValueError("at least 28 historical calendar days are required")
    data_through = daily["date"].iloc[-1]
    if row["forecast_date"].iloc[0] != data_through + np.timedelta64(1, "D"):
        raise ValueError("forecast date must be one day after historical cutoff")
    trailing_7 = float(daily["quantity"].iloc[-7:].mean())
    trailing_28 = float(daily["quantity"].iloc[-28:].mean())
    if not np.isfinite(trailing_7) or not np.isfinite(trailing_28) or trailing_7 < 0 or trailing_28 < 0:
        raise ValueError("historical averages must be finite and non-negative")

    def comparison(average: float) -> float | None:
        if average == 0:
            return None
        value = ((prediction - average) / average) * 100
        if not np.isfinite(value):
            raise ValueError("historical comparison must be finite")
        return float(value)

    metadata = artifact["metadata"]
    return PredictionResult(
        forecast_date=row["forecast_date"].iloc[0].date().isoformat(),
        predicted_quantity=prediction,
        data_through=data_through.date().isoformat(),
        trailing_7_day_average=trailing_7,
        trailing_28_day_average=trailing_28,
        vs_7_day_average_percent=comparison(trailing_7),
        vs_28_day_average_percent=comparison(trailing_28),
        model_family=metadata["model_family"],
        artifact_version=metadata["artifact_schema_version"],
        forecast_horizon_days=metadata["forecast_horizon_days"],
    )
