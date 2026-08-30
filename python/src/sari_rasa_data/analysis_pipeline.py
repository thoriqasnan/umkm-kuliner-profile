"""Integrated Pandas + NumPy analysis for Phase 4C-4.

This module does not reimplement loading, validation, cleaning,
transformation, filtering, grouping, or statistics. It only composes the
already-verified Phase 4B/4C-1/4C-2/4C-3 functions over one DataFrame built
from a transaction CSV (the small canonical fixture or the large synthetic
dataset).

Order-level vs transaction-line semantics: one ``order_id`` can span several
transaction lines (several products bought together). Metrics named with
"order" (``unique_order_count``, ``average_order_value``) are computed per
unique ``order_id``. Every other total in this module counts transaction
lines, matching the existing Phase 4B/4C-2 aggregation behavior.
"""

from pathlib import Path

import pandas as pd

from sari_rasa_data.dataframe import load_transactions_dataframe
from sari_rasa_data.numpy_analysis import column_to_numpy, summarize_numeric_column
from sari_rasa_data.pandas_analysis import (
    pandas_daily_revenue,
    pandas_quantity_by_product,
    pandas_revenue_by_category,
    pandas_total_revenue,
    product_quantity_ranking,
    series_to_sorted_int_dict,
)


def load_analysis_dataframe(path: Path | str) -> pd.DataFrame:
    """Run the verified Phase 4B/4C-1 pipeline over a transaction CSV."""
    return load_transactions_dataframe(path)


def unique_order_count(dataframe: pd.DataFrame) -> int:
    """Return the number of distinct orders (not transaction lines)."""
    return int(dataframe["order_id"].nunique())


def average_order_value(dataframe: pd.DataFrame) -> float:
    """Return total revenue divided by the number of unique orders."""
    orders = unique_order_count(dataframe)
    if orders == 0:
        raise ValueError("cannot compute average order value with zero orders")
    return pandas_total_revenue(dataframe) / orders


def order_date_range(dataframe: pd.DataFrame) -> dict[str, str]:
    """Return the earliest and latest ISO order date in the dataset."""
    if dataframe.empty:
        raise ValueError("cannot compute a date range for an empty DataFrame")
    return {
        "start_date": str(dataframe["order_date"].min()),
        "end_date": str(dataframe["order_date"].max()),
    }


def monthly_revenue(dataframe: pd.DataFrame) -> dict[str, int]:
    """Return transaction-line revenue grouped by ``YYYY-MM``."""
    months = dataframe["order_date"].str.slice(0, 7)
    grouped = dataframe.groupby(months)["line_total"].sum()
    return series_to_sorted_int_dict(grouped)


def payment_method_line_counts(dataframe: pd.DataFrame) -> dict[str, int]:
    """Return transaction-LINE counts by payment method (not unique orders)."""
    counts = dataframe.groupby("payment_method").size()
    return series_to_sorted_int_dict(counts)


def weekday_weekend_comparison(dataframe: pd.DataFrame) -> dict[str, dict[str, int]]:
    """Compare weekday vs weekend transaction lines by calendar day-of-week."""
    is_weekend = pd.to_datetime(dataframe["order_date"]).dt.dayofweek >= 5

    def _segment_summary(mask: pd.Series) -> dict[str, int]:
        segment = dataframe.loc[mask]
        return {
            "transaction_line_count": int(len(segment)),
            "total_revenue": int(segment["line_total"].sum()),
            "total_quantity_sold": int(segment["quantity"].sum()),
        }

    return {
        "weekday": _segment_summary(~is_weekend),
        "weekend": _segment_summary(is_weekend),
    }


def top_products_by_quantity(
    dataframe: pd.DataFrame, top_n: int = 5
) -> list[dict[str, str | int]]:
    """Return the ``top_n`` products by total quantity sold, descending."""
    return product_quantity_ranking(dataframe)[:top_n]


def analyze_transactions(path: Path | str) -> dict[str, object]:
    """Return one JSON-compatible analysis summary for a transaction CSV."""
    dataframe = load_analysis_dataframe(path)

    quantity_array = column_to_numpy(dataframe, "quantity")
    line_total_array = column_to_numpy(dataframe, "line_total")

    return {
        "dataset_overview": {
            "transaction_line_count": int(len(dataframe)),
            "unique_order_count": unique_order_count(dataframe),
            **order_date_range(dataframe),
        },
        "sales": {
            "total_revenue": pandas_total_revenue(dataframe),
            "total_quantity_sold": int(dataframe["quantity"].sum()),
            "average_order_value": average_order_value(dataframe),
        },
        "revenue_by_category": pandas_revenue_by_category(dataframe),
        "quantity_by_product": pandas_quantity_by_product(dataframe),
        "top_products_by_quantity": top_products_by_quantity(dataframe),
        "daily_revenue": pandas_daily_revenue(dataframe),
        "monthly_revenue": monthly_revenue(dataframe),
        "weekday_weekend_comparison": weekday_weekend_comparison(dataframe),
        "payment_method_line_counts": payment_method_line_counts(dataframe),
        "quantity_statistics": summarize_numeric_column(quantity_array),
        "line_total_statistics": summarize_numeric_column(line_total_array),
    }
