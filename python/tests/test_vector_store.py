from dataclasses import replace
import importlib
import math
import sqlite3
import sys

import numpy as np
import pytest

from sari_rasa_data.embedding_contracts import ProductEmbeddingRecord
from sari_rasa_data.vector_contracts import (
    VectorRecord,
    VectorSearchRequest,
    VectorSpace,
    VectorStoreCorruptionError,
    VectorStoreIncompatibleSpaceError,
    VectorStoreInvalidInputError,
)
from sari_rasa_data.vector_store import SQLiteVectorStore, decode_vector, encode_vector


def embedding(product_id=1, language="id", vector=(1.0, 0.0), **changes):
    values = dict(
        product_id=product_id,
        slug=f"item-{product_id}",
        language=language,
        text_version="7d-catalog-text-v1",
        semantic_text=f"name: Item {product_id}\ncategory: Food\ndescription: Good",
        content_hash=(f"{product_id:064x}"[-64:]),
        provider="fake",
        model="deterministic",
        dimensions=len(vector),
        vector=vector,
    )
    values.update(changes)
    return ProductEmbeddingRecord(**values)


def record(product_id=1, language="id", vector=(1.0, 0.0), **changes):
    category = changes.pop("category", "Food")
    price = changes.pop("price_rupiah", 1000)
    return VectorRecord(
        embedding(product_id, language, vector, **changes), category, price
    )


def vector_space(dimensions=2, **changes):
    values = dict(
        provider="fake",
        model="deterministic",
        dimensions=dimensions,
        normalization="none",
        text_version="7d-catalog-text-v1",
    )
    values.update(changes)
    return VectorSpace(**values)


def test_float32_little_endian_round_trip_and_deterministic_bytes():
    vector = (1.25, -2.5, 3.75)
    first = encode_vector(vector, 3)
    assert first == encode_vector(vector, 3)
    assert first == np.asarray(vector, dtype="<f4").tobytes()
    assert decode_vector(first, 3) == vector


@pytest.mark.parametrize(
    "vector,dimensions",
    [
        ((), 0),
        ((1.0,), 2),
        ((float("nan"),), 1),
        ((float("inf"),), 1),
        ((0.0, 0.0), 2),
    ],
)
def test_encode_rejects_invalid_vectors(vector, dimensions):
    with pytest.raises(VectorStoreInvalidInputError):
        encode_vector(vector, dimensions)


def test_decode_rejects_wrong_byte_length_nonfinite_and_zero_norm():
    with pytest.raises(VectorStoreCorruptionError, match="byte length"):
        decode_vector(b"bad", 2)
    with pytest.raises(VectorStoreCorruptionError):
        decode_vector(np.asarray([float("nan")], dtype="<f4").tobytes(), 1)
    with pytest.raises(VectorStoreCorruptionError, match="norm"):
        decode_vector(np.asarray([0.0, 0.0], dtype="<f4").tobytes(), 2)


def test_schema_insert_search_and_compatible_reopen(tmp_path):
    path = tmp_path / "vectors.db"
    store = SQLiteVectorStore(path, vector_space())
    assert store.sync([record()]).new == 1
    reopened = SQLiteVectorStore(path, vector_space())
    result = reopened.search(
        VectorSearchRequest(vector_space(), (1.0, 0.0), language="id", top_k=1)
    )
    assert [(item.product_id, item.slug) for item in result] == [(1, "item-1")]
    with sqlite3.connect(path) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
    assert {"vector_space", "product_embeddings"} <= tables


@pytest.mark.parametrize(
    "changes",
    [
        {"provider": "other"},
        {"model": "other"},
        {"dimensions": 3},
        {"text_version": "v2"},
        {"embedding_profile": "7h-embedding-profile-e5-v1"},
    ],
)
def test_incompatible_space_cannot_reopen_database(tmp_path, changes):
    path = tmp_path / "vectors.db"
    SQLiteVectorStore(path, vector_space())
    with pytest.raises(VectorStoreIncompatibleSpaceError):
        SQLiteVectorStore(path, vector_space(**changes))


def test_sync_new_reuse_replace_metadata_update_and_no_rewrite(tmp_path):
    path = tmp_path / "vectors.db"
    store = SQLiteVectorStore(path, vector_space())
    original = record()
    assert store.sync([original]).new == 1
    with sqlite3.connect(path) as connection:
        original_blob = connection.execute(
            "SELECT vector FROM product_embeddings"
        ).fetchone()[0]
    same_hash_different_vector = VectorRecord(
        replace(original.embedding, vector=(0.0, 1.0)), "Food", 1000
    )
    assert store.sync([same_hash_different_vector]).reused == 1
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT vector FROM product_embeddings").fetchone()[0] == original_blob

    metadata = VectorRecord(replace(original.embedding, slug="renamed"), "Food", 2000)
    assert store.sync([metadata]).metadata_updated == 1
    changed = VectorRecord(
        replace(
            original.embedding,
            slug="renamed",
            content_hash="f" * 64,
            vector=(0.0, 1.0),
        ),
        "Drink",
        2000,
    )
    assert store.sync([changed]).replaced == 1
    result = store.search(VectorSearchRequest(vector_space(), (0.0, 1.0), top_k=1))[0]
    assert (result.slug, result.category, result.price_rupiah, result.score) == (
        "renamed", "Drink", 2000, 1.0
    )


