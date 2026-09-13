import pytest

from sari_rasa_data.embedding_contracts import EmbeddingConfigUnavailableError, EmbeddingInvalidInputError
from sari_rasa_data.embedding_profiles import (
    E5_MODEL_ID,
    E5_PROFILE,
    E5_PROFILE_ID,
    MINILM_MODEL_ID,
    MINILM_PROFILE,
    MINILM_PROFILE_ID,
    resolve_embedding_profile,
)


def test_minilm_query_and_document_inputs_remain_exactly_unchanged():
    value = "  name: Soto\ncategory: makanan  "
    assert MINILM_PROFILE.prepare_query(value) == value
    assert MINILM_PROFILE.prepare_document(value) == value


def test_e5_applies_exact_retrieval_roles_and_deterministic_normalization():
    assert E5_PROFILE.prepare_query("  Ｓoto\n ayam  ") == "query: Soto ayam"
    assert E5_PROFILE.prepare_document(" name: Soto\n description: hangat ") == (
        "passage: name: Soto description: hangat"
    )
    assert E5_PROFILE.prepare_query("query:   Soto\nayam") == "query: Soto ayam"
    assert E5_PROFILE.prepare_document("PASSAGE:  Soto ayam") == "passage: Soto ayam"


@pytest.mark.parametrize("value", ["", "   ", "query:"])
def test_e5_blank_or_prefix_only_input_fails_closed(value):
    with pytest.raises(EmbeddingInvalidInputError):
        E5_PROFILE.prepare_query(value)


def test_known_models_resolve_automatically_and_exact_pairs_resolve_explicitly():
    assert resolve_embedding_profile(MINILM_MODEL_ID) is MINILM_PROFILE
    assert resolve_embedding_profile(E5_MODEL_ID) is E5_PROFILE
    assert resolve_embedding_profile(MINILM_MODEL_ID, MINILM_PROFILE_ID) is MINILM_PROFILE
    assert resolve_embedding_profile(E5_MODEL_ID, E5_PROFILE_ID) is E5_PROFILE


@pytest.mark.parametrize(
    "model,profile",
    [
        ("unknown/model", None),
        (MINILM_MODEL_ID, E5_PROFILE_ID),
        (E5_MODEL_ID, MINILM_PROFILE_ID),
        (E5_MODEL_ID, "unknown-profile"),
    ],
)
def test_unknown_or_incompatible_model_profile_combinations_fail_closed(model, profile):
    with pytest.raises(EmbeddingConfigUnavailableError):
        resolve_embedding_profile(model, profile)


def test_profiles_contain_no_case_or_product_specific_inputs():
    combined = repr((MINILM_PROFILE, E5_PROFILE)).casefold()
    assert "ret-" not in combined
    assert "product_id" not in combined
