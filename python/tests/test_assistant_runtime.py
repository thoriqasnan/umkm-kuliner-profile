from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from sari_rasa_data.ai_contracts import PHASE8_ASSISTANT_RUNTIME_PROFILE
from sari_rasa_data.assistant_runtime import (
    CANONICAL_APPLICATION_DB_PATH,
    DEFAULT_PHASE8_E5_INDEX_PATH,
    PHASE7_VECTOR_DB_PATH,
    AssistantRetrievalResult,
    AssistantRuntimeError,
    AssistantRuntimeManager,
    canonicalize_catalog,
    catalog_fingerprints,
)
from sari_rasa_data.embedding_contracts import (
    EmbeddingModelLoadError,
    EmbeddingRequest,
    EmbeddingVector,
)
from sari_rasa_data.embedding_profiles import E5_MODEL_ID, E5_PROFILE_ID
from sari_rasa_data.embeddings import CATALOG_TEXT_VERSION, CATALOG_TEXT_VERSION_V2
from sari_rasa_data.hybrid_retrieval import HYBRID_RETRIEVAL_POLICY
from sari_rasa_data.vector_contracts import (
    VectorSpace, VectorStoreCorruptionError, VectorStoreStorageError,
)
from sari_rasa_data.vector_store import (
    DEFAULT_VECTOR_DB_PATH, SQLiteVectorStore, _raise_sqlite_store_error,
)


def item(product_id=1, **changes):
    values = {
        "product_id": product_id,
        "slug": f"item-{product_id}",
        "name": f"Item {product_id}",
        "category": "minuman" if product_id == 1 else "makanan",
        "price_rupiah": product_id * 1000,
        "description_id": "Minuman segar" if product_id == 1 else "Makanan hangat",
        "description_en": "Refreshing drink" if product_id == 1 else "Warm food",
    }
    values.update(changes)
    return values


class FakeE5Client:
    def __init__(self, *, dimensions=4, fail_load=False, inconsistent=False):
        self.dimensions = dimensions
        self.fail_load = fail_load
        self.inconsistent = inconsistent
        self.requests = []

    def embed(self, request):
        assert isinstance(request, EmbeddingRequest)
        self.requests.append(request)
        if self.fail_load:
            raise EmbeddingModelLoadError("private cache path must not escape")
        dimensions = self.dimensions + (1 if self.inconsistent and len(self.requests) > 1 else 0)
        digest = sha256(request.semantic_text.encode()).digest()
        vector = tuple(float(digest[index] + 1) for index in range(dimensions))
        return EmbeddingVector("sentence-transformers", E5_MODEL_ID, dimensions, vector)


def manager(tmp_path, client=None, **kwargs):
    selected = client or FakeE5Client()
    return AssistantRuntimeManager(
        tmp_path / "phase8-e5.db", embedding_client_factory=lambda: selected, **kwargs
    ), selected


def test_fingerprint_is_order_independent_deterministic_and_normalized():
    first = [item(2), item(1, name="  Item 1  ")]
    second = [item(1), item(2)]
    assert catalog_fingerprints(first) == catalog_fingerprints(second)
    assert catalog_fingerprints(first) == catalog_fingerprints(first)
    assert canonicalize_catalog(first)[0].name == "Item 1"


def test_fingerprint_fields_and_price_only_rule():
    base = catalog_fingerprints([item()])
    for field, value in (
        ("name", "Renamed"), ("category", "makanan"),
        ("description_id", "Berubah"), ("description_en", "Changed"),
    ):
        changed = catalog_fingerprints([item(**{field: value})])
        assert changed.semantic != base.semantic
        assert changed.canonical != base.canonical
    price = catalog_fingerprints([item(price_rupiah=9000)])
    assert price.canonical != base.canonical
    assert price.semantic == base.semantic


def test_phase8_runtime_profile_and_separate_path_do_not_change_phase7_defaults(tmp_path):
    profile = PHASE8_ASSISTANT_RUNTIME_PROFILE
    assert (profile.embedding_model, profile.embedding_profile) == (E5_MODEL_ID, E5_PROFILE_ID)
    assert profile.semantic_text_version == CATALOG_TEXT_VERSION_V2
    assert profile.retrieval_policy == HYBRID_RETRIEVAL_POLICY
    assert CATALOG_TEXT_VERSION != CATALOG_TEXT_VERSION_V2
    repository_root = Path(__file__).resolve().parents[2]
    assert DEFAULT_PHASE8_E5_INDEX_PATH == repository_root / "python/data/sari_rasa_phase8_e5_vectors.db"
    assert DEFAULT_PHASE8_E5_INDEX_PATH.is_absolute()
    assert PHASE7_VECTOR_DB_PATH == repository_root / DEFAULT_VECTOR_DB_PATH
    with pytest.raises(ValueError):
        AssistantRuntimeManager(PHASE7_VECTOR_DB_PATH)


