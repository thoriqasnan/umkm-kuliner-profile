import pytest

from sari_rasa_data.llm_contracts import LLMInvalidRequestError, LLMRequest


@pytest.mark.parametrize("language", ["id", "en"])
def test_request_accepts_supported_languages(language):
    request = LLMRequest("Be concise", "Hello", language, 64, "request-1")
    assert request.language == language
    assert request.correlation_id == "request-1"


@pytest.mark.parametrize(
    "overrides",
    [
        {"language": "fr"},
        {"user_input": "  "},
        {"system_instruction": ""},
        {"max_output_tokens": 0},
        {"max_output_tokens": 1025},
        {"max_output_tokens": True},
        {"correlation_id": ""},
    ],
)
def test_request_rejects_invalid_input(overrides):
    values = dict(system_instruction="Be concise", user_input="Hello", language="en", max_output_tokens=64)
    values.update(overrides)
    with pytest.raises(LLMInvalidRequestError):
        LLMRequest(**values)
