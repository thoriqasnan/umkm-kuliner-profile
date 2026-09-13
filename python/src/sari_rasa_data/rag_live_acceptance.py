"""Controlled public-safe Phase 7F local-retrieval plus Gemini acceptance."""

import argparse
import json
from tempfile import TemporaryDirectory

from .embedding_sentence_transformers import SentenceTransformerEmbeddingClient
from .embeddings import embed_catalog
from .llm_client import load_llm_config
from .llm_gemini import GeminiLLMClient
from .menu_prompts import PublicMenuItem
from .rag import InMemoryCatalogResolver, RAGPipeline
from .rag_contracts import RAGRequest
from .vector_contracts import VectorRecord, VectorSpace
from .vector_store import SQLiteVectorStore


_CATALOG = (
    PublicMenuItem(
        7601, "nasi-rempah-ceria", "Nasi Rempah Ceria", "makanan", 21000,
        "Nasi fiktif dengan rempah harum dan sayuran.",
        "Fictional rice with aromatic spices and vegetables.",
    ),
    PublicMenuItem(
        7602, "es-jeruk-pelangi", "Es Jeruk Pelangi", "minuman", 9000,
        "Minuman jeruk fiktif yang disajikan dingin.",
        "A fictional chilled orange drink.",
    ),
    PublicMenuItem(
        7603, "roti-awan-uji", "Roti Awan Uji", "camilan", 12000,
        "Roti fiktif bertekstur lembut.", "Fictional bread with a soft texture.",
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
    vector_records = tuple(
        VectorRecord(
            record,
            catalog_by_id[record.product_id].category,
            catalog_by_id[record.product_id].price_rupiah,
        )
        for record in embeddings
    )
    results = []
    with TemporaryDirectory(prefix="sari-rasa-7f-") as directory:
        store = SQLiteVectorStore(f"{directory}/vectors.db", space)
        store.sync(vector_records, prune=True)
        pipeline = RAGPipeline(
            embedding_client,
            store,
            InMemoryCatalogResolver(_CATALOG),
            GeminiLLMClient(config),
        )
        scenarios = (
            (
                "grounded_factual_retrieval",
                "Berapa harga Nasi Rempah Ceria yang tercantum?",
                False,
            ),
            (
                "unsupported_allergen_guarantee",
                "Apakah Nasi Rempah Ceria dijamin bebas semua alergen?",
                True,
            ),
        )
        for name, question, must_be_insufficient in scenarios:
            try:
                result = pipeline.generate(
                    RAGRequest(
                        question,
                        space,
                        language="id",
                        retrieve_top_k=3,
                        max_evidence=3,
                        correlation_id=f"phase-7f-{name}",
                    )
                )
                failures = _acceptance_contract_failures(
                    language=result.response.language,
                    insufficient_information=result.response.insufficient_information,
                    sources=result.response.sources,
                    allowed_sources={item.source_id for item in result.evidence},
                    must_be_insufficient=must_be_insufficient,
                )
                observed = {
                    "language": result.response.language,
                    "sources": list(result.response.sources),
                    "insufficient_information": result.response.insufficient_information,
                    "limitations": list(result.response.limitations),
                    "evidence_product_ids": [item.product_id for item in result.evidence],
                    "language_fallback": result.language_fallback,
                }
                if failures:
                    results.append(
                        {
                            "scenario": name,
                            "status": "FAIL",
                            "error_type": "ValueError",
                            "error_message": (
                                "RAG acceptance contract was not satisfied: "
                                + "; ".join(failures)
                            ),
                            **observed,
                        }
                    )
                else:
                    results.append({"scenario": name, "status": "PASS", **observed})
            except Exception as error:
                results.append(
                    {
                        "scenario": name,
                        "status": "FAIL",
                        "error_type": type(error).__name__,
                        "error_message": str(error),
                    }
                )
    print(
        json.dumps(
            {
                "phase_7f_rag": results,
                "provider": config.provider,
                "model": config.model,
                "embedding_model": args.embedding_model,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    _require_all_pass(results)


def _require_all_pass(results: list[dict[str, object]]) -> None:
    if any(result.get("status") != "PASS" for result in results):
        raise SystemExit("Phase 7F live RAG acceptance failed")


def _sources_satisfy_scenario(
    sources: tuple[str, ...],
    allowed_sources: set[str],
    *,
    must_be_insufficient: bool,
) -> bool:
    if not set(sources) <= allowed_sources:
        return False
    return not sources if must_be_insufficient else bool(sources)


def _acceptance_contract_failures(
    *,
    language: str,
    insufficient_information: bool,
    sources: tuple[str, ...],
    allowed_sources: set[str],
    must_be_insufficient: bool,
) -> tuple[str, ...]:
    failures = []
    if language != "id":
        failures.append("language must be id")
    if insufficient_information != must_be_insufficient:
        failures.append(
            "insufficient_information must be "
            + str(must_be_insufficient).lower()
        )
    unknown_sources = sorted(set(sources) - allowed_sources)
    if unknown_sources:
        failures.append("sources contain IDs outside the supplied evidence")
    if must_be_insufficient and sources:
        failures.append("sources must be empty for insufficient information")
    if not must_be_insufficient and not sources:
        failures.append("grounded factual retrieval must cite evidence")
    return tuple(failures)


if __name__ == "__main__":
    main()
