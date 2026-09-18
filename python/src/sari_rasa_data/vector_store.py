"""SQLite persistence and exact NumPy cosine search for Phase 7E."""

from collections.abc import Iterable
from contextlib import contextmanager
from pathlib import Path
import sqlite3
from typing import Iterator

import numpy as np

from .vector_contracts import (
    VectorRecord,
    VectorMetadataRecord,
    VectorSearchRequest,
    VectorSearchResult,
    VectorSpace,
    VectorStoreCorruptionError,
    VectorStoreIncompatibleSpaceError,
    VectorStoreInvalidInputError,
    VectorStoreStorageError,
    VectorSyncSummary,
)


DEFAULT_VECTOR_DB_PATH = Path("python/data/sari_rasa_vectors.db")
_SCHEMA_VERSION = 1


def _raise_sqlite_store_error(message: str, exc: sqlite3.Error) -> None:
    code = getattr(exc, "sqlite_errorcode", None)
    primary_code = code & 0xFF if isinstance(code, int) else None
    detail = str(exc).casefold()
    known_corruption = primary_code in {sqlite3.SQLITE_CORRUPT, sqlite3.SQLITE_NOTADB, sqlite3.SQLITE_SCHEMA}
    known_schema_damage = any(token in detail for token in (
        "database disk image is malformed", "file is not a database",
        "malformed database schema", "no such table", "no such column",
    ))
    error_type = VectorStoreCorruptionError if known_corruption or known_schema_damage else VectorStoreStorageError
    raise error_type(message) from exc


def encode_vector(vector: tuple[float, ...], dimensions: int) -> bytes:
    """Encode one validated vector as deterministic little-endian float32 bytes."""
    if isinstance(dimensions, bool) or not isinstance(dimensions, int) or dimensions <= 0:
        raise VectorStoreInvalidInputError("dimensions must be a positive integer")
    if not isinstance(vector, tuple) or not vector or len(vector) != dimensions:
        raise VectorStoreInvalidInputError("vector length must match dimensions")
    if any(
        isinstance(value, bool) or not isinstance(value, (int, float))
        for value in vector
    ):
        raise VectorStoreInvalidInputError("vector components must be numeric")
    array = np.asarray(vector, dtype=np.dtype("<f4"))
    if not np.isfinite(array).all():
        raise VectorStoreInvalidInputError("vector components must be finite")
    if float(np.linalg.norm(array.astype(np.float64))) == 0.0:
        raise VectorStoreInvalidInputError("vector norm must be non-zero")
    return array.tobytes(order="C")


def decode_vector(blob: bytes, dimensions: int) -> tuple[float, ...]:
    """Decode and validate an exact little-endian float32 vector BLOB."""
    if isinstance(dimensions, bool) or not isinstance(dimensions, int) or dimensions <= 0:
        raise VectorStoreCorruptionError("stored vector dimensions are invalid")
    if not isinstance(blob, bytes) or len(blob) != dimensions * 4:
        raise VectorStoreCorruptionError("stored vector byte length is invalid")
    array = np.frombuffer(blob, dtype=np.dtype("<f4"))
    if len(array) != dimensions or not np.isfinite(array).all():
        raise VectorStoreCorruptionError("stored vector is invalid")
    if float(np.linalg.norm(array.astype(np.float64))) == 0.0:
        raise VectorStoreCorruptionError("stored vector norm must be non-zero")
    return tuple(float(value) for value in array)


