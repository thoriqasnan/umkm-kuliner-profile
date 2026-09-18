import json

import httpx
import pytest

from sari_rasa_data.llm_client import LLMConfig
from sari_rasa_data.agent_contracts import (
    AGENT_ACTION_SCHEMA,
    INITIAL_SEARCH_AGENT_ACTION_SCHEMA,
    TERMINAL_AGENT_ACTION_SCHEMA,
    AgentActionValidationError,
    AgentDecisionRequest,
)
from sari_rasa_data.llm_contracts import (
    LLMRequest,
    LLMAuthenticationError,
    LLMInvalidToolArgumentsError,
    LLMMalformedResponseError,
    LLMMalformedToolResponseError,
    LLMSourceValidationError,
    LLMStructuredContractError,
    LLMToolCallLoopError,
    LLMUnknownToolError,
    LLMUnexpectedToolResponseError,
)
from sari_rasa_data.llm_gemini import GeminiLLMClient
from sari_rasa_data.llm_structured import PUBLIC_MENU_RESPONSE_SCHEMA, StructuredLLMRequest
from sari_rasa_data.menu_prompts import PublicMenuItem, build_structured_menu_request


API_KEY = "structured-secret-test-key"
GEMINI_SCHEMA_KEYWORDS = {
    "type", "format", "title", "description", "nullable", "enum", "maxItems",
    "minItems", "properties", "required", "minProperties", "maxProperties",
    "minLength", "maxLength", "pattern", "example", "anyOf", "propertyOrdering",
    "default", "items", "minimum", "maximum",
}


@pytest.fixture
def catalog():
    return (
        PublicMenuItem(1, "nasi-goreng", "Nasi Goreng", "Makanan", 18000, "Nasi gurih", "Savory rice"),
        PublicMenuItem(2, "es-teh", "Es Teh", "Minuman", 5000, "Teh dingin", "Iced tea"),
    )


def request(catalog, language="id"):
    return build_structured_menu_request(
        "Cari nasi", catalog, {"product:1", "product:2"}, language=language, correlation_id="7c"
    )


def final_body(language="id", sources=None):
    value = {
        "answer": "Nasi Goreng tersedia." if language == "id" else "Fried rice is listed.",
        "sources": ["product:1"] if sources is None else sources,
        "insufficient_information": False,
        "limitations": [],
        "language": language,
    }
    return {"candidates": [{"content": {"parts": [{"text": json.dumps(value)}]}, "finishReason": "STOP"}]}


def tool_body(name="search_menu", args=None, call_id=None, thought_signature=None):
    function_call = {"name": name, "args": args or {"query": "nasi"}}
    if call_id is not None:
        function_call["id"] = call_id
    part = {"functionCall": function_call}
    if thought_signature is not None:
        part["thoughtSignature"] = thought_signature
    return {
        "candidates": [{
            "content": {"role": "model", "parts": [part]},
            "finishReason": "STOP",
        }]
    }


def client(handler):
    config = LLMConfig("gemini", "gemini-configured-model", API_KEY, 3.0)
    return GeminiLLMClient(config, transport=httpx.MockTransport(handler))


def agent_request(
    *, terminal_only=False, search_required=False, allowed=frozenset({"menu:1"}),
    timeout_seconds=None,
):
    return AgentDecisionRequest(
        LLMRequest("trusted agent policy", "untrusted request", "id", 128),
        allowed,
        terminal_only,
        search_required,
        timeout_seconds,
    )


def test_agent_provider_timeout_is_capped_by_normal_and_remaining_budget():
    observed = []

    def handler(http_request):
        observed.append(http_request.extensions["timeout"]["read"])
        return httpx.Response(200, json=agent_body({
            "action": "call_tool",
            "tool_name": "search_menu",
            "arguments": {"query": "nasi", "limit": 5},
        }))

    configured = client(handler)
    configured.decide(agent_request(search_required=True, timeout_seconds=1.25))
    configured.decide(agent_request(search_required=True, timeout_seconds=8.0))
    assert observed == [1.25, 3.0]


