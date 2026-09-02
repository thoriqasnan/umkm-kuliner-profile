import inspect

import numpy as np
import pandas as pd
import pytest
from sklearn.pipeline import Pipeline

import sari_rasa_data.model_training as training_module
from sari_rasa_data.forecasting import (
    SUPERVISED_FEATURE_COLUMNS,
    TARGET_COLUMN,
    build_daily_quantity_series,
    build_next_day_quantity_features,
    chronological_split,
)
from sari_rasa_data.ml_synthetic_data import generate_ml_transactions
from sari_rasa_data.model_training import (
    CandidateResult,
    CandidateSpec,
    FrozenSelection,
    MODEL_RANDOM_STATE,
    build_candidate_estimator,
    candidate_specs,
    evaluate_frozen_selection_once,
    feature_target_split,
    rank_candidates,
    select_model_on_validation,
    validation_permutation_importance,
)


@pytest.fixture(scope="module")
def seeded_splits():
    transactions = pd.DataFrame(generate_ml_transactions())
    daily = build_daily_quantity_series(transactions)
    supervised = build_next_day_quantity_features(daily)
    return chronological_split(supervised)


def _toy_supervised(rows=90):
    daily = pd.DataFrame(
        {
            "date": pd.date_range("2024-01-01", periods=rows + 29, freq="D"),
            "quantity": 70 + (np.arange(rows + 29) % 7) * 3 + np.arange(rows + 29) // 30,
        }
    )
    return build_next_day_quantity_features(daily)


def test_feature_target_split_uses_only_approved_features():
    supervised = _toy_supervised()
    X, y = feature_target_split(supervised)
    assert tuple(X.columns) == SUPERVISED_FEATURE_COLUMNS
    assert y.name == TARGET_COLUMN
    assert "date" not in X and "forecast_date" not in X and TARGET_COLUMN not in X


def test_feature_target_split_rejects_empty_missing_and_nonfinite_input():
    supervised = _toy_supervised()
    with pytest.raises(ValueError, match="empty"):
        feature_target_split(supervised.iloc[:0])
    with pytest.raises(KeyError):
        feature_target_split(supervised.drop(columns=["lag_1_quantity"]))
    invalid = supervised.copy()
    invalid.loc[0, "lag_1_quantity"] = np.nan
    with pytest.raises(ValueError, match="finite"):
        feature_target_split(invalid)


def test_candidate_space_is_small_reproducible_and_contains_two_families():
    first = candidate_specs()
    assert first == candidate_specs()
    assert len(first) == 8
    assert {spec.model for spec in first} == {"ridge", "hist_gradient_boosting"}
    trees = [spec for spec in first if spec.model == "hist_gradient_boosting"]
    assert all(build_candidate_estimator(spec).random_state == MODEL_RANDOM_STATE for spec in trees)


def test_ridge_pipeline_scaler_is_fitted_only_on_train(seeded_splits):
    train = seeded_splits["train"]
    validation = seeded_splits["validation"]
    spec = CandidateSpec("ridge", (("alpha", 1.0),))
    estimator = build_candidate_estimator(spec)
    assert isinstance(estimator, Pipeline)
    X_train, y_train = feature_target_split(train)
    estimator.fit(X_train, y_train)
    assert np.allclose(estimator.named_steps["scaler"].mean_, X_train.mean().to_numpy())
    assert not np.allclose(
        estimator.named_steps["scaler"].mean_,
        pd.concat((train, validation))[list(SUPERVISED_FEATURE_COLUMNS)].mean().to_numpy(),
    )


def test_validation_selection_api_has_no_test_parameter_and_is_deterministic(seeded_splits):
    assert "test" not in inspect.signature(select_model_on_validation).parameters
    first = select_model_on_validation(seeded_splits["train"], seeded_splits["validation"])
    second = select_model_on_validation(seeded_splits["train"], seeded_splits["validation"])
    assert first.selected_spec == second.selected_spec
    assert first.candidates == second.candidates
    assert first.selected_spec.model == "hist_gradient_boosting"
    assert first.candidates[0].validation_mae < first.baseline_mae
    assert first.baseline_mae == pytest.approx(9.333333333333334)


