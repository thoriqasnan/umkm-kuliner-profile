"""Small, explicit model-input profiles for retrieval embeddings."""

from dataclasses import dataclass
import unicodedata

from .embedding_contracts import EmbeddingConfigUnavailableError, EmbeddingInvalidInputError


MINILM_MODEL_ID = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
E5_MODEL_ID = "intfloat/multilingual-e5-base"
MINILM_PROFILE_ID = "7d-embedding-profile-minilm-v1"
E5_PROFILE_ID = "7h-embedding-profile-e5-v1"


@dataclass(frozen=True)
class EmbeddingProfile:
    profile_id: str
    model_id: str
    query_prefix: str | None = None
    document_prefix: str | None = None

    def prepare_query(self, value: str) -> str:
        return self._prepare(value, self.query_prefix)

    def prepare_document(self, value: str) -> str:
        return self._prepare(value, self.document_prefix)

    @staticmethod
    def _prepare(value: str, prefix: str | None) -> str:
        if not isinstance(value, str) or not value.strip():
            raise EmbeddingInvalidInputError("embedding profile input must not be blank")
        if prefix is None:
            return value
        normalized = " ".join(unicodedata.normalize("NFKC", value).split())
        marker = f"{prefix}:"
        if normalized.casefold().startswith(marker.casefold()):
            remainder = normalized[len(marker):].strip()
            if not remainder:
                raise EmbeddingInvalidInputError("embedding profile input must contain text")
            return f"{prefix}: {remainder}"
        return f"{prefix}: {normalized}"


MINILM_PROFILE = EmbeddingProfile(MINILM_PROFILE_ID, MINILM_MODEL_ID)
E5_PROFILE = EmbeddingProfile(E5_PROFILE_ID, E5_MODEL_ID, "query", "passage")
_PROFILES_BY_ID = {
    MINILM_PROFILE_ID: MINILM_PROFILE,
    E5_PROFILE_ID: E5_PROFILE,
}


def resolve_embedding_profile(
    model_id: str, profile_id: str | None = None
) -> EmbeddingProfile:
    """Resolve only known exact model/profile pairs; never infer a family by substring."""
    if not isinstance(model_id, str) or not model_id.strip():
        raise EmbeddingConfigUnavailableError("an embedding model is required")
    normalized_model = model_id.strip()
    if profile_id is None:
        matches = tuple(
            profile for profile in _PROFILES_BY_ID.values()
            if profile.model_id == normalized_model
        )
        if len(matches) != 1:
            raise EmbeddingConfigUnavailableError("embedding model requires an explicit supported profile")
        return matches[0]
    if not isinstance(profile_id, str) or not profile_id.strip():
        raise EmbeddingConfigUnavailableError("embedding profile is required")
    profile = _PROFILES_BY_ID.get(profile_id.strip())
    if profile is None or profile.model_id != normalized_model:
        raise EmbeddingConfigUnavailableError("embedding model and profile are incompatible")
    return profile
