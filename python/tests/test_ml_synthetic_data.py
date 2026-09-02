from datetime import date
import hashlib
from pathlib import Path

import pandas as pd
import pytest

from sari_rasa_data.data_loader import load_transactions_csv
from sari_rasa_data.ml_synthetic_data import (
    ML_DATASET_END_DATE,
    ML_DATASET_START_DATE,
    ML_DEFAULT_SEED,
    generate_ml_transactions,
    is_promotion_date,
    write_ml_transactions_csv,
)
from sari_rasa_data.transactions import REQUIRED_TRANSACTION_FIELDS


CANONICAL_PATH = Path(__file__).resolve().parents[1] / "data" / "transactions.csv"
CANONICAL_SHA256 = "54c27fb9d059b45561b7f9033a0ed83bdfa49349407d8a6a76d9a25e38f7bf8c"


@pytest.fixture(scope="module")
def generated_rows():
    return generate_ml_transactions()


def test_ml_generator_is_reproducible_and_seed_sensitive():
    start = date(2024, 1, 1)
    end = date(2024, 1, 21)
    assert generate_ml_transactions(17, start, end) == generate_ml_transactions(17, start, end)
    assert generate_ml_transactions(17, start, end) != generate_ml_transactions(18, start, end)


def test_ml_generator_uses_valid_schema_and_values(generated_rows):
    assert generated_rows
    assert all(tuple(row) == REQUIRED_TRANSACTION_FIELDS for row in generated_rows)
    assert all(row["quantity"] > 0 and row["unit_price"] > 0 for row in generated_rows)
    assert all(row["order_id"].startswith("ORD-ML-") for row in generated_rows)


def test_ml_generator_covers_configured_two_year_horizon(generated_rows):
    dates = [date.fromisoformat(row["order_date"]) for row in generated_rows]
    assert min(dates) == ML_DATASET_START_DATE
    assert max(dates) == ML_DATASET_END_DATE
    assert len(set(dates)) == (ML_DATASET_END_DATE - ML_DATASET_START_DATE).days + 1


def test_ml_generator_retains_meaningful_imperfect_temporal_signals(generated_rows):
    frame = pd.DataFrame(generated_rows)
    frame["order_date"] = pd.to_datetime(frame["order_date"])
    daily = frame.groupby("order_date")["quantity"].sum().sort_index()
    weekend = daily.index.dayofweek >= 5
    promotion = pd.Series(
        [is_promotion_date(timestamp.date()) for timestamp in daily.index],
        index=daily.index,
    )

    # Wide thresholds protect the generator's intended learning value without
    # tying tests to exact random output or pretending the signal is perfect.
    assert daily.loc[weekend].mean() > daily.loc[~weekend].mean() * 1.15
    assert daily.tail(90).mean() > daily.head(90).mean() * 1.15
    assert daily.loc[promotion].mean() > daily.loc[~promotion].mean() * 1.15
    assert 0.35 < daily.autocorr(lag=1) < 0.90
    assert daily.std() > 0


def test_written_ml_dataset_passes_shared_transaction_validation(tmp_path):
    path = tmp_path / "ml.csv"
    row_count = write_ml_transactions_csv(path, ML_DEFAULT_SEED, date(2024, 2, 1), date(2024, 2, 14))
    assert len(load_transactions_csv(path)) == row_count


def test_ml_writer_refuses_to_overwrite_canonical_dataset():
    with pytest.raises(ValueError, match="canonical"):
        write_ml_transactions_csv(CANONICAL_PATH)
    assert hashlib.sha256(CANONICAL_PATH.read_bytes()).hexdigest() == CANONICAL_SHA256
