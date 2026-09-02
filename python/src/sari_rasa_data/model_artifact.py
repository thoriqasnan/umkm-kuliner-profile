"""Trusted, versioned Phase 5E model artifact export and loading."""

import argparse
import platform
from datetime import date
from pathlib import Path
from typing import Any

import joblib
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor

from sari_rasa_data.application_catalog import APPLICATION_CATALOG_IDENTITY, APPLICATION_PRODUCT_CATALOG
from sari_rasa_data.forecasting import (
    SUPERVISED_FEATURE_COLUMNS,
    TARGET_COLUMN,
    build_next_day_quantity_features,
    load_daily_quantity_series,
)
from sari_rasa_data.ml_synthetic_data import ML_DEFAULT_SEED
from sari_rasa_data.ml_v2_data import V2_DATASET_IDENTITY, V2_DEFAULT_PATH, V2_DEFAULT_SEED, sha256_file
from sari_rasa_data.ml_v2_experiment import V2_SELECTED_MODEL_SPEC, load_v2_daily_quantity_series
from sari_rasa_data.model_training import (
    MODEL_RANDOM_STATE,
    SELECTED_MODEL_SPEC,
    build_candidate_estimator,
    feature_target_split,
)

ARTIFACT_SCHEMA_VERSION = "1.0"
MODEL_FAMILY = "hist_gradient_boosting"
FORECAST_HORIZON_DAYS = 1
TRAINING_POLICY = "all_available_supervised_history_after_final_evaluation"
V1_ML_DATASET_PATH = Path(__file__).resolve().parents[2] / "data" / "transactions_ml.csv"
V1_MODEL_ARTIFACT_PATH = Path(__file__).resolve().parents[2] / "models" / "next_day_quantity_v1.joblib"
DEFAULT_ML_DATASET_PATH = V2_DEFAULT_PATH
DEFAULT_MODEL_ARTIFACT_PATH = Path(__file__).resolve().parents[2] / "models" / "next_day_quantity_v2.joblib"
REQUIRED_METADATA = {
    "artifact_schema_version", "model_family", "hyperparameters", "feature_columns",
    "target_name", "forecast_horizon_days", "training_start_date", "training_end_date",
    "dataset_identity", "seed", "model_random_state", "scikit_learn_version",
        "python_version", "training_policy",
}


class ArtifactError(RuntimeError):
    """Raised when a trusted local artifact is absent, corrupt, or incompatible."""


def _metadata(supervised: Any) -> dict[str, Any]:
    parameters = SELECTED_MODEL_SPEC.parameter_dict()
    parameters.update({"early_stopping": False, "random_state": MODEL_RANDOM_STATE})
    return {
        "artifact_schema_version": ARTIFACT_SCHEMA_VERSION,
        "model_family": MODEL_FAMILY,
        "hyperparameters": parameters,
        "feature_columns": list(SUPERVISED_FEATURE_COLUMNS),
        "target_name": TARGET_COLUMN,
        "forecast_horizon_days": FORECAST_HORIZON_DAYS,
        "training_start_date": supervised["forecast_date"].min().date().isoformat(),
        "training_end_date": supervised["forecast_date"].max().date().isoformat(),
        "dataset_identity": "sari_rasa_ml_synthetic_transactions_v1",
        "seed": ML_DEFAULT_SEED,
        "model_random_state": MODEL_RANDOM_STATE,
        "scikit_learn_version": sklearn.__version__,
        "python_version": platform.python_version(),
        "training_policy": TRAINING_POLICY,
    }


def export_model_artifact(data_path: Path | str, output_path: Path | str) -> dict[str, Any]:
    """Fit the frozen specification on all approved supervised history and save it."""
    supervised = build_next_day_quantity_features(load_daily_quantity_series(data_path))
    features, target = feature_target_split(supervised)
    estimator = build_candidate_estimator(SELECTED_MODEL_SPEC)
    estimator.fit(features, target)
    artifact = {"metadata": _metadata(supervised), "model": estimator}
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, destination, compress=3)
    return artifact["metadata"]


def export_v2_model_artifact(data_path: Path | str = DEFAULT_ML_DATASET_PATH, output_path: Path | str = DEFAULT_MODEL_ARTIFACT_PATH) -> dict[str, Any]:
    """Refit the frozen V2 winner on all V2 supervised history and serialize it."""
    transaction_rows = _csv_data_row_count(data_path)
    if transaction_rows != 750_000:
        raise ValueError("V2 serving export requires exactly 750000 transaction rows")
    supervised = build_next_day_quantity_features(load_v2_daily_quantity_series(data_path))
    features, target = feature_target_split(supervised)
    estimator = build_candidate_estimator(V2_SELECTED_MODEL_SPEC)
    estimator.fit(features, target)
    parameters = V2_SELECTED_MODEL_SPEC.parameter_dict()
    parameters.update({"early_stopping": False, "random_state": MODEL_RANDOM_STATE})
    metadata = {
        "artifact_schema_version": ARTIFACT_SCHEMA_VERSION,
        "experiment_version": "2.0",
        "model_family": MODEL_FAMILY,
        "hyperparameters": parameters,
        "feature_columns": list(SUPERVISED_FEATURE_COLUMNS),
        "target_name": TARGET_COLUMN,
        "forecast_horizon_days": FORECAST_HORIZON_DAYS,
        "training_start_date": supervised["forecast_date"].min().date().isoformat(),
        "training_end_date": supervised["forecast_date"].max().date().isoformat(),
        "dataset_identity": V2_DATASET_IDENTITY,
        "dataset_sha256": sha256_file(data_path),
        "catalog_identity": APPLICATION_CATALOG_IDENTITY,
        "product_count": len(APPLICATION_PRODUCT_CATALOG),
        "transaction_rows": transaction_rows,
        "daily_supervised_rows": len(supervised),
        "seed": V2_DEFAULT_SEED,
        "model_random_state": MODEL_RANDOM_STATE,
        "scikit_learn_version": sklearn.__version__,
        "python_version": platform.python_version(),
        "training_policy": TRAINING_POLICY,
    }
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"metadata": metadata, "model": estimator}, destination, compress=3)
    return metadata


