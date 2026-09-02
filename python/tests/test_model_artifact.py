import copy
from pathlib import Path
import subprocess

import joblib
import pytest
from sklearn.ensemble import HistGradientBoostingRegressor

from sari_rasa_data.forecasting import SUPERVISED_FEATURE_COLUMNS, TARGET_COLUMN
from sari_rasa_data.model_artifact import (
    ARTIFACT_SCHEMA_VERSION,
    ArtifactError,
    export_model_artifact,
    export_v2_model_artifact,
    load_model_artifact,
)
from sari_rasa_data.model_training import MODEL_RANDOM_STATE, SELECTED_MODEL_SPEC


DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "transactions_ml.csv"


@pytest.fixture(scope="module")
def exported(tmp_path_factory):
    path = tmp_path_factory.mktemp("artifact") / "model.joblib"
    metadata = export_model_artifact(DATA_PATH, path)
    return path, metadata


def test_export_uses_frozen_spec_and_metadata_contract(exported):
    path, metadata = exported
    assert path.is_file()
    assert metadata["artifact_schema_version"] == ARTIFACT_SCHEMA_VERSION
    assert metadata["model_family"] == SELECTED_MODEL_SPEC.model
    assert metadata["feature_columns"] == list(SUPERVISED_FEATURE_COLUMNS)
    assert metadata["target_name"] == TARGET_COLUMN
    assert metadata["forecast_horizon_days"] == 1
    assert metadata["hyperparameters"] == {
        **SELECTED_MODEL_SPEC.parameter_dict(),
        "early_stopping": False,
        "random_state": MODEL_RANDOM_STATE,
    }
    assert metadata["training_start_date"] == "2024-01-30"
    assert metadata["training_end_date"] == "2025-12-31"


def test_valid_artifact_loads(exported):
    artifact = load_model_artifact(exported[0])
    assert isinstance(artifact["model"], HistGradientBoostingRegressor)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("artifact_schema_version", "999"),
        ("feature_columns", ["wrong"]),
        ("model_family", "ridge"),
    ],
)
def test_incompatible_metadata_is_rejected(exported, tmp_path, field, value):
    artifact = copy.deepcopy(joblib.load(exported[0]))
    artifact["metadata"][field] = value
    path = tmp_path / "invalid.joblib"
    joblib.dump(artifact, path)
    with pytest.raises(ArtifactError, match="metadata is incompatible"):
        load_model_artifact(path)


def test_missing_metadata_is_rejected(exported, tmp_path):
    artifact = copy.deepcopy(joblib.load(exported[0]))
    del artifact["metadata"]["seed"]
    path = tmp_path / "missing.joblib"
    joblib.dump(artifact, path)
    with pytest.raises(ArtifactError, match="metadata is incomplete"):
        load_model_artifact(path)


def test_corrupt_artifact_is_controlled(tmp_path):
    path = tmp_path / "corrupt.joblib"
    path.write_bytes(b"not a joblib artifact")
    with pytest.raises(ArtifactError, match="unavailable or unreadable"):
        load_model_artifact(path)


def test_generated_artifact_directory_is_git_ignored():
    repository = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        ["git", "check-ignore", "python/models/example.joblib"],
        cwd=repository,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0


def test_v2_artifact_records_distinct_experiment_and_dataset_provenance(tmp_path):
    from sari_rasa_data.ml_v2_data import write_v2_transactions_csv, sha256_file
    data = tmp_path / "v2.csv"
    model = tmp_path / "v2.joblib"
    # Export contract requires the production V2 row-count metadata, so use a
    # patched lightweight daily loader while retaining a real deterministic hash.
    import pandas as pd
    import sari_rasa_data.model_artifact as module
    daily = pd.DataFrame({"date": pd.date_range("2024-10-09", periods=100), "quantity": 2000 + (pd.Series(range(100)) % 7) * 100})
    data.write_text("small deterministic V2 fixture", encoding="utf-8")
    original = module.load_v2_daily_quantity_series
    original_count = module._csv_data_row_count
    module.load_v2_daily_quantity_series = lambda path: daily
    module._csv_data_row_count = lambda path: 750_000
    try:
        metadata = export_v2_model_artifact(data, model)
    finally:
        module.load_v2_daily_quantity_series = original
        module._csv_data_row_count = original_count
    assert metadata["experiment_version"] == "2.0"
    assert metadata["dataset_sha256"] == sha256_file(data)
    assert metadata["transaction_rows"] == 750_000
    assert metadata["daily_supervised_rows"] == 71
    assert metadata["catalog_identity"] == "sari_rasa_seed_products_11_v1"
    assert metadata["product_count"] == 11
    artifact = joblib.load(model)
    artifact["metadata"]["daily_supervised_rows"] = 664
    joblib.dump(artifact, model)
    assert load_model_artifact(model)["metadata"]["experiment_version"] == "2.0"
