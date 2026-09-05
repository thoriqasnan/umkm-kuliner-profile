"""Validated, separate Phase 6F artifact for the experimental MLP."""

import platform
from pathlib import Path
from typing import Any

import numpy as np
import torch

from sari_rasa_data.application_catalog import (
    APPLICATION_CATALOG_IDENTITY,
    APPLICATION_PRODUCT_CATALOG,
)
from sari_rasa_data.dl_experiment import (
    BASELINE_BATCH_SIZE,
    BASELINE_SEED,
    EARLY_STOPPING_PATIENCE,
    MLP_HIDDEN_UNITS,
    MLP_INPUT_FEATURES,
    MLP_OUTPUT_FEATURES,
    PHASE6_LEARNING_RATE,
    TRAINING_MAX_EPOCHS,
    V2_EXPECTED_SPLIT_COUNTS,
    build_baseline_mlp,
    load_v2_development_data,
    train_baseline_mlp,
)
from sari_rasa_data.forecasting import SUPERVISED_FEATURE_COLUMNS, TARGET_COLUMN
from sari_rasa_data.ml_v2_data import V2_DATASET_IDENTITY, V2_DEFAULT_PATH, V2_DEFAULT_SEED


DL_ARTIFACT_SCHEMA_VERSION = "1.0"
DL_MODEL_FAMILY = "experimental_mlp"
DL_FRAMEWORK = "pytorch"
DL_TRAINING_POLICY = "train_only_with_validation_mae_best_weight_restoration"
DL_PREDICTION_POLICY = "clamp_min_zero"
DEFAULT_DL_ARTIFACT_PATH = Path(__file__).resolve().parents[2] / "models" / "next_day_quantity_mlp_v1.pt"
_ARTIFACT_KEYS = {"metadata", "state_dict"}
_METADATA_KEYS = {
    "artifact_schema_version",
    "model_family",
    "framework",
    "framework_version",
    "python_version",
    "architecture",
    "feature_columns",
    "target_name",
    "scaler",
    "training_policy",
    "prediction_policy",
    "training_parameters",
    "best_epoch",
    "stopping_epoch",
    "validation_mae",
    "validation_rmse",
    "dataset_identity",
    "dataset_sha256",
    "dataset_seed",
    "catalog_identity",
    "product_count",
    "train_observations",
    "validation_observations",
}


class DLArtifactError(RuntimeError):
    """Raised when the trusted local DL artifact fails validation."""


def _architecture() -> dict[str, Any]:
    return {
        "input_features": MLP_INPUT_FEATURES,
        "hidden_units": MLP_HIDDEN_UNITS,
        "output_features": MLP_OUTPUT_FEATURES,
        "activation": "relu",
    }


def _training_parameters() -> dict[str, Any]:
    return {
        "optimizer": "adam",
        "learning_rate": PHASE6_LEARNING_RATE,
        "batch_size": BASELINE_BATCH_SIZE,
        "max_epochs": TRAINING_MAX_EPOCHS,
        "patience": EARLY_STOPPING_PATIENCE,
        "seed": BASELINE_SEED,
        "loss": "mse",
        "selection_metric": "validation_mae",
        "device": "cpu",
    }


def export_dl_model_artifact(
    data_path: Path | str = V2_DEFAULT_PATH,
    output_path: Path | str = DEFAULT_DL_ARTIFACT_PATH,
) -> dict[str, Any]:
    """Train the frozen development policy and save restored weights."""
    data = load_v2_development_data(data_path)
    trained = train_baseline_mlp(data)
    metadata = {
        "artifact_schema_version": DL_ARTIFACT_SCHEMA_VERSION,
        "model_family": DL_MODEL_FAMILY,
        "framework": DL_FRAMEWORK,
        "framework_version": str(torch.__version__),
        "python_version": platform.python_version(),
        "architecture": _architecture(),
        "feature_columns": list(SUPERVISED_FEATURE_COLUMNS),
        "target_name": TARGET_COLUMN,
        "scaler": {
            "mean": list(data.scaler.mean),
            "scale": list(data.scaler.scale),
            "variance": list(data.scaler.variance),
            "samples_seen": data.scaler.samples_seen,
        },
        "training_policy": DL_TRAINING_POLICY,
        "prediction_policy": DL_PREDICTION_POLICY,
        "training_parameters": _training_parameters(),
        "best_epoch": trained.best_epoch,
        "stopping_epoch": trained.stopping_epoch,
        "validation_mae": trained.validation_mae,
        "validation_rmse": trained.validation_rmse,
        "dataset_identity": data.provenance.dataset_identity,
        "dataset_sha256": data.provenance.dataset_sha256,
        "dataset_seed": data.provenance.dataset_seed,
        "catalog_identity": data.provenance.catalog_identity,
        "product_count": data.provenance.product_count,
        "train_observations": data.temporal.train_observations,
        "validation_observations": data.temporal.validation_observations,
    }
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "metadata": metadata,
            "state_dict": {name: value.detach().cpu() for name, value in trained.model.state_dict().items()},
        },
        destination,
    )
    return metadata


