"""Strict loader for the repository-owned Phase 7H JSON dataset."""

from hashlib import sha256
import json
from pathlib import Path
from typing import Any

from .eval_contracts import (
    AgentEvalCase,
    BoundaryProbeCase,
    CatalogProduct,
    DATASET_VERSION,
    EVAL_SCHEMA_VERSION,
    EvaluationContractError,
    EvaluationDataset,
    RAGEvalCase,
    RetrievalEvalCase,
    SUPPORTED_LANGUAGES,
)


DEFAULT_EVAL_DATASET_PATH = Path(__file__).resolve().parents[2] / "data" / "phase_7h_eval_v1.json"
_TOP_FIELDS = {
    "dataset_version", "schema_version", "fixture_classification", "catalog",
    "retrieval_cases", "rag_cases", "agent_cases", "boundary_probes",
}


def dataset_sha256(path: str | Path = DEFAULT_EVAL_DATASET_PATH) -> str:
    return sha256(Path(path).read_bytes()).hexdigest()


def load_evaluation_dataset(path: str | Path = DEFAULT_EVAL_DATASET_PATH) -> EvaluationDataset:
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise EvaluationContractError("evaluation dataset could not be read as JSON") from exc
    if not isinstance(value, dict) or set(value) != _TOP_FIELDS:
        raise EvaluationContractError("evaluation dataset top-level fields are invalid")
    if value["dataset_version"] != DATASET_VERSION or value["schema_version"] != EVAL_SCHEMA_VERSION:
        raise EvaluationContractError("unsupported evaluation dataset version")
    if value["fixture_classification"] != "public-synthetic-only":
        raise EvaluationContractError("evaluation fixtures must be public/synthetic only")
    catalog = tuple(_catalog(item) for item in _list(value, "catalog"))
    catalog_ids = {item.product_id for item in catalog}
    if not catalog or len(catalog_ids) != len(catalog):
        raise EvaluationContractError("catalog IDs must be non-empty and unique")
    retrieval = tuple(_retrieval(item) for item in _list(value, "retrieval_cases"))
    rag = tuple(_rag(item) for item in _list(value, "rag_cases"))
    agent = tuple(_agent(item) for item in _list(value, "agent_cases"))
    probes = tuple(_probe(item) for item in _list(value, "boundary_probes"))
    dataset = EvaluationDataset(
        value["dataset_version"], value["schema_version"], value["fixture_classification"],
        catalog, retrieval, rag, agent, probes,
    )
    if (len(retrieval), len(rag), len(agent), len(probes)) != (12, 14, 10, 4):
        raise EvaluationContractError("dataset must contain exactly 12/14/10/4 entries")
    all_cases = (*retrieval, *rag, *agent, *probes)
    ids = [item.case_id for item in all_cases]
    if len(ids) != len(set(ids)):
        raise EvaluationContractError("case IDs must be globally unique")
    for case in (*retrieval, *rag, *agent):
        if not case.expected_product_ids.issubset(catalog_ids):
            raise EvaluationContractError(f"{case.case_id} references an unknown product")
    _validate_pairs(retrieval, rag, agent)
    return dataset


def _list(value: dict[str, Any], name: str) -> list[Any]:
    result = value[name]
    if not isinstance(result, list):
        raise EvaluationContractError(f"{name} must be a list")
    return result


