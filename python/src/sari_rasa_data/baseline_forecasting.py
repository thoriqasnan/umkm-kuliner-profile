"""Deterministic validation baselines for next-day quantity forecasting."""

from collections.abc import Iterable

import numpy as np
import pandas as pd

from sari_rasa_data.forecasting import DAILY_COLUMNS, TARGET_COLUMN


PREVIOUS_DAY = "previous_day"
PREVIOUS_WEEK = "previous_week"
TRAILING_SEVEN_DAY_MEAN = "trailing_seven_day_mean"


def _finite_numeric(values: Iterable[float], name: str) -> np.ndarray:
    """Return a finite one-dimensional float array or raise a clear error."""
    try:
        array = np.asarray(values, dtype=float)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{name} must contain numeric values") from error
    if array.ndim != 1:
        raise ValueError(f"{name} must be one-dimensional")
    if array.size == 0:
        raise ValueError(f"{name} must not be empty")
    if not np.isfinite(array).all():
        raise ValueError(f"{name} must contain only finite values")
    return array


def _validated_residuals(
    actual: Iterable[float], predicted: Iterable[float]
) -> np.ndarray:
    """Return finite residuals for equally sized validated sequences."""
    actual_array = _finite_numeric(actual, "actual")
    predicted_array = _finite_numeric(predicted, "predicted")
    if actual_array.size != predicted_array.size:
        raise ValueError("actual and predicted lengths must match")
    with np.errstate(over="ignore", invalid="ignore"):
        residuals = actual_array - predicted_array
    if not np.isfinite(residuals).all():
        raise ValueError("actual and predicted differences must be finite")
    return residuals


def mean_absolute_error(actual: Iterable[float], predicted: Iterable[float]) -> float:
    """Return mean absolute error for equally sized finite numeric sequences."""
    absolute = np.abs(_validated_residuals(actual, predicted))
    scale = float(absolute.max())
    return 0.0 if scale == 0 else float(scale * np.mean(absolute / scale))


def root_mean_squared_error(
    actual: Iterable[float], predicted: Iterable[float]
) -> float:
    """Return root mean squared error for finite numeric sequences."""
    absolute = np.abs(_validated_residuals(actual, predicted))
    scale = float(absolute.max())
    if scale == 0:
        return 0.0
    scaled = absolute / scale
    return float(scale * np.sqrt(np.mean(np.square(scaled))))


def _feature_prediction(validation: pd.DataFrame, column: str) -> pd.Series:
    if column not in validation:
        raise KeyError(f"validation data are missing column: {column}")
    values = _finite_numeric(validation[column], column)
    return pd.Series(values, index=validation.index, name=column)


def previous_day_forecast(validation: pd.DataFrame) -> pd.Series:
    """Predict each forecast date using its previous calendar day's quantity."""
    return _feature_prediction(validation, "lag_1_quantity")


def previous_week_forecast(validation: pd.DataFrame) -> pd.Series:
    """Predict each forecast date using quantity from seven calendar days prior."""
    return _feature_prediction(validation, "lag_7_quantity")


def trailing_seven_day_mean_forecast(
    daily: pd.DataFrame, forecast_dates: Iterable[object]
) -> pd.Series:
    """Predict from the seven actual daily quantities immediately before each date.

    Unlike the conservative Phase 5B ``rolling_mean_7`` model feature, this
    approved baseline includes the forecast origin day because that quantity is
    already known before the next-day forecast is made.
    """
    missing = [column for column in DAILY_COLUMNS if column not in daily]
    if missing:
        raise KeyError(f"daily data are missing columns: {', '.join(missing)}")

    dates = pd.to_datetime(daily["date"], errors="raise")
    quantities = _finite_numeric(daily["quantity"], "daily quantity")
    if dates.isna().any() or dates.duplicated().any():
        raise ValueError("daily dates must be present and unique")
    if not dates.is_monotonic_increasing:
        raise ValueError("daily dates must be sorted chronologically")
    expected = pd.date_range(dates.iloc[0], dates.iloc[-1], freq="D")
    if not dates.reset_index(drop=True).equals(pd.Series(expected)):
        raise ValueError("daily dates must form a continuous calendar")

    requested = pd.Series(pd.to_datetime(list(forecast_dates), errors="raise"))
    if requested.empty:
        raise ValueError("forecast_dates must not be empty")
    if requested.isna().any() or requested.duplicated().any():
        raise ValueError("forecast_dates must be present and unique")

    quantity_by_date = pd.Series(quantities, index=pd.DatetimeIndex(dates))
    predictions = []
    for forecast_date in requested:
        history_dates = pd.date_range(
            forecast_date - pd.Timedelta(days=7),
            forecast_date - pd.Timedelta(days=1),
            freq="D",
        )
        history = quantity_by_date.reindex(history_dates)
        if history.isna().any():
            raise ValueError("each forecast date requires seven prior daily values")
        predictions.append(float(history.mean()))
    return pd.Series(predictions, name=TRAILING_SEVEN_DAY_MEAN)


def evaluate_validation_baselines(
    validation: pd.DataFrame, daily: pd.DataFrame
) -> dict[str, object]:
    """Evaluate approved baselines on an explicitly supplied validation frame.

    This function intentionally accepts no test frame and exposes no test
    evaluation path. Selection in Phase 5C is validation-only.
    """
    required = ("forecast_date", TARGET_COLUMN, "lag_1_quantity", "lag_7_quantity")
    missing = [column for column in required if column not in validation]
    if missing:
        raise KeyError(f"validation data are missing columns: {', '.join(missing)}")
    if validation.empty:
        raise ValueError("validation data must not be empty")

    forecast_dates = pd.to_datetime(validation["forecast_date"], errors="raise")
    if forecast_dates.isna().any() or not forecast_dates.is_monotonic_increasing:
        raise ValueError("validation forecast dates must be present and ordered")
    actual = _finite_numeric(validation[TARGET_COLUMN], TARGET_COLUMN)
    predictions = {
        PREVIOUS_DAY: previous_day_forecast(validation),
        PREVIOUS_WEEK: previous_week_forecast(validation),
        TRAILING_SEVEN_DAY_MEAN: trailing_seven_day_mean_forecast(
            daily, forecast_dates
        ),
    }

    results = []
    for name, predicted in predictions.items():
        values = _finite_numeric(predicted, name)
        results.append(
            {
                "baseline": name,
                "validation_rows": int(actual.size),
                "mae": mean_absolute_error(actual, values),
                "rmse": root_mean_squared_error(actual, values),
                "mean_prediction": float(values.mean()),
                "mean_actual": float(actual.mean()),
                "min_prediction": float(values.min()),
                "max_prediction": float(values.max()),
            }
        )

    ranked = sorted(results, key=lambda result: (result["mae"], result["baseline"]))
    return {
        "evaluation_split": "validation",
        "validation_start": forecast_dates.iloc[0].date().isoformat(),
        "validation_end": forecast_dates.iloc[-1].date().isoformat(),
        "validation_rows": int(actual.size),
        "baselines": ranked,
        "baseline_to_beat": ranked[0]["baseline"],
    }
