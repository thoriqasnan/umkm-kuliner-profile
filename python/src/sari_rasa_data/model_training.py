"""Classical ML selection and one-time final evaluation for Phase 5D."""

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from sari_rasa_data.baseline_forecasting import (
    mean_absolute_error,
    previous_week_forecast,
    root_mean_squared_error,
)
from sari_rasa_data.forecasting import SUPERVISED_FEATURE_COLUMNS, TARGET_COLUMN


MODEL_RANDOM_STATE = 20260901
FORBIDDEN_MODEL_COLUMNS = ("date", "forecast_date", TARGET_COLUMN)
_FINAL_EVALUATION_TOKENS: dict[object, bool] = {}


@dataclass(frozen=True)
class CandidateSpec:
    """Immutable description of one intentionally small candidate configuration."""

    model: str
    parameters: tuple[tuple[str, Any], ...]

    def parameter_dict(self) -> dict[str, Any]:
        return dict(self.parameters)


@dataclass(frozen=True)
class CandidateResult:
    """Validation result for one candidate trained on TRAIN only."""

    spec: CandidateSpec
    validation_mae: float
    validation_rmse: float
    mae_improvement: float
    mae_improvement_percent: float


@dataclass(frozen=True)
class FrozenSelection:
    """Logically frozen validation-selected model and candidate record."""

    selected_spec: CandidateSpec
    selected_train_estimator: Any
    candidates: tuple[CandidateResult, ...]
    baseline_mae: float
    _evaluation_token: object = field(repr=False, compare=False)


@dataclass(frozen=True)
class FinalTestEvaluation:
    """Single final-test result plus predictions for post-selection diagnostics."""

    model_mae: float
    model_rmse: float
    baseline_mae: float
    baseline_rmse: float
    mae_improvement: float
    mae_improvement_percent: float | None
    predictions: pd.DataFrame
    refit_estimator: Any


RIDGE_ALPHAS = (0.01, 0.1, 1.0, 10.0, 100.0)
HIST_GRADIENT_BOOSTING_CONFIGS = (
    (
        ("learning_rate", 0.05),
        ("max_iter", 100),
        ("max_leaf_nodes", 7),
        ("l2_regularization", 1.0),
    ),
    (
        ("learning_rate", 0.1),
        ("max_iter", 100),
        ("max_leaf_nodes", 7),
        ("l2_regularization", 1.0),
    ),
    (
        ("learning_rate", 0.05),
        ("max_iter", 150),
        ("max_leaf_nodes", 15),
        ("l2_regularization", 2.0),
    ),
)

# Frozen by Phase 5D validation-only selection. Serving code must reuse this
# specification rather than reconstructing or retuning it.
SELECTED_MODEL_SPEC = CandidateSpec(
    "hist_gradient_boosting", HIST_GRADIENT_BOOSTING_CONFIGS[0]
)


def candidate_specs() -> tuple[CandidateSpec, ...]:
    """Return the complete predefined Phase 5D validation search space."""
    ridge = tuple(
        CandidateSpec("ridge", (("alpha", alpha),)) for alpha in RIDGE_ALPHAS
    )
    trees = tuple(
        CandidateSpec("hist_gradient_boosting", config)
        for config in HIST_GRADIENT_BOOSTING_CONFIGS
    )
    return ridge + trees


