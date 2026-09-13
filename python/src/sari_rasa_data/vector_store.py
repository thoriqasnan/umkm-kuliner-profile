"""SQLite persistence and exact NumPy cosine search for Phase 7E."""

from collections.abc import Iterable
from contextlib import contextmanager
from pathlib import Path
import sqlite3
from typing import Iterator

import numpy as np

from .vector_contracts import (
    VectorRecord,
    VectorSearchRequest,
    VectorSearchResult,
    VectorSpace,
    VectorStoreCorruptionError,
    VectorStoreIncompatibleSpaceError,
    VectorStoreInvalidInputError,
    VectorSyncSummary,
)


DEFAULT_VECTOR_DB_PATH = Path("python/data/sari_rasa_vectors.db")
_SCHEMA_VERSION = 1


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
            raise VectorStoreCorruptionError(
                "vector database could not be opened"
            ) from exc

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
            raise VectorStoreCorruptionError(
                "vector database schema or metadata is invalid"
            ) from exc

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
            raise VectorStoreCorruptionError("vector synchronization failed") from exc

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
            raise VectorStoreCorruptionError("vector search failed") from exc
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