def test_selection_rejects_overlapping_reversed_or_unsorted_partitions():
    frame = _toy_supervised()
    splits = chronological_split(frame)
    with pytest.raises(ValueError, match="strictly before"):
        select_model_on_validation(splits["validation"], splits["train"])
    with pytest.raises(ValueError, match="strictly before"):
        select_model_on_validation(splits["train"], splits["train"])
    with pytest.raises(ValueError, match="sorted"):
        select_model_on_validation(
            splits["train"].sort_values("forecast_date", ascending=False),
            splits["validation"],
        )


def test_rank_candidates_uses_mae_then_rmse_and_rejects_empty():
    spec_a = CandidateSpec("ridge", (("alpha", 1.0),))
    spec_b = CandidateSpec("ridge", (("alpha", 10.0),))
    worse_rmse = CandidateResult(spec_a, 5.0, 8.0, 4.0, 40.0)
    better_rmse = CandidateResult(spec_b, 5.0, 7.0, 4.0, 40.0)
    assert rank_candidates([worse_rmse, better_rmse])[0] == better_rmse
    with pytest.raises(ValueError, match="empty"):
        rank_candidates([])


def test_permutation_importance_is_deterministic_on_validation(seeded_splits):
    selection = select_model_on_validation(seeded_splits["train"], seeded_splits["validation"])
    first = validation_permutation_importance(selection, seeded_splits["validation"], repeats=3)
    second = validation_permutation_importance(selection, seeded_splits["validation"], repeats=3)
    assert first == second
    assert {item["feature"] for item in first} == set(SUPERVISED_FEATURE_COLUMNS)


def test_final_evaluation_requires_frozen_selection():
    frame = _toy_supervised()
    splits = chronological_split(frame)
    with pytest.raises(TypeError, match="frozen"):
        evaluate_frozen_selection_once(
            CandidateSpec("ridge", (("alpha", 1.0),)),
            splits["train"],
            splits["validation"],
            splits["test"],
        )


def test_final_evaluation_rejects_overlap_and_is_single_use():
    frame = _toy_supervised()
    splits = chronological_split(frame)
    overlapping_selection = select_model_on_validation(
        splits["train"], splits["validation"]
    )
    with pytest.raises(ValueError, match="strictly before"):
        evaluate_frozen_selection_once(
            overlapping_selection,
            splits["train"],
            splits["validation"],
            splits["validation"],
        )

    selection = select_model_on_validation(splits["train"], splits["validation"])
    evaluate_frozen_selection_once(
        selection, splits["train"], splits["validation"], splits["test"]
    )
    with pytest.raises(RuntimeError, match="already"):
        evaluate_frozen_selection_once(
            selection, splits["train"], splits["validation"], splits["test"]
        )


def test_final_policy_refits_only_train_plus_validation(monkeypatch):
    frame = _toy_supervised()
    splits = chronological_split(frame)
    selection = select_model_on_validation(splits["train"], splits["validation"])
    observed = {}

    class SpyEstimator:
        def fit(self, X, y):
            observed["fit_rows"] = len(X)
            observed["fit_max_lag_1"] = float(X["lag_1_quantity"].max())
            return self

        def predict(self, X):
            observed["predict_rows"] = len(X)
            return X["lag_7_quantity"].to_numpy(dtype=float)

    monkeypatch.setattr(training_module, "build_candidate_estimator", lambda spec: SpyEstimator())
    result = evaluate_frozen_selection_once(
        selection, splits["train"], splits["validation"], splits["test"]
    )
    pretest = pd.concat((splits["train"], splits["validation"]), ignore_index=True)
    assert observed["fit_rows"] == len(pretest)
    assert observed["fit_max_lag_1"] == pretest["lag_1_quantity"].max()
    assert observed["predict_rows"] == len(splits["test"])
    assert len(result.predictions) == len(splits["test"])


def test_baseline_comparison_calculation_has_expected_direction():
    frame = _toy_supervised()
    splits = chronological_split(frame)
    selection = select_model_on_validation(splits["train"], splits["validation"])
    result = evaluate_frozen_selection_once(
        selection, splits["train"], splits["validation"], splits["test"]
    )
    assert result.mae_improvement == pytest.approx(result.baseline_mae - result.model_mae)
    if result.baseline_mae:
        assert result.mae_improvement_percent == pytest.approx(
            result.mae_improvement / result.baseline_mae * 100
        )
    else:
        assert result.mae_improvement_percent is None
