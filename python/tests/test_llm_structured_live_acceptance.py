import importlib
import json
import sys

import httpx

from sari_rasa_data.llm_contracts import LLMAuthenticationError
from sari_rasa_data.llm_structured import StructuredLLMRequest, StructuredLLMResponse
from sari_rasa_data.menu_tools import execute_menu_tool


class FakeStructuredClient:
    def __init__(self, *, fail_with=None):
        self.requests = []
        self.fail_with = fail_with

    def generate_structured(self, request):
        self.requests.append(request)
        if self.fail_with is not None:
            raise self.fail_with
        if request.prompt.correlation_id == "phase-7c-live-tool":
            from sari_rasa_data import llm_gemini

            execute = llm_gemini.execute_menu_tool
            execute(_tool_call(), request.catalog, request.prompt.language)
            return StructuredLLMResponse(
                "Es Jeruk Pelangi adalah minuman jeruk fiktif.",
                ("product:7102",),
                False,
                (),
                "id",
            )
        return StructuredLLMResponse(
            "Nasi Rempah Ceria adalah menu nasi fiktif.",
            ("product:7101",),
            False,
            (),
            "id",
        )


def _tool_call():
    from sari_rasa_data.llm_structured import ToolCall

    return ToolCall("search_menu", {"query": "jeruk", "language": "id", "limit": 1})


def test_run_acceptance_uses_existing_contracts_and_real_tool_executor():
    from sari_rasa_data.llm_structured_live_acceptance import run_acceptance

    client = FakeStructuredClient()
    results = run_acceptance(client, provider="gemini", model="configured-model")

    assert [result["status"] for result in results] == ["PASS", "PASS"]
    assert [result["tool_call_count"] for result in results] == [0, 1]
    assert all(isinstance(request, StructuredLLMRequest) for request in client.requests)
    assert client.requests[0].tools == ()
    assert client.requests[1].tools[0].name == "search_menu"
    assert all(request.allowed_source_ids == {"product:7101", "product:7102"} for request in client.requests)


def test_catalog_is_tiny_fictional_and_public_safe():
    from sari_rasa_data.llm_structured_live_acceptance import _CATALOG

    assert len(_CATALOG) == 2
    assert {item.product_id for item in _CATALOG} == {7101, 7102}
    fixture_text = json.dumps([item.__dict__ for item in _CATALOG], ensure_ascii=False).lower()
    assert "fiktif" in fixture_text and "fictional" in fixture_text
    assert not any(term in fixture_text for term in ("password", "token", "customer", "payment"))


def test_failure_output_includes_only_sanitized_typed_exception_message():
    from sari_rasa_data.llm_structured_live_acceptance import run_acceptance

    message = "LLM provider rejected credentials"
    results = run_acceptance(
        FakeStructuredClient(fail_with=LLMAuthenticationError(message)),
        provider="gemini",
        model="configured-model",
    )
    rendered = json.dumps(results)

    assert [result["status"] for result in results] == ["FAIL", "FAIL"]
    assert all(result["error_type"] == "LLMAuthenticationError" for result in results)
    assert all(result["error_message"] == message for result in results)
    assert "LLMAuthenticationError(" not in rendered
    assert "Traceback" not in rendered


def test_failure_after_tool_execution_reports_actual_count():
    from sari_rasa_data import llm_gemini
    from sari_rasa_data.llm_structured_live_acceptance import run_acceptance

    class ExecuteThenFailClient(FakeStructuredClient):
        def generate_structured(self, request):
            self.requests.append(request)
            if request.tools:
                llm_gemini.execute_menu_tool(
                    _tool_call(), request.catalog, request.prompt.language
                )
                raise RuntimeError("sanitized failure after tool execution")
            return super().generate_structured(request)

    results = run_acceptance(
        ExecuteThenFailClient(), provider="gemini", model="configured-model"
    )
    assert results[1]["status"] == "FAIL"
    assert results[1]["tool_call_count"] == 1


def test_import_does_not_create_an_http_client(monkeypatch):
    sys.modules.pop("sari_rasa_data.llm_structured_live_acceptance", None)

    def unexpected_client(*args, **kwargs):
        raise AssertionError("network client created during import")

    monkeypatch.setattr(httpx, "Client", unexpected_client)
    importlib.import_module("sari_rasa_data.llm_structured_live_acceptance")
