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
    BASELINE_BATCH_SIZE,
    BASELINE_EPOCHS,
    BASELINE_LEARNING_RATE,
    BASELINE_SEED,
    EARLY_STOPPING_PATIENCE,
    MLP_HIDDEN_UNITS,
    MLP_INPUT_FEATURES,
    MLP_OUTPUT_FEATURES,
    PHASE5_TEST_BASELINE_MAE,
    PHASE5_TEST_BASELINE_RMSE,
    PHASE5_TEST_HGB_MAE,
    PHASE5_TEST_HGB_RMSE,
    PHASE6_LEARNING_RATE,
    TRAINING_MAX_EPOCHS,
    V2_EXPECTED_SUPERVISED_ROWS,
    BaselineMLP,
    BaselineTrainingResult,
    DevelopmentData,
    _prepare_development_data,
    build_baseline_mlp,
    load_v2_development_data,
    run_phase6_final_evaluation_once,
    train_baseline_mlp,
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


@pytest.fixture(scope="module")
def trained(prepared: DevelopmentData):
    return train_baseline_mlp(prepared)


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


def test_baseline_mlp_has_exact_approved_architecture() -> None:
    model = build_baseline_mlp()

    assert MLP_INPUT_FEATURES == 10
    assert MLP_HIDDEN_UNITS == 16
    assert MLP_OUTPUT_FEATURES == 1
    assert isinstance(model, BaselineMLP)
    assert isinstance(model.layers[0], torch.nn.Linear)
    assert model.layers[0].in_features == 10
    assert model.layers[0].out_features == 16
    assert isinstance(model.layers[1], torch.nn.ReLU)
    assert isinstance(model.layers[2], torch.nn.Linear)
    assert model.layers[2].in_features == 16
    assert model.layers[2].out_features == 1


def test_baseline_forward_is_finite_and_parameters_are_trainable() -> None:
    model = build_baseline_mlp()
    output = model(torch.ones((7, 10), dtype=torch.float32))

    assert output.shape == (7, 1)
    assert torch.isfinite(output).all()
    assert all(parameter.requires_grad for parameter in model.parameters())


def test_training_returns_finite_development_only_history(trained) -> None:
    assert trained.seed == BASELINE_SEED
    assert trained.learning_rate == PHASE6_LEARNING_RATE
    assert trained.batch_size == BASELINE_BATCH_SIZE
    assert trained.epochs == TRAINING_MAX_EPOCHS == 200
    assert trained.patience == EARLY_STOPPING_PATIENCE == 20
    assert len(trained.history) == trained.stopping_epoch + 1
    assert [entry.epoch for entry in trained.history] == list(range(trained.stopping_epoch + 1))
    assert all(
        np.isfinite(entry.train_loss)
        and np.isfinite(entry.validation_loss)
        and np.isfinite(entry.validation_mae)
        and np.isfinite(entry.validation_rmse)
        for entry in trained.history
    )
    assert np.isfinite(trained.validation_mae)
    assert np.isfinite(trained.validation_rmse)
    assert all("test" not in field.name for field in fields(type(trained)))


def test_training_changes_parameters_and_meaningfully_reduces_train_loss(trained) -> None:
    initial = build_baseline_mlp(BASELINE_SEED)

    assert any(
        not torch.equal(before, after)
        for before, after in zip(initial.parameters(), trained.model.parameters(), strict=True)
    )
    assert trained.history[-1].train_loss < trained.history[0].train_loss


def test_training_is_practically_repeatable_and_does_not_mutate_data(
    prepared: DevelopmentData,
    trained,
) -> None:
    snapshots = {
        name: tensor.clone()
        for name, tensor in (
            ("train_features", prepared.train_features),
            ("train_targets", prepared.train_targets),
            ("validation_features", prepared.validation_features),
            ("validation_targets", prepared.validation_targets),
        )
    }
    repeated = train_baseline_mlp(prepared)

    for name, original in snapshots.items():
        assert torch.equal(getattr(prepared, name), original)
    np.testing.assert_allclose(
        [entry.train_loss for entry in repeated.history],
        [entry.train_loss for entry in trained.history],
        rtol=1e-6,
        atol=1e-6,
    )
    np.testing.assert_allclose(
        [entry.validation_loss for entry in repeated.history],
        [entry.validation_loss for entry in trained.history],
        rtol=1e-6,
        atol=1e-6,
    )
    assert repeated.validation_mae == pytest.approx(trained.validation_mae, rel=1e-6)
    assert repeated.validation_rmse == pytest.approx(trained.validation_rmse, rel=1e-6)
    assert repeated.best_epoch == trained.best_epoch
    assert repeated.stopping_epoch == trained.stopping_epoch


