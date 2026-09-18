import json
import subprocess
import sys

import pytest
from pydantic import ValidationError

from sari_rasa_data.ai_contracts import (
    AI_ERROR_HTTP_STATUS,
    AI_TIMEOUT_OWNERSHIP,
    ASSISTANT_AUTHORITY,
    KNOWN_VERIFIED_E5_DIMENSIONS,
    PHASE8_ASSISTANT_RUNTIME_PROFILE,
    PROHIBITED_AUTHORITY,
    AiReadiness,
    AssistantRuntimeProfile,
    InternalAiRequest,
    InternalAiResponse,
    build_ai_readiness,
    explicit_rollback_profile_available,
    internal_error_http_status,
    select_response_language,
    validate_runtime_dimensions,
    validate_timeout_ownership,
)
from sari_rasa_data.embedding_profiles import E5_MODEL_ID, E5_PROFILE_ID, MINILM_PROFILE_ID
from sari_rasa_data.embeddings import CATALOG_TEXT_VERSION, CATALOG_TEXT_VERSION_V2
from sari_rasa_data.hybrid_retrieval import HYBRID_RETRIEVAL_POLICY, SEMANTIC_RETRIEVAL_POLICY


CORRELATION_ID = "123e4567-e89b-42d3-a456-426614174000"


@pytest.mark.parametrize(
    "message,interface_language,expected",
    [
        ("Recommend a soupy dish.", "en", "en"),
        ("Rekomendasikan makanan berkuah.", "en", "id"),
        ("Rekomendasikan makanan berkuah.", "id", "id"),
        ("Recommend a soupy dish.", "id", "en"),
        ("Soto?", "en", "en"),
        ("Rp20.000?", "id", "id"),
        ("I want makanan berkuah yang murah.", "en", "id"),
        ("sepertinya enak ya", "en", "id"),
        ("kayaknya enak deh", "en", "id"),
        ("looks really tasty", "id", "en"),
        ("Soto?", "id", "id"),
    ],
)
def test_response_language_uses_current_message_then_interface_fallback(
    message, interface_language, expected
):
    assert select_response_language(message, interface_language) == expected


def item(**changes):
    value = {
        "product_id": 6,
        "slug": "es-jeruk-peras",
        "name": "Es Jeruk Peras",
        "category": "minuman",
        "price_rupiah": 8000,
        "description_id": "Jeruk peras asli.",
        "description_en": "Fresh squeezed orange.",
    }
    value.update(changes)
    return value


def request(**changes):
    value = {
        "message": "Ada minuman?",
        "language": "id",
        "correlation_id": CORRELATION_ID,
        "catalog": [item()],
    }
    value.update(changes)
    return value


def response(**changes):
    value = {
        "answer": "Es Jeruk Peras tersedia.",
        "language": "id",
        "insufficient_information": False,
        "limitations": [],
        "sources": [{"source_id": "menu:1", "product_id": 6}],
    }
    value.update(changes)
    return value


def test_internal_request_is_strict_trimmed_bilingual_and_exact():
    parsed = InternalAiRequest.model_validate(request(message="  Menu?  "))
    assert parsed.message == "Menu?"
    assert InternalAiRequest.model_validate(request(language="en")).language == "en"
    for invalid in (
        request(message=" "), request(message="x" * 1001), request(language="fr"),
        request(message=1), request(model="attacker-model"), request(correlation_id="user-1"),
    ):
        with pytest.raises(ValidationError):
            InternalAiRequest.model_validate(invalid)


def test_catalog_allowlist_validation_order_and_identity():
    valid = InternalAiRequest.model_validate(request()).catalog[0]
    assert set(valid.model_dump()) == {
        "product_id", "slug", "name", "category", "price_rupiah",
        "description_id", "description_en",
    }
    for invalid_item in (
        item(admin_role="admin"), item(product_id=0), item(price_rupiah=-1),
        item(price_rupiah=8.5), item(description_id=" "), item(description_en=1),
    ):
        with pytest.raises(ValidationError):
            InternalAiRequest.model_validate(request(catalog=[invalid_item]))
    with pytest.raises(ValidationError):
        InternalAiRequest.model_validate(request(catalog=[item(product_id=7), item(product_id=6)]))
    with pytest.raises(ValidationError):
        InternalAiRequest.model_validate(request(catalog=[item(), item()]))


def test_internal_response_reuses_grounding_and_insufficiency_semantics():
    assert InternalAiResponse.model_validate(response()).sources[0].product_id == 6
    insufficient = InternalAiResponse.model_validate(response(
        answer="Informasi bahan tidak tersedia.",
        insufficient_information=True,
        limitations=["Informasi bahan tidak tersedia."],
        sources=[],
    ))
    assert insufficient.insufficient_information and insufficient.sources == ()
    for invalid in (
        response(language="fr"), response(extra="private"),
        response(sources=[{"source_id": "menu:9", "product_id": 6}]),
        response(sources=[{"source_id": "menu:1", "product_id": 6}, {"source_id": "menu:1", "product_id": 7}]),
        response(insufficient_information=True),
        response(insufficient_information=True, sources=[], limitations=[]),
        response(sources=[]),
        response(answer="x" * 4001),
        response(limitations=["x" * 257]),
        response(limitations=["bounded"] * 11),
        response(sources=[{"source_id": f"menu:{index + 1}", "product_id": index + 1} for index in range(6)]),
    ):
        with pytest.raises(ValidationError):
            InternalAiResponse.model_validate(invalid)


