from dataclasses import FrozenInstanceError, replace
import math

import pytest

from sari_rasa_data.embedding_contracts import (
    EmbeddingInvalidInputError,
    EmbeddingInvalidLanguageError,
    EmbeddingInvalidVectorError,
    EmbeddingVector,
    ProductEmbeddingRecord,
)
from sari_rasa_data.embedding_fake import FakeEmbeddingClient
from sari_rasa_data.embedding_profiles import E5_PROFILE, E5_PROFILE_ID, MINILM_PROFILE_ID
from sari_rasa_data.embeddings import (
    CATALOG_TEXT_VERSION,
    CATALOG_TEXT_VERSION_V1,
    CATALOG_TEXT_VERSION_V2,
    embed_catalog,
    project_catalog_semantic_text,
    semantic_content_hash,
)
from sari_rasa_data.menu_prompts import PublicMenuItem


def item(**changes):
    base = PublicMenuItem(
        2, "nasi-goreng", "  Nasi   Goreng  ", " Makanan ", 18000,
        "Nasi\n goreng khas.", "Signature fried rice.",
    )
    return replace(base, **changes)


def test_projection_uses_selected_description_and_explicit_field_order():
    assert project_catalog_semantic_text(item(), "id") == (
        "name: Nasi Goreng\ncategory: Makanan\ndescription: Nasi goreng khas."
    )


def test_v1_projection_remains_the_historical_default():
    assert CATALOG_TEXT_VERSION == CATALOG_TEXT_VERSION_V1
    assert project_catalog_semantic_text(item(), "id") == project_catalog_semantic_text(
        item(), "id", CATALOG_TEXT_VERSION_V1
    )


def test_v2_indonesian_projection_is_language_first_and_bilingual():
    text = project_catalog_semantic_text(
        item(category=" snack "), "id", CATALOG_TEXT_VERSION_V2
    )
    assert text == (
        "name: Nasi Goreng\n"
        "category_id: camilan\n"
        "description_id: Nasi goreng khas.\n"
        "category_en: snack\n"
        "description_en: Signature fried rice."
    )
    assert text.index("category_id") < text.index("category_en")


def test_v2_english_projection_is_language_first_and_bilingual():
    text = project_catalog_semantic_text(
        item(category=" MINUMAN "), "en", CATALOG_TEXT_VERSION_V2
    )
    assert text == (
        "name: Nasi Goreng\n"
        "category_en: drink\n"
        "description_en: Signature fried rice.\n"
        "category_id: minuman\n"
        "description_id: Nasi goreng khas."
    )
    assert text.index("category_en") < text.index("category_id")


def test_v2_is_deterministic_normalized_and_excludes_nonsemantic_fields():
    first = project_catalog_semantic_text(
        item(category=" makanan ", description_en="Ｓignature   fried\nrice."),
        "en",
        CATALOG_TEXT_VERSION_V2,
    )
    changed = project_catalog_semantic_text(
        item(product_id=999, slug="other", price_rupiah=1, category="makanan", description_en="Signature fried rice."),
        "en",
        CATALOG_TEXT_VERSION_V2,
    )
    assert first == changed
    assert all(value not in first for value in ("999", "other", "Rp", "bola daging", "soup"))


@pytest.mark.parametrize(
    "category,expected_id,expected_en",
    [("makanan", "makanan", "food"), ("minuman", "minuman", "drink"), ("snack", "camilan", "snack")],
)
def test_v2_uses_only_the_canonical_bilingual_category_mapping(category, expected_id, expected_en):
    text = project_catalog_semantic_text(item(category=category), "id", CATALOG_TEXT_VERSION_V2)
    assert f"category_id: {expected_id}" in text
    assert f"category_en: {expected_en}" in text
    assert project_catalog_semantic_text(item(), "en") == (
        "name: Nasi Goreng\ncategory: Makanan\ndescription: Signature fried rice."
    )


def test_excluded_fields_do_not_affect_projection():
    original = project_catalog_semantic_text(item(), "id")
    changed = item(product_id=99, slug="changed", price_rupiah=999999)
    assert project_catalog_semantic_text(changed, "id") == original


@pytest.mark.parametrize("changed,language", [({"description_id": " "}, "id"), ({"description_en": " "}, "en")])
def test_projection_rejects_missing_selected_description(changed, language):
    with pytest.raises(EmbeddingInvalidInputError):
        project_catalog_semantic_text(item(**changed), language)


@pytest.mark.parametrize("changed", [{"name": " "}, {"category": " "}])
def test_public_item_rejects_missing_shared_semantic_values_before_projection(changed):
    with pytest.raises(ValueError):
        item(**changed)


def test_projection_rejects_invalid_language():
    with pytest.raises(EmbeddingInvalidLanguageError):
        project_catalog_semantic_text(item(), "fr")


