import copy

import numpy as np
import pytest
import torch

from sari_rasa_data.dl_experiment import PHASE6_LEARNING_RATE
from sari_rasa_data.dl_model_artifact import (
    DL_ARTIFACT_SCHEMA_VERSION,
    DLArtifactError,
    export_dl_model_artifact,
    load_dl_model_artifact,
)
from sari_rasa_data.dl_prediction import predict_next_day_with_dl
from sari_rasa_data.forecasting import SUPERVISED_FEATURE_COLUMNS
from sari_rasa_data.ml_v2_data import V2_DEFAULT_PATH, sha256_file


@pytest.fixture(scope="module")
def exported(tmp_path_factory):
    path = tmp_path_factory.mktemp("dl-artifact") / "model.pt"
    metadata = export_dl_model_artifact(V2_DEFAULT_PATH, path)
    return path, metadata


def test_export_records_frozen_policy_scaler_and_provenance(exported):
    path, metadata = exported

    assert path.is_file()
    assert metadata["artifact_schema_version"] == DL_ARTIFACT_SCHEMA_VERSION
    assert metadata["model_family"] == "experimental_mlp"
    assert metadata["framework"] == "pytorch"
    assert metadata["framework_version"] == torch.__version__
    assert metadata["architecture"] == {
        "input_features": 10,
        "hidden_units": 16,
        "output_features": 1,
        "activation": "relu",
    }
    assert metadata["feature_columns"] == list(SUPERVISED_FEATURE_COLUMNS)
    assert metadata["training_parameters"] == {
        "optimizer": "adam",
        "learning_rate": PHASE6_LEARNING_RATE,
        "batch_size": 32,
        "max_epochs": 200,
        "patience": 20,
        "seed": 20260903,
        "loss": "mse",
        "selection_metric": "validation_mae",
        "device": "cpu",
    }
    assert metadata["training_policy"] == "train_only_with_validation_mae_best_weight_restoration"
    assert metadata["prediction_policy"] == "clamp_min_zero"
    assert metadata["scaler"]["samples_seen"] == metadata["train_observations"] == 479
    assert len(metadata["scaler"]["mean"]) == len(SUPERVISED_FEATURE_COLUMNS)
    assert metadata["dataset_sha256"] == sha256_file(V2_DEFAULT_PATH)
    assert metadata["catalog_identity"] == "sari_rasa_seed_products_11_v1"
    assert metadata["product_count"] == 11


def test_valid_artifact_restores_finite_cpu_model(exported):
    artifact = load_dl_model_artifact(exported[0])
    model = artifact["model"]

    assert not model.training
    assert all(parameter.device.type == "cpu" for parameter in model.parameters())
    with torch.no_grad():
        output = model(torch.zeros((1, 10), dtype=torch.float32))
    assert output.shape == (1, 1)
    assert torch.isfinite(output).all()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("artifact_schema_version", "999"),
        ("architecture", {"input_features": 10}),
        ("feature_columns", ["wrong"]),
        ("training_parameters", {"learning_rate": 99}),
        ("prediction_policy", "raw"),
        ("dataset_identity", "wrong"),
    ],
)
def test_incompatible_metadata_is_rejected(exported, tmp_path, field, value):
    artifact = copy.deepcopy(torch.load(exported[0], weights_only=True))
    artifact["metadata"][field] = value
    path = tmp_path / "invalid.pt"
    torch.save(artifact, path)

    with pytest.raises(DLArtifactError, match="metadata is incompatible"):
        load_dl_model_artifact(path)


def test_nonfinite_or_wrong_shape_weights_are_rejected(exported, tmp_path):
    nonfinite = copy.deepcopy(torch.load(exported[0], weights_only=True))
    nonfinite["state_dict"]["layers.0.weight"][0, 0] = torch.nan
    nonfinite_path = tmp_path / "nonfinite.pt"
    torch.save(nonfinite, nonfinite_path)
    with pytest.raises(DLArtifactError, match="weights are incompatible"):
        load_dl_model_artifact(nonfinite_path)

    wrong_shape = copy.deepcopy(torch.load(exported[0], weights_only=True))
    wrong_shape["state_dict"]["layers.2.bias"] = torch.zeros(2)
    wrong_shape_path = tmp_path / "wrong-shape.pt"
    torch.save(wrong_shape, wrong_shape_path)
    with pytest.raises(DLArtifactError, match="weights are incompatible"):
        load_dl_model_artifact(wrong_shape_path)


def test_corrupt_artifact_fails_closed(tmp_path):
    path = tmp_path / "corrupt.pt"
    path.write_bytes(b"not a trusted torch artifact")

    with pytest.raises(DLArtifactError, match="unavailable or unreadable"):
        load_dl_model_artifact(path)


def test_dl_inference_is_deterministic_finite_and_explicitly_experimental(exported):
    first = predict_next_day_with_dl(V2_DEFAULT_PATH, exported[0])
    second = predict_next_day_with_dl(V2_DEFAULT_PATH, exported[0])

    assert first == second
    assert first.forecast_date == "2026-09-02"
    assert first.data_through == "2026-09-01"
    assert np.isfinite(first.predicted_quantity)
    assert first.predicted_quantity >= 0
    assert first.model_family == "experimental_mlp"
    assert first.experimental is True


def test_dl_inference_rejects_dataset_provenance_mismatch(exported, tmp_path):
    data = tmp_path / "wrong.csv"
    data.write_text("wrong dataset", encoding="utf-8")

    with pytest.raises(ValueError, match="does not match"):
        predict_next_day_with_dl(data, exported[0])
