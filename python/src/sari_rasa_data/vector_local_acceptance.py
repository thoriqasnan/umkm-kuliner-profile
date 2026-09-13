"""Explicit local Phase 7E real embedding/store/search acceptance."""

import argparse
import math
from tempfile import TemporaryDirectory

from .embedding_contracts import EmbeddingRequest
from .embedding_sentence_transformers import SentenceTransformerEmbeddingClient
from .embeddings import embed_catalog
from .menu_prompts import PublicMenuItem
from .vector_contracts import VectorRecord, VectorSearchRequest, VectorSpace
from .vector_store import SQLiteVectorStore


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="Cached local model name or directory")
    args = parser.parse_args()
    catalog = (
        PublicMenuItem(
            7501, "soto-rempah-uji", "Soto Rempah Uji", "makanan", 18000,
            "Sup ayam fiktif dengan rempah hangat.",
            "Fictional chicken soup with warming spices.",
        ),
        PublicMenuItem(
            7502, "es-jeruk-uji", "Es Jeruk Uji", "minuman", 9000,
            "Minuman jeruk fiktif yang dingin.",
            "A fictional chilled orange drink.",
        ),
    )
    client = SentenceTransformerEmbeddingClient(args.model, local_files_only=True)
    embeddings = embed_catalog(catalog, ("id", "en"), client)
    space = VectorSpace.from_embedding(embeddings[0])
    metadata = {item.product_id: item for item in catalog}
    records = tuple(
        VectorRecord(
            record,
            metadata[record.product_id].category,
            metadata[record.product_id].price_rupiah,
        )
        for record in embeddings
    )
    with TemporaryDirectory(prefix="sari-rasa-7e-") as directory:
        store = SQLiteVectorStore(f"{directory}/vectors.db", space)
        summary = store.sync(records, prune=True)
        searches = []
        repeated_searches = []
        for language, text in (
            ("id", "sup ayam dengan rempah"),
            ("en", "chicken soup with spices"),
        ):
            query = client.embed(EmbeddingRequest(text, language))
            request = VectorSearchRequest(
                space, query.vector, language=language, top_k=1
            )
            searches.append(store.search(request))
            repeated_searches.append(store.search(request))
        round_trip = store.search(
            VectorSearchRequest(
                space,
                embeddings[0].vector,
                language=embeddings[0].language,
                top_k=1,
            )
        )
        passed = (
            len(records) == 4
            and space.dimensions == 384
            and summary.new == 4
            and all(len(results) == 1 for results in searches)
            and all(math.isfinite(results[0].score) for results in searches)
            and searches == repeated_searches
            and len(round_trip) == 1
            and round_trip[0].product_id == embeddings[0].product_id
            and round_trip[0].language == embeddings[0].language
        )
    if not passed:
        raise SystemExit("Phase 7E local vector acceptance failed")
    print("phase_7e_local_vector_store: PASS")
    print(f"provider: {space.provider}")
    print(f"model: {space.model}")
    print(f"dimensions: {space.dimensions}")
    print("languages: id,en")
    print("stored_records: 4")
    print(
        "top_product_ids: "
        + ",".join(str(results[0].product_id) for results in searches)
    )


if __name__ == "__main__":
    main()
