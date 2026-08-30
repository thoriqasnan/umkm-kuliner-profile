"""Load and validate transaction records from CSV and JSON files."""

import csv
import json
from pathlib import Path

from sari_rasa_data.transactions import (
    REQUIRED_TRANSACTION_FIELDS,
    Transaction,
    parse_transaction_row,
)


def _parse_record(record: object, position: str) -> Transaction:
    """Parse one record and add its position to validation errors."""
    if not isinstance(record, dict):
        raise TypeError(f"{position} must be a transaction object")

    try:
        return parse_transaction_row(record)
    except (KeyError, ValueError, TypeError) as error:
        raise ValueError(f"invalid transaction at {position}: {error}") from error


def load_transactions_csv(path: Path | str) -> list[Transaction]:
    """Load a UTF-8 transaction CSV and return normalized dictionaries."""
    file_path = Path(path)
    with file_path.open(encoding="utf-8", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        columns = reader.fieldnames or []
        missing_columns = [
            field for field in REQUIRED_TRANSACTION_FIELDS if field not in columns
        ]
        if missing_columns:
            missing = ", ".join(missing_columns)
            raise ValueError(f"CSV is missing required columns: {missing}")

        transactions = []
        for row_number, row in enumerate(reader, start=2):
            if None in row:
                raise ValueError(f"malformed CSV record at row {row_number}")
            transactions.append(_parse_record(row, f"CSV row {row_number}"))

    return transactions


def load_transactions_json(path: Path | str) -> list[Transaction]:
    """Load a UTF-8 JSON array and return normalized dictionaries."""
    file_path = Path(path)
    with file_path.open(encoding="utf-8") as json_file:
        data = json.load(json_file)

    if not isinstance(data, list):
        raise ValueError("JSON top-level value must be a list")

    return [
        _parse_record(record, f"JSON item {index}")
        for index, record in enumerate(data)
    ]
