"""Leakage-safe PyTorch preparation for the Phase 6 development partitions.

This module adapts the frozen Phase 5 V2 forecasting frame.  It intentionally
returns TRAIN and VALIDATION tensors only; TEST remains metadata until Phase 6E.
No neural-network model or training loop belongs here.
"""

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sklearn.preprocessing import StandardScaler
from torch import Tensor

from sari_rasa_data.application_catalog import (
    APPLICATION_CATALOG_IDENTITY,
    APPLICATION_PRODUCT_CATALOG,
)
from sari_rasa_data.forecasting import (
    SUPERVISED_FEATURE_COLUMNS,
    TARGET_COLUMN,
    build_next_day_quantity_features,
)
from sari_rasa_data.ml_v2_data import (
    V2_DATASET_IDENTITY,
    V2_DEFAULT_PATH,
    V2_DEFAULT_SEED,
    sha256_file,
)
from sari_rasa_data.ml_v2_experiment import (
    V2_TEST_END,
    V2_TEST_START,
    V2_TRAIN_END,
    V2_VALIDATION_END,
    V2_VALIDATION_START,
    load_v2_daily_quantity_series,
    v2_temporal_split,
)
from sari_rasa_data.model_training import feature_target_split


V2_TRAIN_START = "2024-11-07"
V2_EXPECTED_SPLIT_COUNTS = {"train": 479, "validation": 92, "test": 93}
V2_EXPECTED_SUPERVISED_ROWS = sum(V2_EXPECTED_SPLIT_COUNTS.values())


@dataclass(frozen=True)
class ScalerState:
    """Immutable TRAIN-fitted StandardScaler values needed by later phases."""

    mean: tuple[float, ...]
    scale: tuple[float, ...]
    variance: tuple[float, ...]
    samples_seen: int


@dataclass(frozen=True)
class TemporalMetadata:
    """Frozen V2 boundaries and counts, including TEST metadata only."""

    train_start: str
    train_end: str
    validation_start: str
    validation_end: str
    test_start: str
    test_end: str
    train_observations: int
    validation_observations: int
    test_observations: int
    total_observations: int


@dataclass(frozen=True)
class DatasetProvenance:
    """Identity of the trusted dataset used to construct the tensors."""

    dataset_identity: str
    dataset_sha256: str
    dataset_seed: int
    catalog_identity: str
    product_count: int


@dataclass(frozen=True)
class DevelopmentData:
    """TRAIN/VALIDATION tensors for 6C/6D, deliberately excluding TEST."""

    feature_names: tuple[str, ...]
    target_name: str
    train_features: Tensor
    train_targets: Tensor
    validation_features: Tensor
    validation_targets: Tensor
    scaler: ScalerState
    temporal: TemporalMetadata
    provenance: DatasetProvenance


def _iso_boundary(frame: pd.DataFrame, position: int) -> str:
    return pd.Timestamp(frame["forecast_date"].iloc[position]).date().isoformat()


def _validate_frozen_splits(splits: dict[str, pd.DataFrame]) -> None:
    if tuple(splits) != ("train", "validation", "test"):
        raise ValueError("V2 split names or order are incompatible")
    counts = {name: len(frame) for name, frame in splits.items()}
    if counts != V2_EXPECTED_SPLIT_COUNTS:
        raise ValueError("V2 split observation counts are incompatible")

    for name, frame in splits.items():
        dates = pd.to_datetime(frame["forecast_date"], errors="raise")
        if dates.isna().any() or dates.duplicated().any() or not dates.is_monotonic_increasing:
            raise ValueError(f"{name} forecast dates must be present, unique, and sorted")
    if not (
        splits["train"]["forecast_date"].iloc[-1]
        < splits["validation"]["forecast_date"].iloc[0]
        < splits["test"]["forecast_date"].iloc[0]
    ):
        raise ValueError("V2 partitions must be strictly chronological")

    boundaries = (
        _iso_boundary(splits["train"], 0),
        _iso_boundary(splits["train"], -1),
        _iso_boundary(splits["validation"], 0),
        _iso_boundary(splits["validation"], -1),
        _iso_boundary(splits["test"], 0),
        _iso_boundary(splits["test"], -1),
    )
    expected = (
        V2_TRAIN_START,
        V2_TRAIN_END,
        V2_VALIDATION_START,
        V2_VALIDATION_END,
        V2_TEST_START,
        V2_TEST_END,
    )
    if boundaries != expected:
        raise ValueError("V2 split date boundaries are incompatible")


