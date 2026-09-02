"""Validated, stat-invalidated aggregate cache for large analytics datasets."""

import hashlib
import threading
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from sari_rasa_data.application_catalog import APPLICATION_PRODUCT_CATALOG
from sari_rasa_data.analysis_pipeline import InvalidAnalyticsRange
from sari_rasa_data.transactions import REQUIRED_TRANSACTION_FIELDS

V2_ANALYTICS_PATH = Path(__file__).resolve().parents[2] / "data" / "transactions_ml_v2.csv"
V2_EXPECTED_SHA256 = "9d87ac53771e5c4cd3eed39127fe50cb8bdbe749a885c2472cdacfb8e1cd8d3e"
V2_EXPECTED_ROWS = 750_000
V2_EXPECTED_MIN_DATE = "2024-10-09"
V2_EXPECTED_MAX_DATE = "2026-09-01"


@dataclass(frozen=True)
class AnalyticsSnapshot:
    source: Path
    identity: tuple[int, int, int, int]
    row_count: int
    min_date: str
    max_date: str
    daily: pd.DataFrame
    daily_products: pd.DataFrame
    daily_categories: pd.DataFrame


def _file_identity(path: Path) -> tuple[int, int, int, int]:
    stat = path.stat()
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_snapshot(path: Path, identity: tuple[int, int, int, int]) -> AnalyticsSnapshot:
    frame = pd.read_csv(path, dtype={"order_id": "string", "product_id": "string"})
    if tuple(frame.columns) != REQUIRED_TRANSACTION_FIELDS:
        raise ValueError("analytics dataset schema is incompatible")
    if frame.empty or frame.isna().any().any():
        raise ValueError("analytics dataset must be non-empty without missing values")
    if frame.duplicated().any():
        raise ValueError("analytics dataset contains duplicate rows")
    text_columns = ("order_id", "order_date", "product_id", "product_name", "category", "payment_method")
    for column in text_columns:
        values = frame[column].astype("string")
        if values.str.strip().ne(values).any() or values.str.len().eq(0).any():
            raise ValueError(f"analytics dataset has invalid {column}")
    dates = pd.to_datetime(frame["order_date"], format="%Y-%m-%d", errors="raise")
    if not dates.dt.strftime("%Y-%m-%d").eq(frame["order_date"]).all():
        raise ValueError("analytics dates must use YYYY-MM-DD")
    for column, minimum in (("quantity", 1), ("unit_price", 0)):
        numeric = pd.to_numeric(frame[column], errors="raise")
        if (numeric < minimum).any() or not (numeric % 1 == 0).all():
            raise ValueError(f"analytics dataset has invalid {column}")
        frame[column] = numeric.astype("int64")
    frame["date"] = dates
    order_consistency = frame.groupby("order_id", sort=False, observed=True).agg(
        dates=("date", "nunique"), payments=("payment_method", "nunique")
    )
    if order_consistency["dates"].gt(1).any() or order_consistency["payments"].gt(1).any():
        raise ValueError("analytics orders must have one date and payment method")
    del order_consistency
    frame["line_total"] = frame["quantity"] * frame["unit_price"]
    if (frame["line_total"] < 0).any():
        raise ValueError("analytics line totals must not overflow")

    min_date = dates.min().date().isoformat()
    max_date = dates.max().date().isoformat()
    if path.resolve() == V2_ANALYTICS_PATH.resolve():
        if len(frame) != V2_EXPECTED_ROWS or min_date != V2_EXPECTED_MIN_DATE or max_date != V2_EXPECTED_MAX_DATE:
            raise ValueError("configured V2 analytics dataset identity is incompatible")
        if _sha256(path) != V2_EXPECTED_SHA256:
            raise ValueError("configured V2 analytics dataset hash is incompatible")
        catalog = pd.DataFrame(APPLICATION_PRODUCT_CATALOG).drop(columns="weight")
        catalog["product_id"] = catalog["product_id"].astype("string")
        observed = frame.loc[:, ["product_id", "product_name", "category", "unit_price"]].drop_duplicates()
        aligned = observed.merge(catalog, on="product_id", how="outer", suffixes=("_observed", "_catalog"), indicator=True)
        fields = ("product_name", "category", "unit_price")
        if len(aligned) != len(catalog) or aligned["_merge"].ne("both").any() or any(
            aligned[f"{field}_observed"].ne(aligned[f"{field}_catalog"]).any() for field in fields
        ):
            raise ValueError("configured V2 analytics product catalog is incompatible")

    daily = frame.groupby("date", sort=True, observed=True).agg(
        total_revenue=("line_total", "sum"),
        unique_orders=("order_id", "nunique"),
        total_quantity=("quantity", "sum"),
    ).reset_index()
    daily_products = frame.groupby(["date", "product_name"], sort=True, observed=True).agg(
        total_quantity=("quantity", "sum"), total_revenue=("line_total", "sum")
    ).reset_index()
    daily_categories = frame.groupby(["date", "category"], sort=True, observed=True).agg(
        total_revenue=("line_total", "sum")
    ).reset_index()
    del frame
    return AnalyticsSnapshot(path, identity, len(dates), min_date, max_date, daily, daily_products, daily_categories)


