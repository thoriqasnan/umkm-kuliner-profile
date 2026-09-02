import os
from pathlib import Path

import pandas as pd
import pytest

import sari_rasa_data.analytics_store as module
from sari_rasa_data.analytics_store import AnalyticsDatasetCache, analytics_from_snapshot


HEADER = "order_id,order_date,product_id,product_name,category,quantity,unit_price,payment_method\n"


def write_fixture(path: Path, quantity: int = 2, start: str = "2026-01-01") -> None:
    path.write_text(HEADER + f"ORD-1,{start},P1,Produk A,Makanan,{quantity},10000,QRIS\n" + f"ORD-2,2026-01-02,P2,Produk B,Minuman,1,5000,Tunai\n", encoding="utf-8")


def test_cache_reuses_unchanged_snapshot_and_invalidates_on_file_identity(tmp_path, monkeypatch):
    path = tmp_path / "analytics.csv"
    write_fixture(path)
    cache = AnalyticsDatasetCache()
    calls = 0
    original = module.pd.read_csv
    def counted(*args, **kwargs):
        nonlocal calls
        calls += 1
        return original(*args, **kwargs)
    monkeypatch.setattr(module.pd, "read_csv", counted)
    first = cache.get(path)
    second = cache.get(path)
    assert first is second and calls == 1
    write_fixture(path, quantity=5)
    os.utime(path, ns=(path.stat().st_atime_ns, path.stat().st_mtime_ns + 1_000_000))
    third = cache.get(path)
    assert third is not first and calls == 2
    assert analytics_from_snapshot(third, "summary")["total_quantity"] == 6


def test_cache_has_no_cross_dataset_contamination_and_failed_reload_is_not_cached(tmp_path):
    first_path = tmp_path / "first.csv"; second_path = tmp_path / "second.csv"
    write_fixture(first_path, quantity=2); write_fixture(second_path, quantity=8)
    cache = AnalyticsDatasetCache()
    assert analytics_from_snapshot(cache.get(first_path), "summary")["total_quantity"] == 3
    assert analytics_from_snapshot(cache.get(second_path), "summary")["total_quantity"] == 9
    second_path.write_text("bad,data\n", encoding="utf-8")
    with pytest.raises(ValueError):
        cache.get(second_path)


def test_snapshot_contracts_and_date_ranges(tmp_path):
    path = tmp_path / "analytics.csv"; write_fixture(path)
    snapshot = AnalyticsDatasetCache().get(path)
    assert analytics_from_snapshot(snapshot, "summary") == {"total_revenue": 25000, "unique_orders": 2, "total_quantity": 3, "average_order_value": 12500}
    assert analytics_from_snapshot(snapshot, "products")["products"][0]["product_name"] == "Produk A"
    assert len(analytics_from_snapshot(snapshot, "categories")["categories"]) == 2
    trend = analytics_from_snapshot(snapshot, "sales_trend", "2026-01-01", "2026-01-01")
    assert trend["available_period"] == {"min_available_date": "2026-01-01", "max_available_date": "2026-01-02"}
    assert len(trend["daily_sales"]) == 1
    with pytest.raises(ValueError):
        analytics_from_snapshot(snapshot, "summary", "2025-12-31", None)


def test_loader_rejects_cross_date_order_inconsistency(tmp_path):
    path = tmp_path / "invalid.csv"
    path.write_text(HEADER + "ORD-1,2026-01-01,P1,A,Makanan,1,1000,QRIS\nORD-1,2026-01-02,P2,B,Minuman,1,1000,QRIS\n", encoding="utf-8")
    with pytest.raises(ValueError, match="one date"):
        AnalyticsDatasetCache().get(path)


def test_runtime_default_is_trusted_v2_not_client_input():
    from sari_rasa_data import service
    assert service.ANALYTICS_DATASET_PATH == module.V2_ANALYTICS_PATH
    assert service.ANALYTICS_DATASET_PATH.name == "transactions_ml_v2.csv"


def test_start_end_bounded_and_empty_ranges(tmp_path):
    path = tmp_path / "gapped.csv"
    path.write_text(HEADER + "ORD-1,2026-01-01,P1,A,Makanan,1,1000,QRIS\nORD-2,2026-01-03,P2,B,Minuman,2,2000,Tunai\n", encoding="utf-8")
    snapshot = AnalyticsDatasetCache().get(path)
    assert analytics_from_snapshot(snapshot, "summary", "2026-01-03", None)["total_quantity"] == 2
    assert analytics_from_snapshot(snapshot, "summary", None, "2026-01-01")["total_quantity"] == 1
    assert analytics_from_snapshot(snapshot, "summary", "2026-01-01", "2026-01-03")["total_quantity"] == 3
    empty = analytics_from_snapshot(snapshot, "sales_trend", "2026-01-02", "2026-01-02")
    assert empty["daily_sales"] == []
    assert empty["summary"] == {"total_revenue": 0, "unique_orders": 0, "total_quantity": 0, "average_order_value": 0.0}
