"""Immutable provider-neutral contracts and sanitized failures for Phase 7F RAG."""

from dataclasses import dataclass
import math
import re
from typing import Literal, Protocol

from .llm_structured import StructuredLLMResponse
from .menu_prompts import PublicMenuItem
from .vector_contracts import VectorSpace


RAGLanguage = Literal["id", "en"]
MAX_RETRIEVAL_CANDIDATES = 10
MAX_EVIDENCE_PRODUCTS = 5
MAX_RAG_QUERY_LENGTH = 1000
_SOURCE_PATTERN = re.compile(r"^menu:[1-5]$")


class RAGError(Exception):
    """Base class for sanitized application-owned RAG failures."""


class RAGInvalidRequestError(RAGError):
    pass


class RAGCatalogResolutionError(RAGError):
    pass


@dataclass(frozen=True)
class RAGRequest:
    user_input: str
    vector_space: VectorSpace
    language: RAGLanguage = "id"
    retrieve_top_k: int = MAX_RETRIEVAL_CANDIDATES
    max_evidence: int = MAX_EVIDENCE_PRODUCTS
    max_output_tokens: int = 256
    correlation_id: str | None = None

    def __post_init__(self) -> None:
        if (
            not isinstance(self.user_input, str)
            or not self.user_input.strip()
            or len(self.user_input) > MAX_RAG_QUERY_LENGTH
        ):
            raise RAGInvalidRequestError(
                f"user_input must contain 1-{MAX_RAG_QUERY_LENGTH} characters"
            )
        if not isinstance(self.vector_space, VectorSpace):
            raise RAGInvalidRequestError("vector_space must be a VectorSpace")
        if self.language not in ("id", "en"):
            raise RAGInvalidRequestError("language must be 'id' or 'en'")
        if (
            isinstance(self.retrieve_top_k, bool)
            or not isinstance(self.retrieve_top_k, int)
            or not 1 <= self.retrieve_top_k <= MAX_RETRIEVAL_CANDIDATES
        ):
            raise RAGInvalidRequestError(
                f"retrieve_top_k must be between 1 and {MAX_RETRIEVAL_CANDIDATES}"
            )
        if (
            isinstance(self.max_evidence, bool)
            or not isinstance(self.max_evidence, int)
            or not 1 <= self.max_evidence <= MAX_EVIDENCE_PRODUCTS
        ):
            raise RAGInvalidRequestError(
                f"max_evidence must be between 1 and {MAX_EVIDENCE_PRODUCTS}"
            )
        if (
            isinstance(self.max_output_tokens, bool)
            or not isinstance(self.max_output_tokens, int)
            or self.max_output_tokens <= 0
        ):
            raise RAGInvalidRequestError("max_output_tokens must be a positive integer")


@dataclass(frozen=True)
class RAGEvidence:
    source_id: str
    product_id: int
    slug: str
    name: str
    category: str
    price_rupiah: int
    description: str
    language: RAGLanguage
    score: float
    content_hash: str

    def __post_init__(self) -> None:
        if not isinstance(self.source_id, str) or not _SOURCE_PATTERN.fullmatch(
            self.source_id
        ):
            raise RAGInvalidRequestError("source_id must use the request-local menu:N format")
        if (
            isinstance(self.product_id, bool)
            or not isinstance(self.product_id, int)
            or self.product_id <= 0
        ):
            raise RAGInvalidRequestError("evidence product_id must be positive")
        for field_name in ("slug", "name", "category", "description"):
            value = getattr(self, field_name)
            if not isinstance(value, str) or not value.strip():
                raise RAGInvalidRequestError(f"evidence {field_name} must not be blank")
        if (
            isinstance(self.price_rupiah, bool)
            or not isinstance(self.price_rupiah, int)
            or self.price_rupiah < 0
        ):
            raise RAGInvalidRequestError("evidence price_rupiah must not be negative")
        if self.language not in ("id", "en"):
            raise RAGInvalidRequestError("evidence language must be 'id' or 'en'")
        if (
            isinstance(self.score, bool)
            or not isinstance(self.score, (int, float))
            or not math.isfinite(float(self.score))
        ):
            raise RAGInvalidRequestError("evidence score must be finite")
        if (
            not isinstance(self.content_hash, str)
            or len(self.content_hash) != 64
            or any(value not in "0123456789abcdef" for value in self.content_hash)
        ):
            raise RAGInvalidRequestError("evidence content_hash must be a SHA-256 digest")


@dataclass(frozen=True)
class RAGResult:
    response: StructuredLLMResponse
    evidence: tuple[RAGEvidence, ...]
    requested_language: RAGLanguage
    evidence_language: RAGLanguage | None
    language_fallback: bool
    retrieved_candidate_count: int
    stale_candidate_count: int


@dataclass(frozen=True)
class RetrievedMenuItem:
    item: PublicMenuItem
    language: RAGLanguage
    score: float
    content_hash: str


@dataclass(frozen=True)
class RAGRetrievalResult:
    items: tuple[RetrievedMenuItem, ...]
    requested_language: RAGLanguage
    evidence_language: RAGLanguage | None
    language_fallback: bool
    retrieved_candidate_count: int
    stale_candidate_count: int


class CatalogResolver(Protocol):
    def resolve(self, product_id: int) -> PublicMenuItem | None: ...


class VectorSearcher(Protocol):
    vector_space: VectorSpace

    def search(self, request): ...
