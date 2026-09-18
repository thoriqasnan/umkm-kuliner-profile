import json
from dataclasses import FrozenInstanceError

import pytest

from sari_rasa_data.llm_contracts import (
    LLMSourceValidationError,
    LLMStructuredContractError,
    LLMStructuredOutputParseError,
)
from sari_rasa_data.llm_structured import (
    PUBLIC_MENU_RESPONSE_SCHEMA,
    STRUCTURED_MENU_SCHEMA_VERSION,
    StructuredLLMResponse,
    parse_structured_menu_response,
)


ALLOWED = frozenset({"product:1", "product:2"})


def payload(**overrides):
    value = {
        "answer": "Nasi Goreng tersedia.",
        "sources": ["product:1"],
        "insufficient_information": False,
        "limitations": [],
        "language": "id",
    }
    value.update(overrides)
    return json.dumps(value)


@pytest.mark.parametrize(
    "language,answer", [("id", "Nasi Goreng tersedia."), ("en", "Fried rice is listed.")]
)
def test_valid_bilingual_response_is_immutable(language, answer):
    result = parse_structured_menu_response(payload(language=language, answer=answer), ALLOWED)
    assert result == StructuredLLMResponse(answer, ("product:1",), False, (), language)
    with pytest.raises(FrozenInstanceError):
        result.answer = "changed"


def test_response_schema_and_parser_enforce_shared_output_bounds():
    assert PUBLIC_MENU_RESPONSE_SCHEMA["properties"]["answer"]["maxLength"] == 4000
    assert PUBLIC_MENU_RESPONSE_SCHEMA["properties"]["sources"]["maxItems"] == 5
    assert PUBLIC_MENU_RESPONSE_SCHEMA["properties"]["limitations"]["maxItems"] == 10
    with pytest.raises(LLMStructuredContractError):
        parse_structured_menu_response(payload(answer="x" * 4001), ALLOWED)


def test_valid_insufficient_response_and_limitations():
    result = parse_structured_menu_response(
        payload(
            answer="Informasi menu tidak cukup.",
            sources=[],
            insufficient_information=True,
            limitations=["Informasi bahan tidak tersedia."],
        ),
        ALLOWED,
    )
    assert result.insufficient_information is True
    assert result.limitations == ("Informasi bahan tidak tersedia.",)


@pytest.mark.parametrize("raw", ["not-json", "[1]", "null"])
def test_malformed_or_non_object_json_rejected(raw):
    error = LLMStructuredOutputParseError if raw == "not-json" else LLMStructuredContractError
    with pytest.raises(error):
        parse_structured_menu_response(raw, ALLOWED)


@pytest.mark.parametrize(
    "change",
    [
        {"answer": ""},
        {"answer": 1},
        {"sources": "product:1"},
        {"sources": [1]},
        {"insufficient_information": "false"},
        {"limitations": "none"},
        {"limitations": [""]},
        {"limitations": ["x" * 257]},
        {"limitations": ["x"] * 11},
        {"language": "fr"},
    ],
)
def test_wrong_types_and_values_rejected(change):
    with pytest.raises(LLMStructuredContractError):
        parse_structured_menu_response(payload(**change), ALLOWED)


def test_missing_and_extra_fields_rejected():
    missing = json.loads(payload())
    del missing["answer"]
    extra = json.loads(payload())
    extra["confidence"] = 1
    for value in (missing, extra):
        with pytest.raises(LLMStructuredContractError):
            parse_structured_menu_response(json.dumps(value), ALLOWED)


def test_unknown_source_is_not_silently_removed():
    with pytest.raises(LLMSourceValidationError):
        parse_structured_menu_response(payload(sources=["product:999"]), ALLOWED)


def test_duplicate_sources_rejected():
    with pytest.raises(LLMStructuredContractError, match="duplicates"):
        parse_structured_menu_response(payload(sources=["product:1", "product:1"]), ALLOWED)


def test_schema_is_explicit_strict_and_versioned():
    assert STRUCTURED_MENU_SCHEMA_VERSION == "phase-7c.public-menu-response.v1"
    assert "additionalProperties" not in PUBLIC_MENU_RESPONSE_SCHEMA
    assert set(PUBLIC_MENU_RESPONSE_SCHEMA["required"]) == set(
        PUBLIC_MENU_RESPONSE_SCHEMA["properties"]
    )