def agent_body(value):
    return {
        "candidates": [{
            "content": {"parts": [{"text": json.dumps(value)}]},
            "finishReason": "STOP",
        }]
    }


def assert_gemini_schema_keywords(schema):
    assert set(schema).issubset(GEMINI_SCHEMA_KEYWORDS)
    for child in schema.get("properties", {}).values():
        assert_gemini_schema_keywords(child)
    if "items" in schema:
        assert_gemini_schema_keywords(schema["items"])
    for child in schema.get("anyOf", []):
        assert_gemini_schema_keywords(child)


def test_schema_and_tool_declaration_mapping(catalog):
    captured = {}

    def handler(http_request):
        captured["payload"] = json.loads(http_request.content)
        return httpx.Response(200, json=final_body())

    result = client(handler).generate_structured(request(catalog))
    config = captured["payload"]["generationConfig"]
    assert config["responseMimeType"] == "application/json"
    assert config["responseSchema"] == PUBLIC_MENU_RESPONSE_SCHEMA
    declaration = captured["payload"]["tools"][0]["functionDeclarations"][0]
    assert declaration["name"] == "search_menu"
    assert set(declaration) == {"name", "description", "parameters"}
    assert_gemini_schema_keywords(config["responseSchema"])
    assert_gemini_schema_keywords(declaration["parameters"])
    assert "additionalProperties" not in json.dumps(config["responseSchema"])
    assert "additionalProperties" not in json.dumps(declaration["parameters"])
    assert result.sources == ("product:1",)


def test_agent_decision_mapping_uses_json_schema_and_no_native_tools():
    payloads = []

    def handler(http_request):
        payloads.append(json.loads(http_request.content))
        return httpx.Response(200, json=agent_body({
            "action": "call_tool",
            "tool_name": "search_menu",
            "arguments": {"query": "nasi", "limit": 3},
        }))

    action = client(handler).decide(agent_request(allowed=frozenset()))
    assert action.action == "call_tool" and action.arguments.limit == 3
    assert payloads[0]["generationConfig"]["responseSchema"] == AGENT_ACTION_SCHEMA
    assert "tools" not in payloads[0] and "toolConfig" not in payloads[0]


def test_agent_initial_search_required_schema_excludes_terminal_actions():
    captured = {}

    def handler(http_request):
        captured.update(json.loads(http_request.content))
        return httpx.Response(200, json=agent_body({
            "action": "call_tool",
            "tool_name": "search_menu",
            "arguments": {"query": "nasi", "limit": 3},
        }))

    action = client(handler).decide(
        agent_request(search_required=True, allowed=frozenset())
    )
    schema = captured["generationConfig"]["responseSchema"]
    assert schema == INITIAL_SEARCH_AGENT_ACTION_SCHEMA
    assert schema["properties"]["action"]["enum"] == ["call_tool"]
    assert action.action == "call_tool"


def test_agent_terminal_turn_uses_terminal_only_schema():
    captured = {}

    def handler(http_request):
        captured.update(json.loads(http_request.content))
        return httpx.Response(200, json=agent_body({
            "action": "finish",
            "response": {
                "answer": "Nasi direkomendasikan.",
                "sources": ["menu:1"],
                "insufficient_information": False,
                "limitations": [],
                "language": "id",
            },
        }))

    result = client(handler).decide(agent_request(terminal_only=True))
    assert result.action == "finish"
    assert captured["generationConfig"]["responseSchema"] == TERMINAL_AGENT_ACTION_SCHEMA
    assert "call_tool" not in captured["generationConfig"]["responseSchema"]["properties"]["action"]["enum"]


def test_agent_mapping_rejects_malformed_action_and_native_tool_call():
    with pytest.raises(AgentActionValidationError):
        client(lambda _: httpx.Response(200, json=agent_body({
            "action": "finish", "response": {"answer": "missing fields"}
        }))).decide(agent_request())
    with pytest.raises(LLMUnexpectedToolResponseError):
        client(lambda _: httpx.Response(200, json=tool_body())).decide(agent_request())