class SQLiteVectorStore:
    """One explicitly identified vector space stored in one SQLite database."""

    def __init__(self, path: str | Path, vector_space: VectorSpace) -> None:
        if not isinstance(vector_space, VectorSpace):
            raise VectorStoreInvalidInputError("vector_space must be a VectorSpace")
        if not isinstance(path, (str, Path)) or not str(path).strip():
            raise VectorStoreInvalidInputError("vector database path is required")
        self._path = Path(path)
        self.vector_space = vector_space
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        try:
            connection = sqlite3.connect(self._path)
            connection.execute("PRAGMA foreign_keys = ON")
            return connection
        except sqlite3.Error as exc:
            _raise_sqlite_store_error("vector database could not be opened", exc)

    @contextmanager
    def _transaction(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _initialize(self) -> None:
        try:
            with self._transaction() as connection:
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS vector_space (
                        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
                        schema_version INTEGER NOT NULL,
                        space_key TEXT NOT NULL UNIQUE,
                        provider TEXT NOT NULL,
                        model TEXT NOT NULL,
                        dimensions INTEGER NOT NULL CHECK (dimensions > 0),
                        normalization TEXT NOT NULL,
                        text_version TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS product_embeddings (
                        product_id INTEGER NOT NULL CHECK (product_id > 0),
                        language TEXT NOT NULL CHECK (language IN ('id', 'en')),
                        slug TEXT NOT NULL,
                        category TEXT NOT NULL,
                        price_rupiah INTEGER NOT NULL CHECK (price_rupiah >= 0),
                        content_hash TEXT NOT NULL,
                        vector BLOB NOT NULL,
                        space_key TEXT NOT NULL,
                        PRIMARY KEY (product_id, language),
                        FOREIGN KEY (space_key) REFERENCES vector_space(space_key)
                    );
                    CREATE INDEX IF NOT EXISTS idx_product_embeddings_language_category
                    ON product_embeddings(language, category);
                    """
                )
                row = connection.execute(
                    "SELECT schema_version, space_key, provider, model, dimensions, "
                    "normalization, text_version FROM vector_space WHERE singleton_id = 1"
                ).fetchone()
                expected = (
                    _SCHEMA_VERSION,
                    self.vector_space.key,
                    self.vector_space.provider,
                    self.vector_space.model,
                    self.vector_space.dimensions,
                    self.vector_space.normalization,
                    self.vector_space.text_version,
                )
                if row is None:
                    connection.execute(
                        "INSERT INTO vector_space VALUES (1, ?, ?, ?, ?, ?, ?, ?)",
                        expected,
                    )
                elif tuple(row) != expected:
                    raise VectorStoreIncompatibleSpaceError(
                        "vector database belongs to an incompatible vector space"
                    )
        except VectorStoreIncompatibleSpaceError:
            raise
        except sqlite3.Error as exc:
            _raise_sqlite_store_error("vector database schema or metadata is invalid", exc)

    def sync(
        self, records: Iterable[VectorRecord], *, prune: bool = False
    ) -> VectorSyncSummary:
        values = tuple(records)
        if any(not isinstance(record, VectorRecord) for record in values):
            raise VectorStoreInvalidInputError("records must be VectorRecord values")
        identities = [(item.embedding.product_id, item.embedding.language) for item in values]
        if len(identities) != len(set(identities)):
            raise VectorStoreInvalidInputError(
                "sync records must have unique product/language identities"
            )
        ordered = sorted(
            values,
            key=lambda item: (
                item.embedding.product_id,
                0 if item.embedding.language == "id" else 1,
                item.embedding.slug,
            ),
        )
        counts = {"new": 0, "reused": 0, "replaced": 0, "metadata_updated": 0}
        try:
            with self._transaction() as connection:
                connection.execute("BEGIN IMMEDIATE")
                for item in ordered:
                    embedding = item.embedding
                    if VectorSpace.from_embedding(embedding) != self.vector_space:
                        raise VectorStoreIncompatibleSpaceError(
                            "embedding record belongs to an incompatible vector space"
                        )
                    blob = encode_vector(embedding.vector, embedding.dimensions)
                    stored = connection.execute(
                        "SELECT slug, category, price_rupiah, content_hash FROM "
                        "product_embeddings WHERE product_id = ? AND language = ?",
                        (embedding.product_id, embedding.language),
                    ).fetchone()
                    parameters = (
                        embedding.slug,
                        item.category.strip(),
                        item.price_rupiah,
                        embedding.content_hash,
                        blob,
                        self.vector_space.key,
                        embedding.product_id,
                        embedding.language,
                    )
                    if stored is None:
                        connection.execute(
                            "INSERT INTO product_embeddings "
                            "(slug, category, price_rupiah, content_hash, vector, space_key, "
                            "product_id, language) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                            parameters,
                        )
                        counts["new"] += 1
                    elif stored[3] != embedding.content_hash:
                        connection.execute(
                            "UPDATE product_embeddings SET slug = ?, category = ?, "
                            "price_rupiah = ?, content_hash = ?, vector = ?, space_key = ? "
                            "WHERE product_id = ? AND language = ?",
                            parameters,
                        )
                        counts["replaced"] += 1
                    elif stored[1] != item.category.strip():
                        raise VectorStoreInvalidInputError(
                            "category change requires a changed semantic content hash"
                        )
                    elif (stored[0], stored[2]) != (
                        embedding.slug,
                        item.price_rupiah,
                    ):
                        connection.execute(
                            "UPDATE product_embeddings SET slug = ?, price_rupiah = ? "
                            "WHERE product_id = ? AND language = ?",
                            (
                                embedding.slug,
                                item.price_rupiah,
                                embedding.product_id,
                                embedding.language,
                            ),
                        )
                        counts["metadata_updated"] += 1
                    else:
                        counts["reused"] += 1
                pruned = 0
                if prune:
                    keep = set(identities)
                    stored_identities = connection.execute(
                        "SELECT product_id, language FROM product_embeddings"
                    ).fetchall()
                    remove = sorted(set(stored_identities) - keep)
                    for identity in remove:
                        connection.execute(
                            "DELETE FROM product_embeddings WHERE product_id = ? AND language = ?",
                            identity,
                        )
                    pruned = len(remove)
                return VectorSyncSummary(pruned=pruned, **counts)
        except (VectorStoreInvalidInputError, VectorStoreIncompatibleSpaceError):
            raise
        except sqlite3.Error as exc:
            _raise_sqlite_store_error("vector synchronization failed", exc)

    def metadata_manifest(self) -> tuple[VectorMetadataRecord, ...]:
        """Return validated non-vector metadata for lifecycle reconciliation."""
        try:
            with self._transaction() as connection:
                rows = connection.execute(
                    "SELECT product_id, slug, language, content_hash, category, price_rupiah "
                    "FROM product_embeddings WHERE space_key = ? "
                    "ORDER BY product_id, language, slug",
                    (self.vector_space.key,),
                ).fetchall()
        except sqlite3.Error as exc:
            _raise_sqlite_store_error("vector metadata could not be read", exc)
        try:
            return tuple(VectorMetadataRecord(*row) for row in rows)
        except VectorStoreInvalidInputError as exc:
            raise VectorStoreCorruptionError("stored vector metadata is invalid") from exc

    def validate_integrity(self) -> None:
        """Validate SQLite structure plus every stored vector before reuse."""
        try:
            with self._transaction() as connection:
                result = connection.execute("PRAGMA quick_check").fetchone()
                if result != ("ok",):
                    raise VectorStoreCorruptionError("vector database integrity check failed")
                rows = connection.execute(
                    "SELECT vector FROM product_embeddings WHERE space_key = ?",
                    (self.vector_space.key,),
                ).fetchall()
        except VectorStoreCorruptionError:
            raise
        except sqlite3.Error as exc:
            _raise_sqlite_store_error("vector database integrity check failed", exc)
        for (blob,) in rows:
            decode_vector(blob, self.vector_space.dimensions)

    def sync_metadata(
        self, records: Iterable[VectorMetadataRecord], *, prune: bool = False
    ) -> VectorSyncSummary:
        """Refresh canonical metadata without rewriting compatible vectors."""
        values = tuple(records)
        if any(not isinstance(record, VectorMetadataRecord) for record in values):
            raise VectorStoreInvalidInputError("metadata records are invalid")
        identities = [(item.product_id, item.language) for item in values]
        if len(identities) != len(set(identities)):
            raise VectorStoreInvalidInputError("metadata identities must be unique")
        updated = reused = 0
        try:
            with self._transaction() as connection:
                connection.execute("BEGIN IMMEDIATE")
                for item in sorted(values, key=lambda value: (value.product_id, value.language, value.slug)):
                    stored = connection.execute(
                        "SELECT content_hash, slug, category, price_rupiah FROM product_embeddings "
                        "WHERE product_id = ? AND language = ? AND space_key = ?",
                        (item.product_id, item.language, self.vector_space.key),
                    ).fetchone()
                    if stored is None or stored[0] != item.content_hash:
                        raise VectorStoreIncompatibleSpaceError(
                            "stored vector metadata does not match canonical semantic content"
                        )
                    current = (stored[1], stored[2], stored[3])
                    expected = (item.slug, item.category.strip(), item.price_rupiah)
                    if current == expected:
                        reused += 1
                    else:
                        connection.execute(
                            "UPDATE product_embeddings SET slug = ?, category = ?, price_rupiah = ? "
                            "WHERE product_id = ? AND language = ? AND space_key = ?",
                            (*expected, item.product_id, item.language, self.vector_space.key),
                        )
                        updated += 1
                pruned = 0
                if prune:
                    keep = set(identities)
                    stored_identities = connection.execute(
                        "SELECT product_id, language FROM product_embeddings WHERE space_key = ?",
                        (self.vector_space.key,),
                    ).fetchall()
                    remove = sorted(set(stored_identities) - keep)
                    for identity in remove:
                        connection.execute(
                            "DELETE FROM product_embeddings WHERE product_id = ? AND language = ? "
                            "AND space_key = ?",
                            (*identity, self.vector_space.key),
                        )
                    pruned = len(remove)
                return VectorSyncSummary(reused=reused, metadata_updated=updated, pruned=pruned)
        except (VectorStoreInvalidInputError, VectorStoreIncompatibleSpaceError):
            raise
        except sqlite3.Error as exc:
            _raise_sqlite_store_error("vector metadata synchronization failed", exc)

    def search(self, request: VectorSearchRequest) -> tuple[VectorSearchResult, ...]:
        if not isinstance(request, VectorSearchRequest):
            raise VectorStoreInvalidInputError(
                "request must be a VectorSearchRequest"
            )
        if request.vector_space != self.vector_space:
            raise VectorStoreIncompatibleSpaceError(
                "query belongs to an incompatible vector space"
            )
        query_blob = encode_vector(request.vector, self.vector_space.dimensions)
        query = np.frombuffer(query_blob, dtype=np.dtype("<f4")).astype(np.float64)
        clauses = ["space_key = ?"]
        parameters: list[object] = [self.vector_space.key]
        if request.language is not None:
            clauses.append("language = ?")
            parameters.append(request.language)
        if request.category is not None:
            clauses.append("category = ?")
            parameters.append(request.category.strip())
        sql = (
            "SELECT product_id, slug, language, content_hash, category, price_rupiah, "
            "vector FROM product_embeddings WHERE " + " AND ".join(clauses)
        )
        try:
            with self._transaction() as connection:
                rows = connection.execute(sql, parameters).fetchall()
        except sqlite3.Error as exc:
            _raise_sqlite_store_error("vector search failed", exc)
        query_norm = float(np.linalg.norm(query))
        results = []
        for row in rows:
            candidate = np.asarray(
                decode_vector(row[6], self.vector_space.dimensions),
                dtype=np.float64,
            )
            denominator = query_norm * float(np.linalg.norm(candidate))
            if denominator == 0.0:
                raise VectorStoreCorruptionError("stored vector norm must be non-zero")
            score = float(np.dot(query, candidate) / denominator)
            results.append(
                VectorSearchResult(
                    product_id=row[0],
                    slug=row[1],
                    language=row[2],
                    score=score,
                    content_hash=row[3],
                    category=row[4],
                    price_rupiah=row[5],
                )
            )
        results.sort(
            key=lambda result: (
                -result.score,
                result.product_id,
                0 if result.language == "id" else 1,
                result.slug,
            )
        )
        return tuple(results[: request.top_k])
