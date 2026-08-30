"""Clean and transform validated transaction records for Phase 4B-3."""

from typing import Iterable, Mapping, TypedDict

from sari_rasa_data.transactions import Transaction, parse_transaction_row


CATEGORY_NAMES = {
    "makanan": "Makanan",
    "minuman": "Minuman",
    "camilan": "Camilan",
}

PAYMENT_METHOD_NAMES = {
    "qris": "QRIS",
    "transfer": "Transfer",
    "tunai": "Tunai",
}


class TransformedTransaction(Transaction):
    """A clean transaction with its transaction-line total."""

    line_total: int


def _normalize_known_value(value: str, names: dict[str, str], field: str) -> str:
    """Normalize a known text value by whitespace and capitalization."""
    normalized = names.get(value.casefold())
    if normalized is None:
        raise ValueError(f"unknown {field}: {value}")
    return normalized


def clean_transaction(transaction: Mapping[str, object]) -> Transaction:
    """Return a validated, cleaned transaction without mutating the input.

    The shared parser trims required text and validates date and number fields.
    This function additionally maps known category and payment-method case
    variants to the canonical values used by the synthetic dataset.
    """
    cleaned = parse_transaction_row(transaction)
    cleaned["category"] = _normalize_known_value(
        cleaned["category"], CATEGORY_NAMES, "category"
    )
    cleaned["payment_method"] = _normalize_known_value(
        cleaned["payment_method"], PAYMENT_METHOD_NAMES, "payment_method"
    )
    return cleaned


def transform_transaction(transaction: Mapping[str, object]) -> TransformedTransaction:
    """Return a clean transaction with deterministic ``line_total``."""
    cleaned = clean_transaction(transaction)
    return {
        **cleaned,
        "line_total": cleaned["quantity"] * cleaned["unit_price"],
    }


def clean_transactions(
    transactions: Iterable[Mapping[str, object]],
) -> list[Transaction]:
    """Clean records in input order and return new dictionaries."""
    return [clean_transaction(transaction) for transaction in transactions]


def transform_transactions(
    transactions: Iterable[Mapping[str, object]],
) -> list[TransformedTransaction]:
    """Clean and transform records in input order."""
    return [transform_transaction(transaction) for transaction in transactions]
