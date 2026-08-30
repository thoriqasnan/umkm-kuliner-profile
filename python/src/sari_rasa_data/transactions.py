"""Transaction schema and small validation helpers for Phase 4B-1."""

from datetime import date
from typing import Mapping, TypedDict


REQUIRED_TRANSACTION_FIELDS = (
    "order_id",
    "order_date",
    "product_id",
    "product_name",
    "category",
    "quantity",
    "unit_price",
    "payment_method",
)


class Transaction(TypedDict):
    """Normalized shape of one synthetic UMKM transaction row."""

    order_id: str
    order_date: date
    product_id: str
    product_name: str
    category: str
    quantity: int
    unit_price: int
    payment_method: str


def _required_text(row: Mapping[str, str], field: str) -> str:
    """Return a trimmed required text value."""
    if field not in row:
        raise KeyError(f"missing required field: {field}")

    value = row[field]
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    return value.strip()


def _required_integer(row: Mapping[str, str], field: str) -> int:
    """Convert one required CSV field to an integer."""
    text = _required_text(row, field)
    try:
        return int(text)
    except ValueError as error:
        raise ValueError(f"{field} must be an integer") from error


def parse_transaction_row(row: Mapping[str, str]) -> Transaction:
    """Validate and normalize one CSV-style transaction row.

    Dates must use ISO ``YYYY-MM-DD`` format. Quantity must be positive and
    unit price must be non-negative. Full dataset loading and cleaning remain
    responsibilities of later Phase 4B subphases.
    """
    for field in REQUIRED_TRANSACTION_FIELDS:
        if field not in row:
            raise KeyError(f"missing required field: {field}")

    raw_date = _required_text(row, "order_date")
    try:
        order_date = date.fromisoformat(raw_date)
    except ValueError as error:
        raise ValueError("order_date must use YYYY-MM-DD format") from error
    if order_date.isoformat() != raw_date:
        raise ValueError("order_date must use YYYY-MM-DD format")

    quantity = _required_integer(row, "quantity")
    if quantity <= 0:
        raise ValueError("quantity must be a positive integer")

    unit_price = _required_integer(row, "unit_price")
    if unit_price < 0:
        raise ValueError("unit_price must be a non-negative integer")

    return {
        "order_id": _required_text(row, "order_id"),
        "order_date": order_date,
        "product_id": _required_text(row, "product_id"),
        "product_name": _required_text(row, "product_name"),
        "category": _required_text(row, "category"),
        "quantity": quantity,
        "unit_price": unit_price,
        "payment_method": _required_text(row, "payment_method"),
    }