def test_category_change_without_hash_change_rolls_back_transaction(tmp_path):
    store = SQLiteVectorStore(tmp_path / "vectors.db", vector_space())
    good = record(1)
    bad = record(2, category="Drink")
    store.sync([bad])
    with pytest.raises(VectorStoreInvalidInputError, match="category"):
        store.sync([good, replace(bad, category="Changed")])
    results = store.search(VectorSearchRequest(vector_space(), (1.0, 0.0), top_k=10))
    assert [item.product_id for item in results] == [2]


def test_prune_is_explicit_deterministic_and_bilingual_is_independent(tmp_path):
    store = SQLiteVectorStore(tmp_path / "vectors.db", vector_space())
    records = [record(2, "en"), record(1, "id"), record(1, "en")]
    assert store.sync(records).new == 3
    assert store.sync([records[1]], prune=False).pruned == 0
    summary = store.sync([records[1]], prune=True)
    assert summary.reused == 1 and summary.pruned == 2
    assert store.search(VectorSearchRequest(vector_space(), (1.0, 0.0), top_k=10))[0].language == "id"


def test_exact_cosine_ranking_filters_top_k_and_ties(tmp_path):
    store = SQLiteVectorStore(tmp_path / "vectors.db", vector_space())
    store.sync(
        [
            record(3, "en", (1.0, 0.0), category="Food"),
            record(2, "id", (0.8, 0.2), category="Drink"),
            record(1, "id", (1.0, 0.0), category="Food"),
        ]
    )
    request = VectorSearchRequest(vector_space(), (1.0, 0.0), top_k=2)
    results = store.search(request)
    assert [item.product_id for item in results] == [1, 3]
    assert all(math.isfinite(item.score) for item in results)
    assert [item.product_id for item in store.search(replace(request, language="id"))] == [1, 2]
    assert [item.product_id for item in store.search(replace(request, category="Drink"))] == [2]


def test_search_rejects_zero_norm_dimensions_and_incompatible_space(tmp_path):
    store = SQLiteVectorStore(tmp_path / "vectors.db", vector_space())
    with pytest.raises(VectorStoreInvalidInputError, match="norm"):
        store.search(VectorSearchRequest(vector_space(), (0.0, 0.0)))
    with pytest.raises(VectorStoreIncompatibleSpaceError):
        store.search(
            VectorSearchRequest(vector_space(model="other"), (1.0, 0.0))
        )


def test_corrupt_blob_and_database_metadata_fail_closed(tmp_path):
    path = tmp_path / "vectors.db"
    store = SQLiteVectorStore(path, vector_space())
    store.sync([record()])
    with sqlite3.connect(path) as connection:
        connection.execute("UPDATE product_embeddings SET vector = ?", (b"bad",))
    with pytest.raises(VectorStoreCorruptionError, match="byte length"):
        store.search(VectorSearchRequest(vector_space(), (1.0, 0.0)))
    with sqlite3.connect(path) as connection:
        connection.execute("UPDATE vector_space SET model = 'corrupt'")
    with pytest.raises(VectorStoreIncompatibleSpaceError):
        SQLiteVectorStore(path, vector_space())


def test_corrupt_retrieval_metadata_fails_closed(tmp_path):
    path = tmp_path / "vectors.db"
    store = SQLiteVectorStore(path, vector_space())
    store.sync([record()])
    with sqlite3.connect(path) as connection:
        connection.execute("UPDATE product_embeddings SET slug = ''")
    with pytest.raises(VectorStoreCorruptionError, match="slug"):
        store.search(VectorSearchRequest(vector_space(), (1.0, 0.0)))


def test_duplicate_sync_identity_and_incompatible_record_rejected(tmp_path):
    store = SQLiteVectorStore(tmp_path / "vectors.db", vector_space())
    with pytest.raises(VectorStoreInvalidInputError, match="unique"):
        store.sync([record(), record()])
    with pytest.raises(VectorStoreIncompatibleSpaceError):
        store.sync([record(model="other")])
    with pytest.raises(VectorStoreIncompatibleSpaceError):
        store.sync([record(embedding_profile="7h-embedding-profile-e5-v1")])


def test_import_has_no_model_network_or_llm_dependency():
    for name in ("sentence_transformers", "sari_rasa_data.llm_gemini"):
        sys.modules.pop(name, None)
    module = importlib.reload(importlib.import_module("sari_rasa_data.vector_store"))
    assert module.SQLiteVectorStore
    assert "sentence_transformers" not in sys.modules
    assert "sari_rasa_data.llm_gemini" not in sys.modules