def test_validation_mae_selects_and_restores_best_model(prepared, trained) -> None:
    best = min(trained.history, key=lambda entry: entry.validation_mae)

    assert trained.best_epoch == best.epoch
    assert trained.validation_mae == pytest.approx(best.validation_mae, rel=1e-6)
    assert trained.validation_rmse == pytest.approx(best.validation_rmse, rel=1e-6)
    with torch.no_grad():
        restored_predictions = trained.model(prepared.validation_features).clamp_min(0).squeeze(1)
    actual = prepared.validation_targets.squeeze(1)
    assert torch.mean(torch.abs(actual - restored_predictions)).item() == pytest.approx(
        best.validation_mae, rel=1e-6
    )


def test_early_stopping_honors_patience(prepared: DevelopmentData) -> None:
    stopped = train_baseline_mlp(prepared, epochs=50, learning_rate=1e-30, patience=3)

    assert stopped.early_stopped
    assert stopped.best_epoch == 0
    assert stopped.stopping_epoch == 3


def test_non_negative_policy_applies_only_to_evaluation(prepared: DevelopmentData) -> None:
    model = build_baseline_mlp()
    with torch.no_grad():
        model.layers[2].weight.zero_()
        model.layers[2].bias.fill_(-5.0)
        raw = model(prepared.validation_features)
        evaluated = raw.clamp_min(0)

    assert torch.all(raw < 0)
    assert torch.all(evaluated == 0)
    assert not any(isinstance(layer, (torch.nn.ReLU6, torch.nn.Softplus)) for layer in model.layers)


def test_training_api_and_result_keep_test_isolated() -> None:
    import inspect

    assert "test" not in inspect.signature(train_baseline_mlp).parameters
    assert all("test" not in field.name for field in fields(BaselineTrainingResult))


def test_phase6_final_evaluation_uses_frozen_test_once(monkeypatch) -> None:
    import inspect
    from types import SimpleNamespace

    import sari_rasa_data.dl_experiment as module

    class ZeroModel:
        def __call__(self, features):
            return torch.zeros((len(features), 1), dtype=torch.float32)

    development = SimpleNamespace(
        scaler=SimpleNamespace(mean=(0.0,) * 10, scale=(1.0,) * 10),
        temporal=SimpleNamespace(test_start="2026-06-01", test_end="2026-09-01"),
        provenance=SimpleNamespace(dataset_identity="synthetic_test_fixture"),
    )
    trained = SimpleNamespace(
        model=ZeroModel(), learning_rate=PHASE6_LEARNING_RATE, seed=BASELINE_SEED,
        batch_size=BASELINE_BATCH_SIZE, epochs=TRAINING_MAX_EPOCHS,
        patience=EARLY_STOPPING_PATIENCE,
    )
    supervised = pd.DataFrame(index=range(V2_EXPECTED_SUPERVISED_ROWS))
    test = pd.DataFrame(index=range(93))
    monkeypatch.setattr(module, "_PHASE6_TEST_EVALUATED", False)
    monkeypatch.setattr(module, "sha256_file", lambda path: "a" * 64)
    monkeypatch.setattr(module, "load_v2_daily_quantity_series", lambda path: object())
    monkeypatch.setattr(module, "build_next_day_quantity_features", lambda daily: supervised)
    monkeypatch.setattr(module, "_prepare_development_data", lambda frame, dataset_sha256: development)
    monkeypatch.setattr(module, "train_baseline_mlp", lambda data: trained)
    monkeypatch.setattr(module, "v2_temporal_split", lambda frame: {"test": test})
    monkeypatch.setattr(module, "_validate_frozen_splits", lambda splits: None)
    monkeypatch.setattr(
        module,
        "feature_target_split",
        lambda frame: (
            pd.DataFrame(np.ones((93, 10)), columns=SUPERVISED_FEATURE_COLUMNS),
            pd.Series(np.ones(93)),
        ),
    )

    assert tuple(inspect.signature(run_phase6_final_evaluation_once).parameters) == ("path",)
    result = run_phase6_final_evaluation_once()

    assert result.test_start == "2026-06-01"
    assert result.test_end == "2026-09-01"
    assert result.test_observations == 93
    assert result.dataset_identity == "synthetic_test_fixture"
    assert result.dataset_sha256 == "a" * 64
    assert result.baseline.mae == PHASE5_TEST_BASELINE_MAE
    assert result.baseline.rmse == PHASE5_TEST_BASELINE_RMSE
    assert result.hgb.mae == PHASE5_TEST_HGB_MAE
    assert result.hgb.rmse == PHASE5_TEST_HGB_RMSE
    assert all(
        np.isfinite(value)
        for metrics in (result.baseline, result.hgb, result.mlp)
        for value in (metrics.mae, metrics.rmse)
    )
    assert result.ranking == tuple(
        metrics.model
        for metrics in sorted(
            (result.baseline, result.hgb, result.mlp),
            key=lambda metrics: (metrics.mae, metrics.rmse),
        )
    )
    assert result.mlp_beats_hgb == (result.mlp.mae < result.hgb.mae)
    assert result.mlp_vs_hgb_mae_percent == pytest.approx(
        ((result.mlp.mae - result.hgb.mae) / result.hgb.mae) * 100.0
    )
    with pytest.raises(RuntimeError, match="already been performed"):
        run_phase6_final_evaluation_once()
