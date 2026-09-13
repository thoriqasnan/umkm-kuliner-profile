"""Provider-neutral contracts and sanitized failures for Phase 7D embeddings."""

from dataclasses import dataclass
import math
from typing import Literal, Protocol


EmbeddingLanguage = Literal["id", "en"]


class EmbeddingError(Exception):
    """Base class for safe, provider-neutral embedding failures."""


class EmbeddingInvalidInputError(EmbeddingError):
    pass


class EmbeddingInvalidLanguageError(EmbeddingInvalidInputError):
    pass


class EmbeddingInvalidVectorError(EmbeddingError):
    pass


class EmbeddingConfigUnavailableError(EmbeddingError):
    pass


class EmbeddingModelLoadError(EmbeddingError):
    pass


class EmbeddingInferenceError(EmbeddingError):
    pass


@dataclass(frozen=True)
class EmbeddingRequest:
    semantic_text: str
    language: EmbeddingLanguage

    def __post_init__(self) -> None:
        if not isinstance(self.semantic_text, str) or not self.semantic_text.strip():
            raise EmbeddingInvalidInputError("semantic_text must not be blank")
        if self.language not in ("id", "en"):
            raise EmbeddingInvalidLanguageError("language must be 'id' or 'en'")


@dataclass(frozen=True)
class EmbeddingVector:
    provider: str
    model: str
    dimensions: int
    vector: tuple[float, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.provider, str) or not self.provider.strip():
            raise EmbeddingInvalidVectorError("provider must not be blank")
        if not isinstance(self.model, str) or not self.model.strip():
            raise EmbeddingInvalidVectorError("model must not be blank")
        _validate_vector(self.dimensions, self.vector)


@dataclass(frozen=True)
class ProductEmbeddingRecord:
    product_id: int
    slug: str
    language: EmbeddingLanguage
    text_version: str
    semantic_text: str
    content_hash: str
    provider: str
    model: str
    dimensions: int
    vector: tuple[float, ...]
    embedding_profile: str = "7d-embedding-profile-minilm-v1"

    def __post_init__(self) -> None:
        if isinstance(self.product_id, bool) or not isinstance(self.product_id, int) or self.product_id <= 0:
            raise EmbeddingInvalidInputError("product_id must be a positive integer")
        for field_name in ("slug", "text_version", "semantic_text", "content_hash", "embedding_profile"):
            value = getattr(self, field_name)
            if not isinstance(value, str) or not value.strip():
                raise EmbeddingInvalidInputError(f"{field_name} must not be blank")
        if self.language not in ("id", "en"):
            raise EmbeddingInvalidLanguageError("language must be 'id' or 'en'")
        if len(self.content_hash) != 64 or any(c not in "0123456789abcdef" for c in self.content_hash):
            raise EmbeddingInvalidInputError("content_hash must be a lowercase SHA-256 digest")
        if not isinstance(self.provider, str) or not self.provider.strip():
            raise EmbeddingInvalidVectorError("provider must not be blank")
        if not isinstance(self.model, str) or not self.model.strip():
            raise EmbeddingInvalidVectorError("model must not be blank")
        _validate_vector(self.dimensions, self.vector)


class EmbeddingClient(Protocol):
    def embed(self, request: EmbeddingRequest) -> EmbeddingVector: ...


def _validate_vector(dimensions: int, vector: tuple[float, ...]) -> None:
    if isinstance(dimensions, bool) or not isinstance(dimensions, int) or dimensions <= 0:
        raise EmbeddingInvalidVectorError("dimensions must be a positive integer")
    if not isinstance(vector, tuple) or not vector:
        raise EmbeddingInvalidVectorError("vector must be a non-empty tuple")
    if len(vector) != dimensions:
        raise EmbeddingInvalidVectorError("vector length must match dimensions")
    for component in vector:
        if isinstance(component, bool) or not isinstance(component, (int, float)):
            raise EmbeddingInvalidVectorError("vector components must be numeric")
        if not math.isfinite(float(component)):
            raise EmbeddingInvalidVectorError("vector components must be finite")