def feature_target_split(frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    """Select only approved predictors and the next-day target."""
    required = [*SUPERVISED_FEATURE_COLUMNS, TARGET_COLUMN]
    missing = [column for column in required if column not in frame]
    if missing:
        raise KeyError(f"supervised data are missing columns: {', '.join(missing)}")
    if frame.empty:
        raise ValueError("supervised data must not be empty")

    features = frame.loc[:, SUPERVISED_FEATURE_COLUMNS].copy()
    target = frame.loc[:, TARGET_COLUMN].copy()
    feature_values = features.to_numpy(dtype=float)
    target_values = target.to_numpy(dtype=float)
    if not np.isfinite(feature_values).all() or not np.isfinite(target_values).all():
        raise ValueError("features and target must contain only finite numeric values")
    return features, target


def _forecast_dates(frame: pd.DataFrame, name: str) -> pd.Series:
    if "forecast_date" not in frame:
        raise KeyError(f"{name} data are missing column: forecast_date")
    if frame.empty:
        raise ValueError(f"{name} data must not be empty")
    dates = pd.to_datetime(frame["forecast_date"], errors="raise")
    if dates.isna().any() or dates.duplicated().any():
        raise ValueError(f"{name} forecast dates must be present and unique")
    if not dates.is_monotonic_increasing:
        raise ValueError(f"{name} forecast dates must be sorted chronologically")
    return dates


def _validate_chronological_partitions(
    train: pd.DataFrame,
    validation: pd.DataFrame,
    test: pd.DataFrame | None = None,
) -> None:
    """Reject reversed, overlapping, duplicated, or out-of-order partitions."""
    train_dates = _forecast_dates(train, "train")
    validation_dates = _forecast_dates(validation, "validation")
    if train_dates.iloc[-1] >= validation_dates.iloc[0]:
        raise ValueError("train must end strictly before validation starts")
    if test is not None:
        test_dates = _forecast_dates(test, "test")
        if validation_dates.iloc[-1] >= test_dates.iloc[0]:
            raise ValueError("validation must end strictly before test starts")


def build_candidate_estimator(spec: CandidateSpec) -> Any:
    """Build an unfitted deterministic estimator for an approved candidate."""
    parameters = spec.parameter_dict()
    if spec.model == "ridge":
        return Pipeline(
            steps=(
                ("scaler", StandardScaler()),
                ("regressor", Ridge(**parameters)),
            )
        )
    if spec.model == "hist_gradient_boosting":
        return HistGradientBoostingRegressor(
            **parameters,
            early_stopping=False,
            random_state=MODEL_RANDOM_STATE,
        )
    raise ValueError(f"unsupported candidate model: {spec.model}")


def _candidate_result(
    spec: CandidateSpec,
    actual: pd.Series,
    predicted: np.ndarray,
    baseline_mae: float,
) -> CandidateResult:
    mae = mean_absolute_error(actual, predicted)
    rmse = root_mean_squared_error(actual, predicted)
    improvement = baseline_mae - mae
    return CandidateResult(
        spec=spec,
        validation_mae=mae,
        validation_rmse=rmse,
        mae_improvement=improvement,
        mae_improvement_percent=(
            (improvement / baseline_mae) * 100.0 if baseline_mae else None
        ),
    )


def rank_candidates(results: list[CandidateResult]) -> tuple[CandidateResult, ...]:
    """Rank candidates by validation MAE, then RMSE and stable specification."""
    if not results:
        raise ValueError("candidate results must not be empty")
    return tuple(
        sorted(
            results,
            key=lambda result: (
                result.validation_mae,
                result.validation_rmse,
                result.spec.model,
                repr(result.spec.parameters),
            ),
        )
    )


def select_model_on_validation(
    train: pd.DataFrame,
    validation: pd.DataFrame,
    baseline_mae: float | None = None,
) -> FrozenSelection:
    """Fit candidates on TRAIN and freeze selection using VALIDATION only.

    The API intentionally accepts no test frame. Preprocessing inside Ridge's
    pipeline is fitted only by ``estimator.fit(X_train, y_train)``.
    """
    _validate_chronological_partitions(train, validation)
    X_train, y_train = feature_target_split(train)
    X_validation, y_validation = feature_target_split(validation)
    resolved_baseline_mae = (
        mean_absolute_error(y_validation, previous_week_forecast(validation))
        if baseline_mae is None
        else float(baseline_mae)
    )
    if not np.isfinite(resolved_baseline_mae) or resolved_baseline_mae <= 0:
        raise ValueError("baseline_mae must be a positive finite number")

    results: list[CandidateResult] = []
    estimators: dict[CandidateSpec, Any] = {}
    for spec in candidate_specs():
        estimator = build_candidate_estimator(spec)
        estimator.fit(X_train, y_train)
        predicted = estimator.predict(X_validation)
        results.append(
            _candidate_result(spec, y_validation, predicted, resolved_baseline_mae)
        )
        estimators[spec] = estimator

    ranked = rank_candidates(results)
    selected_spec = ranked[0].spec
    evaluation_token = object()
    _FINAL_EVALUATION_TOKENS[evaluation_token] = False
    return FrozenSelection(
        selected_spec=selected_spec,
        selected_train_estimator=estimators[selected_spec],
        candidates=ranked,
        baseline_mae=resolved_baseline_mae,
        _evaluation_token=evaluation_token,
    )


def _validate_frozen_selection(selection: FrozenSelection) -> None:
    if not isinstance(selection, FrozenSelection):
        raise TypeError("a frozen model selection is required")
    if selection._evaluation_token not in _FINAL_EVALUATION_TOKENS:
        raise ValueError("model selection was not issued by validation selection")
    if not selection.candidates:
        raise ValueError("frozen selection has no candidate results")
    ranked = rank_candidates(list(selection.candidates))
    if ranked != selection.candidates or ranked[0].spec != selection.selected_spec:
        raise ValueError("frozen selection does not match the validation winner")
    estimator = selection.selected_train_estimator
    if selection.selected_spec.model == "ridge" and not isinstance(estimator, Pipeline):
        raise ValueError("frozen estimator does not match the selected Ridge spec")
    if selection.selected_spec.model == "hist_gradient_boosting" and not isinstance(
        estimator, HistGradientBoostingRegressor
    ):
        raise ValueError("frozen estimator does not match the selected tree spec")


def validation_permutation_importance(
    selection: FrozenSelection,
    validation: pd.DataFrame,
    repeats: int = 20,
) -> list[dict[str, float | str]]:
    """Return validation permutation importance as predictive associations."""
    _validate_frozen_selection(selection)
    if repeats <= 0:
        raise ValueError("repeats must be positive")
    X_validation, y_validation = feature_target_split(validation)
    measured = permutation_importance(
        selection.selected_train_estimator,
        X_validation,
        y_validation,
        scoring="neg_mean_absolute_error",
        n_repeats=repeats,
        random_state=MODEL_RANDOM_STATE,
    )
    results = [
        {
            "feature": feature,
            "importance_mean": float(mean),
            "importance_std": float(std),
        }
        for feature, mean, std in zip(
            SUPERVISED_FEATURE_COLUMNS,
            measured.importances_mean,
            measured.importances_std,
            strict=True,
        )
    ]
    return sorted(results, key=lambda item: item["importance_mean"], reverse=True)


def evaluate_frozen_selection_once(
    selection: FrozenSelection,
    train: pd.DataFrame,
    validation: pd.DataFrame,
    test: pd.DataFrame,
) -> FinalTestEvaluation:
    """Refit the frozen pipeline on TRAIN+VALIDATION and evaluate TEST once.

    Model family and parameters must already be frozen by validation selection.
    Preprocessing is refitted only on the combined pre-test rows. This function
    performs no selection or tuning and returns predictions for one subsequent
    diagnostic pass without requiring another test prediction call.
    """
    _validate_frozen_selection(selection)
    _validate_chronological_partitions(train, validation, test)
    if _FINAL_EVALUATION_TOKENS[selection._evaluation_token]:
        raise RuntimeError("final test evaluation has already been performed")
    pretest = pd.concat((train, validation), ignore_index=True)
    X_pretest, y_pretest = feature_target_split(pretest)
    # Consume immediately before the first test feature/target access. A failed
    # test attempt is not silently retryable or usable for tuning.
    _FINAL_EVALUATION_TOKENS[selection._evaluation_token] = True
    X_test, y_test = feature_target_split(test)

    estimator = build_candidate_estimator(selection.selected_spec)
    estimator.fit(X_pretest, y_pretest)
    model_prediction = np.asarray(estimator.predict(X_test), dtype=float)
    baseline_prediction = previous_week_forecast(test).to_numpy(dtype=float)
    model_mae = mean_absolute_error(y_test, model_prediction)
    baseline_mae = mean_absolute_error(y_test, baseline_prediction)
    improvement = baseline_mae - model_mae

    prediction_frame = pd.DataFrame(
        {
            "forecast_date": pd.to_datetime(test["forecast_date"]).reset_index(drop=True),
            "actual": y_test.reset_index(drop=True).astype(float),
            "model_prediction": model_prediction,
            "previous_week_prediction": baseline_prediction,
            "is_weekend": test["is_weekend"].reset_index(drop=True).astype("int64"),
        }
    )
    prediction_frame["model_error"] = (
        prediction_frame["actual"] - prediction_frame["model_prediction"]
    )
    prediction_frame["baseline_error"] = (
        prediction_frame["actual"] - prediction_frame["previous_week_prediction"]
    )

    return FinalTestEvaluation(
        model_mae=model_mae,
        model_rmse=root_mean_squared_error(y_test, model_prediction),
        baseline_mae=baseline_mae,
        baseline_rmse=root_mean_squared_error(y_test, baseline_prediction),
        mae_improvement=improvement,
        mae_improvement_percent=(
            (improvement / baseline_mae) * 100.0 if baseline_mae else None
        ),
        predictions=prediction_frame,
        refit_estimator=estimator,
    )