@pytest.mark.parametrize("cwd_kind", ["repository", "python", "unrelated"])
def test_default_phase8_index_path_is_cwd_independent(monkeypatch, tmp_path, cwd_kind):
    repository_root = Path(__file__).resolve().parents[2]
    cwd = {
        "repository": repository_root,
        "python": repository_root / "python",
        "unrelated": tmp_path,
    }[cwd_kind]
    monkeypatch.chdir(cwd)
    runtime = AssistantRuntimeManager(embedding_client_factory=lambda: FakeE5Client())
    assert runtime.index_path == repository_root / "python/data/sari_rasa_phase8_e5_vectors.db"
    assert runtime.index_path.is_absolute()


def test_lazy_build_bilingual_reuse_and_readiness(tmp_path):
    runtime, client = manager(tmp_path)
    assert client.requests == [] and not runtime.index_path.exists()
    assert runtime.readiness().status == "not_ready"
    built = runtime.synchronize([item(2), item(1)])
    assert built.mode == "built" and built.summary.new == 4
    assert built.vector_space.embedding_profile == E5_PROFILE_ID
    assert built.vector_space.text_version == CATALOG_TEXT_VERSION_V2
    assert len(client.requests) == 4
    assert all(request.semantic_text.startswith("passage: ") for request in client.requests)
    assert {row.language for row in runtime._store.metadata_manifest()} == {"id", "en"}
    reused = runtime.synchronize([item(1), item(2)])
    assert reused.mode == "reused" and reused.summary.reused == 4
    assert len(client.requests) == 4
    assert runtime.readiness().model_dump() == {
        "status": "ready", "profile_id": "phase-8.customer-menu-e5-v1", "reasons": (),
        "provider_configuration": "unconfigured", "provider_probe": "not_performed",
    }


def test_new_changed_deleted_catalog_full_sync_and_prune(tmp_path):
    runtime, client = manager(tmp_path)
    runtime.synchronize([item(1), item(2)])
    initial_calls = len(client.requests)
    changed = runtime.synchronize([item(1, description_id="Sangat segar"), item(2)])
    assert changed.mode == "synchronized" and changed.summary.replaced >= 1
    assert len(client.requests) == initial_calls + 4
    added = runtime.synchronize([item(1, description_id="Sangat segar"), item(2), item(3)])
    assert added.summary.new == 2
    assert len(runtime._store.metadata_manifest()) == 6
    deleted = runtime.synchronize([item(1, description_id="Sangat segar")])
    assert deleted.summary.pruned == 4
    assert {(row.product_id, row.language) for row in runtime._store.metadata_manifest()} == {(1, "id"), (1, "en")}


def test_price_only_sync_does_not_embed_and_retrieval_uses_fresh_canonical_price(tmp_path):
    runtime, client = manager(tmp_path)
    runtime.synchronize([item(1), item(2)])
    calls = len(client.requests)
    updated = runtime.synchronize([item(1, price_rupiah=99000), item(2)])
    assert updated.mode == "metadata_updated" and updated.summary.metadata_updated == 2
    assert len(client.requests) == calls
    result = runtime.retrieve("minuman segar", language="id", max_results=2)
    product = next(row for row in result if row.product_id == 1)
    assert product.price_rupiah == 99000
    assert len(client.requests) == calls + 1


def test_retrieval_uses_single_e5_query_prefix_hybrid_bound_and_no_vectors(tmp_path):
    runtime, client = manager(tmp_path)
    runtime.synchronize([item(1), item(2), item(3), item(4), item(5), item(6)])
    results = runtime.retrieve("refreshing drink", language="en")
    assert 1 <= len(results) <= 5
    assert client.requests[-1].semantic_text == "query: refreshing drink"
    assert all(isinstance(row, AssistantRetrievalResult) and not hasattr(row, "vector") for row in results)
    assert results[0].product_id == 1
    with pytest.raises(ValueError):
        runtime.retrieve("menu", language="en", max_results=6)


def test_retrieval_fails_closed_if_catalog_snapshot_changed(tmp_path):
    runtime, _ = manager(tmp_path)
    synchronized = runtime.synchronize([item(1), item(2)])
    runtime.synchronize([item(1, description_id="changed"), item(2)])
    with pytest.raises(AssistantRuntimeError):
        runtime.retrieve(
            "minuman", language="id",
            expected_catalog_fingerprint=synchronized.catalog_fingerprint,
        )


