"""Separate next-day inference path for the experimental Phase 6 MLP."""

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch

from sari_rasa_data.dl_model_artifact import load_dl_model_artifact
from sari_rasa_data.forecasting import SUPERVISED_FEATURE_COLUMNS, build_prediction_feature_row
from sari_rasa_data.ml_v2_data import sha256_file
from sari_rasa_data.ml_v2_experiment import load_v2_daily_quantity_series


@dataclass(frozen=True)
class DLPredictionResult:
    forecast_date: str
    predicted_quantity: float
    data_through: str
    model_family: str
    artifact_version: str
    experimental: bool


def predict_next_day_with_dl(
    data_path: Path | str,
    artifact_path: Path | str,
) -> DLPredictionResult:
    """Predict with the trusted DL artifact without affecting production HGB."""
    artifact = load_dl_model_artifact(artifact_path)
    metadata = artifact["metadata"]
    if sha256_file(data_path) != metadata["dataset_sha256"]:
        raise ValueError("V2 dataset does not match the DL artifact")
    daily = load_v2_daily_quantity_series(data_path)
    row = build_prediction_feature_row(daily)
    values = row.loc[:, SUPERVISED_FEATURE_COLUMNS].to_numpy(dtype=np.float64)
    scaler = metadata["scaler"]
    scaled = (values - np.asarray(scaler["mean"])) / np.asarray(scaler["scale"])
    features = torch.tensor(scaled, dtype=torch.float32)
    if not torch.isfinite(features).all().item():
        raise ValueError("DL inference features must be finite")
    with torch.no_grad():
        prediction = float(artifact["model"](features).clamp_min(0).item())
    if not np.isfinite(prediction) or prediction < 0:
        raise ValueError("DL prediction must be finite and non-negative")
    data_through = daily["date"].iloc[-1]
    forecast_date = row["forecast_date"].iloc[0]
    if forecast_date != data_through + np.timedelta64(1, "D"):
        raise ValueError("forecast date must be one day after historical cutoff")
    return DLPredictionResult(
        forecast_date=forecast_date.date().isoformat(),
        predicted_quantity=prediction,
        data_through=data_through.date().isoformat(),
        model_family=metadata["model_family"],
        artifact_version=metadata["artifact_schema_version"],
        experimental=True,
    )