def load_model_artifact(path: Path | str) -> dict[str, Any]:
    """Load and validate one operator-controlled, trusted local artifact.

    Joblib uses executable pickle semantics. Callers must never pass a client-
    controlled or uploaded path to this function.
    """
    try:
        artifact = joblib.load(Path(path))
    except Exception as exc:
        raise ArtifactError("model artifact is unavailable or unreadable") from exc
    if not isinstance(artifact, dict) or set(artifact) != {"metadata", "model"}:
        raise ArtifactError("model artifact structure is incompatible")
    metadata = artifact["metadata"]
    if not isinstance(metadata, dict) or not REQUIRED_METADATA.issubset(metadata):
        raise ArtifactError("model artifact metadata is incomplete")
    experiment_version = metadata.get("experiment_version", "1.0")
    supported = {
        "1.0": ("sari_rasa_ml_synthetic_transactions_v1", _metadata_hyperparameters()),
        "2.0": (V2_DATASET_IDENTITY, _spec_hyperparameters(V2_SELECTED_MODEL_SPEC)),
    }
    if experiment_version not in supported:
        raise ArtifactError("model artifact metadata is incompatible")
    dataset_identity, expected_parameters = supported[experiment_version]
    expected = {
        "artifact_schema_version": ARTIFACT_SCHEMA_VERSION,
        "model_family": MODEL_FAMILY,
        "feature_columns": list(SUPERVISED_FEATURE_COLUMNS),
        "target_name": TARGET_COLUMN,
        "forecast_horizon_days": FORECAST_HORIZON_DAYS,
        "hyperparameters": expected_parameters,
        "training_policy": TRAINING_POLICY,
        "dataset_identity": dataset_identity,
    }
    if any(metadata.get(key) != value for key, value in expected.items()):
        raise ArtifactError("model artifact metadata is incompatible")
    model = artifact["model"]
    if not isinstance(model, HistGradientBoostingRegressor) or not callable(getattr(model, "predict", None)):
        raise ArtifactError("model artifact estimator is incompatible")
    model_parameters = model.get_params()
    if any(model_parameters.get(key) != value for key, value in expected_parameters.items()):
        raise ArtifactError("model artifact estimator configuration is incompatible")
    if experiment_version == "2.0" and (
        not isinstance(metadata.get("dataset_sha256"), str) or len(metadata["dataset_sha256"]) != 64 or
        metadata.get("transaction_rows") != 750_000 or metadata.get("daily_supervised_rows") != 664 or
        metadata.get("catalog_identity") != APPLICATION_CATALOG_IDENTITY or
        metadata.get("product_count") != len(APPLICATION_PRODUCT_CATALOG)
    ):
        raise ArtifactError("model artifact V2 provenance is incompatible")
    try:
        training_start = date.fromisoformat(metadata["training_start_date"])
        training_end = date.fromisoformat(metadata["training_end_date"])
    except (TypeError, ValueError) as exc:
        raise ArtifactError("model artifact training boundary is incompatible") from exc
    if training_start > training_end:
        raise ArtifactError("model artifact training boundary is incompatible")
    return artifact


def _metadata_hyperparameters() -> dict[str, Any]:
    return _spec_hyperparameters(SELECTED_MODEL_SPEC)


def _spec_hyperparameters(spec: Any) -> dict[str, Any]:
    parameters = spec.parameter_dict()
    parameters.update({"early_stopping": False, "random_state": MODEL_RANDOM_STATE})
    return parameters


def _csv_data_row_count(path: Path | str) -> int:
    with Path(path).open("rb") as handle:
        lines = sum(chunk.count(b"\n") for chunk in iter(lambda: handle.read(1024 * 1024), b""))
    return max(lines - 1, 0)


def main() -> None:
    parser = argparse.ArgumentParser(description="Export the trusted next-day forecast model artifact")
    parser.add_argument("--data", type=Path, default=DEFAULT_ML_DATASET_PATH)
    parser.add_argument("--output", type=Path, default=DEFAULT_MODEL_ARTIFACT_PATH)
    args = parser.parse_args()
    metadata = export_v2_model_artifact(args.data, args.output)
    print(f"exported {args.output} ({metadata['artifact_schema_version']}, training through {metadata['training_end_date']})")


if __name__ == "__main__":
    main()
