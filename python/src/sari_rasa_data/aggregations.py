"""Pure-Python dataset aggregations for transformed transactions."""

from typing import Iterable

from sari_rasa_data.data_transform import TransformedTransaction


def total_revenue(transactions: Iterable[TransformedTransaction]) -> int:
    """Return the sum of transaction-line totals."""
    return sum(transaction["line_total"] for transaction in transactions)


def total_quantity_sold(transactions: Iterable[TransformedTransaction]) -> int:
    """Return quantity sold across transaction lines, not unique orders."""
    return sum(transaction["quantity"] for transaction in transactions)


def _sorted_totals(totals: dict[str, int]) -> dict[str, int]:
    """Return grouped totals with keys in deterministic alphabetical order."""
    return {key: totals[key] for key in sorted(totals)}


def revenue_by_category(
    transactions: Iterable[TransformedTransaction],
) -> dict[str, int]:
    """Return transaction-line revenue grouped by category."""
    totals: dict[str, int] = {}
    for transaction in transactions:
        category = transaction["category"]
        totals[category] = totals.get(category, 0) + transaction["line_total"]
    return _sorted_totals(totals)


def quantity_by_product(
    transactions: Iterable[TransformedTransaction],
) -> dict[str, int]:
    """Return quantity sold grouped by product name."""
    totals: dict[str, int] = {}
    for transaction in transactions:
        product_name = transaction["product_name"]
        totals[product_name] = totals.get(product_name, 0) + transaction["quantity"]
    return _sorted_totals(totals)


def daily_revenue(
    transactions: Iterable[TransformedTransaction],
) -> dict[str, int]:
    """Return transaction-line revenue grouped by ISO date."""
    totals: dict[str, int] = {}
    for transaction in transactions:
        order_date = transaction["order_date"]
        totals[order_date] = totals.get(order_date, 0) + transaction["line_total"]
    return _sorted_totals(totals)


def summarize_transactions(
    transactions: Iterable[TransformedTransaction],
) -> dict[str, int | dict[str, int]]:
    """Compose all Phase 4B aggregations into one JSON-compatible summary."""
    records = list(transactions)
    return {
        "total_revenue": total_revenue(records),
        "total_quantity_sold": total_quantity_sold(records),
        "revenue_by_category": revenue_by_category(records),
        "quantity_by_product": quantity_by_product(records),
        "daily_revenue": daily_revenue(records),
    }
