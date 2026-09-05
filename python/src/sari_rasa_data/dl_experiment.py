"""Leakage-safe PyTorch training and final evaluation for Phase 6.

This module adapts the frozen Phase 5 V2 forecasting frame and provides the
small Phase 6C baseline MLP, the Phase 6D validation workflow, and the
single-use Phase 6E TEST comparison.
"""

from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sklearn.preprocessing import StandardScaler
from torch import Tensor, nn
from torch.utils.data import DataLoader, TensorDataset

from sari_rasa_data.application_catalog import (
    APPLICATION_CATALOG_IDENTITY,
    APPLICATION_PRODUCT_CATALOG,
)
from sari_rasa_data.baseline_forecasting import (
    mean_absolute_error,
    root_mean_squared_error,
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
MLP_INPUT_FEATURES = len(SUPERVISED_FEATURE_COLUMNS)
MLP_HIDDEN_UNITS = 16
MLP_OUTPUT_FEATURES = 1
BASELINE_SEED = 20260903
BASELINE_LEARNING_RATE = 1e-3
PHASE6_LEARNING_RATE = 1e-2
BASELINE_BATCH_SIZE = 32
BASELINE_EPOCHS = 40
TRAINING_MAX_EPOCHS = 200
EARLY_STOPPING_PATIENCE = 20
PHASE5_TEST_BASELINE_MAE = 178.3333
PHASE5_TEST_BASELINE_RMSE = 228.5035
PHASE5_TEST_HGB_MAE = 135.5097
PHASE5_TEST_HGB_RMSE = 177.6172
PHASE6_TEST_MLP_MAE = 147.2643
PHASE6_TEST_MLP_RMSE = 193.5776
_PHASE6_TEST_EVALUATED = False


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


class BaselineMLP(nn.Module):
    """The single approved Phase 6C architecture: 10 → 16 → 1."""

    def __init__(self) -> None:
        super().__init__()
        self.layers = nn.Sequential(
            nn.Linear(MLP_INPUT_FEATURES, MLP_HIDDEN_UNITS),
            nn.ReLU(),
            nn.Linear(MLP_HIDDEN_UNITS, MLP_OUTPUT_FEATURES),
        )

    def forward(self, features: Tensor) -> Tensor:
        return self.layers(features)


@dataclass(frozen=True)
class EpochMetrics:
    """Development metrics after an epoch; epoch zero is pre-training."""

    epoch: int
    train_loss: float
    validation_loss: float
    validation_mae: float
    validation_rmse: float


@dataclass(frozen=True)
class BaselineTrainingResult:
    """Best restored model plus development-only learning evidence."""

    model: BaselineMLP
    history: tuple[EpochMetrics, ...]
    validation_mae: float
    validation_rmse: float
    seed: int
    learning_rate: float
    batch_size: int
    epochs: int
    patience: int
    best_epoch: int
    stopping_epoch: int
    early_stopped: bool


@dataclass(frozen=True)
class TestModelMetrics:
    """Frozen TEST metrics for one comparison model."""

    model: str
    mae: float
    rmse: float


@dataclass(frozen=True)
class Phase6FinalEvaluation:
    """The single Phase 6 TEST result and frozen Phase 5 comparison."""

    baseline: TestModelMetrics
    hgb: TestModelMetrics
    mlp: TestModelMetrics
    ranking: tuple[str, ...]
    mlp_vs_hgb_mae_percent: float
    mlp_beats_hgb: bool
    test_start: str
    test_end: str
    test_observations: int
    dataset_identity: str
    dataset_sha256: str


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


def build_baseline_mlp(seed: int = BASELINE_SEED) -> BaselineMLP:
    """Build the baseline with deterministic CPU parameter initialization."""
    if not isinstance(seed, int):
        raise TypeError("seed must be an integer")
    with torch.random.fork_rng(devices=[]):
        torch.manual_seed(seed)
        return BaselineMLP().cpu()


def _validate_training_data(data: DevelopmentData) -> None:
    expected = (
        (data.train_features, (V2_EXPECTED_SPLIT_COUNTS["train"], MLP_INPUT_FEATURES)),
        (data.train_targets, (V2_EXPECTED_SPLIT_COUNTS["train"], MLP_OUTPUT_FEATURES)),
        (
            data.validation_features,
            (V2_EXPECTED_SPLIT_COUNTS["validation"], MLP_INPUT_FEATURES),
        ),
        (
            data.validation_targets,
            (V2_EXPECTED_SPLIT_COUNTS["validation"], MLP_OUTPUT_FEATURES),
        ),
    )
    if data.feature_names != SUPERVISED_FEATURE_COLUMNS or data.target_name != TARGET_COLUMN:
        raise ValueError("development feature or target contract is incompatible")
    for tensor, shape in expected:
        if tensor.device.type != "cpu" or tensor.dtype != torch.float32 or tuple(tensor.shape) != shape:
            raise ValueError("development tensor contract is incompatible")
        if not torch.isfinite(tensor).all().item():
            raise ValueError("development tensors must contain only finite values")


def _development_metrics(
    model: BaselineMLP,
    data: DevelopmentData,
    loss_function: nn.Module,
) -> tuple[float, float, float, float]:
    model.eval()
    with torch.no_grad():
        train_loss = float(loss_function(model(data.train_features), data.train_targets))
        raw_validation_predictions = model(data.validation_features)
        validation_loss = float(loss_function(raw_validation_predictions, data.validation_targets))
        # Frozen before TEST access: train raw scalar outputs with MSE, but all
        # model-selection/evaluation predictions represent non-negative demand.
        validation_predictions = raw_validation_predictions.clamp_min(0).squeeze(1).numpy()
    validation_actual = data.validation_targets.squeeze(1).numpy()
    validation_mae = mean_absolute_error(validation_actual, validation_predictions)
    validation_rmse = root_mean_squared_error(validation_actual, validation_predictions)
    metrics = (train_loss, validation_loss, validation_mae, validation_rmse)
    if not all(np.isfinite(value) for value in metrics):
        raise ValueError("training and validation metrics must be finite")
    return metrics


def train_baseline_mlp(
    data: DevelopmentData,
    *,
    epochs: int = TRAINING_MAX_EPOCHS,
    seed: int = BASELINE_SEED,
    learning_rate: float = PHASE6_LEARNING_RATE,
    batch_size: int = BASELINE_BATCH_SIZE,
    patience: int = EARLY_STOPPING_PATIENCE,
) -> BaselineTrainingResult:
    """Train on raw outputs and select/restore the best VALIDATION-MAE model.

    Evaluation predictions are clamped to zero without changing the network or
    MSE objective.  This deliberately has no TEST input or artifact output.
    """
    _validate_training_data(data)
    if not isinstance(epochs, int) or epochs <= 0 or epochs > TRAINING_MAX_EPOCHS:
        raise ValueError(f"epochs must be between 1 and {TRAINING_MAX_EPOCHS}")
    if not isinstance(batch_size, int) or batch_size <= 0:
        raise ValueError("batch_size must be a positive integer")
    if not np.isfinite(learning_rate) or learning_rate <= 0:
        raise ValueError("learning_rate must be positive and finite")
    if not isinstance(patience, int) or patience <= 0:
        raise ValueError("patience must be a positive integer")

    model = build_baseline_mlp(seed)
    loss_function = nn.MSELoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)
    generator = torch.Generator(device="cpu").manual_seed(seed)
    batches = DataLoader(
        TensorDataset(data.train_features, data.train_targets),
        batch_size=batch_size,
        shuffle=True,
        generator=generator,
        num_workers=0,
    )

    initial = _development_metrics(model, data, loss_function)
    history = [EpochMetrics(0, *initial)]
    best_epoch = 0
    best_mae = initial[2]
    best_weights = deepcopy(model.state_dict())
    epochs_without_improvement = 0
    for epoch in range(1, epochs + 1):
        model.train()
        for features, targets in batches:
            optimizer.zero_grad()
            loss = loss_function(model(features), targets)
            if not torch.isfinite(loss).item():
                raise ValueError("training loss must be finite")
            loss.backward()
            optimizer.step()
        metrics = _development_metrics(model, data, loss_function)
        history.append(EpochMetrics(epoch, *metrics))
        if metrics[2] < best_mae:
            best_epoch = epoch
            best_mae = metrics[2]
            best_weights = deepcopy(model.state_dict())
            epochs_without_improvement = 0
        else:
            epochs_without_improvement += 1
            if epochs_without_improvement >= patience:
                break

    stopping_epoch = history[-1].epoch
    model.load_state_dict(best_weights)
    model.eval()
    restored = _development_metrics(model, data, loss_function)
    return BaselineTrainingResult(
        model=model,
        history=tuple(history),
        validation_mae=restored[2],
        validation_rmse=restored[3],
        seed=seed,
        learning_rate=float(learning_rate),
        batch_size=batch_size,
        epochs=epochs,
        patience=patience,
        best_epoch=best_epoch,
        stopping_epoch=stopping_epoch,
        early_stopped=stopping_epoch < epochs,
    )


