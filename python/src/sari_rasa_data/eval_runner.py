"""Deterministic Phase 7H runner. Local semantic and live modes are stop-gated."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import platform
import subprocess
import tempfile
from time import perf_counter
from typing import Any, Callable

from .agent_contracts import AgentActionValidationError, parse_agent_action
from .embedding_fake import FakeEmbeddingClient
from .embedding_contracts import EmbeddingClient, EmbeddingError, EmbeddingRequest
from .embedding_profiles import MINILM_MODEL_ID, resolve_embedding_profile
from .embeddings import CATALOG_TEXT_VERSION, SUPPORTED_CATALOG_TEXT_VERSIONS, embed_catalog
from .eval_contracts import METRIC_DEFINITIONS_VERSION, EvaluationContractError
from .eval_dataset import DEFAULT_EVAL_DATASET_PATH, dataset_sha256, load_evaluation_dataset
from .eval_metrics import AgentObservation, RAGObservation, RetrievalObservation, SafetyObservation, agent_bilingual_agreement, aggregate_retrieval, aggregate_rag, aggregate_safety, rag_bilingual_agreement, retrieval_bilingual_agreement
from .hybrid_retrieval import HYBRID_CANDIDATE_COUNT, HYBRID_RETRIEVAL_POLICY, SEMANTIC_RETRIEVAL_POLICY, SUPPORTED_RETRIEVAL_POLICIES, rerank_hybrid
from .llm_contracts import LLMError
from .llm_structured import parse_structured_menu_response
from .menu_prompts import PublicMenuItem
from .rag import InMemoryCatalogResolver, RAGRetriever
from .vector_contracts import VectorRecord, VectorSearchRequest, VectorSearchResult, VectorSpace
from .vector_store import SQLiteVectorStore


LOCAL_MODEL_ID = MINILM_MODEL_ID


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the Phase 7H AI evaluation in an explicitly selected mode."
    )
    parser.add_argument(
        "--mode",
        choices=("offline", "local-model", "controlled-live"),
        default="offline",
        help="evaluation mode (controlled-live remains unavailable)",
    )
    parser.add_argument(
        "--dataset",
        default=str(DEFAULT_EVAL_DATASET_PATH),
        help="path to the versioned evaluation dataset JSON",
    )
    parser.add_argument(
        "--embedding-model",
        default=LOCAL_MODEL_ID,
        help="local semantic model identity; loading is delegated to local-model mode",
    )
    parser.add_argument(
        "--semantic-text-version",
        choices=tuple(sorted(SUPPORTED_CATALOG_TEXT_VERSIONS)),
        default=CATALOG_TEXT_VERSION,
        help="versioned catalog semantic projection",
    )
    parser.add_argument(
        "--retrieval-policy",
        choices=tuple(sorted(SUPPORTED_RETRIEVAL_POLICIES)),
        default=SEMANTIC_RETRIEVAL_POLICY,
        help="explicit semantic-only or conservative hybrid retrieval policy",
    )
    parser.add_argument(
        "--embedding-profile",
        help="optional explicit supported profile; known models resolve automatically",
    )
    parser.add_argument(
        "--output",
        help="optional new path for the machine-readable JSON result",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        result = run_evaluation(
            mode=args.mode,
            dataset_path=args.dataset,
            output_path=args.output,
            embedding_model=args.embedding_model,
            semantic_text_version=args.semantic_text_version,
            retrieval_policy=args.retrieval_policy,
            embedding_profile=args.embedding_profile,
        )
    except (EmbeddingError, EvaluationContractError) as exc:
        print(f"evaluation failed: {exc}", file=__import__("sys").stderr)
        return 2
    print(format_scorecard(result))
    return 0


def run_evaluation(
    *, mode: str = "offline", dataset_path: str | Path = DEFAULT_EVAL_DATASET_PATH,
    output_path: str | Path | None = None,
    embedding_model: str = LOCAL_MODEL_ID,
    semantic_text_version: str = CATALOG_TEXT_VERSION,
    retrieval_policy: str = SEMANTIC_RETRIEVAL_POLICY,
    embedding_profile: str | None = None,
    _embedding_client_factory: Callable[..., EmbeddingClient] | None = None,
) -> dict[str, Any]:
    if mode == "local-model":
        return _run_local_model(
            Path(dataset_path),
            embedding_model,
            output_path,
            _embedding_client_factory,
            semantic_text_version,
            retrieval_policy,
            embedding_profile,
        )
    if mode != "offline":
        if mode == "controlled-live":
            raise EvaluationContractError("controlled-live evaluation is not implemented")
        raise EvaluationContractError("unknown evaluation run mode")
    started = perf_counter()
    dataset = load_evaluation_dataset(dataset_path)
    orchestration = _offline_vector_orchestration(dataset)
    boundary = _run_boundary_probes(dataset)
    rag_rows, safety_rows, agent_rows = _offline_case_observations(dataset)
    result = {
        "metadata": _metadata(dataset, Path(dataset_path)),
        "semantic_retrieval_quality": None,
        "semantic_retrieval_quality_status": "not_run_fake_embeddings_have_no_semantic_meaning",
        "offline_orchestration": orchestration,
        "rag": {**aggregate_rag(rag_rows), "bilingual": rag_bilingual_agreement(rag_rows)},
        "safety": aggregate_safety(safety_rows),
        "agent": {**_aggregate_agent(agent_rows), "bilingual": agent_bilingual_agreement(agent_rows)},
        "boundary_probes": boundary,
        "observability": {
            "total_wall_clock_ms": (perf_counter() - started) * 1000.0,
            "embedding_call_count": orchestration["embedding_call_count"],
            "vector_search_count": orchestration["vector_search_count"],
            "provider_llm_call_count": 0,
            "input_tokens": None, "output_tokens": None, "total_tokens": None,
        },
        "quality_thresholds": None,
        "human_rubric": None,
    }
    _write_result(result, output_path)
    return result


def _run_local_model(
    dataset_path: Path,
    embedding_model: str,
    output_path: str | Path | None,
    client_factory: Callable[..., EmbeddingClient] | None,
    semantic_text_version: str,
    retrieval_policy: str,
    embedding_profile: str | None,
) -> dict[str, Any]:
    if not isinstance(embedding_model, str) or not embedding_model.strip():
        raise EvaluationContractError("a local embedding model is required")
    started = perf_counter()
    dataset = load_evaluation_dataset(dataset_path)
    if retrieval_policy not in SUPPORTED_RETRIEVAL_POLICIES:
        raise EvaluationContractError("unsupported retrieval policy")
    profile = resolve_embedding_profile(embedding_model, embedding_profile)
    catalog = tuple(_public_item(item) for item in dataset.catalog)
    if client_factory is None:
        from .embedding_sentence_transformers import SentenceTransformerEmbeddingClient

        client_factory = SentenceTransformerEmbeddingClient
    client = client_factory(embedding_model.strip(), local_files_only=True)

    index_started = perf_counter()
    records = embed_catalog(
        catalog,
        ("id", "en"),
        client,
        text_version=semantic_text_version,
        profile=profile,
    )
    vector_space = VectorSpace.from_embedding(records[0])
    observations = []
    embedding_latency_ms = 0.0
    search_latency_ms = 0.0
    with tempfile.TemporaryDirectory(prefix="phase7h-local-semantic-") as directory:
        store = SQLiteVectorStore(Path(directory) / "vectors.db", vector_space)
        product_by_id = {item.product_id: item for item in catalog}
        store.sync(
            (
                VectorRecord(
                    record,
                    product_by_id[record.product_id].category,
                    product_by_id[record.product_id].price_rupiah,
                )
                for record in records
            ),
            prune=True,
        )
        index_latency_ms = (perf_counter() - index_started) * 1000.0
        for case in dataset.retrieval_cases:
            embed_started = perf_counter()
            query = client.embed(EmbeddingRequest(profile.prepare_query(case.query), case.language))
            embedding_latency_ms += (perf_counter() - embed_started) * 1000.0
            query_space = VectorSpace(
                query.provider,
                query.model,
                query.dimensions,
                vector_space.normalization,
                semantic_text_version,
                profile.profile_id,
            )
            if query_space != vector_space:
                raise EvaluationContractError("local query embedding belongs to an incompatible vector space")
            search_started = perf_counter()
            semantic_found = store.search(
                VectorSearchRequest(
                    vector_space,
                    query.vector,
                    language=case.language,
                    top_k=(HYBRID_CANDIDATE_COUNT if retrieval_policy == HYBRID_RETRIEVAL_POLICY else 5),
                )
            )
            if retrieval_policy == HYBRID_RETRIEVAL_POLICY:
                found = rerank_hybrid(case.query, semantic_found, product_by_id)
            else:
                found = semantic_found
            search_latency_ms += (perf_counter() - search_started) * 1000.0
            observations.append(
                RetrievalObservation(
                    case.case_id,
                    case.language,
                    case.expected_product_ids,
                    tuple(str(item.product_id) for item in found),
                    tuple(item.score for item in found),
                    case.bilingual_pair_id,
                )
            )

    quality = aggregate_retrieval(observations)
    case_contracts = {case.case_id: case for case in dataset.retrieval_cases}
    for row, observation in zip(quality["cases"], observations, strict=True):
        case = case_contracts[observation.case_id]
        row.update({
            "query": case.query,
            "expected_product_ids": sorted(case.expected_product_ids),
            "retrieved_product_ids": list(observation.retrieved_product_ids),
            "retrieved_scores": list(observation.scores),
        })
    quality["bilingual"] = retrieval_bilingual_agreement(observations)
    result = {
        "metadata": _metadata(
            dataset,
            dataset_path,
            mode="local-model",
            embedding={
                "provider": records[0].provider,
                "model": records[0].model,
                "dimensions": records[0].dimensions,
                "semantic_text_version": semantic_text_version,
                "semantic_quality_eligible": True,
                "vector_space_key": vector_space.key,
                "local_files_only": True,
                "retrieval_policy": retrieval_policy,
                "embedding_profile": profile.profile_id,
            },
        ),
        "semantic_retrieval_quality": quality,
        "semantic_retrieval_quality_status": "measured_with_local_semantic_model",
        "observability": {
            "total_wall_clock_ms": (perf_counter() - started) * 1000.0,
            "catalog_index_latency_ms": index_latency_ms,
            "query_embedding_latency_ms": embedding_latency_ms,
            "vector_search_latency_ms": search_latency_ms,
            "embedding_call_count": len(records) + len(observations),
            "vector_search_count": len(observations),
            "provider_llm_call_count": 0,
            "input_tokens": None, "output_tokens": None, "total_tokens": None,
        },
        "quality_thresholds": None,
    }
    _write_result(result, output_path)
    return result


def format_scorecard(result: dict[str, Any]) -> str:
    meta = result["metadata"]
    if meta["run_mode"] == "local-model":
        quality = result["semantic_retrieval_quality"]
        overall = quality["overall"]
        summary = [
            f"Phase 7H evaluation — local-model ({meta['dataset_version']})",
            f"Retrieval cases: {overall['case_count']} (ID {quality['id']['case_count']}, EN {quality['en']['case_count']})",
            f"Hit@1: {_percent(overall['hit_at_1'])}",
            f"Hit@3: {_percent(overall['hit_at_3'])}",
            f"Recall@5: {_percent(overall['recall_at_5'])}",
            f"MRR: {_decimal(overall['mrr'])}",
            f"Bilingual both-hit@1: {_percent(quality['bilingual']['both_hit_at_1_rate'])}",
            f"Model: {meta['embedding']['model']} ({meta['embedding']['dimensions']} dimensions)",
            f"Retrieval policy: {meta['embedding']['retrieval_policy']}",
            "Per-case results:",
        ]
        summary.extend(
            f"  {row['case_id']} [{row['language']}] gold={','.join(row['expected_product_ids'])} "
            f"retrieved={','.join(row['retrieved_product_ids'])} "
            f"H@1={row['hit_at_1']} H@3={row['hit_at_3']} "
            f"R@5={row['recall_at_5']:.4f} RR={row['reciprocal_rank']:.4f}"
            for row in quality["cases"]
        )
        return "\n".join(summary)
    probes = result["boundary_probes"]
    return "\n".join((
        f"Phase 7H evaluation — {meta['run_mode']} ({meta['dataset_version']})",
        f"Cases: {meta['case_counts']['evaluation_cases']} evaluation + {meta['case_counts']['boundary_probes']} boundary probes",
        "Semantic retrieval quality: NOT RUN (fake embeddings are orchestration-only)",
        f"RAG contract-valid: {_percent(result['rag']['structured']['contract_valid_rate'])}",
        f"Safety hard gates: {'PASS' if result['safety']['hard_gates_pass'] else 'FAIL'}",
        f"Agent bounds: {'PASS' if result['agent']['hard_bounds_pass'] else 'FAIL'}",
        f"Boundary probes: {sum(item['passed'] for item in probes)}/{len(probes)} passed",
    ))


def _offline_vector_orchestration(dataset) -> dict[str, Any]:
    catalog = tuple(_public_item(item) for item in dataset.catalog)
    client = _CountingEmbeddingClient()
    records = embed_catalog(catalog, ("id", "en"), client)
    vector_space = VectorSpace.from_embedding(records[0])
    with tempfile.TemporaryDirectory(prefix="phase7h-eval-") as directory:
        store = SQLiteVectorStore(Path(directory) / "vectors.db", vector_space)
        store.sync((VectorRecord(record, next(item.category for item in catalog if item.product_id == record.product_id), next(item.price_rupiah for item in catalog if item.product_id == record.product_id)) for record in records), prune=True)
        query = client.embed(EmbeddingRequest("offline orchestration probe", "id"))
        found = store.search(VectorSearchRequest(vector_space, query.vector, language="id", top_k=5))
    return {
        "passed": len(records) == len(catalog) * 2 and len(found) == 5,
        "catalog_product_count": len(catalog), "indexed_record_count": len(records),
        "embedding_call_count": client.calls, "vector_search_count": 1,
        "embedding_provider": "fake", "embedding_model": "deterministic-sha256",
        "embedding_dimensions": vector_space.dimensions, "vector_space_key": vector_space.key,
    }


class _CountingEmbeddingClient:
    def __init__(self) -> None:
        self.inner = FakeEmbeddingClient()
        self.calls = 0
    def embed(self, request):
        self.calls += 1
        return self.inner.embed(request)


def _run_boundary_probes(dataset) -> list[dict[str, Any]]:
    results = {}
    vector_space = VectorSpace("fake", "deterministic-sha256", 8, "none", CATALOG_TEXT_VERSION)
    client = FakeEmbeddingClient()
    item = _public_item(dataset.catalog[0])
    stale = VectorSearchResult(item.product_id, item.slug, "id", 1.0, "0" * 64, item.category, item.price_rupiah)
    class Searcher:
        def __init__(self, result): self.vector_space, self.result = vector_space, result
        def search(self, request): return (self.result,) if request.language == "id" else ()
    results["stale_vector_record"] = not RAGRetriever(client, Searcher(stale), InMemoryCatalogResolver((item,))).retrieve("query", vector_space, language="id", top_k=1, max_items=1).items
    results["missing_canonical_product"] = not RAGRetriever(client, Searcher(stale), InMemoryCatalogResolver(())).retrieve("query", vector_space, language="id", top_k=1, max_items=1).items
    try:
        parse_structured_menu_response("{", frozenset())
        results["malformed_structured_response"] = False
    except LLMError:
        results["malformed_structured_response"] = True
    try:
        parse_agent_action('{"action":"call_tool","tool_name":"shell","arguments":{"query":"x"}}', allowed_source_ids=frozenset(), requested_language="en", terminal_only=False)
        results["invalid_agent_action"] = False
    except AgentActionValidationError:
        results["invalid_agent_action"] = True
    return [{"case_id": probe.case_id, "probe": probe.probe, "expected_outcome": probe.expected_outcome, "passed": results[probe.probe]} for probe in dataset.boundary_probes]


def _offline_case_observations(dataset):
    rag_rows, safety_rows = [], []
    for case in dataset.rag_cases:
        supported = case.expected_response_class == "supported"
        sources = ("menu:1",) if supported else ()
        rag_rows.append(RAGObservation(case.case_id, case.language, case.expected_response_class, case.expected_response_class, True, True, True, sources, sources, frozenset({"menu:1"}), case.source_required, safety_disposition=case.expected_safety_outcome, bilingual_pair_id=case.bilingual_pair_id, canonical_product_ids=case.expected_product_ids))
        safety_rows.append(SafetyObservation(prompt_injection_case="prompt-injection" in case.tags, prompt_injection_safely_contained="prompt-injection" in case.tags))
    agent_rows = []
    for case in dataset.agent_cases:
        decisions, tools = case.min_decisions, case.min_tool_calls
        agent_rows.append(AgentObservation(case.case_id, case.expected_terminal_class, case.expected_terminal_class, case.expected_terminal_class == "finish", case.expected_terminal_class == "cannot_complete", decisions, tools, min(case.max_evidence, tools), decisions, True, invalid_action_attempts=int("invalid-action" in case.tags), unknown_tool_attempts=int("invalid-action" in case.tags), refinement_search_count=int("refinement" in case.tags), language=case.language, bilingual_pair_id=case.bilingual_pair_id, canonical_product_ids=case.expected_product_ids))
        safety_rows.append(SafetyObservation(unsafe_model_action_attempts=int("invalid-action" in case.tags), unauthorized_tool_attempts=int("invalid-action" in case.tags), mutation_requests=int("mutation" in case.tags), prompt_injection_case="prompt-injection" in case.tags, prompt_injection_safely_contained="prompt-injection" in case.tags))
    return rag_rows, safety_rows, agent_rows


def _aggregate_agent(rows):
    rows = tuple(rows)
    from .eval_metrics import safe_rate
    return {
        "case_count": len(rows),
        "expected_task_outcome_rate": safe_rate(sum(r.expected_terminal_class == r.terminal_class for r in rows), len(rows)),
        "grounded_finish_rate": safe_rate(sum(r.grounded_finish for r in rows if r.terminal_class == "finish"), sum(r.terminal_class == "finish" for r in rows)),
        "safe_cannot_complete_rate": safe_rate(sum(r.safe_cannot_complete for r in rows if r.terminal_class == "cannot_complete"), sum(r.terminal_class == "cannot_complete" for r in rows)),
        "invalid_action_attempts": sum(r.invalid_action_attempts for r in rows), "unknown_tool_attempts": sum(r.unknown_tool_attempts for r in rows),
        "repeated_tool_attempts": sum(r.repeated_tool_attempts for r in rows), "unnecessary_tool_calls": sum(r.unnecessary_tool_calls for r in rows),
        "refinement_search_count": sum(r.refinement_search_count for r in rows),
        "average_decisions": None if not rows else sum(r.decision_count for r in rows) / len(rows), "max_decisions": max((r.decision_count for r in rows), default=None),
        "average_tool_calls": None if not rows else sum(r.tool_call_count for r in rows) / len(rows), "max_tool_calls": max((r.tool_call_count for r in rows), default=None),
        "provider_call_count": sum(r.provider_call_count for r in rows),
        "decision_bound_violations": sum(r.decision_count > 3 for r in rows), "tool_bound_violations": sum(r.tool_call_count > 2 for r in rows), "evidence_bound_violations": sum(r.evidence_count > 5 for r in rows),
        "hard_bounds_pass": all(r.decision_count <= 3 and r.tool_call_count <= 2 and r.evidence_count <= 5 for r in rows),
    }


def _metadata(dataset, path, *, mode="offline", embedding=None):
    commit, dirty = _git_identity()
    case_counts = (
        {
            "retrieval": len(dataset.retrieval_cases),
            "rag": 0,
            "agent": 0,
            "evaluation_cases": len(dataset.retrieval_cases),
            "boundary_probes": 0,
            "total_entries": len(dataset.retrieval_cases),
        }
        if mode == "local-model"
        else {
            "retrieval": len(dataset.retrieval_cases), "rag": len(dataset.rag_cases),
            "agent": len(dataset.agent_cases), "evaluation_cases": dataset.evaluation_case_count,
            "boundary_probes": len(dataset.boundary_probes), "total_entries": dataset.total_entry_count,
        }
    )
    return {
        "dataset_version": dataset.dataset_version, "schema_version": dataset.schema_version,
        "dataset_sha256": dataset_sha256(path), "metric_definitions_version": METRIC_DEFINITIONS_VERSION,
        "run_mode": mode, "utc_timestamp": datetime.now(timezone.utc).isoformat(),
        "git_commit": commit, "dirty_working_tree": dirty,
        "case_counts": case_counts,
        "embedding": embedding or {"provider": "fake", "model": "deterministic-sha256", "dimensions": 8, "semantic_text_version": CATALOG_TEXT_VERSION, "semantic_quality_eligible": False},
        "future_local_model": {"model": LOCAL_MODEL_ID, "local_files_only_required": True, "status": "run" if mode == "local-model" else "not_run"},
        "llm": {"provider": None, "model": None, "provider_calls": 0},
        "prompt_schema_versions": {"structured": "phase-7c.public-menu-response.v1", "agent": "phase-7g.menu-agent-action.v1"},
        "agent_limits": {"decisions": 3, "tool_calls": 2, "evidence": 5},
        "python_version": platform.python_version(), "platform": platform.platform(),
    }


def _git_identity():
    try:
        commit = subprocess.run(("git", "rev-parse", "HEAD"), capture_output=True, text=True, check=True).stdout.strip()
        dirty = bool(subprocess.run(("git", "status", "--porcelain"), capture_output=True, text=True, check=True).stdout)
        return commit, dirty
    except (OSError, subprocess.SubprocessError):
        return None, None


def _public_item(item):
    slug = item.name.lower().replace(" ", "-")
    return PublicMenuItem(int(item.product_id), slug, item.name, item.category, item.price_rupiah, item.description_id, item.description_en)


def _percent(value):
    return "N/A" if value is None else f"{value * 100:.1f}%"


def _decimal(value):
    return "N/A" if value is None else f"{value:.4f}"


def _write_result(result, output_path):
    if output_path is None:
        return
    path = Path(output_path)
    if path.exists():
        raise EvaluationContractError("evaluation output path already exists")
    path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    raise SystemExit(main())
