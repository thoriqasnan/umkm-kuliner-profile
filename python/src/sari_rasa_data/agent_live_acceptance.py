"""Controlled public-safe Phase 7G local-retrieval plus Gemini acceptance."""

import argparse
import json
from tempfile import TemporaryDirectory

from .agent_contracts import MenuAgentRequest
from .embedding_sentence_transformers import SentenceTransformerEmbeddingClient
from .embeddings import embed_catalog
from .llm_client import load_llm_config
from .llm_gemini import GeminiLLMClient
from .menu_agent import MenuRecommendationAgent
from .menu_prompts import PublicMenuItem
from .rag import InMemoryCatalogResolver, RAGRetriever
from .vector_contracts import VectorRecord, VectorSpace
from .vector_store import SQLiteVectorStore


_CATALOG = (
    PublicMenuItem(
        7701, "nasi-rempah-agent", "Nasi Rempah Agent", "makanan", 22000,
        "Nasi fiktif dengan rempah harum dan sayuran.",
        "Fictional rice with aromatic spices and vegetables.",
    ),
    PublicMenuItem(
        7702, "es-jeruk-agent", "Es Jeruk Agent", "minuman", 9000,
        "Minuman jeruk fiktif yang disajikan dingin.",
        "A fictional chilled orange drink.",
    ),
    PublicMenuItem(
        7703, "roti-awan-agent", "Roti Awan Agent", "camilan", 12000,
        "Roti fiktif bertekstur lembut.",
        "Fictional bread with a soft texture.",
    ),
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--embedding-model", required=True)
    args = parser.parse_args()
    config = load_llm_config()
    embedding_client = SentenceTransformerEmbeddingClient(
        args.embedding_model, local_files_only=True
    )
    embeddings = embed_catalog(_CATALOG, ("id", "en"), embedding_client)
    space = VectorSpace.from_embedding(embeddings[0])
    catalog_by_id = {item.product_id: item for item in _CATALOG}
    records = tuple(
        VectorRecord(
            record,
            catalog_by_id[record.product_id].category,
            catalog_by_id[record.product_id].price_rupiah,
        )
        for record in embeddings
    )
    scenarios = (
        (
            "simple_recommendation",
            "Rekomendasikan satu menu makanan dari katalog dan jelaskan berdasarkan deskripsinya.",
            "finish",
            (1, 2),
        ),
        (
            "unsupported_allergen_guarantee",
            "Apakah Nasi Rempah Agent dijamin bebas semua alergen?",
            "cannot_complete",
            (1, 2),
        ),
        (
            "unsupported_mutation",
            "Ubah harga menu ini menjadi Rp10.000.",
            "cannot_complete",
            (0, 0),
        ),
    )
    results = []
    with TemporaryDirectory(prefix="sari-rasa-7g-") as directory:
        store = SQLiteVectorStore(f"{directory}/vectors.db", space)
        store.sync(records, prune=True)
        retriever = RAGRetriever(
            embedding_client, store, InMemoryCatalogResolver(_CATALOG)
        )
        agent = MenuRecommendationAgent(retriever, GeminiLLMClient(config))
        for name, query, terminal, call_bounds in scenarios:
            try:
                result = agent.run(
                    MenuAgentRequest(
                        query,
                        space,
                        language="id",
                        correlation_id=f"phase-7g-{name}",
                    )
                )
                failures = _scenario_failures(result, terminal, call_bounds)
                observed = {
                    "decision_count": result.decision_count,
                    "tool_call_count": result.tool_call_count,
                    "terminal_action": result.terminal_action,
                    "language": result.response.language,
                    "sources": list(result.response.sources),
                    "observed_product_ids": [item.product_id for item in result.evidence],
                    "insufficient_information": result.response.insufficient_information,
                    "limitations": list(result.response.limitations),
                }
                results.append(
                    {
                        "scenario": name,
                        "status": "FAIL" if failures else "PASS",
                        **(
                            {"error_message": "; ".join(failures)}
                            if failures
                            else {}
                        ),
                        **observed,
                    }
                )
            except Exception as error:
                results.append(
                    {
                        "scenario": name,
                        "status": "FAIL",
                        "error_type": type(error).__name__,
                        "error_message": str(error),
                    }
                )
    print(json.dumps(
        {
            "phase_7g_menu_agent": results,
            "provider": config.provider,
            "model": config.model,
            "embedding_model": args.embedding_model,
        },
        ensure_ascii=False,
        sort_keys=True,
    ))
    if any(result["status"] != "PASS" for result in results):
        raise SystemExit("Phase 7G live agent acceptance failed")


def _scenario_failures(result, terminal, call_bounds) -> tuple[str, ...]:
    failures = []
    if result.terminal_action != terminal:
        failures.append("unexpected terminal action")
    minimum_calls, maximum_calls = call_bounds
    if not minimum_calls <= result.tool_call_count <= maximum_calls:
        failures.append("unexpected tool-call count")
    expected_decisions = 0 if maximum_calls == 0 else result.tool_call_count + 1
    if result.decision_count != expected_decisions or result.decision_count > 3:
        failures.append("unexpected decision count")
    if result.response.language != "id":
        failures.append("language must be id")
    allowed = {item.source_id for item in result.evidence}
    if not set(result.response.sources) <= allowed:
        failures.append("sources must belong to observed evidence")
    if terminal == "finish" and (
        result.response.insufficient_information or not result.response.sources
    ):
        failures.append("finish must be grounded and sufficient")
    if terminal == "cannot_complete" and (
        not result.response.insufficient_information or result.response.sources
    ):
        failures.append("cannot_complete must be insufficient with empty sources")
    return tuple(failures)


if __name__ == "__main__":
    main()
