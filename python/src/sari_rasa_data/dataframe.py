"""Pandas DataFrame bridge for the verified Phase 4B transaction pipeline."""

import json
from pathlib import Path
from typing import Iterable, Mapping

import pandas as pd

from sari_rasa_data.data_loader import load_transactions_csv
from sari_rasa_data.data_transform import transform_transactions


TRANSACTION_COLUMNS = (
    "order_id",
    "order_date",
    "product_id",
    "product_name",
    "category",
    "quantity",
    "unit_price",
    "payment_method",
    "line_total",
)


def transactions_to_dataframe(
    transactions: Iterable[Mapping[str, object]],
) -> pd.DataFrame:
    """Copy transformed transaction records into a predictable DataFrame."""
    records = []
    for index, transaction in enumerate(transactions):
        missing = [column for column in TRANSACTION_COLUMNS if column not in transaction]
        if missing:
            missing_names = ", ".join(missing)
            raise KeyError(f"transaction {index} is missing columns: {missing_names}")
        records.append({column: transaction[column] for column in TRANSACTION_COLUMNS})

    return pd.DataFrame.from_records(records, columns=TRANSACTION_COLUMNS)


def load_transactions_dataframe(path: Path | str) -> pd.DataFrame:
    """Run the Phase 4B CSV pipeline and return its transformed DataFrame."""
    loaded = load_transactions_csv(path)
    transformed = transform_transactions(loaded)
    return transactions_to_dataframe(transformed)


def dataframe_to_records(dataframe: pd.DataFrame) -> list[dict[str, object]]:
    """Return expected DataFrame columns as JSON-compatible Python records."""
    missing = [column for column in TRANSACTION_COLUMNS if column not in dataframe.columns]
    if missing:
        missing_names = ", ".join(missing)
        raise KeyError(f"DataFrame is missing columns: {missing_names}")

    selected = dataframe.loc[:, TRANSACTION_COLUMNS]
    return json.loads(selected.to_json(orient="records"))
