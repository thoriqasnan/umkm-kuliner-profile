import pytest

from sari_rasa_data.foundation import (
    calculate_subtotal,
    count_by_category,
    normalize_order,
    product_names,
    summarize_order,
    total_quantity,
    validate_product,
)


def test_validate_product_accepts_valid_input():
    validate_product({"name": "Nasi Goreng", "quantity": 2, "unit_price": 15000})


def test_validate_product_rejects_invalid_quantity():
    with pytest.raises(ValueError):
        validate_product({"name": "Nasi Goreng", "quantity": 0, "unit_price": 15000})


def test_validate_product_rejects_invalid_price():
    with pytest.raises(ValueError):
        validate_product({"name": "Nasi Goreng", "quantity": 2, "unit_price": -100})


def test_validate_product_rejects_missing_name():
    with pytest.raises(ValueError):
        validate_product({"name": "", "quantity": 2, "unit_price": 15000})


def test_calculate_subtotal_returns_expected_value():
    assert calculate_subtotal(3, 12000) == 36000


def test_calculate_subtotal_rejects_invalid_quantity():
    with pytest.raises(ValueError):
        calculate_subtotal(-1, 12000)


def test_calculate_subtotal_rejects_non_int_quantity():
    with pytest.raises(TypeError):
        calculate_subtotal("two", 12000)


def test_calculate_subtotal_rejects_non_int_unit_price():
    with pytest.raises(TypeError):
        calculate_subtotal(2, "cheap")


def test_validate_product_accepts_zero_price():
    validate_product({"name": "Air Putih", "quantity": 1, "unit_price": 0})


def test_validate_product_rejects_non_string_name():
    with pytest.raises(TypeError):
        validate_product({"name": 123, "quantity": 2, "unit_price": 15000})


def test_validate_product_rejects_non_int_quantity():
    with pytest.raises(TypeError):
        validate_product({"name": "Nasi Goreng", "quantity": "two", "unit_price": 15000})


def test_validate_product_rejects_non_int_unit_price():
    with pytest.raises(TypeError):
        validate_product({"name": "Nasi Goreng", "quantity": 2, "unit_price": "cheap"})


def test_summarize_order_handles_empty_list():
    assert summarize_order([]) == {"items": [], "item_count": 0, "total": 0}


def test_summarize_order_returns_normalized_json_compatible_shape():
    products = [
        {"name": "Nasi Goreng", "quantity": 2, "unit_price": 15000},
        {"name": "Es Teh", "quantity": 3, "unit_price": 5000},
    ]

    summary = summarize_order(products)

    assert summary == {
        "items": [
            {"name": "Nasi Goreng", "quantity": 2, "unit_price": 15000, "subtotal": 30000},
            {"name": "Es Teh", "quantity": 3, "unit_price": 5000, "subtotal": 15000},
        ],
        "item_count": 2,
        "total": 45000,
    }


def test_summarize_order_rejects_invalid_item():
    products = [
        {"name": "Nasi Goreng", "quantity": 2, "unit_price": 15000},
        {"name": "", "quantity": 1, "unit_price": 1000},
    ]

    with pytest.raises(ValueError):
        summarize_order(products)


def test_total_quantity_sums_across_items():
    items = [{"quantity": 2}, {"quantity": 3}, {"quantity": 1}]
    assert total_quantity(items) == 6


def test_total_quantity_handles_empty_list():
    assert total_quantity([]) == 0


def test_total_quantity_rejects_non_int_quantity():
    with pytest.raises(TypeError):
        total_quantity([{"quantity": "two"}])


def test_product_names_collects_in_order():
    items = [{"name": "Nasi Goreng"}, {"name": "Es Teh"}]
    assert product_names(items) == ["Nasi Goreng", "Es Teh"]


def test_product_names_rejects_missing_name():
    with pytest.raises(KeyError):
        product_names([{"quantity": 1}])


def test_product_names_handles_empty_list():
    assert product_names([]) == []


def test_count_by_category_counts_each_category():
    products = [
        {"category": "Makanan"},
        {"category": "Minuman"},
        {"category": "Makanan"},
    ]
    assert count_by_category(products) == {"Makanan": 2, "Minuman": 1}


def test_count_by_category_rejects_missing_category():
    with pytest.raises(ValueError):
        count_by_category([{"category": ""}])


def test_count_by_category_handles_empty_list():
    assert count_by_category([]) == {}


def test_normalize_order_uses_summarize_order_and_defaults_customer_name():
    order = {
        "items": [{"name": "Nasi Goreng", "quantity": 2, "unit_price": 15000}],
    }

    normalized = normalize_order(order)

    assert normalized == {
        "customer_name": "Guest",
        "items": [
            {"name": "Nasi Goreng", "quantity": 2, "unit_price": 15000, "subtotal": 30000},
        ],
        "item_count": 1,
        "total": 30000,
    }


def test_normalize_order_rejects_empty_items():
    with pytest.raises(ValueError):
        normalize_order({"items": []})


def test_normalize_order_trims_customer_name():
    order = {
        "customer_name": "  Budi  ",
        "items": [{"name": "Es Teh", "quantity": 1, "unit_price": 5000}],
    }

    normalized = normalize_order(order)

    assert normalized["customer_name"] == "Budi"


def test_normalize_order_rejects_non_string_customer_name():
    order = {
        "customer_name": 123,
        "items": [{"name": "Es Teh", "quantity": 1, "unit_price": 5000}],
    }

    with pytest.raises(TypeError):
        normalize_order(order)
