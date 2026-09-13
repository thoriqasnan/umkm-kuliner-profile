import pytest

from sari_rasa_data.llm_contracts import LLMRequest, LLMTimeoutError
from sari_rasa_data.llm_fake import FakeLLMClient


def request(language="id", correlation_id="corr-1"):
    return LLMRequest("Be concise", "Describe SariRasa", language, 32, correlation_id)


def test_fake_is_deterministic_and_normalized():
    client = FakeLLMClient()
    first = client.generate(request())
    second = client.generate(request())
    assert first == second
    assert first.provider == "fake"
    assert first.model == "deterministic-v1"
    assert first.finish_reason == "stop"
    assert first.correlation_id == "corr-1"
    assert first.usage.total_tokens == 19


def test_fake_supports_english_and_timeout():
    assert "serves" in FakeLLMClient().generate(request("en")).content
    with pytest.raises(LLMTimeoutError):
        FakeLLMClient("timeout").generate(request())