def test_zero_tool_payload_omits_tools_and_cannot_execute_tool(catalog, monkeypatch):
    direct = build_structured_menu_request(
        "Cari nasi",
        catalog,
        {"product:1", "product:2"},
        enable_search_menu_tool=False,
    )
    payloads = []

    def handler(http_request):
        payloads.append(json.loads(http_request.content))
        return httpx.Response(200, json=final_body())

    def unexpected_execution(*args, **kwargs):
        raise AssertionError("zero-tool request entered tool execution")

    monkeypatch.setattr("sari_rasa_data.llm_gemini.execute_menu_tool", unexpected_execution)
    assert client(handler).generate_structured(direct).sources == ("product:1",)
    assert "tools" not in payloads[0]
    assert "toolConfig" not in payloads[0]

    with pytest.raises(LLMUnexpectedToolResponseError):
        client(lambda _: httpx.Response(200, json=tool_body())).generate_structured(direct)


def test_request_allows_zero_or_registered_search_and_rejects_other_tool_sets(catalog):
    valid = request(catalog)
    from sari_rasa_data.llm_structured import ToolDefinition
    assert StructuredLLMRequest(
        prompt=valid.prompt,
        allowed_source_ids=valid.allowed_source_ids,
        catalog=valid.catalog,
        tools=(),
    ).tools == ()
    assert valid.tools[0].name == "search_menu"
    with pytest.raises(LLMStructuredContractError, match="only the registered search_menu"):
        StructuredLLMRequest(
            prompt=valid.prompt,
            allowed_source_ids=valid.allowed_source_ids,
            catalog=valid.catalog,
            tools=(ToolDefinition("delete_product", "unsafe", {}),),
        )
    with pytest.raises(LLMStructuredContractError, match="only the registered search_menu"):
        StructuredLLMRequest(
            prompt=valid.prompt,
            allowed_source_ids=valid.allowed_source_ids,
            catalog=valid.catalog,
            tools=(valid.tools[0], valid.tools[0]),
        )
    with pytest.raises(LLMStructuredContractError, match="only the registered search_menu"):
        StructuredLLMRequest(
            prompt=valid.prompt,
            allowed_source_ids=valid.allowed_source_ids,
            catalog=valid.catalog,
            tools=("search_menu",),
        )
    with pytest.raises(LLMStructuredContractError, match="description"):
        ToolDefinition("search_menu", "", {})
    with pytest.raises(LLMStructuredContractError, match="parameters"):
        ToolDefinition("search_menu", "Search", [])


def test_tool_call_executes_and_result_maps_back(catalog):
    payloads = []

    def handler(http_request):
        payloads.append(json.loads(http_request.content))
        return httpx.Response(200, json=tool_body()) if len(payloads) == 1 else httpx.Response(200, json=final_body())

    result = client(handler).generate_structured(request(catalog))
    assert result.answer == "Nasi Goreng tersedia."
    response = payloads[1]["contents"][-1]["parts"][0]["functionResponse"]
    assert response["name"] == "search_menu"
    assert response["response"]["items"][0]["product_id"] == 1
    assert len(payloads) == 2


def test_gemini_3_original_content_and_call_id_are_preserved(catalog):
    payloads = []
    provider_body = tool_body(
        call_id="gemini-call-123",
        thought_signature="opaque-provider-context",
    )
    original_content = provider_body["candidates"][0]["content"]

    def handler(http_request):
        payloads.append(json.loads(http_request.content))
        if len(payloads) == 1:
            return httpx.Response(200, json=provider_body)
        return httpx.Response(200, json=final_body())

    response = client(handler).generate_structured(request(catalog))

    model_content = payloads[1]["contents"][-2]
    tool_response = payloads[1]["contents"][-1]["parts"][0]["functionResponse"]
    assert model_content == original_content
    assert model_content["parts"][0]["thoughtSignature"] == "opaque-provider-context"
    assert tool_response["id"] == "gemini-call-123"
    assert response.answer == "Nasi Goreng tersedia."
    assert not hasattr(response, "content")


