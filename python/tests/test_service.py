import csv
import pathlib
import sqlite3
import subprocess
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from sari_rasa_data import service
from sari_rasa_data.service import app


@pytest.fixture(autouse=True)
def use_canonical_analytics_fixture(monkeypatch):
    """Keep ordinary service tests fast while production defaults to V2."""
    monkeypatch.setattr(service, "ANALYTICS_DATASET_PATH", service.CANONICAL_DATASET_PATH)
    service.ANALYTICS_DATASET_CACHE.clear()
    yield
    service.ANALYTICS_DATASET_CACHE.clear()


def test_service_exposes_fastapi_application():
    assert isinstance(app, FastAPI)


def test_service_import_does_not_read_canonical_dataset():
    source_root = pathlib.Path(__file__).resolve().parents[1] / "src"
    import_probe = """
import sys

def reject_dataset_open(event, args):
    if event == "open" and "transactions.csv" in str(args[0]):
        raise AssertionError("service import must not read the canonical dataset")

sys.addaudithook(reject_dataset_open)
import sari_rasa_data.service
"""

    result = subprocess.run(
        [sys.executable, "-c", import_probe],
        cwd=pathlib.Path(__file__).resolve().parents[2],
        env={"PYTHONPATH": str(source_root)},
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr


def test_health_returns_stable_json_contract():
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == {"status": "ok"}


def test_health_does_not_access_datasets_or_database(monkeypatch):
    def fail_path_open(*args, **kwargs):
        raise AssertionError("health endpoint must not open dataset files")

    def fail_sqlite_connect(*args, **kwargs):
        raise AssertionError("health endpoint must not connect to SQLite")

    monkeypatch.setattr(pathlib.Path, "open", fail_path_open)
    monkeypatch.setattr(sqlite3, "connect", fail_sqlite_connect)

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_next_day_forecast_success_contract(monkeypatch):
    from sari_rasa_data.prediction import PredictionResult
    monkeypatch.setattr(service, "predict_next_day", lambda data, model: PredictionResult(
        "2026-01-01", 91.25, "2025-12-31", 80.0, 75.0, 14.0625, 21.666666666666668,
        "hist_gradient_boosting", "1.0", 1
    ))
    with TestClient(app) as client:
        response = client.get("/analytics/forecast/next-day")
    assert response.status_code == 200
    assert response.json() == {
        "forecast_date": "2026-01-01",
        "predicted_quantity": 91.25,
        "historical_context": {
            "data_through": "2025-12-31",
            "trailing_7_day_average": 80.0,
            "trailing_28_day_average": 75.0,
            "vs_7_day_average_percent": 14.0625,
            "vs_28_day_average_percent": 21.666666666666668,
        },
        "model": {"family": "hist_gradient_boosting", "artifact_version": "1.0", "forecast_horizon_days": 1},
    }


def test_next_day_forecast_missing_or_corrupt_artifact_is_controlled(monkeypatch):
    from sari_rasa_data.model_artifact import ArtifactError
    def fail(data, model):
        raise ArtifactError("/private/model.joblib pickle detail")
    monkeypatch.setattr(service, "predict_next_day", fail)
    with TestClient(app) as client:
        response = client.get("/analytics/forecast/next-day")
        rejected_input = client.get("/analytics/forecast/next-day?model_path=/tmp/evil.joblib")
    assert response.status_code == 503
    assert response.json() == {"detail": "next-day forecast unavailable"}
    assert "/private" not in response.text
    assert rejected_input.status_code == 503


def test_model_comparison_success_contract_labels_roles(monkeypatch):
    from sari_rasa_data.dl_prediction import DLPredictionResult

    monkeypatch.setattr(
        service,
        "predict_next_day_with_dl",
        lambda data, model: DLPredictionResult(
            "2026-09-02", 2460.5, "2026-09-01", "experimental_mlp", "1.0", True
        ),
    )
    with TestClient(app) as client:
        response = client.get("/analytics/forecast/model-comparison")

    assert response.status_code == 200
    body = response.json()
    assert body["evaluation"] == {
        "start_date": "2026-06-01",
        "end_date": "2026-09-01",
        "dataset_identity": "sari_rasa_ml_synthetic_transactions_v2",
        "metric_unit": "next_day_total_quantity",
    }
    assert body["models"] == [
        {
            "name": "Phase 5 HistGradientBoosting",
            "type": "hist_gradient_boosting",
            "role": "production",
            "mae": 135.5097,
            "rmse": 177.6172,
        },
        {
            "name": "Phase 6 MLP",
            "type": "mlp_10_16_1_relu",
            "role": "experimental",
            "mae": 147.2643,
            "rmse": 193.5776,
        },
        {
            "name": "Previous-week baseline",
            "type": "previous_week",
            "role": "benchmark",
            "mae": 178.3333,
            "rmse": 228.5035,
        },
    ]
    assert body["experimental_inference"] == {
        "forecast_date": "2026-09-02",
        "predicted_quantity": 2460.5,
        "data_through": "2026-09-01",
        "model_family": "experimental_mlp",
        "artifact_version": "1.0",
        "role": "experimental",
    }


def test_model_comparison_missing_or_invalid_dl_artifact_is_controlled(monkeypatch):
    from sari_rasa_data.dl_model_artifact import DLArtifactError

    def fail(data, model):
        raise DLArtifactError("/private/python/models/secret.pt internal detail")

    monkeypatch.setattr(service, "predict_next_day_with_dl", fail)
    with TestClient(app) as client:
        response = client.get("/analytics/forecast/model-comparison")

    assert response.status_code == 503
    assert response.json() == {"detail": "model comparison unavailable"}
    assert "/private" not in response.text


def test_sales_trend_endpoint_supports_full_partial_empty_and_invalid_ranges():
    with TestClient(app) as client:
        full = client.get("/analytics/sales-trend")
        partial = client.get("/analytics/sales-trend?start_date=2026-07-03&end_date=2026-07-05")
        outside = client.get("/analytics/sales-trend?start_date=2026-08-01&end_date=2026-08-02")
        malformed = client.get("/analytics/sales-trend?start_date=bad&end_date=2026-07-02")
        reversed_range = client.get("/analytics/sales-trend?start_date=2026-07-03&end_date=2026-07-02")
    assert full.status_code == 200 and full.json()["start_date"] == "2026-07-01" and full.json()["end_date"] == "2026-07-15"
    assert [point["date"] for point in partial.json()["daily_sales"]] == ["2026-07-03", "2026-07-04", "2026-07-05"]
    assert full.json()["available_period"] == {"min_available_date": "2026-07-01", "max_available_date": "2026-07-15"}
    for response in (outside, malformed, reversed_range):
        assert response.status_code == 400
        assert response.json() == {"detail": "invalid sales trend date range"}


@pytest.mark.parametrize("endpoint", ["summary", "products", "categories"])
def test_existing_analytics_endpoints_accept_optional_inclusive_range(endpoint):
    with TestClient(app) as client:
        response = client.get(f"/analytics/{endpoint}?start_date=2026-07-04&end_date=2026-07-04")
        invalid = client.get(f"/analytics/{endpoint}?start_date=2026-06-30&end_date=2026-07-04")
    assert response.status_code == 200
    assert invalid.status_code == 400
    assert invalid.json() == {"detail": "invalid analytics date range"}


def test_sales_trend_endpoint_redacts_internal_failures(monkeypatch):
    def fail(*args, **kwargs):
        raise OSError("/private/python/data/transactions.csv")
    monkeypatch.setattr(service, "build_sales_trend_analytics", fail)
    with TestClient(app) as client:
        response = client.get("/analytics/sales-trend")
    assert response.status_code == 500
    assert response.json() == {"detail": "sales trend analytics unavailable"}
    assert "/private" not in response.text


def test_analytics_summary_returns_canonical_json_contract():
    with TestClient(app) as client:
        response = client.get("/analytics/summary")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == {
        "total_revenue": 745000,
        "unique_orders": 20,
        "total_quantity": 53,
        "average_order_value": 37250.0,
    }
    for value in response.json().values():
        assert isinstance(value, (int, float))
        assert not isinstance(value, bool)


def test_analytics_summary_uses_configured_path_independent_of_cwd(
    monkeypatch, tmp_path
):
    expected_path = (
        pathlib.Path(__file__).resolve().parents[1] / "data" / "transactions.csv"
    )
    assert service.CANONICAL_DATASET_PATH == expected_path

    monkeypatch.chdir(tmp_path)
    with TestClient(app) as client:
        response = client.get("/analytics/summary")

    assert response.status_code == 200
    assert response.json()["total_revenue"] == 745000


def test_analytics_summary_does_not_read_large_dataset(monkeypatch):
    original_path_open = pathlib.Path.open

    def guarded_path_open(path, *args, **kwargs):
        if path.name == "transactions_large.csv":
            raise AssertionError("summary endpoint must not read the large dataset")
        return original_path_open(path, *args, **kwargs)

    monkeypatch.setattr(pathlib.Path, "open", guarded_path_open)

    with TestClient(app) as client:
        response = client.get("/analytics/summary")

    assert response.status_code == 200
    assert response.json()["unique_orders"] == 20


def test_analytics_summary_redacts_expected_pipeline_errors(monkeypatch):
    internal_detail = "private canonical path and validation detail"

    def fail_summary(path):
        raise ValueError(internal_detail)

    monkeypatch.setattr(service, "build_analytics_summary", fail_summary)

    with TestClient(app) as client:
        response = client.get("/analytics/summary")

    assert response.status_code == 500
    assert response.json() == {"detail": "analytics summary unavailable"}
    assert internal_detail not in response.text


def test_products_analytics_returns_canonical_json_in_quantity_order():
    with TestClient(app) as client:
        response = client.get("/analytics/products")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == {
        "products": [
            {"product_name": "Es Teh", "total_quantity": 9, "total_revenue": 45000},
            {"product_name": "Nasi Goreng", "total_quantity": 6, "total_revenue": 108000},
            {"product_name": "Pisang Goreng", "total_quantity": 6, "total_revenue": 72000},
            {"product_name": "Soto Ayam", "total_quantity": 6, "total_revenue": 120000},
            {"product_name": "Tahu Isi", "total_quantity": 6, "total_revenue": 48000},
            {"product_name": "Nasi Ayam", "total_quantity": 5, "total_revenue": 120000},
            {"product_name": "Jus Jeruk", "total_quantity": 4, "total_revenue": 40000},
            {"product_name": "Mie Goreng", "total_quantity": 4, "total_revenue": 68000},
            {"product_name": "Sate Ayam", "total_quantity": 4, "total_revenue": 88000},
            {"product_name": "Kopi Susu", "total_quantity": 3, "total_revenue": 36000},
        ]
    }
    for product in response.json()["products"]:
        for field in ("total_quantity", "total_revenue"):
            assert isinstance(product[field], int)
            assert not isinstance(product[field], bool)


def test_categories_analytics_returns_canonical_json_in_name_order():
    with TestClient(app) as client:
        response = client.get("/analytics/categories")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == {
        "categories": [
            {"category": "Camilan", "total_revenue": 120000},
            {"category": "Makanan", "total_revenue": 504000},
            {"category": "Minuman", "total_revenue": 121000},
        ]
    }
    for category in response.json()["categories"]:
        assert isinstance(category["total_revenue"], int)
        assert not isinstance(category["total_revenue"], bool)


@pytest.mark.parametrize("endpoint", ["/analytics/products", "/analytics/categories"])
def test_grouped_analytics_paths_are_independent_of_cwd(endpoint, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)

    with TestClient(app) as client:
        response = client.get(endpoint)

    assert response.status_code == 200


@pytest.mark.parametrize("endpoint", ["/analytics/products", "/analytics/categories"])
def test_grouped_analytics_do_not_read_large_dataset(endpoint, monkeypatch):
    original_path_open = pathlib.Path.open

    def guarded_path_open(path, *args, **kwargs):
        if path.name == "transactions_large.csv":
            raise AssertionError("analytics endpoints must not read the large dataset")
        return original_path_open(path, *args, **kwargs)

    monkeypatch.setattr(pathlib.Path, "open", guarded_path_open)

    with TestClient(app) as client:
        response = client.get(endpoint)

    assert response.status_code == 200


@pytest.mark.parametrize(
    ("endpoint", "builder_name", "public_detail", "error_type"),
    [
        (
            "/analytics/products",
            "build_products_analytics",
            "product analytics unavailable",
            ValueError,
        ),
        (
            "/analytics/categories",
            "build_categories_analytics",
            "category analytics unavailable",
            ValueError,
        ),
        (
            "/analytics/summary",
            "build_analytics_summary",
            "analytics summary unavailable",
            OSError,
        ),
        (
            "/analytics/products",
            "build_products_analytics",
            "product analytics unavailable",
            OSError,
        ),
        (
            "/analytics/categories",
            "build_categories_analytics",
            "category analytics unavailable",
            OSError,
        ),
        (
            "/analytics/summary",
            "build_analytics_summary",
            "analytics summary unavailable",
            csv.Error,
        ),
    ],
)
def test_analytics_routes_redact_expected_pipeline_errors(
    endpoint, builder_name, public_detail, error_type, monkeypatch
):
    internal_detail = "/private/internal/path/transactions.csv: validation detail"

    def fail_analytics(path):
        raise error_type(internal_detail)

    monkeypatch.setattr(service, builder_name, fail_analytics)

    with TestClient(app) as client:
        response = client.get(endpoint)

    assert response.status_code == 500
    assert response.json() == {"detail": public_detail}
    assert internal_detail not in response.text
