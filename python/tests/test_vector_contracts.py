from dataclasses import FrozenInstanceError

import pytest

from sari_rasa_data.embedding_contracts import EmbeddingInvalidLanguageError
from sari_rasa_data.vector_contracts import (
    VectorSearchRequest,
    VectorSpace,
    VectorStoreInvalidInputError,
)


def space(**changes):
    values = dict(
        provider="fake",
        model="deterministic",
        dimensions=3,
        normalization="none",
        text_version="7d-catalog-text-v1",
    )
    values.update(changes)
    return VectorSpace(**values)


def test_vector_space_is_immutable_and_key_is_stable_and_complete():
    first = space()
    assert first.key == space().key
    assert first.key != space(model="other").key
    assert first.key != space(provider="other").key
    assert first.key != space(dimensions=4).key
    assert first.key != space(text_version="v2").key
    assert first.key != space(embedding_profile="7h-embedding-profile-e5-v1").key
    with pytest.raises(FrozenInstanceError):
        first.model = "changed"


@pytest.mark.parametrize(
    "changes",
    [
        {"provider": ""},
        {"model": ""},
        {"dimensions": 0},
        {"dimensions": True},
        {"normalization": "unit"},
        {"text_version": ""},
        {"embedding_profile": ""},
    ],
)
def test_invalid_vector_space_rejected(changes):
    with pytest.raises(VectorStoreInvalidInputError):
        space(**changes)


@pytest.mark.parametrize("top_k", [0, 51, True, 1.5])
def test_search_bounds_are_strict(top_k):
    with pytest.raises(VectorStoreInvalidInputError):
        VectorSearchRequest(space(), (1.0, 0.0, 0.0), top_k=top_k)


def test_search_rejects_wrong_dimensions_nonfinite_and_language():
    with pytest.raises(VectorStoreInvalidInputError, match="dimensions"):
        VectorSearchRequest(space(), (1.0, 0.0))
    with pytest.raises(VectorStoreInvalidInputError, match="finite"):
        VectorSearchRequest(space(), (float("nan"), 0.0, 1.0))
    with pytest.raises(EmbeddingInvalidLanguageError):
        VectorSearchRequest(space(), (1.0, 0.0, 0.0), language="fr")


def test_category_filter_is_bounded():
    for category in ("", " ", "x" * 101):
        with pytest.raises(VectorStoreInvalidInputError):
            VectorSearchRequest(space(), (1.0, 0.0, 0.0), category=category)
