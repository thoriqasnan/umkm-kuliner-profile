"""Beginner-readable NumPy array conversion and basic statistics for Phase 4C-3.

Standard deviation uses population semantics (``numpy.std`` default, ddof=0):
the canonical transaction dataset is treated as the complete set of
transactions being described, not a sample drawn from a larger population.
"""

import numpy as np
import pandas as pd

NUMERIC_COLUMNS = ("quantity", "unit_price", "line_total")


def column_to_numpy(dataframe: pd.DataFrame, column_name: str) -> np.ndarray:
    """Return a new NumPy array copied from one approved numeric column."""
    if column_name not in NUMERIC_COLUMNS:
        expected = ", ".join(NUMERIC_COLUMNS)
        raise ValueError(f"unsupported column: expected one of {expected}")
    if column_name not in dataframe.columns:
        raise KeyError(f"DataFrame is missing column: {column_name}")

    return dataframe[column_name].to_numpy(copy=True)


def _require_non_empty(values: np.ndarray) -> None:
    if values.size == 0:
        raise ValueError("cannot compute a statistic on an empty array")


def mean_value(values: np.ndarray) -> float:
    """Return the arithmetic mean as a plain Python float."""
    _require_non_empty(values)
    return float(np.mean(values))


def median_value(values: np.ndarray) -> float:
    """Return the median as a plain Python float."""
    _require_non_empty(values)
    return float(np.median(values))


def min_value(values: np.ndarray) -> float:
    """Return the minimum as a plain Python float."""
    _require_non_empty(values)
    return float(np.min(values))


def max_value(values: np.ndarray) -> float:
    """Return the maximum as a plain Python float."""
    _require_non_empty(values)
    return float(np.max(values))


def standard_deviation(values: np.ndarray) -> float:
    """Return the population standard deviation as a plain Python float."""
    _require_non_empty(values)
    return float(np.std(values))


def percentile_value(values: np.ndarray, percentile: float) -> float:
    """Return one percentile (0-100 inclusive) as a plain Python float."""
    if not 0 <= percentile <= 100:
        raise ValueError("percentile must be between 0 and 100")
    _require_non_empty(values)
    return float(np.percentile(values, percentile))


def summarize_numeric_column(values: np.ndarray) -> dict[str, float | int]:
    """Return a JSON-compatible summary of basic statistics for one array."""
    _require_non_empty(values)
    return {
        "count": int(values.size),
        "mean": mean_value(values),
        "median": median_value(values),
        "min": min_value(values),
        "max": max_value(values),
        "std": standard_deviation(values),
        "p25": percentile_value(values, 25),
        "p75": percentile_value(values, 75),
    }
