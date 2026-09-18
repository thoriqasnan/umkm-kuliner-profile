"""Phase 8A contracts for the future public, read-only menu assistant.

This module defines data and ownership boundaries only. Importing it performs
no configuration reads, model loads, database access, or network requests.
"""

from dataclasses import dataclass
import re
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, field_validator, model_validator

from .embedding_contracts import EmbeddingConfigUnavailableError
from .embedding_profiles import E5_MODEL_ID, E5_PROFILE_ID, MINILM_PROFILE_ID, resolve_embedding_profile
from .embeddings import CATALOG_TEXT_VERSION_V2, SUPPORTED_CATALOG_TEXT_VERSIONS
from .hybrid_retrieval import HYBRID_RETRIEVAL_POLICY, SUPPORTED_RETRIEVAL_POLICIES


MAX_AI_MESSAGE_LENGTH = 1000
MAX_AI_ANSWER_LENGTH = 4000
MAX_AI_LIMITATION_LENGTH = 256
MAX_AI_LIMITATIONS = 10
MAX_AI_SOURCES = 5
PHASE8_ASSISTANT_PROFILE_ID = "phase-8.customer-menu-e5-v1"
KNOWN_VERIFIED_E5_DIMENSIONS = 768

AiLanguage = Literal["id", "en"]
AiErrorCode = Literal[
    "invalid_request",
    "rate_limited",
    "upstream_timeout",
    "upstream_unavailable",
    "invalid_upstream_response",
    "ai_runtime_unavailable",
    "internal_error",
]

AI_ERROR_HTTP_STATUS: dict[str, int] = {
    "invalid_request": 400,
    "rate_limited": 429,
    "upstream_timeout": 504,
    "upstream_unavailable": 502,
    "invalid_upstream_response": 502,
    "ai_runtime_unavailable": 503,
    "internal_error": 500,
}

AI_TIMEOUT_OWNERSHIP = {
    "browser": "may_abort_or_supersede",
    "node": "owns_outer_service_deadline_and_disconnect_abort",
    "python": "owns_inner_runtime_and_provider_timeouts",
    "ordering": "python_inner_timeout_must_be_shorter_than_node_outer_deadline",
}

ASSISTANT_AUTHORITY = frozenset({"public", "read_only", "public_menu_only"})
PROHIBITED_AUTHORITY = frozenset({
    "credentials", "passwords", "sessions", "reset_tokens", "accounts", "roles",
    "admin_operations", "private_analytics", "carts", "orders", "checkout", "payment",
    "arbitrary_database", "shell", "filesystem", "browser_automation", "arbitrary_network",
})

# Deliberately small bilingual signals for choosing the language of one current
# message. Shared menu names/terms (for example "menu" and "soto") are omitted
# so genuinely ambiguous messages fall back to the interface language.
_ID_LANGUAGE_SIGNALS = frozenset({
    "ada", "apa", "apakah", "atau", "bawah", "berapa", "berkuah", "bisa",
    "buat", "cari", "dengan", "deh", "di", "dong", "enak", "ingin",
    "kayaknya", "lezat", "makanan", "mana", "minuman", "murah", "pilihkan",
    "rekomendasi", "rekomendasikan", "saya", "segar", "sepertinya", "tolong",
    "untuk", "ya", "yang",
})
_EN_LANGUAGE_SIGNALS = frozenset({
    "a", "any", "are", "can", "cheap", "choose", "dish", "drink", "find",
    "for", "food", "fresh", "good", "have", "i", "is", "looks", "me",
    "nice", "really", "recommend", "refreshing", "seems", "show", "some",
    "soupy", "tasty", "the", "under", "want", "what", "which", "with", "you",
})


def select_response_language(message: str, interface_language: AiLanguage) -> AiLanguage:
    """Select ID/EN for this message, using interface language only on ambiguity."""
    tokens = re.findall(r"[a-z]+", message.casefold())
    id_score = sum(token in _ID_LANGUAGE_SIGNALS for token in tokens)
    en_score = sum(token in _EN_LANGUAGE_SIGNALS for token in tokens)
    if id_score > en_score:
        return "id"
    if en_score > id_score:
        return "en"
    return interface_language


class StrictContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class PublicCatalogItem(StrictContractModel):
    product_id: StrictInt = Field(gt=0)
    slug: StrictStr = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    name: StrictStr
    category: StrictStr
    price_rupiah: StrictInt = Field(ge=0)
    description_id: StrictStr
    description_en: StrictStr

    @field_validator("name", "category", "description_id", "description_en")
    @classmethod
    def non_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("catalog text must not be blank")
        return value


class InternalAiRequest(StrictContractModel):
    message: StrictStr = Field(max_length=MAX_AI_MESSAGE_LENGTH)
    language: AiLanguage
    correlation_id: StrictStr = Field(max_length=36)
    catalog: tuple[PublicCatalogItem, ...] = Field(min_length=1)

    @field_validator("catalog", mode="before")
    @classmethod
    def catalog_json_array(cls, value):
        if not isinstance(value, (list, tuple)):
            raise ValueError("catalog must be an array")
        return tuple(value)

    @field_validator("message")
    @classmethod
    def normalize_message(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("message must not be blank")
        return value

    @field_validator("correlation_id")
    @classmethod
    def validate_correlation_id(cls, value: str) -> str:
        if len(value) != 36:
            raise ValueError("correlation_id must be a canonical UUIDv4")
        try:
            parsed = UUID(value)
        except (ValueError, AttributeError):
            raise ValueError("correlation_id must be a canonical UUIDv4") from None
        if parsed.version != 4 or str(parsed) != value:
            raise ValueError("correlation_id must be a canonical UUIDv4")
        return value

    @model_validator(mode="after")
    def unique_ordered_catalog(self):
        product_ids = [item.product_id for item in self.catalog]
        slugs = [item.slug for item in self.catalog]
        if len(product_ids) != len(set(product_ids)) or len(slugs) != len(set(slugs)):
            raise ValueError("catalog identities must be unique")
        if list(self.catalog) != sorted(self.catalog, key=lambda item: (item.product_id, item.slug)):
            raise ValueError("catalog must be ordered by product_id then slug")
        return self


class InternalAiSource(StrictContractModel):
    source_id: StrictStr = Field(pattern=r"^menu:[1-5]$")
    product_id: StrictInt = Field(gt=0)


class InternalAiResponse(StrictContractModel):
    answer: StrictStr = Field(max_length=MAX_AI_ANSWER_LENGTH)
    language: AiLanguage
    insufficient_information: bool
    limitations: tuple[StrictStr, ...] = Field(max_length=MAX_AI_LIMITATIONS)
    sources: tuple[InternalAiSource, ...] = Field(max_length=MAX_AI_SOURCES)

    @field_validator("limitations", "sources", mode="before")
    @classmethod
    def response_json_arrays(cls, value):
        if not isinstance(value, (list, tuple)):
            raise ValueError("response collections must be arrays")
        return tuple(value)

    @field_validator("answer")
    @classmethod
    def non_blank_answer(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("answer must not be blank")
        return value

    @field_validator("limitations")
    @classmethod
    def valid_limitations(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        normalized = tuple(value.strip() for value in values)
        if any(not value or len(value) > MAX_AI_LIMITATION_LENGTH for value in normalized):
            raise ValueError(
                f"limitations must be non-blank and at most {MAX_AI_LIMITATION_LENGTH} characters"
            )
        return normalized

    @model_validator(mode="after")
    def grounded_result_semantics(self):
        source_ids = [source.source_id for source in self.sources]
        product_ids = [source.product_id for source in self.sources]
        if len(source_ids) != len(set(source_ids)) or len(product_ids) != len(set(product_ids)):
            raise ValueError("sources must not contain duplicates")
        if self.insufficient_information:
            if self.sources or not self.limitations:
                raise ValueError("insufficient results require empty sources and limitations")
        elif not self.sources:
            raise ValueError("grounded results require at least one source")
        return self


ReadinessReason = Literal[
    "configuration_invalid",
    "profile_unrecognized",
    "embedding_prerequisite_unavailable",
    "index_prerequisite_unavailable",
    "runtime_prerequisite_unavailable",
]


class AiReadiness(StrictContractModel):
    status: Literal["ready", "not_ready"]
    profile_id: Literal["phase-8.customer-menu-e5-v1"]
    reasons: tuple[ReadinessReason, ...] = Field(max_length=5)
    provider_configuration: Literal["configured", "unconfigured", "invalid"] = "unconfigured"
    provider_probe: Literal["not_performed"] = "not_performed"

    @model_validator(mode="after")
    def consistent_status(self):
        if (self.status == "ready") == bool(self.reasons):
            raise ValueError("readiness status and reasons are inconsistent")
        return self


@dataclass(frozen=True)
class AssistantRuntimeProfile:
    profile_id: str
    embedding_model: str
    embedding_profile: str
    semantic_text_version: str
    retrieval_policy: str
    expected_dimensions: int | None = None

    def validate(self) -> None:
        if self.profile_id != PHASE8_ASSISTANT_PROFILE_ID:
            raise ValueError("AI runtime profile is not recognized")
        try:
            embedding = resolve_embedding_profile(self.embedding_model, self.embedding_profile)
        except EmbeddingConfigUnavailableError:
            raise ValueError("AI runtime embedding profile is incompatible") from None
        if embedding.profile_id != E5_PROFILE_ID or embedding.query_prefix != "query" or embedding.document_prefix != "passage":
            raise ValueError("AI runtime embedding profile is incompatible")
        if self.semantic_text_version not in SUPPORTED_CATALOG_TEXT_VERSIONS or self.semantic_text_version != CATALOG_TEXT_VERSION_V2:
            raise ValueError("AI runtime semantic projection is incompatible")
        if self.retrieval_policy not in SUPPORTED_RETRIEVAL_POLICIES or self.retrieval_policy != HYBRID_RETRIEVAL_POLICY:
            raise ValueError("AI runtime retrieval policy is incompatible")
        if self.expected_dimensions is not None and self.expected_dimensions <= 0:
            raise ValueError("expected dimensions must be positive when supplied")


PHASE8_ASSISTANT_RUNTIME_PROFILE = AssistantRuntimeProfile(
    profile_id=PHASE8_ASSISTANT_PROFILE_ID,
    embedding_model=E5_MODEL_ID,
    embedding_profile=E5_PROFILE_ID,
    semantic_text_version=CATALOG_TEXT_VERSION_V2,
    retrieval_policy=HYBRID_RETRIEVAL_POLICY,
    expected_dimensions=None,
)


def validate_runtime_dimensions(
    adapter_dimensions: int, index_dimensions: int | None = None
) -> int:
    """Derive dimensions from adapter output and require index compatibility."""
    for value in (adapter_dimensions, index_dimensions):
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ValueError("embedding dimensions must be a positive integer")
    if index_dimensions is not None and adapter_dimensions != index_dimensions:
        raise ValueError("embedding adapter and index dimensions are incompatible")
    return adapter_dimensions


def validate_timeout_ownership(node_outer_seconds: float, python_inner_seconds: float) -> None:
    """Validate deadline ordering without making an unmeasured latency promise."""
    for value in (node_outer_seconds, python_inner_seconds):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0.1 <= value <= 60:
            raise ValueError("AI timeouts must be between 0.1 and 60 seconds")
    if python_inner_seconds >= node_outer_seconds:
        raise ValueError("Python inner timeout must be shorter than Node outer deadline")


def build_ai_readiness(*, configuration_valid: bool, profile_recognized: bool,
                       embedding_available: bool, index_available: bool,
                       runtime_available: bool) -> AiReadiness:
    """Build a sanitized readiness result without probing or loading prerequisites."""
    checks = (
        (configuration_valid, "configuration_invalid"),
        (profile_recognized, "profile_unrecognized"),
        (embedding_available, "embedding_prerequisite_unavailable"),
        (index_available, "index_prerequisite_unavailable"),
        (runtime_available, "runtime_prerequisite_unavailable"),
    )
    reasons = tuple(reason for passed, reason in checks if not passed)
    return AiReadiness(
        status="not_ready" if reasons else "ready",
        profile_id=PHASE8_ASSISTANT_PROFILE_ID,
        reasons=reasons,
    )


def internal_error_http_status(code: AiErrorCode) -> int:
    return AI_ERROR_HTTP_STATUS[code]


def explicit_rollback_profile_available() -> str:
    """Expose MiniLM's existing profile identity; never select it automatically."""
    return MINILM_PROFILE_ID
