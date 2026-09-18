"""Immutable application-owned contracts for the Phase 7E vector index."""

from dataclasses import dataclass
from hashlib import sha256
import json
import math
from typing import Literal

from .embedding_contracts import (
    EmbeddingInvalidLanguageError,
    ProductEmbeddingRecord,
)


VectorLanguage = Literal["id", "en"]
VECTOR_NORMALIZATION_NONE = "none"
MAX_SEARCH_RESULTS = 50


class VectorStoreError(Exception):
    """Base class for sanitized vector-store failures."""


class VectorStoreInvalidInputError(VectorStoreError):
    pass


class VectorStoreIncompatibleSpaceError(VectorStoreError):
    pass


class VectorStoreCorruptionError(VectorStoreError):
    pass


class VectorStoreStorageError(VectorStoreError):
    """Non-rebuildable or transient storage failure."""


@dataclass(frozen=True)
class VectorSpace:
    provider: str
    model: str
    dimensions: int
    normalization: str
    text_version: str
    embedding_profile: str = "7d-embedding-profile-minilm-v1"

    def __post_init__(self) -> None:
        for field_name in ("provider", "model", "text_version", "embedding_profile"):
            value = getattr(self, field_name)
            if not isinstance(value, str) or not value.strip():
                raise VectorStoreInvalidInputError(f"{field_name} must not be blank")
        if (
            isinstance(self.dimensions, bool)
            or not isinstance(self.dimensions, int)
            or self.dimensions <= 0
        ):
            raise VectorStoreInvalidInputError("dimensions must be a positive integer")
        if self.normalization != VECTOR_NORMALIZATION_NONE:
            raise VectorStoreInvalidInputError("unsupported vector normalization mode")

    @property
    def key(self) -> str:
        payload = json.dumps(
            {
                "dimensions": self.dimensions,
                "model": self.model,
                "normalization": self.normalization,
                "provider": self.provider,
                "text_version": self.text_version,
                "embedding_profile": self.embedding_profile,
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return sha256(payload).hexdigest()

    @classmethod
    def from_embedding(
        cls,
        record: ProductEmbeddingRecord,
        normalization: str = VECTOR_NORMALIZATION_NONE,
    ) -> "VectorSpace":
        if not isinstance(record, ProductEmbeddingRecord):
            raise VectorStoreInvalidInputError(
                "record must be a ProductEmbeddingRecord"
            )
        return cls(
            record.provider,
            record.model,
            record.dimensions,
            normalization,
            record.text_version,
            record.embedding_profile,
        )


@dataclass(frozen=True)
class VectorRecord:
    embedding: ProductEmbeddingRecord
    category: str
    price_rupiah: int

    def __post_init__(self) -> None:
        if not isinstance(self.embedding, ProductEmbeddingRecord):
            raise VectorStoreInvalidInputError(
                "embedding must be a ProductEmbeddingRecord"
            )
        if not isinstance(self.category, str) or not self.category.strip():
            raise VectorStoreInvalidInputError("category must not be blank")
        if (
            isinstance(self.price_rupiah, bool)
            or not isinstance(self.price_rupiah, int)
            or self.price_rupiah < 0
        ):
            raise VectorStoreInvalidInputError(
                "price_rupiah must be a non-negative integer"
            )


@dataclass(frozen=True)
class VectorSyncSummary:
    new: int = 0
    reused: int = 0
    replaced: int = 0
    metadata_updated: int = 0
    pruned: int = 0


@dataclass(frozen=True)
class VectorMetadataRecord:
    product_id: int
    slug: str
    language: VectorLanguage
    content_hash: str
    category: str
    price_rupiah: int

    def __post_init__(self) -> None:
        if isinstance(self.product_id, bool) or not isinstance(self.product_id, int) or self.product_id <= 0:
            raise VectorStoreInvalidInputError("metadata product identity is invalid")
        if not isinstance(self.slug, str) or not self.slug.strip():
            raise VectorStoreInvalidInputError("metadata slug is invalid")
        if self.language not in ("id", "en"):
            raise VectorStoreInvalidInputError("metadata language is invalid")
        if (
            not isinstance(self.content_hash, str)
            or len(self.content_hash) != 64
            or any(character not in "0123456789abcdef" for character in self.content_hash)
        ):
            raise VectorStoreInvalidInputError("metadata content hash is invalid")
        if not isinstance(self.category, str) or not self.category.strip():
            raise VectorStoreInvalidInputError("metadata category is invalid")
        if (
            isinstance(self.price_rupiah, bool)
            or not isinstance(self.price_rupiah, int)
            or self.price_rupiah < 0
        ):
            raise VectorStoreInvalidInputError("metadata price is invalid")


@dataclass(frozen=True)
class VectorSearchRequest:
    vector_space: VectorSpace
    vector: tuple[float, ...]
    language: VectorLanguage | None = None
    top_k: int = 10
    category: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.vector_space, VectorSpace):
            raise VectorStoreInvalidInputError("vector_space must be a VectorSpace")
        if not isinstance(self.vector, tuple) or not self.vector:
            raise VectorStoreInvalidInputError("query vector must be a non-empty tuple")
        if len(self.vector) != self.vector_space.dimensions:
            raise VectorStoreInvalidInputError(
                "query vector length must match vector-space dimensions"
            )
        for component in self.vector:
            if (
                isinstance(component, bool)
                or not isinstance(component, (int, float))
                or not math.isfinite(float(component))
            ):
                raise VectorStoreInvalidInputError(
                    "query vector components must be numeric and finite"
                )
        if self.language is not None and self.language not in ("id", "en"):
            raise EmbeddingInvalidLanguageError("language must be 'id' or 'en'")
        if (
            isinstance(self.top_k, bool)
            or not isinstance(self.top_k, int)
            or not 1 <= self.top_k <= MAX_SEARCH_RESULTS
        ):
            raise VectorStoreInvalidInputError(
                f"top_k must be between 1 and {MAX_SEARCH_RESULTS}"
            )
        if self.category is not None and (
            not isinstance(self.category, str)
            or not self.category.strip()
            or len(self.category) > 100
        ):
            raise VectorStoreInvalidInputError(
                "category must be a non-blank string of at most 100 characters"
            )


@dataclass(frozen=True)
class VectorSearchResult:
    product_id: int
    slug: str
    language: VectorLanguage
    score: float
    content_hash: str
    category: str
    price_rupiah: int

    def __post_init__(self) -> None:
        if (
            isinstance(self.product_id, bool)
            or not isinstance(self.product_id, int)
            or self.product_id <= 0
        ):
            raise VectorStoreCorruptionError("stored product identity is invalid")
        if not isinstance(self.slug, str) or not self.slug.strip():
            raise VectorStoreCorruptionError("stored product slug is invalid")
        if self.language not in ("id", "en"):
            raise VectorStoreCorruptionError("stored embedding language is invalid")
        if (
            isinstance(self.score, bool)
            or not isinstance(self.score, (int, float))
            or not math.isfinite(float(self.score))
        ):
            raise VectorStoreCorruptionError("vector search produced a non-finite score")
        if (
            not isinstance(self.content_hash, str)
            or len(self.content_hash) != 64
            or any(character not in "0123456789abcdef" for character in self.content_hash)
        ):
            raise VectorStoreCorruptionError("stored content hash is invalid")
        if not isinstance(self.category, str) or not self.category.strip():
            raise VectorStoreCorruptionError("stored category is invalid")
        if (
            isinstance(self.price_rupiah, bool)
            or not isinstance(self.price_rupiah, int)
            or self.price_rupiah < 0
        ):
            raise VectorStoreCorruptionError("stored price metadata is invalid")
