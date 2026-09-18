"""Lazy Phase 8 E5/V2/hybrid index lifecycle and retrieval dependency."""

from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path
from threading import RLock
from typing import Callable, Iterable, Literal

from pydantic import ValidationError

from .ai_contracts import (
    PHASE8_ASSISTANT_RUNTIME_PROFILE,
    AiReadiness,
    PublicCatalogItem,
    build_ai_readiness,
    validate_runtime_dimensions,
)
from .embedding_contracts import (
    EmbeddingClient,
    EmbeddingError,
    EmbeddingModelLoadError,
    EmbeddingRequest,
)
from .embedding_sentence_transformers import SentenceTransformerEmbeddingClient
from .embedding_profiles import E5_PROFILE
from .embeddings import embed_catalog, project_catalog_semantic_text, semantic_content_hash
from .hybrid_retrieval import (
    FINAL_RESULT_COUNT,
    HYBRID_CANDIDATE_COUNT,
    HybridRetrievalError,
    rerank_hybrid,
)
from .menu_prompts import PublicMenuItem
from .vector_contracts import (
    VectorMetadataRecord,
    VectorRecord,
    VectorSearchRequest,
    VectorSpace,
    VectorStoreError,
    VectorStoreCorruptionError,
    VectorStoreIncompatibleSpaceError,
    VectorSyncSummary,
)
from .vector_store import DEFAULT_VECTOR_DB_PATH, SQLiteVectorStore


PYTHON_ROOT = Path(__file__).resolve().parents[2]
REPOSITORY_ROOT = PYTHON_ROOT.parent
DEFAULT_PHASE8_E5_INDEX_PATH = PYTHON_ROOT / "data/sari_rasa_phase8_e5_vectors.db"
PHASE7_VECTOR_DB_PATH = REPOSITORY_ROOT / DEFAULT_VECTOR_DB_PATH
CANONICAL_APPLICATION_DB_PATH = REPOSITORY_ROOT / "data/umkm.db"


class AssistantRuntimeError(Exception):
    """Sanitized Phase 8 runtime failure."""

    def __init__(self, readiness_reason: str):
        super().__init__("customer assistant runtime unavailable")
        self.readiness_reason = readiness_reason


@dataclass(frozen=True)
class CatalogFingerprints:
    canonical: str
    semantic: str


@dataclass(frozen=True)
class RuntimeSyncResult:
    catalog_fingerprint: str
    semantic_fingerprint: str
    vector_space: VectorSpace
    summary: VectorSyncSummary
    mode: Literal["built", "reused", "metadata_updated", "synchronized"]


@dataclass(frozen=True)
class AssistantRetrievalResult:
    product_id: int
    slug: str
    language: Literal["id", "en"]
    score: float
    category: str
    price_rupiah: int


def canonicalize_catalog(
    catalog: Iterable[PublicCatalogItem | dict],
) -> tuple[PublicCatalogItem, ...]:
    try:
        values = tuple(
            item if isinstance(item, PublicCatalogItem) else PublicCatalogItem.model_validate(item)
            for item in catalog
        )
    except (TypeError, ValidationError):
        raise ValueError("canonical public catalog is invalid") from None
    if not values:
        raise ValueError("canonical public catalog is invalid")
    ordered = tuple(sorted(values, key=lambda item: (item.product_id, item.slug)))
    if len({item.product_id for item in ordered}) != len(ordered) or len({item.slug for item in ordered}) != len(ordered):
        raise ValueError("canonical public catalog identities must be unique")
    return ordered