def test_phase8_profile_is_explicit_e5_v2_hybrid_without_default_switch_or_fallback():
    profile = PHASE8_ASSISTANT_RUNTIME_PROFILE
    profile.validate()
    assert profile.embedding_model == E5_MODEL_ID
    assert profile.embedding_profile == E5_PROFILE_ID
    assert profile.semantic_text_version == CATALOG_TEXT_VERSION_V2
    assert profile.retrieval_policy == HYBRID_RETRIEVAL_POLICY
    assert profile.expected_dimensions is None
    assert CATALOG_TEXT_VERSION != CATALOG_TEXT_VERSION_V2
    assert explicit_rollback_profile_available() == MINILM_PROFILE_ID
    assert SEMANTIC_RETRIEVAL_POLICY != profile.retrieval_policy
    assert validate_runtime_dimensions(KNOWN_VERIFIED_E5_DIMENSIONS) == 768
    assert validate_runtime_dimensions(768, 768) == 768
    with pytest.raises(ValueError):
        validate_runtime_dimensions(768, 384)


def test_unknown_or_mismatched_runtime_profiles_fail_closed():
    base = PHASE8_ASSISTANT_RUNTIME_PROFILE
    for invalid in (
        AssistantRuntimeProfile("unknown", base.embedding_model, base.embedding_profile, base.semantic_text_version, base.retrieval_policy),
        AssistantRuntimeProfile(base.profile_id, base.embedding_model, MINILM_PROFILE_ID, base.semantic_text_version, base.retrieval_policy),
        AssistantRuntimeProfile(base.profile_id, base.embedding_model, base.embedding_profile, "7d-catalog-text-v1", base.retrieval_policy),
        AssistantRuntimeProfile(base.profile_id, base.embedding_model, base.embedding_profile, base.semantic_text_version, SEMANTIC_RETRIEVAL_POLICY),
    ):
        with pytest.raises(ValueError):
            invalid.validate()


def test_readiness_is_sanitized_and_does_not_load_e5():
    before = set(sys.modules)
    ready = build_ai_readiness(configuration_valid=True, profile_recognized=True,
        embedding_available=True, index_available=True, runtime_available=True)
    assert ready.model_dump() == {
        "status": "ready", "profile_id": "phase-8.customer-menu-e5-v1", "reasons": (),
        "provider_configuration": "unconfigured", "provider_probe": "not_performed",
    }
    not_ready = build_ai_readiness(configuration_valid=False, profile_recognized=True,
        embedding_available=False, index_available=False, runtime_available=True)
    payload = json.dumps(not_ready.model_dump())
    assert not_ready.status == "not_ready"
    assert "configuration_invalid" in not_ready.reasons
    assert not any(value in payload.casefold() for value in ("api_key", "/users/", ".env", "cache_path"))
    assert "sentence_transformers" not in set(sys.modules) - before
    with pytest.raises(ValidationError):
        AiReadiness(status="ready", profile_id="phase-8.customer-menu-e5-v1", reasons=("configuration_invalid",))


def test_error_and_timeout_contracts_are_bounded_and_deterministic():
    assert AI_ERROR_HTTP_STATUS == {
        "invalid_request": 400, "rate_limited": 429, "upstream_timeout": 504,
        "upstream_unavailable": 502, "invalid_upstream_response": 502,
        "ai_runtime_unavailable": 503, "internal_error": 500,
    }
    assert internal_error_http_status("ai_runtime_unavailable") == 503
    assert AI_TIMEOUT_OWNERSHIP["ordering"] == "python_inner_timeout_must_be_shorter_than_node_outer_deadline"
    validate_timeout_ownership(15, 10)
    for outer, inner in ((10, 10), (10, 11), (61, 10), (10, 0)):
        with pytest.raises(ValueError):
            validate_timeout_ownership(outer, inner)


def test_public_assistant_authority_is_explicit_and_narrow():
    assert ASSISTANT_AUTHORITY == {"public", "read_only", "public_menu_only"}
    assert {"credentials", "sessions", "carts", "orders", "payment", "shell", "filesystem"} <= PROHIBITED_AUTHORITY


def test_import_has_no_provider_model_database_or_network_side_effect():
    code = """
import sys
import sari_rasa_data.ai_contracts
forbidden = {
    'sari_rasa_data.llm_gemini', 'sari_rasa_data.service',
    'sentence_transformers', 'sqlite3', 'httpx',
}
print(','.join(sorted(forbidden & set(sys.modules))))
"""
    completed = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, check=False
    )
    assert completed.returncode == 0
    assert completed.stdout == "\n"
    assert completed.stderr == ""
