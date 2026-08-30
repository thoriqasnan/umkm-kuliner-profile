"""Beginner-readable Pandas filtering and aggregation for Phase 4C-2."""

from datetime import date

import pandas as pd

from sari_rasa_data.data_transform import CATEGORY_NAMES, PAYMENT_METHOD_NAMES


def _require_known_filter(value: str, known_values: set[str], field: str) -> str:
    """Require one exact canonical filter value."""
    if not isinstance(value, str) or value not in known_values:
        expected = ", ".join(sorted(known_values))
        raise ValueError(f"unknown {field}: expected one of {expected}")
    return value


def _require_iso_date(value: str, field: str) -> str:
    """Require an exact ISO ``YYYY-MM-DD`` filter value."""
    if not isinstance(value, str):
        raise TypeError(f"{field} must be a string")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise ValueError(f"{field} must use YYYY-MM-DD format") from error
    if parsed.isoformat() != value:
        raise ValueError(f"{field} must use YYYY-MM-DD format")
    return value


def filter_by_category(dataframe: pd.DataFrame, category: str) -> pd.DataFrame:
    """Return rows matching one canonical category."""
    category = _require_known_filter(
        category, set(CATEGORY_NAMES.values()), "category"
    )
    return dataframe.loc[dataframe["category"] == category].copy().reset_index(drop=True)


def filter_by_payment_method(
    dataframe: pd.DataFrame, payment_method: str
) -> pd.DataFrame:
    """Return rows matching one canonical payment method."""
    payment_method = _require_known_filter(
        payment_method, set(PAYMENT_METHOD_NAMES.values()), "payment_method"
    )
    return (
        dataframe.loc[dataframe["payment_method"] == payment_method]
        .copy()
        .reset_index(drop=True)
    )


def filter_by_date_range(
    dataframe: pd.DataFrame, start_date: str, end_date: str
) -> pd.DataFrame:
    """Return rows in an inclusive ISO date range."""
    start_date = _require_iso_date(start_date, "start_date")
    end_date = _require_iso_date(end_date, "end_date")
    if start_date > end_date:
        raise ValueError("start_date must not be later than end_date")

    mask = dataframe["order_date"].between(start_date, end_date, inclusive="both")
    return dataframe.loc[mask].copy().reset_index(drop=True)


def pandas_total_revenue(dataframe: pd.DataFrame) -> int:
    """Return total transaction-line revenue as a Python integer."""
    return int(dataframe["line_total"].sum())


def series_to_sorted_int_dict(series: pd.Series) -> dict[str, int]:
    """Return a Series as a JSON-compatible dict, sorted by key.

    Shared by this module's own grouped totals and by
    ``sari_rasa_data.analysis_pipeline``'s Phase 4C-4 grouped metrics, so the
    groupby-to-dict conversion is written once.
    """
    return {str(key): int(value) for key, value in series.sort_index().items()}


def _grouped_integer_totals(
    dataframe: pd.DataFrame, group_column: str, value_column: str
) -> dict[str, int]:
    """Group and sum a numeric column into a JSON-compatible dictionary."""
    grouped = dataframe.groupby(group_column)[value_column].sum()
    return series_to_sorted_int_dict(grouped)


def pandas_revenue_by_category(dataframe: pd.DataFrame) -> dict[str, int]:
    """Return revenue grouped by category."""
    return _grouped_integer_totals(dataframe, "category", "line_total")


def pandas_quantity_by_product(dataframe: pd.DataFrame) -> dict[str, int]:
    """Return quantity sold grouped by product name."""
    return _grouped_integer_totals(dataframe, "product_name", "quantity")


def pandas_daily_revenue(dataframe: pd.DataFrame) -> dict[str, int]:
    """Return revenue grouped by ISO date."""
    return _grouped_integer_totals(dataframe, "order_date", "line_total")


def product_quantity_ranking(dataframe: pd.DataFrame) -> list[dict[str, str | int]]:
    """Return products by quantity descending, then name ascending for ties."""
    quantities = (
        dataframe.groupby("product_name", as_index=False)["quantity"]
        .sum()
        .sort_values(
            by=["quantity", "product_name"],
            ascending=[False, True],
            kind="stable",
        )
    )
    return [
        {"product_name": str(row.product_name), "quantity": int(row.quantity)}
        for row in quantities.itertuples(index=False)
    ]