def test_two_distinct_calls_allowed_and_final_stops(catalog):
    bodies = [
        tool_body(args={"query": "nasi"}),
        tool_body(args={"query": "minuman"}),
        final_body(),
    ]
    payloads = []

    def handler(http_request):
        payloads.append(json.loads(http_request.content))
        body = bodies[len(payloads) - 1]
        return httpx.Response(200, json=body)

    client(handler).generate_structured(request(catalog))
    assert len(payloads) == 3
    assert "toolConfig" not in payloads[1]
    assert payloads[2]["toolConfig"] == {"functionCallingConfig": {"mode": "NONE"}}
    assert payloads[2]["contents"][-2]["role"] == "model"
    assert "functionResponse" in payloads[2]["contents"][-1]["parts"][0]


def test_third_tool_execution_is_impossible_when_disabled(catalog, monkeypatch):
    calls = 0
    executions = 0

    def handler(_):
        nonlocal calls
        calls += 1
        return httpx.Response(200, json=tool_body(args={"query": str(calls)}))

    from sari_rasa_data import llm_gemini
    original = llm_gemini.execute_menu_tool

    def counted(*args, **kwargs):
        nonlocal executions
        executions += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(llm_gemini, "execute_menu_tool", counted)
    with pytest.raises(LLMUnexpectedToolResponseError):
        client(handler).generate_structured(request(catalog))
    assert calls == 3
    assert executions == 2


def test_repeated_call_loop_rejected(catalog):
    with pytest.raises(LLMToolCallLoopError):
        client(lambda _: httpx.Response(200, json=tool_body())).generate_structured(request(catalog))


@pytest.mark.parametrize(
    "body",
    [
        {"candidates": [{"content": {"parts": [
            {"functionCall": {"name": "search_menu", "args": {"query": "a"}}},
            {"functionCall": {"name": "search_menu", "args": {"query": "b"}}},
        ]}}]},
        {"candidates": [{"content": {"parts": [{"functionCall": {"name": "search_menu"}}]}}]},
        {"candidates": [{"content": {"parts": [{"text": "{}"}, {"functionCall": {"name": "search_menu", "args": {"query": "a"}}}]}}]},
        tool_body(call_id=" "),
        tool_body(call_id=123),
        {"candidates": [{"content": {"parts": [{"functionCall": {
            "id": None, "name": "search_menu", "args": {"query": "a"},
        }}]}}]},
        {"candidates": [{"content": {"parts": [{"functionCall": {
            "id": "call-1", "name": "search_menu", "args": {"query": "a"}, "extra": True,
        }}]}}]},
    ],
)
def test_malformed_or_simultaneous_provider_tool_calls_rejected(catalog, body):
    with pytest.raises(LLMMalformedToolResponseError):
        client(lambda _: httpx.Response(200, json=body)).generate_structured(request(catalog))


def test_unknown_tool_and_invalid_arguments_rejected(catalog):
    with pytest.raises(LLMUnknownToolError):
        client(lambda _: httpx.Response(200, json=tool_body("delete_product"))).generate_structured(request(catalog))
    with pytest.raises(LLMInvalidToolArgumentsError):
        client(lambda _: httpx.Response(200, json=tool_body(args={"query": ""}))).generate_structured(request(catalog))


def test_unknown_source_and_language_mismatch_rejected(catalog):
    with pytest.raises(LLMSourceValidationError):
        client(lambda _: httpx.Response(200, json=final_body(sources=["invented"]))).generate_structured(request(catalog))
    with pytest.raises(LLMStructuredContractError, match="language"):
        client(lambda _: httpx.Response(200, json=final_body(language="en"))).generate_structured(request(catalog))


def test_malformed_provider_json_and_credentials_are_redacted(catalog):
    with pytest.raises(LLMMalformedResponseError) as malformed:
        client(lambda _: httpx.Response(200, text=f"bad {API_KEY}")).generate_structured(request(catalog))
    assert API_KEY not in str(malformed.value)
    with pytest.raises(LLMAuthenticationError) as authentication:
        client(lambda _: httpx.Response(401, text=API_KEY)).generate_structured(request(catalog))
    assert API_KEY not in str(authentication.value)