def test_concurrent_first_load_and_same_catalog_sync_are_serialized(tmp_path):
    runtime, client = manager(tmp_path)
    catalog = [item(1), item(2)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        first = list(pool.map(lambda _: runtime.synchronize(catalog), range(8)))
    assert sum(result.mode == "built" for result in first) == 1
    assert all(result.vector_space == first[0].vector_space for result in first)
    assert len(client.requests) == 4
    with ThreadPoolExecutor(max_workers=8) as pool:
        second = list(pool.map(lambda _: runtime.synchronize(catalog), range(8)))
    assert all(result.mode == "reused" for result in second)
    assert len(client.requests) == 4


def test_unavailable_model_is_sanitized_not_ready_and_has_no_fallback(tmp_path):
    runtime, client = manager(tmp_path, FakeE5Client(fail_load=True))
    with pytest.raises(AssistantRuntimeError) as caught:
        runtime.synchronize([item()])
    assert str(caught.value) == "customer assistant runtime unavailable"
    assert caught.value.readiness_reason == "embedding_prerequisite_unavailable"
    readiness = runtime.readiness().model_dump()
    assert readiness["status"] == "not_ready"
    assert "embedding_prerequisite_unavailable" in readiness["reasons"]
    assert not any(token in str(readiness) for token in ("private", "cache", "/"))
    assert all(E5_MODEL_ID not in request.semantic_text for request in client.requests)


def test_dimension_mismatch_and_incompatible_generated_index_recovers_once(tmp_path):
    runtime, _ = manager(tmp_path, FakeE5Client(inconsistent=True))
    with pytest.raises(AssistantRuntimeError):
        runtime.synchronize([item()])
    assert runtime.readiness().status == "not_ready"

    path = tmp_path / "incompatible.db"
    SQLiteVectorStore(path, VectorSpace("fake", "other", 4, "none", "v1", "other-profile"))
    incompatible = AssistantRuntimeManager(path, embedding_client_factory=lambda: FakeE5Client())
    result = incompatible.synchronize([item()])
    assert result.mode == "built" and result.summary.new == 2
    incompatible._store.validate_integrity()


def test_recovery_never_targets_canonical_or_phase7_database(tmp_path):
    with pytest.raises(ValueError):
        AssistantRuntimeManager(CANONICAL_APPLICATION_DB_PATH)
    with pytest.raises(ValueError):
        AssistantRuntimeManager(PHASE7_VECTOR_DB_PATH)
    canonical = tmp_path / "canonical.db"
    canonical.write_bytes(b"canonical-unchanged")
    alias = tmp_path / "alias.db"
    alias.hardlink_to(canonical)
    monkey_target = AssistantRuntimeManager(tmp_path / "generated.db", embedding_client_factory=lambda: FakeE5Client())
    monkey_target._index_path = alias
    monkey_target._same_path = lambda first, second: first == alias
    assert monkey_target._recover_generated_index() is False
    assert canonical.read_bytes() == b"canonical-unchanged"


def test_known_corruption_has_one_bounded_recovery_and_later_request_succeeds(tmp_path):
    runtime, client = manager(tmp_path)
    runtime.synchronize([item()])
    with sqlite3.connect(runtime.index_path) as connection:
        connection.execute("UPDATE product_embeddings SET vector = ?", (b"bad",))
    recoveries = 0
    original = runtime._recover_generated_index
    def counted_recovery():
        nonlocal recoveries
        recoveries += 1
        return original()
    runtime._recover_generated_index = counted_recovery
    recovered = runtime.synchronize([item()])
    assert recoveries == 1 and recovered.mode == "built"
    runtime._store.validate_integrity()
    assert runtime.retrieve("segar", language="id")
    assert len(client.requests) == 5


@pytest.mark.parametrize("mutation", ["content_hash", "metadata", "missing", "space_key"])
def test_reuse_requires_exact_canonical_manifest_before_activation(tmp_path, mutation):
    runtime, _ = manager(tmp_path)
    runtime.synchronize([item()])
    with sqlite3.connect(runtime.index_path) as connection:
        if mutation == "content_hash":
            connection.execute("UPDATE product_embeddings SET content_hash = ?", ("0" * 64,))
        elif mutation == "metadata":
            connection.execute("UPDATE product_embeddings SET price_rupiah = 999999")
        elif mutation == "missing":
            connection.execute("DELETE FROM product_embeddings WHERE language = 'en'")
        else:
            connection.execute("PRAGMA foreign_keys = OFF")
            connection.execute("UPDATE product_embeddings SET space_key = ?", ("wrong-space",))
    recovered = runtime.synchronize([item()])
    assert recovered.mode == "built"
    assert len(runtime._store.metadata_manifest()) == 2


def test_failed_recovery_and_unknown_failure_remain_fail_closed(tmp_path):
    class AlwaysCorruptStore:
        def __init__(self, *_args):
            raise VectorStoreCorruptionError("generated index corrupt")
    attempts = []
    runtime, _ = manager(tmp_path, store_factory=AlwaysCorruptStore)
    runtime._recover_generated_index = lambda: attempts.append(True) or True
    with pytest.raises(AssistantRuntimeError):
        runtime.synchronize([item()])
    assert attempts == [True]

    class UnknownStore:
        def __init__(self, *_args):
            raise PermissionError("storage unavailable")
    attempts.clear()
    unknown, _ = manager(tmp_path / "unknown", store_factory=UnknownStore)
    unknown._recover_generated_index = lambda: attempts.append(True) or True
    with pytest.raises(AssistantRuntimeError):
        unknown.synchronize([item()])
    assert attempts == []


def test_transient_sqlite_storage_failure_never_triggers_recovery(tmp_path):
    with pytest.raises(VectorStoreStorageError):
        _raise_sqlite_store_error(
            "vector database unavailable", sqlite3.OperationalError("database is locked")
        )

    class LockedStore:
        def __init__(self, *_args):
            raise VectorStoreStorageError("vector database unavailable")
    runtime, _ = manager(tmp_path, store_factory=LockedStore)
    attempts = []
    runtime._recover_generated_index = lambda: attempts.append(True) or True
    with pytest.raises(AssistantRuntimeError):
        runtime.synchronize([item()])
    assert attempts == []


def test_concurrent_corruption_recovery_is_single_and_provider_free(tmp_path):
    runtime, client = manager(tmp_path)
    runtime.synchronize([item()])
    with sqlite3.connect(runtime.index_path) as connection:
        connection.execute("UPDATE product_embeddings SET vector = ?", (b"bad",))
    recoveries = 0
    original = runtime._recover_generated_index
    def counted_recovery():
        nonlocal recoveries
        recoveries += 1
        return original()
    runtime._recover_generated_index = counted_recovery
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: runtime.synchronize([item()]), range(4)))
    assert recoveries == 1
    assert sum(result.mode == "built" for result in results) == 1
    assert all(result.vector_space == results[0].vector_space for result in results)
    assert len(client.requests) == 4


