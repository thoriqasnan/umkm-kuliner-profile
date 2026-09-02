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
    row = build_prediction_feature_row(loader(data_path))
    prediction = float(artifact["model"].predict(row.loc[:, SUPERVISED_FEATURE_COLUMNS])[0])
    if not np.isfinite(prediction):
        raise ValueError("model prediction must be finite")
    metadata = artifact["metadata"]
    return PredictionResult(
        forecast_date=row["forecast_date"].iloc[0].date().isoformat(),
        predicted_quantity=prediction,
        model_family=metadata["model_family"],
        artifact_version=metadata["artifact_schema_version"],
        forecast_horizon_days=metadata["forecast_horizon_days"],
    )
