from datetime import date

import pytest

from sari_rasa_data.data_loader import load_transactions_csv
from sari_rasa_data.data_transform import (
    CATEGORY_NAMES,
    PAYMENT_METHOD_NAMES,
    transform_transactions,
)
from sari_rasa_data.synthetic_data import (
    DATASET_END_DATE,
    DATASET_START_DATE,
    DEFAULT_ROW_COUNT,
    DEFAULT_SEED,
    PRODUCT_CATALOG,
    generate_synthetic_transactions,
    write_synthetic_transactions_csv,
)
from sari_rasa_data.transactions import REQUIRED_TRANSACTION_FIELDS

SAMPLE_ROW_COUNT = 400


def test_requested_row_count_is_exact():
    rows = generate_synthetic_transactions(row_count=SAMPLE_ROW_COUNT, seed=1)
    assert len(rows) == SAMPLE_ROW_COUNT


def test_schema_matches_phase_4b_required_fields():
    rows = generate_synthetic_transactions(row_count=SAMPLE_ROW_COUNT, seed=1)
    for row in rows:
        assert set(row.keys()) == set(REQUIRED_TRANSACTION_FIELDS)
        assert "line_total" not in row


def test_deterministic_output_for_same_seed():
    first = generate_synthetic_transactions(row_count=SAMPLE_ROW_COUNT, seed=42)
    second = generate_synthetic_transactions(row_count=SAMPLE_ROW_COUNT, seed=42)
    assert first == second


def test_different_seed_changes_generated_data():
    first = generate_synthetic_transactions(row_count=SAMPLE_ROW_COUNT, seed=1)
    second = generate_synthetic_transactions(row_count=SAMPLE_ROW_COUNT, seed=2)
    assert first != second


def test_generated_rows_pass_phase_4b_validation_and_transformation(tmp_path):
    csv_path = tmp_path / "sample_large.csv"
    write_synthetic_transactions_csv(csv_path, row_count=SAMPLE_ROW_COUNT, seed=7)

    loaded = load_transactions_csv(csv_path)
    transformed = transform_transactions(loaded)

    assert len(transformed) == SAMPLE_ROW_COUNT
    for transaction in transformed:
        assert transaction["line_total"] == (
            transaction["quantity"] * transaction["unit_price"]
        )


def test_dates_are_within_configured_range():
    rows = generate_synthetic_transactions(row_count=SAMPLE_ROW_COUNT, seed=3)
    for row in rows:
        order_date = date.fromisoformat(row["order_date"])
        assert DATASET_START_DATE <= order_date <= DATASET_END_DATE


def test_quantity_is_always_positive():
    rows = generate_synthetic_transactions(row_count=SAMPLE_ROW_COUNT, seed=4)
    assert all(row["quantity"] > 0 for row in rows)


def test_unit_price_is_always_positive():
    rows = generate_synthetic_transactions(row_count=SAMPLE_ROW_COUNT, seed=5)
    assert all(row["unit_price"] > 0 for row in rows)


def test_categories_are_known_canonical_values():
    rows = generate_synthetic_transactions(row_count=SAMPLE_ROW_COUNT, seed=6)
    known_categories = set(CATEGORY_NAMES.values())
    assert all(row["category"] in known_categories for row in rows)


def test_payment_methods_are_known_canonical_values():
    rows = generate_synthetic_transactions(row_count=SAMPLE_ROW_COUNT, seed=6)
    known_methods = set(PAYMENT_METHOD_NAMES.values())
    assert all(row["payment_method"] in known_methods for row in rows)


def test_multiple_line_orders_exist():
    rows = generate_synthetic_transactions(row_count=SAMPLE_ROW_COUNT, seed=8)
    line_counts: dict[str, int] = {}
    for row in rows:
        line_counts[row["order_id"]] = line_counts.get(row["order_id"], 0) + 1
    assert any(count > 1 for count in line_counts.values())


def test_generated_dataset_is_synthetic_and_reproducible(tmp_path):
    first_path = tmp_path / "first.csv"
    second_path = tmp_path / "second.csv"

    write_synthetic_transactions_csv(first_path, row_count=SAMPLE_ROW_COUNT, seed=99)
    write_synthetic_transactions_csv(second_path, row_count=SAMPLE_ROW_COUNT, seed=99)

    assert first_path.read_text(encoding="utf-8") == second_path.read_text(
        encoding="utf-8"
    )

    known_product_ids = {product["product_id"] for product in PRODUCT_CATALOG}
    rows = generate_synthetic_transactions(row_count=SAMPLE_ROW_COUNT, seed=99)
    assert all(row["product_id"] in known_product_ids for row in rows)
    assert all(row["order_id"].startswith("ORD-LARGE-") for row in rows)


def test_generator_does_not_mutate_module_level_catalog():
    catalog_before = tuple(dict(product) for product in PRODUCT_CATALOG)

    generate_synthetic_transactions(row_count=SAMPLE_ROW_COUNT, seed=11)

    assert PRODUCT_CATALOG == catalog_before


def test_row_count_must_be_positive():
    with pytest.raises(ValueError):
        generate_synthetic_transactions(row_count=0, seed=1)


def test_default_row_count_and_seed_are_documented_constants():
    assert DEFAULT_ROW_COUNT == 10_000
    assert isinstance(DEFAULT_SEED, int)
