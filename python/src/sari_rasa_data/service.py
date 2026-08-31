"""Minimal HTTP service boundary for Sari Rasa data capabilities."""

import csv
from pathlib import Path

from fastapi import FastAPI, HTTPException

from sari_rasa_data.analysis_pipeline import (
    average_order_value,
    load_analysis_dataframe,
    unique_order_count,
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


def build_analytics_summary(path: Path | str) -> dict[str, int | float]:
    """Compose the compact API summary from the verified analysis functions."""
    dataframe = load_analysis_dataframe(path)
    return {
        "total_revenue": pandas_total_revenue(dataframe),
        "unique_orders": unique_order_count(dataframe),
        "total_quantity": int(dataframe["quantity"].sum()),
        "average_order_value": average_order_value(dataframe),
    }


@app.get("/analytics/summary")
def analytics_summary() -> dict[str, int | float]:
    """Return canonical transaction totals for the Python data service."""
    try:
        return build_analytics_summary(CANONICAL_DATASET_PATH)
    except (OSError, csv.Error, KeyError, TypeError, ValueError):
        raise HTTPException(
            status_code=500, detail="analytics summary unavailable"
        ) from None


def build_products_analytics(path: Path | str) -> dict[str, list[dict[str, str | int]]]:
    """Compose product quantity and revenue using verified analytics functions."""
    dataframe = load_analysis_dataframe(path)
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
def products_analytics() -> dict[str, list[dict[str, str | int]]]:
    """Return canonical product analytics in deterministic quantity order."""
    try:
        return build_products_analytics(CANONICAL_DATASET_PATH)
    except (OSError, csv.Error, KeyError, TypeError, ValueError):
        raise HTTPException(
            status_code=500, detail="product analytics unavailable"
        ) from None


def build_categories_analytics(
    path: Path | str,
) -> dict[str, list[dict[str, str | int]]]:
    """Compose alphabetically ordered category revenue analytics."""
    dataframe = load_analysis_dataframe(path)
    categories = [
        {"category": category, "total_revenue": total_revenue}
        for category, total_revenue in pandas_revenue_by_category(dataframe).items()
    ]
    return {"categories": categories}


@app.get("/analytics/categories")
def categories_analytics() -> dict[str, list[dict[str, str | int]]]:
    """Return canonical category revenue in deterministic name order."""
    try:
        return build_categories_analytics(CANONICAL_DATASET_PATH)
    except (OSError, csv.Error, KeyError, TypeError, ValueError):
        raise HTTPException(
            status_code=500, detail="category analytics unavailable"
        ) from None
