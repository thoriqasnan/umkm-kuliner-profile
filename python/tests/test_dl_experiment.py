from dataclasses import fields

import numpy as np
import pandas as pd
import pytest
import torch

from sari_rasa_data.forecasting import (
    SUPERVISED_FEATURE_COLUMNS,
    TARGET_COLUMN,
    build_next_day_quantity_features,
)
from sari_rasa_data.dl_experiment import (
    V2_EXPECTED_SUPERVISED_ROWS,
    DevelopmentData,
    _prepare_development_data,
    load_v2_development_data,
)
from sari_rasa_data.ml_v2_data import V2_DEFAULT_PATH, sha256_file
from sari_rasa_data.ml_v2_experiment import (
    load_v2_daily_quantity_series,
    v2_temporal_split,
)
from sari_rasa_data.model_training import feature_target_split


@pytest.fixture(scope="module")
def supervised() -> pd.DataFrame:
    daily = load_v2_daily_quantity_series(V2_DEFAULT_PATH)
    return build_next_day_quantity_features(daily)


@pytest.fixture(scope="module")
def prepared(supervised: pd.DataFrame) -> DevelopmentData:
    return _prepare_development_data(
        supervised,
        dataset_sha256=sha256_file(V2_DEFAULT_PATH),
    )


def test_active_v2_loader_reuses_feature_and_target_contract(prepared: DevelopmentData) -> None:
    loaded = load_v2_development_data()

    assert loaded.feature_names == SUPERVISED_FEATURE_COLUMNS
    assert loaded.target_name == TARGET_COLUMN
    assert loaded.provenance == prepared.provenance


def test_frozen_counts_and_test_metadata_without_test_tensors(prepared: DevelopmentData) -> None:
    assert prepared.temporal.train_observations == 479
    assert prepared.temporal.validation_observations == 92
    assert prepared.temporal.test_observations == 93
    assert prepared.temporal.total_observations == V2_EXPECTED_SUPERVISED_ROWS == 664
    assert prepared.temporal.test_start == "2026-06-01"
    assert prepared.temporal.test_end == "2026-09-01"
    assert all("test" not in field.name for field in fields(DevelopmentData))


def test_train_precedes_validation(prepared: DevelopmentData) -> None:
    assert prepared.temporal.train_start == "2024-11-07"
    assert prepared.temporal.train_end == "2026-02-28"
    assert prepared.temporal.validation_start == "2026-03-01"
    assert prepared.temporal.validation_end == "2026-05-31"
    assert prepared.temporal.train_end < prepared.temporal.validation_start


def test_tensor_shapes_dtypes_and_finite_values(prepared: DevelopmentData) -> None:
    assert prepared.train_features.shape == (479, 10)
    assert prepared.validation_features.shape == (92, 10)
    assert prepared.train_targets.shape == (479, 1)
    assert prepared.validation_targets.shape == (92, 1)
    for tensor in (
        prepared.train_features,
        prepared.train_targets,
        prepared.validation_features,
        prepared.validation_targets,
    ):
        assert tensor.dtype == torch.float32
        assert torch.isfinite(tensor).all()


def test_scaler_statistics_come_from_train_only(
    supervised: pd.DataFrame,
    prepared: DevelopmentData,
) -> None:
    splits = v2_temporal_split(supervised)
    train_features, _ = feature_target_split(splits["train"])
    train_values = train_features.to_numpy(dtype=np.float64)
    expected_variance = train_values.var(axis=0)
    expected_scale = np.sqrt(expected_variance)
    expected_scale[expected_scale == 0] = 1.0

    np.testing.assert_allclose(prepared.scaler.mean, train_values.mean(axis=0))
    np.testing.assert_allclose(prepared.scaler.variance, expected_variance)
    np.testing.assert_allclose(prepared.scaler.scale, expected_scale)
    assert prepared.scaler.samples_seen == len(train_values) == 479

    changed = supervised.copy(deep=True)
    validation_mask = changed["forecast_date"].between("2026-03-01", "2026-05-31")
    changed.loc[validation_mask, list(SUPERVISED_FEATURE_COLUMNS)] += 1_000_000
    changed_prepared = _prepare_development_data(
        changed,
        dataset_sha256=prepared.provenance.dataset_sha256,
    )
    assert changed_prepared.scaler == prepared.scaler
    assert not torch.equal(
        changed_prepared.validation_features,
        prepared.validation_features,
    )


def test_validation_uses_train_fitted_scaler(
    supervised: pd.DataFrame,
    prepared: DevelopmentData,
) -> None:
    validation, _ = feature_target_split(v2_temporal_split(supervised)["validation"])
    expected = (
        validation.to_numpy(dtype=np.float64) - np.asarray(prepared.scaler.mean)
    ) / np.asarray(prepared.scaler.scale)

    np.testing.assert_allclose(
        prepared.validation_features.numpy(),
        expected.astype(np.float32),
        rtol=1e-6,
        atol=1e-6,
    )


def test_scaled_train_features_are_approximately_standardized(prepared: DevelopmentData) -> None:
    values = prepared.train_features.numpy()

    np.testing.assert_allclose(values.mean(axis=0), 0.0, atol=1e-5)
    np.testing.assert_allclose(values.std(axis=0), 1.0, atol=1e-5)


def test_preprocessing_does_not_mutate_source_and_is_deterministic(
    supervised: pd.DataFrame,
    prepared: DevelopmentData,
) -> None:
    original = supervised.copy(deep=True)
    repeated = _prepare_development_data(
        supervised,
        dataset_sha256=prepared.provenance.dataset_sha256,
    )

    pd.testing.assert_frame_equal(supervised, original)
    assert repeated.feature_names == prepared.feature_names
    assert repeated.scaler == prepared.scaler
    assert repeated.temporal == prepared.temporal
    assert torch.equal(repeated.train_features, prepared.train_features)
    assert torch.equal(repeated.train_targets, prepared.train_targets)
    assert torch.equal(repeated.validation_features, prepared.validation_features)
    assert torch.equal(repeated.validation_targets, prepared.validation_targets)


def test_missing_phase_5_feature_is_rejected(supervised: pd.DataFrame) -> None:
    missing = supervised.drop(columns=[SUPERVISED_FEATURE_COLUMNS[-1]])

    with pytest.raises(KeyError, match=SUPERVISED_FEATURE_COLUMNS[-1]):
        _prepare_development_data(missing, dataset_sha256="0" * 64)


def test_existing_phase_5_split_and_features_remain_unchanged(supervised: pd.DataFrame) -> None:
    splits = v2_temporal_split(supervised)

    assert len(supervised) == 664
    assert [len(splits[name]) for name in ("train", "validation", "test")] == [479, 92, 93]
    assert tuple(supervised.loc[:, SUPERVISED_FEATURE_COLUMNS].columns) == SUPERVISED_FEATURE_COLUMNS
    assert TARGET_COLUMN in supervised
