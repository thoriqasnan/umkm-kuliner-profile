import json
import logging

import httpx
import pytest

from sari_rasa_data.llm_client import LLMConfig
from sari_rasa_data.llm_contracts import (
    LLMAuthenticationError,
    LLMEmptyResponseError,
    LLMMalformedResponseError,
    LLMProviderServerError,
    LLMRateLimitError,
    LLMRefusalError,
    LLMRequest,
    LLMTimeoutError,
    LLMUnexpectedToolResponseError,
    LLMNetworkError,
    LLMProviderClientError,
    LLMResponseTooLargeError,
)
from sari_rasa_data.llm_gemini import GeminiLLMClient


API_KEY = "super-secret-test-key"


def request():
    return LLMRequest("Jawab singkat", "Menu publik SariRasa", "id", 48, "corr-7a")


def response_body(**overrides):
    body = {
        "candidates": [{"content": {"parts": [{"text": "Hidangan lezat."}]}, "finishReason": "STOP"}],
        "usageMetadata": {"promptTokenCount": 7, "candidatesTokenCount": 4, "totalTokenCount": 11},
    }
    body.update(overrides)
    return body


def client(handler, clock=lambda: 1.0):
    config = LLMConfig("gemini", "gemini-configured-model", API_KEY, 3.25)
    return GeminiLLMClient(config, transport=httpx.MockTransport(handler), clock=clock)


def test_payload_header_timeout_and_normalized_response(monkeypatch):
    captured = {}
    original_init = httpx.Client.__init__

    def record_init(self, *args, **kwargs):
        captured["timeout"] = kwargs.get("timeout")
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.Client, "__init__", record_init)

    def handler(http_request):
        captured["request"] = http_request
        captured["payload"] = json.loads(http_request.content)
        return httpx.Response(200, json=response_body())

    ticks = iter([10.0, 10.125])
    result = client(handler, lambda: next(ticks)).generate(request())
    assert captured["timeout"] == 3.25
    assert captured["request"].headers["x-goog-api-key"] == API_KEY
    assert API_KEY not in str(captured["request"].url)
    assert captured["payload"] == {
        "systemInstruction": {"parts": [
            {"text": "Jawab singkat"},
            {"text": "Respond in Indonesian."},
        ]},
        "contents": [{"role": "user", "parts": [{"text": "Menu publik SariRasa"}]}],
        "generationConfig": {"maxOutputTokens": 48, "candidateCount": 1},
    }
    assert result.content == "Hidangan lezat."
    assert result.provider == "gemini"
    assert result.model == "gemini-configured-model"
    assert result.finish_reason == "stop"
    assert result.usage.input_tokens == 7
    assert result.usage.output_tokens == 4
    assert result.usage.total_tokens == 11
    assert result.latency_ms == 125
    assert result.correlation_id == "corr-7a"


@pytest.mark.parametrize("provider_reason, normalized", [("MAX_TOKENS", "length"), ("OTHER", "other")])
def test_finish_reason_mapping(provider_reason, normalized):
    def handler(_):
        body = response_body()
        body["candidates"][0]["finishReason"] = provider_reason
        return httpx.Response(200, json=body)
    assert client(handler).generate(request()).finish_reason == normalized


@pytest.mark.parametrize(
    "status, error_type",
    [(400, LLMProviderClientError), (401, LLMAuthenticationError), (403, LLMAuthenticationError), (429, LLMRateLimitError), (500, LLMProviderServerError), (503, LLMProviderServerError)],
)
def test_http_failure_mapping_is_redacted(status, error_type, caplog):
    caplog.set_level(logging.DEBUG)
    provider_body = f'authorization: Bearer {API_KEY}'
    with pytest.raises(error_type) as raised:
        client(lambda _: httpx.Response(status, text=provider_body)).generate(request())
    exposed = str(raised.value) + caplog.text
    assert API_KEY not in exposed
    assert provider_body not in exposed


def test_google_400_invalid_api_key_maps_to_authentication_without_body_leak():
    body = {"error": {"status": "INVALID_ARGUMENT", "message": API_KEY, "details": [{"reason": "API_KEY_INVALID"}]}}
    with pytest.raises(LLMAuthenticationError) as raised:
        client(lambda _: httpx.Response(400, json=body)).generate(request())
    assert API_KEY not in str(raised.value)


def test_timeout_mapping_is_redacted():
    def handler(http_request):
        raise httpx.ReadTimeout(f"timeout with {API_KEY}", request=http_request)
    with pytest.raises(LLMTimeoutError) as raised:
        client(handler).generate(request())
    assert API_KEY not in str(raised.value)
    assert raised.value.__cause__ is None


def test_network_failure_mapping_is_redacted():
    def handler(http_request):
        raise httpx.ConnectError(f"network with {API_KEY}", request=http_request)
    with pytest.raises(LLMNetworkError) as raised:
        client(handler).generate(request())
    assert API_KEY not in str(raised.value)
    assert raised.value.__cause__ is None


@pytest.mark.parametrize(
    "body, error_type",
    [
        (None, LLMMalformedResponseError),
        ({}, LLMEmptyResponseError),
        ({"candidates": []}, LLMEmptyResponseError),
        ({"candidates": [{}]}, LLMEmptyResponseError),
        ({"candidates": [{"content": {"parts": []}}]}, LLMEmptyResponseError),
        ({"candidates": [{"content": {"parts": [{"text": " "}]}}]}, LLMEmptyResponseError),
        ({"promptFeedback": {"blockReason": "SAFETY"}}, LLMRefusalError),
        ({"candidates": [{"finishReason": "SAFETY"}]}, LLMRefusalError),
        ({"candidates": [{"finishReason": "MALFORMED_FUNCTION_CALL"}]}, LLMUnexpectedToolResponseError),
        ({"candidates": [{"content": {"parts": [{"functionCall": {"name": "x"}}]}}]}, LLMUnexpectedToolResponseError),
    ],
)
def test_invalid_empty_refusal_and_tool_responses(body, error_type):
    def handler(_):
        if body is None:
            return httpx.Response(200, content=b"not-json")
        return httpx.Response(200, json=body)
    with pytest.raises(error_type):
        client(handler).generate(request())


def test_raw_provider_body_never_leaks_from_malformed_response():
    secret_body = f"not-json {API_KEY} private@example.com"
    with pytest.raises(LLMMalformedResponseError) as raised:
        client(lambda _: httpx.Response(200, text=secret_body)).generate(request())
    assert API_KEY not in str(raised.value)
    assert "private@example.com" not in str(raised.value)


def test_reported_output_over_limit_is_rejected():
    body = response_body(usageMetadata={"promptTokenCount": 7, "candidatesTokenCount": 49, "totalTokenCount": 56})
    with pytest.raises(LLMResponseTooLargeError):
        client(lambda _: httpx.Response(200, json=body)).generate(request())
