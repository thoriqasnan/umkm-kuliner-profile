from pathlib import Path

import pandas as pd
import pytest

from sari_rasa_data.forecasting import SUPERVISED_FEATURE_COLUMNS, build_next_day_quantity_features
from sari_rasa_data.ml_v2_data import write_v2_transactions_csv
from sari_rasa_data.ml_v2_experiment import V2_SELECTED_MODEL_SPEC, load_v2_daily_quantity_series, v2_temporal_split


def test_chunked_v2_daily_aggregation_and_frozen_split(tmp_path):
    path = tmp_path / "v2.csv"
    write_v2_transactions_csv(path, row_count=5000, seed=3, start_date=pd.Timestamp("2024-10-09").date(), end_date=pd.Timestamp("2026-09-01").date())
    daily = load_v2_daily_quantity_series(path, chunksize=777)
    assert len(daily) == 693
    assert int(daily.quantity.sum()) > 5000
    supervised = build_next_day_quantity_features(daily)
    splits = v2_temporal_split(supervised)
    assert len(supervised) == 664
    assert [(name, len(frame), frame.forecast_date.min().date().isoformat(), frame.forecast_date.max().date().isoformat()) for name, frame in splits.items()] == [
        ("train", 479, "2024-11-07", "2026-02-28"),
        ("validation", 92, "2026-03-01", "2026-05-31"),
        ("test", 93, "2026-06-01", "2026-09-01"),
    ]
    assert tuple(supervised.loc[:, SUPERVISED_FEATURE_COLUMNS].columns) == SUPERVISED_FEATURE_COLUMNS
    assert splits["train"].forecast_date.max() < splits["validation"].forecast_date.min() < splits["test"].forecast_date.min()
    assert V2_SELECTED_MODEL_SPEC.parameter_dict() == {"learning_rate": 0.05, "max_iter": 150, "max_leaf_nodes": 15, "l2_regularization": 2.0}


def test_v2_loader_rejects_cross_chunk_duplicate_identity_and_incomplete_catalog(tmp_path):
    path = tmp_path / "v2.csv"
    write_v2_transactions_csv(path, row_count=200, seed=9, start_date=pd.Timestamp("2026-01-01").date(), end_date=pd.Timestamp("2026-01-02").date())
    frame = pd.read_csv(path, dtype={"product_id": str})
    duplicate = pd.concat((frame.iloc[:12], frame.iloc[[0]], frame.iloc[12:]), ignore_index=True)
    duplicate.to_csv(path, index=False)
    with pytest.raises(ValueError, match="duplicate order/product"):
        load_v2_daily_quantity_series(path, chunksize=12)

    frame = frame.loc[frame["product_id"] != "11"]
    frame.to_csv(path, index=False)
    with pytest.raises(ValueError, match="complete application product catalog"):
        load_v2_daily_quantity_series(path, chunksize=17)