def run_phase6_final_evaluation_once(
    path: Path | str = V2_DEFAULT_PATH,
) -> Phase6FinalEvaluation:
    """Train the frozen policy and consume the one permitted TEST evaluation.

    This entry point intentionally accepts no model or training configuration.
    TEST is accessed only after the validation-selected weights are restored,
    and the in-process gate is consumed before TEST features or targets are
    extracted so a failed attempt cannot become a tuning loop.
    """
    global _PHASE6_TEST_EVALUATED
    if _PHASE6_TEST_EVALUATED:
        raise RuntimeError("Phase 6 final TEST evaluation has already been performed")

    dataset_sha256 = sha256_file(path)
    daily = load_v2_daily_quantity_series(path)
    supervised = build_next_day_quantity_features(daily)
    if len(supervised) != V2_EXPECTED_SUPERVISED_ROWS:
        raise ValueError("V2 supervised observation count is incompatible")
    development = _prepare_development_data(
        supervised,
        dataset_sha256=dataset_sha256,
    )
    trained = train_baseline_mlp(development)
    if (
        trained.learning_rate != PHASE6_LEARNING_RATE
        or trained.seed != BASELINE_SEED
        or trained.batch_size != BASELINE_BATCH_SIZE
        or trained.epochs != TRAINING_MAX_EPOCHS
        or trained.patience != EARLY_STOPPING_PATIENCE
    ):
        raise RuntimeError("Phase 6 training policy is not frozen")

    splits = v2_temporal_split(supervised)
    _validate_frozen_splits(splits)
    test = splits["test"]
    _PHASE6_TEST_EVALUATED = True
    test_features, test_target = feature_target_split(test)
    scaled_test = (
        test_features.to_numpy(dtype=np.float64) - np.asarray(development.scaler.mean)
    ) / np.asarray(development.scaler.scale)
    test_tensor = torch.tensor(scaled_test, dtype=torch.float32)
    if not torch.isfinite(test_tensor).all().item():
        raise ValueError("TEST features must contain only finite values")
    with torch.no_grad():
        predictions = trained.model(test_tensor).clamp_min(0).squeeze(1).numpy()
    mlp = TestModelMetrics(
        model="mlp",
        mae=mean_absolute_error(test_target, predictions),
        rmse=root_mean_squared_error(test_target, predictions),
    )
    baseline = TestModelMetrics(
        model="previous_week_baseline",
        mae=PHASE5_TEST_BASELINE_MAE,
        rmse=PHASE5_TEST_BASELINE_RMSE,
    )
    hgb = TestModelMetrics(
        model="phase5_hgb",
        mae=PHASE5_TEST_HGB_MAE,
        rmse=PHASE5_TEST_HGB_RMSE,
    )
    metrics = (baseline, hgb, mlp)
    if not all(np.isfinite(value) for item in metrics for value in (item.mae, item.rmse)):
        raise ValueError("final TEST metrics must be finite")
    ranking = tuple(item.model for item in sorted(metrics, key=lambda item: (item.mae, item.rmse)))
    return Phase6FinalEvaluation(
        baseline=baseline,
        hgb=hgb,
        mlp=mlp,
        ranking=ranking,
        mlp_vs_hgb_mae_percent=((mlp.mae - hgb.mae) / hgb.mae) * 100.0,
        mlp_beats_hgb=mlp.mae < hgb.mae,
        test_start=development.temporal.test_start,
        test_end=development.temporal.test_end,
        test_observations=len(test),
        dataset_identity=development.provenance.dataset_identity,
        dataset_sha256=dataset_sha256,
    )
