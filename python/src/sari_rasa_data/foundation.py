"""Phase 4A foundation exercises: basic Python over UMKM product data.

This module is for learning and validation only. It does not touch
SQLite, Node.js, or any external service.
"""

from typing import TypedDict


class Product(TypedDict):
    name: str
    quantity: int
    unit_price: int


def validate_product(product: dict) -> None:
    """Raise TypeError for a wrong field type, ValueError for a bad field value."""
    name = product.get("name")
    if not isinstance(name, str):
        raise TypeError("name must be a string")
    if not name.strip():
        raise ValueError("name must be a non-empty string")

    quantity = product.get("quantity")
    if not isinstance(quantity, int) or isinstance(quantity, bool):
        raise TypeError("quantity must be an int")
    if quantity <= 0:
        raise ValueError("quantity must be a positive integer")

    unit_price = product.get("unit_price")
    if not isinstance(unit_price, int) or isinstance(unit_price, bool):
        raise TypeError("unit_price must be an int")
    if unit_price < 0:
        raise ValueError("unit_price must be a non-negative integer")


def calculate_subtotal(quantity: int, unit_price: int) -> int:
    """Return quantity * unit_price for a single order line.

    Repeats the same checks as validate_product() on purpose: this function
    must stay correct even if called on its own, without validate_product().
    Raises TypeError for a wrong argument type, ValueError for a bad value.
    """
    if not isinstance(quantity, int) or isinstance(quantity, bool):
        raise TypeError("quantity must be an int")
    if quantity <= 0:
        raise ValueError("quantity must be a positive integer")
    if not isinstance(unit_price, int) or isinstance(unit_price, bool):
        raise TypeError("unit_price must be an int")
    if unit_price < 0:
        raise ValueError("unit_price must be a non-negative integer")

    return quantity * unit_price


def summarize_order(products: list[dict]) -> dict:
    """Validate a list of product-like dicts and return a JSON-compatible summary."""
    items = []
    total = 0

    for product in products:
        validate_product(product)
        subtotal = calculate_subtotal(product["quantity"], product["unit_price"])
        items.append(
            {
                "name": product["name"],
                "quantity": product["quantity"],
                "unit_price": product["unit_price"],
                "subtotal": subtotal,
            }
        )
        total += subtotal

    return {
        "items": items,
        "item_count": len(items),
        "total": total,
    }


def total_quantity(order_items: list[dict]) -> int:
    """Sum the quantity field across a list of order-item dicts."""
    total = 0
    for item in order_items:
        quantity = item.get("quantity")
        if not isinstance(quantity, int) or isinstance(quantity, bool):
            raise TypeError("each item's quantity must be an int")
        total += quantity
    return total


def product_names(order_items: list[dict]) -> list[str]:
    """Return the product name from each order-item dict, in order."""
    names = []
    for item in order_items:
        if "name" not in item:
            raise KeyError("name")
        names.append(item["name"])
    return names


def count_by_category(products: list[dict]) -> dict[str, int]:
    """Count how many products fall into each category."""
    counts: dict[str, int] = {}
    for product in products:
        category = product.get("category")
        if not isinstance(category, str) or not category.strip():
            raise ValueError("category must be a non-empty string")
        counts[category] = counts.get(category, 0) + 1
    return counts


def normalize_order(order: dict) -> dict:
    """Validate a small order dict and return it with defaulted, trimmed fields.

    Demonstrates function composition: it reuses summarize_order() rather than
    repeating item validation and subtotal math itself.
    """
    if "items" not in order or not order["items"]:
        raise ValueError("order must contain a non-empty 'items' list")

    raw_customer_name = order.get("customer_name", "")
    if not isinstance(raw_customer_name, str):
        raise TypeError("customer_name must be a string")

    customer_name = raw_customer_name.strip() or "Guest"
    summary = summarize_order(order["items"])

    return {
        "customer_name": customer_name,
        "items": summary["items"],
        "item_count": summary["item_count"],
        "total": summary["total"],
    }
