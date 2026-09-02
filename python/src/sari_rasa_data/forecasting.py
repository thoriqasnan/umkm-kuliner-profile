"""Leakage-safe dataset preparation for next-day quantity forecasting."""

from pathlib import Path

import pandas as pd

from sari_rasa_data.dataframe import load_transactions_dataframe


DAILY_COLUMNS = ("date", "quantity")
SUPERVISED_FEATURE_COLUMNS = (
    "day_of_week",
    "day_of_month",
    "month",
    "is_weekend",
    "lag_1_quantity",
    "lag_7_quantity",
    "lag_14_quantity",
    "rolling_mean_7",
    "rolling_mean_28",
    "rolling_median_7",
)
TARGET_COLUMN = "target_next_day_quantity"
MINIMUM_PREDICTION_HISTORY_DAYS = 29


def build_daily_quantity_series(transactions: pd.DataFrame) -> pd.DataFrame:
    """Aggregate transactions onto a complete, sorted daily calendar.

    Missing calendar dates between the first and last transaction are retained
    with zero quantity.  Transaction input is not mutated.
    """
    missing = [name for name in ("order_date", "quantity") if name not in transactions]
    if missing:
        raise KeyError(f"transactions are missing columns: {', '.join(missing)}")
    if transactions.empty:
        raise ValueError("transactions must not be empty")

    dates = pd.to_datetime(transactions["order_date"], format="%Y-%m-%d", errors="raise")
    quantities = pd.to_numeric(transactions["quantity"], errors="raise")
    if dates.isna().any():
        raise ValueError("order_date must not contain missing values")
    if quantities.isna().any() or (quantities < 0).any():
        raise ValueError("quantity must contain non-negative numeric values")
    if not (quantities % 1 == 0).all():
        raise ValueError("quantity must contain whole numbers")

    normalized = pd.DataFrame({"date": dates, "quantity": quantities.astype("int64")})
    grouped = normalized.groupby("date", sort=True)["quantity"].sum()
    calendar = pd.date_range(grouped.index.min(), grouped.index.max(), freq="D")
    daily = grouped.reindex(calendar, fill_value=0).rename_axis("date").reset_index()
    daily["quantity"] = daily["quantity"].astype("int64")
    return daily.loc[:, DAILY_COLUMNS]


def load_daily_quantity_series(path: Path | str) -> pd.DataFrame:
    """Load a validated transaction CSV and return continuous daily demand."""
    return build_daily_quantity_series(load_transactions_dataframe(path))


def build_next_day_quantity_features(daily: pd.DataFrame) -> pd.DataFrame:
    """Build one supervised row per forecast origin after warm-up.

    ``date`` is the information cutoff. ``forecast_date`` is the next calendar
    day and owns the calendar features and target. Lag 1 is the known quantity
    on ``date``; longer lags are aligned relative to ``forecast_date``.
    Rolling statistics are explicitly shifted once before rolling, so they use
    dates before the cutoff; the current-day value remains available only as
    ``lag_1_quantity``. The final origin is removed because its next-day target
    is unknown.
    """
    missing = [name for name in DAILY_COLUMNS if name not in daily]
    if missing:
        raise KeyError(f"daily data are missing columns: {', '.join(missing)}")
    if daily.empty:
        raise ValueError("daily data must not be empty")

    ordered = daily.loc[:, DAILY_COLUMNS].copy()
    ordered["date"] = pd.to_datetime(ordered["date"], errors="raise")
    if ordered["date"].isna().any():
        raise ValueError("daily date must not contain missing values")
    if ordered["date"].duplicated().any():
        raise ValueError("daily dates must be unique")
    if not ordered["date"].is_monotonic_increasing:
        raise ValueError("daily dates must be sorted ascending")
    expected = pd.date_range(ordered["date"].iloc[0], ordered["date"].iloc[-1], freq="D")
    if not ordered["date"].reset_index(drop=True).equals(pd.Series(expected)):
        raise ValueError("daily dates must form a continuous calendar")

    quantity = pd.to_numeric(ordered["quantity"], errors="raise")
    if quantity.isna().any() or (quantity < 0).any() or not (quantity % 1 == 0).all():
        raise ValueError("daily quantity must contain non-negative whole numbers")

    frame = pd.DataFrame({"date": ordered["date"]})
    frame["forecast_date"] = frame["date"] + pd.Timedelta(days=1)
    frame["day_of_week"] = frame["forecast_date"].dt.dayofweek.astype("int64")
    frame["day_of_month"] = frame["forecast_date"].dt.day.astype("int64")
    frame["month"] = frame["forecast_date"].dt.month.astype("int64")
    frame["is_weekend"] = (frame["day_of_week"] >= 5).astype("int64")
    frame["lag_1_quantity"] = quantity
    frame["lag_7_quantity"] = quantity.shift(6)
    frame["lag_14_quantity"] = quantity.shift(13)

    prior_to_cutoff = quantity.shift(1)
    frame["rolling_mean_7"] = prior_to_cutoff.rolling(7).mean()
    frame["rolling_mean_28"] = prior_to_cutoff.rolling(28).mean()
    frame["rolling_median_7"] = prior_to_cutoff.rolling(7).median()
    frame[TARGET_COLUMN] = quantity.shift(-1)

    required = [*SUPERVISED_FEATURE_COLUMNS, TARGET_COLUMN]
    result = frame.dropna(subset=required).reset_index(drop=True)
    integer_columns = (
        "lag_1_quantity",
        "lag_7_quantity",
        "lag_14_quantity",
        TARGET_COLUMN,
    )
    result[list(integer_columns)] = result.loc[:, integer_columns].astype("int64")
    return result