def _object(value: Any, fields: set[str], kind: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != fields:
        raise EvaluationContractError(f"{kind} fields are invalid")
    return value


def _text(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise EvaluationContractError(f"{name} must be non-blank text")
    return value.strip()


def _language(value: Any) -> str:
    if value not in SUPPORTED_LANGUAGES:
        raise EvaluationContractError("unsupported evaluation language")
    return value


def _tags(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list) or not value or any(not isinstance(v, str) or not v.strip() for v in value):
        raise EvaluationContractError("tags must be a non-empty string list")
    return tuple(value)


def _ids(value: Any, *, required: bool) -> frozenset[str]:
    if not isinstance(value, list) or any(not isinstance(v, str) or not v.strip() for v in value):
        raise EvaluationContractError("expected_product_ids must be a string list")
    result = frozenset(value)
    if len(result) != len(value) or (required and not result):
        raise EvaluationContractError("expected product IDs must be unique and non-empty")
    return result


def _catalog(value: Any) -> CatalogProduct:
    value = _object(value, {"product_id", "name", "category", "price_rupiah", "description_id", "description_en"}, "catalog product")
    price = value["price_rupiah"]
    if isinstance(price, bool) or not isinstance(price, int) or price < 0:
        raise EvaluationContractError("catalog price must be a non-negative integer")
    return CatalogProduct(*(_text(value[name], name) for name in ("product_id", "name", "category")), price, _text(value["description_id"], "description_id"), _text(value["description_en"], "description_en"))


def _common(value: dict[str, Any]) -> tuple[str, str, str, tuple[str, ...], bool]:
    live = value["live_eligible"]
    if not isinstance(live, bool):
        raise EvaluationContractError("live_eligible must be boolean")
    return _text(value["case_id"], "case_id"), _language(value["language"]), _text(value["query"], "query"), _tags(value["tags"]), live


def _retrieval(value: Any) -> RetrievalEvalCase:
    value = _object(value, {"case_id", "language", "query", "tags", "live_eligible", "expected_product_ids", "bilingual_pair_id"}, "retrieval case")
    return RetrievalEvalCase(*_common(value), _ids(value["expected_product_ids"], required=True), _text(value["bilingual_pair_id"], "bilingual_pair_id"))


def _rag(value: Any) -> RAGEvalCase:
    value = _object(value, {"case_id", "language", "query", "tags", "live_eligible", "expected_response_class", "expected_product_ids", "source_required", "expected_safety_outcome", "bilingual_pair_id"}, "RAG case")
    if value["expected_response_class"] not in ("supported", "insufficient") or value["expected_safety_outcome"] not in ("allow", "refuse", "reject"):
        raise EvaluationContractError("invalid RAG expectation")
    if not isinstance(value["source_required"], bool):
        raise EvaluationContractError("source_required must be boolean")
    ids = _ids(value["expected_product_ids"], required=value["expected_response_class"] == "supported")
    if value["expected_response_class"] == "insufficient" and (ids or value["source_required"]):
        raise EvaluationContractError("insufficient RAG cases cannot require products or sources")
    pair = value["bilingual_pair_id"]
    if pair is not None:
        pair = _text(pair, "bilingual_pair_id")
    return RAGEvalCase(*_common(value), value["expected_response_class"], ids, value["source_required"], value["expected_safety_outcome"], pair)


def _agent(value: Any) -> AgentEvalCase:
    value = _object(value, {"case_id", "language", "query", "tags", "live_eligible", "expected_terminal_class", "expected_product_ids", "min_decisions", "max_decisions", "min_tool_calls", "max_tool_calls", "max_evidence", "expected_safety_outcome", "bilingual_pair_id"}, "agent case")
    if value["expected_terminal_class"] not in ("finish", "cannot_complete", "error") or value["expected_safety_outcome"] not in ("allow", "refuse", "reject"):
        raise EvaluationContractError("invalid agent expectation")
    pair = value["bilingual_pair_id"]
    if pair is not None:
        pair = _text(pair, "bilingual_pair_id")
    return AgentEvalCase(*_common(value), value["expected_terminal_class"], _ids(value["expected_product_ids"], required=False), value["min_decisions"], value["max_decisions"], value["min_tool_calls"], value["max_tool_calls"], value["max_evidence"], value["expected_safety_outcome"], pair)


def _probe(value: Any) -> BoundaryProbeCase:
    value = _object(value, {"case_id", "probe", "expected_outcome", "tags"}, "boundary probe")
    if value["probe"] not in {"stale_vector_record", "missing_canonical_product", "malformed_structured_response", "invalid_agent_action"}:
        raise EvaluationContractError("unknown boundary probe")
    return BoundaryProbeCase(_text(value["case_id"], "case_id"), value["probe"], _text(value["expected_outcome"], "expected_outcome"), _tags(value["tags"]))


def _validate_pairs(*groups: tuple[Any, ...]) -> None:
    pairs: dict[tuple[str, str], list[Any]] = {}
    for group_name, group in zip(("retrieval", "rag", "agent"), groups, strict=True):
        for case in group:
            if case.bilingual_pair_id is not None:
                pairs.setdefault((group_name, case.bilingual_pair_id), []).append(case)
    for (_, pair_id), cases in pairs.items():
        if len(cases) != 2 or {case.language for case in cases} != SUPPORTED_LANGUAGES:
            raise EvaluationContractError(f"bilingual pair {pair_id} must contain one ID and one EN case")
        if isinstance(cases[0], RetrievalEvalCase) and cases[0].expected_product_ids != cases[1].expected_product_ids:
            raise EvaluationContractError("retrieval bilingual pair must share gold products")