def test_hash_is_deterministic_and_tracks_semantic_identity():
    text = project_catalog_semantic_text(item(), "id")
    assert semantic_content_hash(text, "id") == semantic_content_hash(text, "id")
    assert semantic_content_hash(text, "id") != semantic_content_hash(text, "en")
    assert semantic_content_hash(text, "id") != semantic_content_hash(text + " changed", "id")
    assert semantic_content_hash(text, "id") != semantic_content_hash(text, "id", "v2")


@pytest.mark.parametrize("field,value", [("name", "Other"), ("category", "Snack"), ("description_id", "Other")])
def test_relevant_catalog_changes_change_hash(field, value):
    first = project_catalog_semantic_text(item(), "id")
    second = project_catalog_semantic_text(item(**{field: value}), "id")
    assert semantic_content_hash(first, "id") != semantic_content_hash(second, "id")


def test_excluded_catalog_changes_do_not_change_hash():
    first = project_catalog_semantic_text(item(), "id")
    changed = project_catalog_semantic_text(item(product_id=8, slug="other", price_rupiah=1), "id")
    assert semantic_content_hash(first, "id") == semantic_content_hash(changed, "id")


def test_fake_is_deterministic_finite_and_dimensioned():
    records = embed_catalog([item()], ["id"], FakeEmbeddingClient(5))
    again = embed_catalog([item()], ["id"], FakeEmbeddingClient(5))
    assert records == again
    assert records[0].dimensions == len(records[0].vector) == 5
    assert all(math.isfinite(value) for value in records[0].vector)


@pytest.mark.parametrize("dimensions", [0, -1, True, 1.5])
def test_fake_rejects_invalid_dimensions(dimensions):
    with pytest.raises(EmbeddingInvalidInputError):
        FakeEmbeddingClient(dimensions)


def valid_record(**changes):
    values = dict(
        product_id=1, slug="item", language="id", text_version=CATALOG_TEXT_VERSION,
        semantic_text="name: Item\ncategory: Food\ndescription: Good",
        content_hash="a" * 64, provider="fake", model="fake", dimensions=2,
        vector=(0.1, 0.2),
    )
    values.update(changes)
    return ProductEmbeddingRecord(**values)


@pytest.mark.parametrize(
    "changes",
    [
        {"dimensions": 3}, {"dimensions": 0}, {"vector": ()},
        {"vector": (float("nan"), 0.2)}, {"vector": (float("inf"), 0.2)},
        {"vector": ("0.1", 0.2)},
    ],
)
def test_record_rejects_invalid_vectors(changes):
    with pytest.raises(EmbeddingInvalidVectorError):
        valid_record(**changes)


def test_record_is_immutable():
    with pytest.raises(FrozenInstanceError):
        valid_record().slug = "changed"


def test_batch_is_canonically_ordered_one_per_product_language_with_metadata():
    first = item(product_id=10, slug="ten")
    second = item(product_id=2, slug="two")
    records = embed_catalog([first, second], ["en", "id"], FakeEmbeddingClient(3))
    assert [(record.product_id, record.slug, record.language) for record in records] == [
        (2, "two", "id"), (2, "two", "en"), (10, "ten", "id"), (10, "ten", "en")
    ]
    assert all(record.text_version == CATALOG_TEXT_VERSION for record in records)
    assert all(record.provider == "fake" and record.model == "deterministic-sha256" for record in records)
    assert all(record.embedding_profile == MINILM_PROFILE_ID for record in records)


def test_e5_profile_formats_document_request_without_changing_v2_record_text():
    class RecordingFake(FakeEmbeddingClient):
        def __init__(self):
            super().__init__(3)
            self.requests = []

        def embed(self, request):
            self.requests.append(request)
            return super().embed(request)

    client = RecordingFake()
    record = embed_catalog(
        [item()], ["id"], client,
        text_version=CATALOG_TEXT_VERSION_V2,
        profile=E5_PROFILE,
    )[0]
    expected = project_catalog_semantic_text(item(), "id", CATALOG_TEXT_VERSION_V2)
    assert client.requests[0].semantic_text == f"passage: {' '.join(expected.split())}"
    assert record.semantic_text == expected
    assert record.embedding_profile == E5_PROFILE_ID


def test_v2_records_change_text_and_vector_space_identity_without_affecting_v1():
    v1 = embed_catalog([item()], ["id"], FakeEmbeddingClient(3))
    v2 = embed_catalog(
        [item()], ["id"], FakeEmbeddingClient(3), text_version=CATALOG_TEXT_VERSION_V2
    )
    from sari_rasa_data.vector_contracts import VectorSpace

    assert v1[0].text_version == CATALOG_TEXT_VERSION_V1
    assert v2[0].text_version == CATALOG_TEXT_VERSION_V2
    assert v1[0].semantic_text != v2[0].semantic_text
    assert VectorSpace.from_embedding(v1[0]).key != VectorSpace.from_embedding(v2[0]).key


def test_embedding_vector_also_validates_at_client_boundary():
    with pytest.raises(EmbeddingInvalidVectorError):
        EmbeddingVector("provider", "model", 1, (float("nan"),))