class AnalyticsDatasetCache:
    """Keep one immutable aggregate snapshot and reload after file replacement/change."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._snapshot: AnalyticsSnapshot | None = None

    def get(self, path: Path | str) -> AnalyticsSnapshot:
        resolved = Path(path).resolve()
        identity = _file_identity(resolved)
        snapshot = self._snapshot
        if snapshot is not None and snapshot.source == resolved and snapshot.identity == identity:
            return snapshot
        with self._lock:
            snapshot = self._snapshot
            identity = _file_identity(resolved)
            if snapshot is not None and snapshot.source == resolved and snapshot.identity == identity:
                return snapshot
            replacement = _load_snapshot(resolved, identity)
            self._snapshot = replacement
            return replacement

    def clear(self) -> None:
        with self._lock:
            self._snapshot = None


ANALYTICS_DATASET_CACHE = AnalyticsDatasetCache()


def _bounds(snapshot: AnalyticsSnapshot, start_date: str | None, end_date: str | None) -> tuple[pd.Timestamp, pd.Timestamp, str, str]:
    start = start_date or snapshot.min_date
    end = end_date or snapshot.max_date
    try:
        start_ts = pd.Timestamp(start)
        end_ts = pd.Timestamp(end)
    except (TypeError, ValueError) as error:
        raise InvalidAnalyticsRange("invalid analytics date range") from error
    if start_ts.strftime("%Y-%m-%d") != start or end_ts.strftime("%Y-%m-%d") != end or start > end or start < snapshot.min_date or end > snapshot.max_date:
        raise InvalidAnalyticsRange("invalid analytics date range")
    return start_ts, end_ts, start, end


def analytics_from_snapshot(snapshot: AnalyticsSnapshot, kind: str, start_date: str | None = None, end_date: str | None = None) -> dict[str, object]:
    start_ts, end_ts, start, end = _bounds(snapshot, start_date, end_date)
    daily = snapshot.daily.loc[snapshot.daily["date"].between(start_ts, end_ts)]
    if kind == "summary":
        revenue = int(daily["total_revenue"].sum())
        orders = int(daily["unique_orders"].sum())
        return {"total_revenue": revenue, "unique_orders": orders, "total_quantity": int(daily["total_quantity"].sum()), "average_order_value": revenue / orders if orders else 0.0}
    if kind == "products":
        selected = snapshot.daily_products.loc[snapshot.daily_products["date"].between(start_ts, end_ts)]
        grouped = selected.groupby("product_name", sort=False).agg(total_quantity=("total_quantity", "sum"), total_revenue=("total_revenue", "sum")).reset_index()
        grouped = grouped.sort_values(["total_quantity", "product_name"], ascending=[False, True])
        return {"products": [{"product_name": str(row.product_name), "total_quantity": int(row.total_quantity), "total_revenue": int(row.total_revenue)} for row in grouped.itertuples(index=False)]}
    if kind == "categories":
        selected = snapshot.daily_categories.loc[snapshot.daily_categories["date"].between(start_ts, end_ts)]
        grouped = selected.groupby("category", sort=True)["total_revenue"].sum()
        return {"categories": [{"category": str(name), "total_revenue": int(value)} for name, value in grouped.items()]}
    if kind != "sales_trend":
        raise ValueError("unsupported analytics kind")
    points = [{"date": row.date.date().isoformat(), "total_revenue": int(row.total_revenue), "unique_orders": int(row.unique_orders), "total_quantity": int(row.total_quantity)} for row in daily.itertuples(index=False)]
    revenue = sum(point["total_revenue"] for point in points)
    orders = sum(point["unique_orders"] for point in points)
    high = max(points, key=lambda point: point["total_revenue"], default=None)
    low = min(points, key=lambda point: point["total_revenue"], default=None)
    day_value = lambda point: None if point is None else {"date": point["date"], "total_revenue": point["total_revenue"]}
    return {
        "start_date": start, "end_date": end,
        "summary": {"total_revenue": revenue, "unique_orders": orders, "total_quantity": sum(point["total_quantity"] for point in points), "average_order_value": revenue / orders if orders else 0.0},
        "daily_sales": points, "high_day": day_value(high), "low_day": day_value(low),
        "available_period": {"min_available_date": snapshot.min_date, "max_available_date": snapshot.max_date},
    }
