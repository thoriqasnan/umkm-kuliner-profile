"""Deterministic public-catalog projection and Phase 7D embedding pipeline."""

from hashlib import sha256
import unicodedata
from typing import Iterable

from .embedding_contracts import (
    EmbeddingClient,
    EmbeddingInvalidInputError,
    EmbeddingInvalidLanguageError,
    EmbeddingLanguage,
    EmbeddingRequest,
    ProductEmbeddingRecord,
)
from .menu_prompts import PublicMenuItem
from .embedding_profiles import EmbeddingProfile, MINILM_PROFILE


CATALOG_TEXT_VERSION_V1 = "7d-catalog-text-v1"
CATALOG_TEXT_VERSION_V2 = "7d-catalog-text-v2"
CATALOG_TEXT_VERSION = CATALOG_TEXT_VERSION_V1
SUPPORTED_CATALOG_TEXT_VERSIONS = frozenset(
    {CATALOG_TEXT_VERSION_V1, CATALOG_TEXT_VERSION_V2}
)
_BILINGUAL_CATEGORY_LABELS = {
    "makanan": {"id": "makanan", "en": "food"},
    "minuman": {"id": "minuman", "en": "drink"},
    "snack": {"id": "camilan", "en": "snack"},
}


def project_catalog_semantic_text(
    item: PublicMenuItem,
    language: EmbeddingLanguage,
    text_version: str = CATALOG_TEXT_VERSION_V1,
) -> str:
    """Project a versioned, deterministic public-catalog semantic document."""
    if not isinstance(item, PublicMenuItem):
        raise EmbeddingInvalidInputError("item must be a PublicMenuItem")
    if language not in ("id", "en"):
        raise EmbeddingInvalidLanguageError("language must be 'id' or 'en'")
    if text_version not in SUPPORTED_CATALOG_TEXT_VERSIONS:
        raise EmbeddingInvalidInputError("unsupported catalog semantic text version")
    if text_version == CATALOG_TEXT_VERSION_V1:
        description = item.description_id if language == "id" else item.description_en
        values = (
            ("name", item.name),
            ("category", item.category),
            ("description", description),
        )
    else:
        category_key = _normalize(item.category).casefold()
        category = _BILINGUAL_CATEGORY_LABELS.get(category_key)
        if category is None:
            raise EmbeddingInvalidInputError(
                "category is not supported by the bilingual semantic projection"
            )
        secondary = "en" if language == "id" else "id"
        descriptions = {"id": item.description_id, "en": item.description_en}
        values = (
            ("name", item.name),
            (f"category_{language}", category[language]),
            (f"description_{language}", descriptions[language]),
            (f"category_{secondary}", category[secondary]),
            (f"description_{secondary}", descriptions[secondary]),
        )
    normalized = []
    for field_name, value in values:
        if not isinstance(value, str) or not value.strip():
            raise EmbeddingInvalidInputError(f"{field_name} must not be blank")
        normalized.append((field_name, _normalize(value)))
    return "\n".join(f"{field_name}: {value}" for field_name, value in normalized)


def semantic_content_hash(
    semantic_text: str,
    language: EmbeddingLanguage,
    text_version: str = CATALOG_TEXT_VERSION,
) -> str:
    if language not in ("id", "en"):
        raise EmbeddingInvalidLanguageError("language must be 'id' or 'en'")
    if not isinstance(text_version, str) or not text_version.strip():
        raise EmbeddingInvalidInputError("text_version must not be blank")
    if not isinstance(semantic_text, str) or not semantic_text.strip():
        raise EmbeddingInvalidInputError("semantic_text must not be blank")
    payload = f"{text_version}\0{language}\0{semantic_text}".encode("utf-8")
    return sha256(payload).hexdigest()


def embed_catalog(
    catalog: Iterable[PublicMenuItem],
    languages: Iterable[EmbeddingLanguage],
    client: EmbeddingClient,
    *,
    text_version: str = CATALOG_TEXT_VERSION_V1,
    profile: EmbeddingProfile = MINILM_PROFILE,
) -> tuple[ProductEmbeddingRecord, ...]:
    items = tuple(catalog)
    if any(not isinstance(item, PublicMenuItem) for item in items):
        raise EmbeddingInvalidInputError("catalog entries must be PublicMenuItem values")
    language_set = set(languages)
    if not language_set:
        raise EmbeddingInvalidInputError("at least one language is required")
    if not language_set <= {"id", "en"}:
        raise EmbeddingInvalidLanguageError("languages may contain only 'id' and 'en'")
    if text_version not in SUPPORTED_CATALOG_TEXT_VERSIONS:
        raise EmbeddingInvalidInputError("unsupported catalog semantic text version")
    if not isinstance(profile, EmbeddingProfile):
        raise EmbeddingInvalidInputError("profile must be an EmbeddingProfile")
    product_ids = [item.product_id for item in items]
    slugs = [item.slug for item in items]
    if len(product_ids) != len(set(product_ids)) or len(slugs) != len(set(slugs)):
        raise EmbeddingInvalidInputError("catalog product_id and slug values must be unique")

    records = []
    for item in sorted(items, key=lambda value: (value.product_id, value.slug)):
        for language in (lang for lang in ("id", "en") if lang in language_set):
            text = project_catalog_semantic_text(item, language, text_version)
            result = client.embed(EmbeddingRequest(profile.prepare_document(text), language))
            records.append(
                ProductEmbeddingRecord(
                    product_id=item.product_id,
                    slug=item.slug,
                    language=language,
                    text_version=text_version,
                    semantic_text=text,
                    content_hash=semantic_content_hash(text, language, text_version),
                    provider=result.provider,
                    model=result.model,
                    dimensions=result.dimensions,
                    vector=result.vector,
                    embedding_profile=profile.profile_id,
                )
            )
    return tuple(records)


def _normalize(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split())