def _finite_numeric_list(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) == MLP_INPUT_FEATURES
        and all(isinstance(item, (int, float)) and np.isfinite(item) for item in value)
    )


def load_dl_model_artifact(path: Path | str) -> dict[str, Any]:
    """Load only tensor/primitive data and reject incompatible artifacts."""
    try:
        artifact = torch.load(Path(path), map_location="cpu", weights_only=True)
    except Exception as exc:
        raise DLArtifactError("DL artifact is unavailable or unreadable") from exc
    if not isinstance(artifact, dict) or set(artifact) != _ARTIFACT_KEYS:
        raise DLArtifactError("DL artifact structure is incompatible")
    metadata = artifact["metadata"]
    if not isinstance(metadata, dict) or set(metadata) != _METADATA_KEYS:
        raise DLArtifactError("DL artifact metadata is incomplete or unexpected")
    expected = {
        "artifact_schema_version": DL_ARTIFACT_SCHEMA_VERSION,
        "model_family": DL_MODEL_FAMILY,
        "framework": DL_FRAMEWORK,
        "architecture": _architecture(),
        "feature_columns": list(SUPERVISED_FEATURE_COLUMNS),
        "target_name": TARGET_COLUMN,
        "training_policy": DL_TRAINING_POLICY,
        "prediction_policy": DL_PREDICTION_POLICY,
        "training_parameters": _training_parameters(),
        "dataset_identity": V2_DATASET_IDENTITY,
        "dataset_seed": V2_DEFAULT_SEED,
        "catalog_identity": APPLICATION_CATALOG_IDENTITY,
        "product_count": len(APPLICATION_PRODUCT_CATALOG),
        "train_observations": V2_EXPECTED_SPLIT_COUNTS["train"],
        "validation_observations": V2_EXPECTED_SPLIT_COUNTS["validation"],
    }
    if any(metadata.get(key) != value for key, value in expected.items()):
        raise DLArtifactError("DL artifact metadata is incompatible")
    if not isinstance(metadata.get("framework_version"), str) or metadata["framework_version"] != str(torch.__version__):
        raise DLArtifactError("DL artifact framework version is incompatible")
    if not isinstance(metadata.get("python_version"), str):
        raise DLArtifactError("DL artifact Python version is incompatible")
    if not isinstance(metadata.get("dataset_sha256"), str) or len(metadata["dataset_sha256"]) != 64:
        raise DLArtifactError("DL artifact dataset provenance is incompatible")
    try:
        int(metadata["dataset_sha256"], 16)
    except ValueError as exc:
        raise DLArtifactError("DL artifact dataset provenance is incompatible") from exc
    scaler = metadata.get("scaler")
    if not isinstance(scaler, dict) or set(scaler) != {"mean", "scale", "variance", "samples_seen"}:
        raise DLArtifactError("DL artifact scaler metadata is incompatible")
    if not all(_finite_numeric_list(scaler.get(key)) for key in ("mean", "scale", "variance")):
        raise DLArtifactError("DL artifact scaler metadata is incompatible")
    if any(value <= 0 for value in scaler["scale"]) or scaler["samples_seen"] != V2_EXPECTED_SPLIT_COUNTS["train"]:
        raise DLArtifactError("DL artifact scaler metadata is incompatible")
    for key in ("best_epoch", "stopping_epoch"):
        if not isinstance(metadata.get(key), int) or not 0 <= metadata[key] <= TRAINING_MAX_EPOCHS:
            raise DLArtifactError("DL artifact training evidence is incompatible")
    if metadata["best_epoch"] > metadata["stopping_epoch"]:
        raise DLArtifactError("DL artifact training evidence is incompatible")
    if not all(
        isinstance(metadata.get(key), (int, float))
        and np.isfinite(metadata[key])
        and metadata[key] >= 0
        for key in ("validation_mae", "validation_rmse")
    ):
        raise DLArtifactError("DL artifact validation metrics are incompatible")

    state_dict = artifact["state_dict"]
    expected_state = build_baseline_mlp().state_dict()
    if not isinstance(state_dict, dict) or set(state_dict) != set(expected_state):
        raise DLArtifactError("DL artifact weights are incompatible")
    for name, expected_tensor in expected_state.items():
        tensor = state_dict[name]
        if (
            not isinstance(tensor, torch.Tensor)
            or tensor.device.type != "cpu"
            or tensor.dtype != expected_tensor.dtype
            or tensor.shape != expected_tensor.shape
            or not torch.isfinite(tensor).all().item()
        ):
            raise DLArtifactError("DL artifact weights are incompatible")
    model = build_baseline_mlp()
    model.load_state_dict(state_dict, strict=True)
    model.eval()
    return {"metadata": metadata, "model": model}