def catalog_fingerprints(catalog: Iterable[PublicCatalogItem | dict]) -> CatalogFingerprints:
    """Hash normalized allowlisted snapshots; price is canonical but non-semantic."""
    values = canonicalize_catalog(catalog)
    canonical_rows = [item.model_dump() for item in values]
    semantic_rows = [
        {
            "product_id": item.product_id,
            "name": item.name,
            "category": item.category,
            "description_id": item.description_id,
            "description_en": item.description_en,
        }
        for item in values
    ]

    def digest(rows) -> str:
        payload = json.dumps(rows, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return sha256(payload.encode("utf-8")).hexdigest()

    semantic_identity = {
        "embedding_model": PHASE8_ASSISTANT_RUNTIME_PROFILE.embedding_model,
        "embedding_profile": PHASE8_ASSISTANT_RUNTIME_PROFILE.embedding_profile,
        "semantic_text_version": PHASE8_ASSISTANT_RUNTIME_PROFILE.semantic_text_version,
        "retrieval_policy": PHASE8_ASSISTANT_RUNTIME_PROFILE.retrieval_policy,
        "products": semantic_rows,
    }
    return CatalogFingerprints(digest(canonical_rows), digest(semantic_identity))


def _phase7_catalog(catalog: tuple[PublicCatalogItem, ...]) -> tuple[PublicMenuItem, ...]:
    return tuple(
        PublicMenuItem(
            item.product_id, item.slug, item.name, item.category, item.price_rupiah,
            item.description_id, item.description_en,
        )
        for item in catalog
    )


def _metadata(catalog: tuple[PublicMenuItem, ...]) -> tuple[VectorMetadataRecord, ...]:
    profile = PHASE8_ASSISTANT_RUNTIME_PROFILE
    records = []
    for item in catalog:
        for language in ("id", "en"):
            text = project_catalog_semantic_text(item, language, profile.semantic_text_version)
            records.append(VectorMetadataRecord(
                item.product_id, item.slug, language,
                semantic_content_hash(text, language, profile.semantic_text_version),
                item.category, item.price_rupiah,
            ))
    return tuple(records)


class AssistantRuntimeManager:
    """Single-process serialized lifecycle for one dedicated Phase 8 index."""

    def __init__(
        self,
        index_path: str | Path = DEFAULT_PHASE8_E5_INDEX_PATH,
        *,
        embedding_client_factory: Callable[[], EmbeddingClient] | None = None,
        store_factory: Callable[[str | Path, VectorSpace], SQLiteVectorStore] = SQLiteVectorStore,
    ) -> None:
        PHASE8_ASSISTANT_RUNTIME_PROFILE.validate()
        if not isinstance(index_path, (str, Path)) or not str(index_path).strip():
            raise ValueError("Phase 8 index path is required")
        self._index_path = Path(index_path)
        protected = (PHASE7_VECTOR_DB_PATH, CANONICAL_APPLICATION_DB_PATH)
        if any(self._same_path(self._index_path, path) for path in protected):
            raise ValueError("Phase 8 E5 index must be separate from protected databases")
        self._client_factory = embedding_client_factory or self._default_client
        self._store_factory = store_factory
        self._lock = RLock()
        self._client: EmbeddingClient | None = None
        self._store: SQLiteVectorStore | None = None
        self._catalog: tuple[PublicMenuItem, ...] = ()
        self._fingerprints: CatalogFingerprints | None = None
        self._readiness_reason = "runtime_prerequisite_unavailable"

    @staticmethod
    def _default_client() -> EmbeddingClient:
        return SentenceTransformerEmbeddingClient(
            PHASE8_ASSISTANT_RUNTIME_PROFILE.embedding_model,
            device="cpu",
            local_files_only=True,
        )

    @property
    def index_path(self) -> Path:
        return self._index_path

    def readiness(self) -> AiReadiness:
        reason = self._readiness_reason
        return build_ai_readiness(
            configuration_valid=reason != "configuration_invalid",
            profile_recognized=reason != "profile_unrecognized",
            embedding_available=reason != "embedding_prerequisite_unavailable",
            index_available=reason != "index_prerequisite_unavailable",
            runtime_available=reason is None,
        )

    def synchronize(
        self, catalog: Iterable[PublicCatalogItem | dict]
    ) -> RuntimeSyncResult:
        canonical = canonicalize_catalog(catalog)
        fingerprints = catalog_fingerprints(canonical)
        phase7_catalog = _phase7_catalog(canonical)
        with self._lock:
            recovery_attempted = False
            if self._store is not None and self._fingerprints == fingerprints:
                try:
                    self._store.validate_integrity()
                    stored_metadata = tuple(sorted(
                        self._store.metadata_manifest(),
                        key=lambda item: (item.product_id, item.language, item.slug),
                    ))
                    expected_metadata = tuple(sorted(
                        _metadata(phase7_catalog),
                        key=lambda item: (item.product_id, item.language, item.slug),
                    ))
                    if stored_metadata != expected_metadata:
                        raise VectorStoreIncompatibleSpaceError(
                            "stored vector metadata does not match the canonical catalog"
                        )
                    count = len(phase7_catalog) * 2
                    return RuntimeSyncResult(
                        fingerprints.canonical, fingerprints.semantic, self._store.vector_space,
                        VectorSyncSummary(reused=count), "reused",
                    )
                except (VectorStoreCorruptionError, VectorStoreIncompatibleSpaceError):
                    self._invalidate("index_prerequisite_unavailable")
                    if not self._recover_generated_index():
                        raise AssistantRuntimeError(self._readiness_reason) from None
                    recovery_attempted = True
            while True:
                try:
                    return self._synchronize_once(phase7_catalog, fingerprints)
                except (VectorStoreCorruptionError, VectorStoreIncompatibleSpaceError):
                    self._invalidate("index_prerequisite_unavailable")
                    if recovery_attempted or not self._recover_generated_index():
                        break
                    recovery_attempted = True
                except EmbeddingModelLoadError:
                    self._invalidate("embedding_prerequisite_unavailable")
                    break
                except EmbeddingError:
                    self._invalidate("embedding_prerequisite_unavailable")
                    break
                except ValueError:
                    self._invalidate("runtime_prerequisite_unavailable")
                    break
                except AssistantRuntimeError as exc:
                    self._invalidate(exc.readiness_reason)
                    break
                except Exception:
                    self._invalidate("runtime_prerequisite_unavailable")
                    break
            raise AssistantRuntimeError(self._readiness_reason) from None

    def _synchronize_once(
        self, phase7_catalog: tuple[PublicMenuItem, ...], fingerprints: CatalogFingerprints
    ) -> RuntimeSyncResult:
        if (
            self._store is not None
            and self._fingerprints is not None
            and self._fingerprints.semantic == fingerprints.semantic
        ):
            summary = self._store.sync_metadata(_metadata(phase7_catalog), prune=True)
            self._store.validate_integrity()
            self._catalog = phase7_catalog
            self._fingerprints = fingerprints
            self._readiness_reason = None
            return RuntimeSyncResult(
                fingerprints.canonical, fingerprints.semantic, self._store.vector_space,
                summary, "metadata_updated",
            )

        client = self._client or self._client_factory()
        records = embed_catalog(
            phase7_catalog, ("id", "en"), client,
            text_version=PHASE8_ASSISTANT_RUNTIME_PROFILE.semantic_text_version,
            profile=E5_PROFILE,
        )
        dimensions = validate_runtime_dimensions(records[0].dimensions)
        if any(record.dimensions != dimensions for record in records):
            raise AssistantRuntimeError("embedding_prerequisite_unavailable")
        space = VectorSpace.from_embedding(records[0])
        store = self._store or self._store_factory(self._index_path, space)
        if store.vector_space != space:
            raise AssistantRuntimeError("index_prerequisite_unavailable")
        by_id = {item.product_id: item for item in phase7_catalog}
        summary = store.sync(
            (
                VectorRecord(
                    record,
                    by_id[record.product_id].category,
                    by_id[record.product_id].price_rupiah,
                )
                for record in records
            ),
            prune=True,
        )
        store.validate_integrity()
        mode = "built" if summary.new else "synchronized"
        self._client = client
        self._store = store
        self._catalog = phase7_catalog
        self._fingerprints = fingerprints
        self._readiness_reason = None
        return RuntimeSyncResult(
            fingerprints.canonical, fingerprints.semantic, space, summary, mode,
        )

    @staticmethod
    def _same_path(first: Path, second: Path) -> bool:
        try:
            if first.exists() and second.exists() and first.samefile(second):
                return True
        except OSError:
            return True
        return first.resolve(strict=False) == second.resolve(strict=False)

    def _recover_generated_index(self) -> bool:
        protected = (PHASE7_VECTOR_DB_PATH, CANONICAL_APPLICATION_DB_PATH)
        if any(self._same_path(self._index_path, path) for path in protected):
            return False
        try:
            for path in (
                self._index_path,
                Path(f"{self._index_path}-wal"),
                Path(f"{self._index_path}-shm"),
            ):
                path.unlink(missing_ok=True)
            return True
        except OSError:
            return False

    def retrieve(
        self, query: str, *, language: Literal["id", "en"], max_results: int = FINAL_RESULT_COUNT,
        expected_catalog_fingerprint: str | None = None,
    ) -> tuple[AssistantRetrievalResult, ...]:
        if not isinstance(query, str) or not query.strip() or language not in ("id", "en"):
            raise ValueError("retrieval request is invalid")
        if isinstance(max_results, bool) or not isinstance(max_results, int) or not 1 <= max_results <= FINAL_RESULT_COUNT:
            raise ValueError("max_results must be between 1 and 5")
        with self._lock:
            if self._store is None or self._client is None or self._fingerprints is None:
                raise AssistantRuntimeError("runtime_prerequisite_unavailable")
            if (
                expected_catalog_fingerprint is not None
                and self._fingerprints.canonical != expected_catalog_fingerprint
            ):
                raise AssistantRuntimeError("runtime_prerequisite_unavailable")
            try:
                embedded = self._client.embed(EmbeddingRequest(E5_PROFILE.prepare_query(query), language))
                validate_runtime_dimensions(embedded.dimensions, self._store.vector_space.dimensions)
                query_space = VectorSpace(
                    embedded.provider, embedded.model, embedded.dimensions,
                    self._store.vector_space.normalization,
                    PHASE8_ASSISTANT_RUNTIME_PROFILE.semantic_text_version,
                    PHASE8_ASSISTANT_RUNTIME_PROFILE.embedding_profile,
                )
                candidates = self._store.search(VectorSearchRequest(
                    query_space, embedded.vector, language=language, top_k=HYBRID_CANDIDATE_COUNT,
                ))
                by_id = {item.product_id: item for item in self._catalog}
                ranked = rerank_hybrid(query, candidates, by_id, top_k=max_results)
                return tuple(
                    AssistantRetrievalResult(
                        row.product_id,
                        by_id[row.product_id].slug,
                        language,
                        row.score,
                        by_id[row.product_id].category,
                        by_id[row.product_id].price_rupiah,
                    )
                    for row in ranked
                )
            except EmbeddingError:
                self._invalidate("embedding_prerequisite_unavailable")
                raise AssistantRuntimeError(self._readiness_reason) from None
            except VectorStoreError:
                self._invalidate("index_prerequisite_unavailable")
                raise AssistantRuntimeError(self._readiness_reason) from None
            except (HybridRetrievalError, ValueError):
                self._invalidate("runtime_prerequisite_unavailable")
                raise AssistantRuntimeError(self._readiness_reason) from None

    def _invalidate(self, reason: str) -> None:
        self._store = None
        self._catalog = ()
        self._fingerprints = None
        self._readiness_reason = reason
