"""Minimal HTTP service boundary for Sari Rasa data capabilities."""

import csv
from pathlib import Path

from fastapi import FastAPI, HTTPException

from sari_rasa_data.analysis_pipeline import (
    InvalidAnalyticsRange,
    average_order_value,
    load_analysis_dataframe,
    unique_order_count,
    resolve_analytics_range,
    sales_trend_summary,
)
from sari_rasa_data.pandas_analysis import (
    pandas_revenue_by_category,
    pandas_revenue_by_product,
    pandas_total_revenue,
    product_quantity_ranking,
)


app = FastAPI()
CANONICAL_DATASET_PATH = (
    Path(__file__).resolve().parents[2] / "data" / "transactions.csv"
)


@app.get("/health")
async def health() -> dict[str, str]:
    """Report that the Python HTTP service is running."""
    return {"status": "ok"}


def build_analytics_summary(
    path: Path | str, start_date: str | None = None, end_date: str | None = None
) -> dict[str, int | float]:
    """Compose the compact API summary from the verified analysis functions."""
    dataframe = load_analysis_dataframe(path)
    filtered = resolve_analytics_range(dataframe, start_date, end_date)["dataframe"]
    orders = unique_order_count(filtered)
    revenue = pandas_total_revenue(filtered)
    return {
        "total_revenue": revenue,
        "unique_orders": orders,
        "total_quantity": int(filtered["quantity"].sum()),
        "average_order_value": revenue / orders if orders else 0.0,
    }


@app.get("/analytics/summary")
def analytics_summary(
    start_date: str | None = None, end_date: str | None = None
) -> dict[str, int | float]:
    """Return canonical transaction totals for the Python data service."""
    try:
        return build_analytics_summary(CANONICAL_DATASET_PATH, start_date, end_date)
    except InvalidAnalyticsRange:
        raise HTTPException(status_code=400, detail="invalid analytics date range") from None
    except (OSError, csv.Error, KeyError, TypeError, ValueError):
        raise HTTPException(
            status_code=500, detail="analytics summary unavailable"
        ) from None


def build_products_analytics(
    path: Path | str, start_date: str | None = None, end_date: str | None = None
) -> dict[str, list[dict[str, str | int]]]:
    """Compose product quantity and revenue using verified analytics functions."""
    dataframe = resolve_analytics_range(
        load_analysis_dataframe(path), start_date, end_date
    )["dataframe"]
    revenues = pandas_revenue_by_product(dataframe)
    products = [
        {
            "product_name": str(product["product_name"]),
            "total_quantity": int(product["quantity"]),
            "total_revenue": revenues[str(product["product_name"])],
        }
        for product in product_quantity_ranking(dataframe)
    ]
    return {"products": products}


@app.get("/analytics/products")
def products_analytics(
    start_date: str | None = None, end_date: str | None = None
) -> dict[str, list[dict[str, str | int]]]:
    """Return canonical product analytics in deterministic quantity order."""
    try:
        return build_products_analytics(CANONICAL_DATASET_PATH, start_date, end_date)
    except InvalidAnalyticsRange:
        raise HTTPException(status_code=400, detail="invalid analytics date range") from None
    except (OSError, csv.Error, KeyError, TypeError, ValueError):
        raise HTTPException(
            status_code=500, detail="product analytics unavailable"
        ) from None


def build_categories_analytics(
    path: Path | str, start_date: str | None = None, end_date: str | None = None
) -> dict[str, list[dict[str, str | int]]]:
    """Compose alphabetically ordered category revenue analytics."""
    dataframe = resolve_analytics_range(
        load_analysis_dataframe(path), start_date, end_date
    )["dataframe"]
    categories = [
        {"category": category, "total_revenue": total_revenue}
        for category, total_revenue in pandas_revenue_by_category(dataframe).items()
    ]
    return {"categories": categories}


@app.get("/analytics/categories")
def categories_analytics(
    start_date: str | None = None, end_date: str | None = None
) -> dict[str, list[dict[str, str | int]]]:
    """Return canonical category revenue in deterministic name order."""
    try:
        return build_categories_analytics(CANONICAL_DATASET_PATH, start_date, end_date)
    except InvalidAnalyticsRange:
        raise HTTPException(status_code=400, detail="invalid analytics date range") from None
    except (OSError, csv.Error, KeyError, TypeError, ValueError):
        raise HTTPException(
            status_code=500, detail="category analytics unavailable"
        ) from None


def build_sales_trend_analytics(
    path: Path | str, start_date: str | None = None, end_date: str | None = None
) -> dict[str, object]:
    """Compose date-range sales analytics from the canonical DataFrame."""
    dataframe = load_analysis_dataframe(path)
    resolved = resolve_analytics_range(dataframe, start_date, end_date)
    result = sales_trend_summary(
        resolved["dataframe"], resolved["start_date"], resolved["end_date"]
    )
    result["available_period"] = {
        "min_available_date": resolved["min_available_date"],
        "max_available_date": resolved["max_available_date"],
    }
    return result


@app.get("/analytics/sales-trend")
def sales_trend_analytics(
    start_date: str | None = None, end_date: str | None = None
) -> dict[str, object]:
    """Return inclusive date-range sales analytics."""
    try:
        return build_sales_trend_analytics(
            CANONICAL_DATASET_PATH, start_date=start_date, end_date=end_date
        )
    except InvalidAnalyticsRange:
        raise HTTPException(
            status_code=400, detail="invalid sales trend date range"
        ) from None
    except (OSError, csv.Error, KeyError, TypeError, ValueError):
        raise HTTPException(
            status_code=500, detail="sales trend analytics unavailable"
        ) from None
