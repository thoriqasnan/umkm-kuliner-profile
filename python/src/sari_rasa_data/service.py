"""Minimal HTTP service boundary for Sari Rasa data capabilities."""

import csv
import os
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
from sari_rasa_data.model_artifact import ArtifactError, DEFAULT_ML_DATASET_PATH, DEFAULT_MODEL_ARTIFACT_PATH
from sari_rasa_data.prediction import predict_next_day
from sari_rasa_data.analytics_store import ANALYTICS_DATASET_CACHE, V2_ANALYTICS_PATH, analytics_from_snapshot


app = FastAPI()
CANONICAL_DATASET_PATH = (
    Path(__file__).resolve().parents[2] / "data" / "transactions.csv"
)
ANALYTICS_DATASET_PATH = Path(os.environ.get("SARI_RASA_ANALYTICS_DATASET_PATH", V2_ANALYTICS_PATH))
ML_FORECAST_DATASET_PATH = Path(os.environ.get("SARI_RASA_ML_DATASET_PATH", DEFAULT_ML_DATASET_PATH))
ML_MODEL_ARTIFACT_PATH = Path(os.environ.get("SARI_RASA_MODEL_ARTIFACT_PATH", DEFAULT_MODEL_ARTIFACT_PATH))


@app.get("/health")
async def health() -> dict[str, str]:
    """Report that the Python HTTP service is running."""
    return {"status": "ok"}


@app.get("/analytics/forecast/next-day")
def next_day_forecast() -> dict[str, object]:
    """Return a next-day demand forecast from trusted operator resources."""
    try:
        result = predict_next_day(ML_FORECAST_DATASET_PATH, ML_MODEL_ARTIFACT_PATH)
    except (ArtifactError, OSError, csv.Error, KeyError, TypeError, ValueError):
        raise HTTPException(status_code=503, detail="next-day forecast unavailable") from None
    return {
        "forecast_date": result.forecast_date,
        "predicted_quantity": result.predicted_quantity,
        "model": {
            "family": result.model_family,
            "artifact_version": result.artifact_version,
            "forecast_horizon_days": result.forecast_horizon_days,
        },
    }


def build_analytics_summary(
    path: Path | str, start_date: str | None = None, end_date: str | None = None
) -> dict[str, int | float]:
    """Compose the compact API summary from the verified analysis functions."""
    return analytics_from_snapshot(ANALYTICS_DATASET_CACHE.get(path), "summary", start_date, end_date)


@app.get("/analytics/summary")
def analytics_summary(
    start_date: str | None = None, end_date: str | None = None
) -> dict[str, int | float]:
    """Return configured transaction totals for the Python data service."""
    try:
        return build_analytics_summary(ANALYTICS_DATASET_PATH, start_date, end_date)
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
    return analytics_from_snapshot(ANALYTICS_DATASET_CACHE.get(path), "products", start_date, end_date)


@app.get("/analytics/products")
def products_analytics(
    start_date: str | None = None, end_date: str | None = None
) -> dict[str, list[dict[str, str | int]]]:
    """Return configured product analytics in deterministic quantity order."""
    try:
        return build_products_analytics(ANALYTICS_DATASET_PATH, start_date, end_date)
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
    return analytics_from_snapshot(ANALYTICS_DATASET_CACHE.get(path), "categories", start_date, end_date)


@app.get("/analytics/categories")
def categories_analytics(
    start_date: str | None = None, end_date: str | None = None
) -> dict[str, list[dict[str, str | int]]]:
    """Return configured category revenue in deterministic name order."""
    try:
        return build_categories_analytics(ANALYTICS_DATASET_PATH, start_date, end_date)
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
    return analytics_from_snapshot(ANALYTICS_DATASET_CACHE.get(path), "sales_trend", start_date, end_date)


@app.get("/analytics/sales-trend")
def sales_trend_analytics(
    start_date: str | None = None, end_date: str | None = None
) -> dict[str, object]:
    """Return inclusive date-range sales analytics."""
    try:
        return build_sales_trend_analytics(
            ANALYTICS_DATASET_PATH, start_date=start_date, end_date=end_date
        )
    except InvalidAnalyticsRange:
        raise HTTPException(
            status_code=400, detail="invalid sales trend date range"
        ) from None
    except (OSError, csv.Error, KeyError, TypeError, ValueError):
        raise HTTPException(
            status_code=500, detail="sales trend analytics unavailable"
        ) from None
