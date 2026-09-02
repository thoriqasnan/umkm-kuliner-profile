"""Frozen date-based experiment contract and efficient V2 daily aggregation."""

from pathlib import Path

import pandas as pd

from sari_rasa_data.application_catalog import APPLICATION_PRODUCT_CATALOG
from sari_rasa_data.forecasting import DAILY_COLUMNS
from sari_rasa_data.transactions import REQUIRED_TRANSACTION_FIELDS
from sari_rasa_data.model_training import CandidateSpec

V2_TRAIN_END = "2026-02-28"
V2_VALIDATION_START = "2026-03-01"
V2_VALIDATION_END = "2026-05-31"
V2_TEST_START = "2026-06-01"
V2_TEST_END = "2026-09-01"
V2_SELECTED_MODEL_SPEC = CandidateSpec(
    "hist_gradient_boosting",
    (
        ("learning_rate", 0.05),
        ("max_iter", 150),
        ("max_leaf_nodes", 15),
        ("l2_regularization", 2.0),
    ),
)


def load_v2_daily_quantity_series(path: Path | str, chunksize: int = 100_000) -> pd.DataFrame:
    """Validate and aggregate V2 CSV chunks without retaining 750K rows."""
    catalog = {str(item["product_id"]): item for item in APPLICATION_PRODUCT_CATALOG}
    totals: dict[pd.Timestamp, int] = {}
    seen_order_products: set[tuple[str, str]] = set()
    observed_product_ids: set[str] = set()
    rows = 0
    for chunk in pd.read_csv(path, chunksize=chunksize, dtype={"product_id": str}):
        if tuple(chunk.columns) != REQUIRED_TRANSACTION_FIELDS:
            raise ValueError("V2 transaction schema is incompatible")
        if chunk.isna().any().any() or chunk.duplicated().any():
            raise ValueError("V2 transactions contain missing or duplicate rows")
        identities = list(chunk[["order_id", "product_id"]].itertuples(index=False, name=None))
        if len(identities) != len(set(identities)) or any(identity in seen_order_products for identity in identities):
            raise ValueError("V2 transactions contain duplicate order/product identities")
        seen_order_products.update(identities)
        observed_product_ids.update(chunk["product_id"].astype(str))
        dates = pd.to_datetime(chunk["order_date"], format="%Y-%m-%d", errors="raise")
        quantities = pd.to_numeric(chunk["quantity"], errors="raise")
        if (quantities <= 0).any() or not (quantities % 1 == 0).all():
            raise ValueError("V2 quantities must be positive whole numbers")
        prices = pd.to_numeric(chunk["unit_price"], errors="raise")
        if (prices <= 0).any():
            raise ValueError("V2 prices must be positive")
        for row in chunk[["product_id", "product_name", "category", "unit_price"]].itertuples(index=False):
            product = catalog.get(str(row.product_id))
            if product is None or (row.product_name, row.category, row.unit_price) != (
                product["product_name"], product["category"], product["unit_price"]
            ):
                raise ValueError("V2 product catalog values are inconsistent")
        grouped = pd.DataFrame({"date": dates, "quantity": quantities.astype("int64")}).groupby("date")["quantity"].sum()
        for day, value in grouped.items():
            totals[day] = totals.get(day, 0) + int(value)
        rows += len(chunk)
    if rows == 0:
        raise ValueError("V2 transactions must not be empty")
    if observed_product_ids != set(catalog):
        raise ValueError("V2 transactions must contain the complete application product catalog")
    daily = pd.DataFrame({"date": sorted(totals), "quantity": [totals[day] for day in sorted(totals)]})
    expected = pd.date_range(daily["date"].iloc[0], daily["date"].iloc[-1], freq="D")
    if not daily["date"].reset_index(drop=True).equals(pd.Series(expected)):
        raise ValueError("V2 daily dates must form a continuous calendar")
    return daily.loc[:, DAILY_COLUMNS]


def v2_temporal_split(supervised: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Apply the frozen V2 forecast-date boundaries without viewing targets."""
    dates = pd.to_datetime(supervised["forecast_date"], errors="raise")
    if dates.duplicated().any() or not dates.is_monotonic_increasing:
        raise ValueError("V2 supervised forecast dates must be unique and sorted")
    train = supervised.loc[dates <= V2_TRAIN_END]
    validation = supervised.loc[(dates >= V2_VALIDATION_START) & (dates <= V2_VALIDATION_END)]
    test = supervised.loc[(dates >= V2_TEST_START) & (dates <= V2_TEST_END)]
    if any(frame.empty for frame in (train, validation, test)) or len(train) + len(validation) + len(test) != len(supervised):
        raise ValueError("V2 split boundaries do not cover the supervised frame")
    return {name: frame.copy().reset_index(drop=True) for name, frame in (("train", train), ("validation", validation), ("test", test))}