def _prepare_development_data(
    supervised: pd.DataFrame,
    *,
    dataset_sha256: str,
) -> DevelopmentData:
    """Scale TRAIN only and return float32 TRAIN/VALIDATION tensors.

    The input frame is never mutated.  The frozen TEST frame is inspected only
    to validate its count and temporal boundary, then discarded without feature
    extraction, scaling, or tensor conversion.  This internal seam accepts
    caller-asserted provenance for focused tests; production callers must use
    ``load_v2_development_data``, which hashes the dataset it actually loads.
    """
    if not isinstance(dataset_sha256, str) or len(dataset_sha256) != 64:
        raise ValueError("dataset_sha256 must be a SHA-256 hexadecimal digest")
    try:
        int(dataset_sha256, 16)
    except ValueError as exc:
        raise ValueError("dataset_sha256 must be a SHA-256 hexadecimal digest") from exc

    source = supervised.copy(deep=True)
    splits = v2_temporal_split(source)
    _validate_frozen_splits(splits)

    train_features, train_target = feature_target_split(splits["train"])
    validation_features, validation_target = feature_target_split(splits["validation"])
    if tuple(train_features.columns) != SUPERVISED_FEATURE_COLUMNS or tuple(
        validation_features.columns
    ) != SUPERVISED_FEATURE_COLUMNS:
        raise ValueError("feature order is incompatible with the Phase 5 contract")

    scaler = StandardScaler()
    scaled_train = scaler.fit_transform(train_features.to_numpy(dtype=np.float64))
    scaled_validation = scaler.transform(validation_features.to_numpy(dtype=np.float64))

    tensors = (
        torch.tensor(scaled_train, dtype=torch.float32),
        torch.tensor(train_target.to_numpy(dtype=np.float64).reshape(-1, 1), dtype=torch.float32),
        torch.tensor(scaled_validation, dtype=torch.float32),
        torch.tensor(validation_target.to_numpy(dtype=np.float64).reshape(-1, 1), dtype=torch.float32),
    )
    if not all(torch.isfinite(value).all().item() for value in tensors):
        raise ValueError("development tensors must contain only finite values")

    temporal = TemporalMetadata(
        train_start=_iso_boundary(splits["train"], 0),
        train_end=_iso_boundary(splits["train"], -1),
        validation_start=_iso_boundary(splits["validation"], 0),
        validation_end=_iso_boundary(splits["validation"], -1),
        test_start=_iso_boundary(splits["test"], 0),
        test_end=_iso_boundary(splits["test"], -1),
        train_observations=len(splits["train"]),
        validation_observations=len(splits["validation"]),
        test_observations=len(splits["test"]),
        total_observations=len(source),
    )
    scaler_state = ScalerState(
        mean=tuple(float(value) for value in scaler.mean_),
        scale=tuple(float(value) for value in scaler.scale_),
        variance=tuple(float(value) for value in scaler.var_),
        samples_seen=int(scaler.n_samples_seen_),
    )
    return DevelopmentData(
        feature_names=SUPERVISED_FEATURE_COLUMNS,
        target_name=TARGET_COLUMN,
        train_features=tensors[0],
        train_targets=tensors[1],
        validation_features=tensors[2],
        validation_targets=tensors[3],
        scaler=scaler_state,
        temporal=temporal,
        provenance=DatasetProvenance(
            dataset_identity=V2_DATASET_IDENTITY,
            dataset_sha256=dataset_sha256,
            dataset_seed=V2_DEFAULT_SEED,
            catalog_identity=APPLICATION_CATALOG_IDENTITY,
            product_count=len(APPLICATION_PRODUCT_CATALOG),
        ),
    )


def load_v2_development_data(path: Path | str = V2_DEFAULT_PATH) -> DevelopmentData:
    """Load trusted V2 history through Phase 5 and prepare development tensors."""
    daily = load_v2_daily_quantity_series(path)
    supervised = build_next_day_quantity_features(daily)
    if len(supervised) != V2_EXPECTED_SUPERVISED_ROWS:
        raise ValueError("V2 supervised observation count is incompatible")
    return _prepare_development_data(supervised, dataset_sha256=sha256_file(path))