def test_corruption_and_failed_sync_disable_stale_runtime(tmp_path):
    runtime, _ = manager(tmp_path)
    runtime.synchronize([item()])
    with sqlite3.connect(runtime.index_path) as connection:
        connection.execute("UPDATE product_embeddings SET vector = ?", (b"bad",))
    with pytest.raises(AssistantRuntimeError):
        runtime.retrieve("segar", language="id")
    assert runtime.readiness().status == "not_ready"
    assert "index_prerequisite_unavailable" in runtime.readiness().reasons
    with pytest.raises(AssistantRuntimeError):
        runtime.retrieve("segar", language="id")


def test_known_sync_corruption_recovers_without_serving_previous_catalog(tmp_path):
    class FailingStore(SQLiteVectorStore):
        fail = False

        def sync(self, records, *, prune=False):
            if self.fail:
                raise VectorStoreCorruptionError("private partial failure")
            result = super().sync(records, prune=prune)
            self.fail = True
            return result

    runtime, _ = manager(tmp_path, store_factory=FailingStore)
    runtime.synchronize([item()])
    recovered = runtime.synchronize([item(description_id="changed")])
    assert recovered.mode == "built"
    assert runtime.readiness().status == "ready"
    assert runtime.retrieve("changed", language="en")


def test_malformed_catalog_is_rejected_before_model_or_index(tmp_path):
    runtime, client = manager(tmp_path)
    for catalog in (
        [item(secret="bad")], [item(), item()], [item(description_en=" ")], [],
    ):
        with pytest.raises(ValueError):
            runtime.synchronize(catalog)
    assert client.requests == [] and not runtime.index_path.exists()


def test_import_does_not_load_sentence_transformers_or_change_default_index(tmp_path):
    source_root = Path(__file__).resolve().parents[1] / "src"
    index = DEFAULT_PHASE8_E5_INDEX_PATH
    probe = """
import hashlib
import pathlib
import sys
from sari_rasa_data.assistant_runtime import DEFAULT_PHASE8_E5_INDEX_PATH
path = DEFAULT_PHASE8_E5_INDEX_PATH
def state():
    return (path.exists(), hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns) if path.exists() else (False, None, None)
before = state()
print('sentence_transformers' in sys.modules)
print(before == state())
"""
    completed = subprocess.run(
        [sys.executable, "-c", probe], cwd=tmp_path,
        env={"PYTHONPATH": str(source_root)}, capture_output=True, text=True, check=False,
    )
    assert completed.returncode == 0, completed.stderr
    assert completed.stdout == "False\nTrue\n"
