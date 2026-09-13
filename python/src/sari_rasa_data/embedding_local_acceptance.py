"""Offline-only Phase 7D real local-model smoke acceptance."""

import argparse
import math

from .embedding_sentence_transformers import SentenceTransformerEmbeddingClient
from .embeddings import embed_catalog
from .menu_prompts import PublicMenuItem


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="Local model name or directory")
    args = parser.parse_args()
    catalog = (PublicMenuItem(
        7001, "soto-ayam-uji", "Soto Ayam Uji", "makanan", 0,
        "Sup ayam hangat dengan rempah.", "Warm chicken soup with spices.",
    ),)
    records = embed_catalog(
        catalog, ("id", "en"),
        SentenceTransformerEmbeddingClient(args.model, local_files_only=True),
    )
    dimensions = {record.dimensions for record in records}
    passed = (
        len(records) == 2
        and {record.language for record in records} == {"id", "en"}
        and len(dimensions) == 1
        and all(math.isfinite(value) for record in records for value in record.vector)
    )
    if not passed:
        raise SystemExit("Phase 7D local embedding acceptance failed")
    print("phase_7d_local_embedding: PASS")
    print(f"provider: {records[0].provider}")
    print(f"model: {records[0].model}")
    print(f"languages: {','.join(record.language for record in records)}")
    print(f"dimensions: {records[0].dimensions}")


if __name__ == "__main__":
    main()
