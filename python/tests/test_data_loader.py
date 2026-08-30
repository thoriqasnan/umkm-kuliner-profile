import csv
import json
from pathlib import Path

import pytest

from sari_rasa_data.data_loader import load_transactions_csv, load_transactions_json
from sari_rasa_data.transactions import REQUIRED_TRANSACTION_FIELDS

DATASET_PATH = Path(__file__).resolve().parents[1] / "data" / "transactions.csv"


def _valid_record() -> dict[str, object]:
    return {
        "order_id": "ORD-TEST-001",
        "order_date": "2026-07-01",
        "product_id": "PRD-001",
        "product_name": "Nasi Goreng",
        "category": "Makanan",
        "quantity": 2,
        "unit_price": 18000,
        "payment_method": "QRIS",
    }


def _write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=REQUIRED_TRANSACTION_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def test_load_canonical_csv():
    transactions = load_transactions_csv(DATASET_PATH)

    assert len(transactions) == 30
    assert transactions[0]["order_id"] == "ORD-001"


def test_csv_loader_normalizes_numeric_types():
    transaction = load_transactions_csv(DATASET_PATH)[0]

    assert type(transaction["quantity"]) is int
    assert type(transaction["unit_price"]) is int


def test_csv_loader_enforces_required_columns(tmp_path):
    path = tmp_path / "missing_column.csv"
    path.write_text("order_id,order_date\nORD-001,2026-07-01\n", encoding="utf-8")

    with pytest.raises(ValueError, match="missing required columns.*product_id"):
        load_transactions_csv(path)


@pytest.mark.parametrize(
    ("field", "value"),
    [("quantity", "zero"), ("quantity", "0"), ("unit_price", "free"), ("unit_price", "-1")],
)
def test_csv_loader_rejects_invalid_numbers(tmp_path, field, value):
    record = _valid_record()
    record[field] = value
    path = tmp_path / "invalid_number.csv"
    _write_csv(path, [record])

    with pytest.raises(ValueError, match=rf"CSV row 2.*{field}"):
        load_transactions_csv(path)


def test_csv_loader_rejects_invalid_date(tmp_path):
    record = _valid_record()
    record["order_date"] = "01-07-2026"
    path = tmp_path / "invalid_date.csv"
    _write_csv(path, [record])

    with pytest.raises(ValueError, match="CSV row 2.*YYYY-MM-DD"):
        load_transactions_csv(path)


def test_csv_loader_rejects_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_transactions_csv(tmp_path / "missing.csv")


def test_csv_loader_rejects_malformed_row(tmp_path):
    path = tmp_path / "malformed.csv"
    header = ",".join(REQUIRED_TRANSACTION_FIELDS)
    path.write_text(f"{header}\nORD-001,2026-07-01,extra,values,beyond,the,header,row,here\n", encoding="utf-8")

    with pytest.raises(ValueError, match="malformed CSV record at row 2"):
        load_transactions_csv(path)


def test_load_valid_json_transaction_list(tmp_path):
    path = tmp_path / "transactions.json"
    path.write_text(json.dumps([_valid_record()]), encoding="utf-8")

    transactions = load_transactions_json(path)

    assert transactions == [_valid_record()]


def test_json_loader_rejects_malformed_json(tmp_path):
    path = tmp_path / "malformed.json"
    path.write_text("[{not valid JSON]", encoding="utf-8")

    with pytest.raises(json.JSONDecodeError):
        load_transactions_json(path)


def test_json_loader_rejects_non_list_top_level(tmp_path):
    path = tmp_path / "object.json"
    path.write_text(json.dumps(_valid_record()), encoding="utf-8")

    with pytest.raises(ValueError, match="top-level value must be a list"):
        load_transactions_json(path)


def test_json_loader_rejects_non_object_record(tmp_path):
    path = tmp_path / "non_object.json"
    path.write_text(json.dumps(["not an object"]), encoding="utf-8")

    with pytest.raises(TypeError, match="JSON item 0 must be a transaction object"):
        load_transactions_json(path)


def test_json_loader_rejects_missing_required_field(tmp_path):
    record = _valid_record()
    del record["product_id"]
    path = tmp_path / "missing_field.json"
    path.write_text(json.dumps([record]), encoding="utf-8")

    with pytest.raises(ValueError, match="JSON item 0.*product_id"):
        load_transactions_json(path)


def test_equivalent_csv_and_json_normalize_to_same_shape(tmp_path):
    record = _valid_record()
    csv_path = tmp_path / "transaction.csv"
    json_path = tmp_path / "transaction.json"
    _write_csv(csv_path, [record])
    json_path.write_text(json.dumps([record]), encoding="utf-8")

    assert load_transactions_csv(csv_path) == load_transactions_json(json_path)


def test_normalized_json_output_is_serializable(tmp_path):
    transactions = load_transactions_csv(DATASET_PATH)
    path = tmp_path / "normalized.json"

    path.write_text(json.dumps(transactions), encoding="utf-8")

    assert json.loads(path.read_text(encoding="utf-8")) == transactions