def build_prediction_feature_row(daily: pd.DataFrame) -> pd.DataFrame:
    """Build the approved feature row for the day after the latest observation.

    A temporary unknown next day is appended, then the training feature builder
    supplies the row. This deliberately shares all lag/rolling/calendar math
    with supervised preparation and avoids training-serving skew.
    """
    if len(daily) < MINIMUM_PREDICTION_HISTORY_DAYS:
        raise ValueError(
            f"at least {MINIMUM_PREDICTION_HISTORY_DAYS} continuous daily observations are required"
        )
    history = daily.loc[:, DAILY_COLUMNS].copy()
    # Run the shared validator before deriving "latest" so malformed ordering
    # cannot affect forecast-date construction or produce misleading errors.
    build_next_day_quantity_features(history)
    latest = pd.to_datetime(history["date"], errors="raise").iloc[-1]
    extended = pd.concat(
        (
            history,
            pd.DataFrame({"date": [latest + pd.Timedelta(days=1)], "quantity": [0]}),
        ),
        ignore_index=True,
    )
    supervised = build_next_day_quantity_features(extended)
    row = supervised.loc[supervised["date"] == latest]
    if len(row) != 1:
        raise ValueError("historical daily demand cannot produce a prediction row")
    features = row.loc[:, SUPERVISED_FEATURE_COLUMNS].copy()
    if not pd.notna(features).all().all():
        raise ValueError("prediction features must be finite")
    return pd.concat(
        (row.loc[:, ["date", "forecast_date"]].reset_index(drop=True), features.reset_index(drop=True)),
        axis=1,
    )


def chronological_split(
    supervised: pd.DataFrame,
    train_fraction: float = 0.70,
    validation_fraction: float = 0.15,
) -> dict[str, pd.DataFrame]:
    """Return deterministic, non-overlapping train/validation/test partitions."""
    if len(supervised) < 3:
        raise ValueError("at least three supervised rows are required")
    if not 0 < train_fraction < 1 or not 0 < validation_fraction < 1:
        raise ValueError("split fractions must be between zero and one")
    if train_fraction + validation_fraction >= 1:
        raise ValueError("train and validation fractions must leave a test set")
    if "forecast_date" not in supervised:
        raise KeyError("supervised data are missing column: forecast_date")
    if not supervised["forecast_date"].is_monotonic_increasing:
        raise ValueError("supervised rows must be sorted chronologically")
    if supervised["forecast_date"].duplicated().any():
        raise ValueError("forecast dates must be unique")

    train_end = int(len(supervised) * train_fraction)
    validation_end = train_end + int(len(supervised) * validation_fraction)
    if train_end == 0 or validation_end == train_end or validation_end == len(supervised):
        raise ValueError("split fractions produce an empty partition")

    return {
        "train": supervised.iloc[:train_end].copy().reset_index(drop=True),
        "validation": supervised.iloc[train_end:validation_end].copy().reset_index(drop=True),
        "test": supervised.iloc[validation_end:].copy().reset_index(drop=True),
    }
