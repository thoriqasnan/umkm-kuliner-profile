from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import sys
from threading import Barrier, Event, Lock

import pytest
from fastapi.testclient import TestClient

from sari_rasa_data import service
from sari_rasa_data.agent_contracts import (
    CallToolAction,
    CannotCompleteAction,
    FinishAction,
    SearchMenuArguments,
)
from sari_rasa_data.ai_contracts import InternalAiRequest, InternalAiResponse, build_ai_readiness
from sari_rasa_data.assistant_runtime import (
    AssistantRetrievalResult,
    AssistantRuntimeError,
)
from sari_rasa_data.assistant_service import AssistantService
from sari_rasa_data.llm_contracts import (
    LLMAuthenticationError, LLMConfigError, LLMMalformedResponseError,
    LLMNetworkError, LLMRateLimitError, LLMTimeoutError, LLMUnexpectedToolResponseError,
)
from sari_rasa_data.llm_structured import StructuredLLMResponse
from sari_rasa_data.vector_contracts import VectorSpace, VectorSyncSummary


SPACE = VectorSpace(
    "sentence-transformers",
    "intfloat/multilingual-e5-base",
    4,
    "none",
    "7d-catalog-text-v2",
    "7h-embedding-profile-e5-v1",
)
CORRELATION_ID = "123e4567-e89b-42d3-a456-426614174000"


def catalog():
    return [
        {
            "product_id": 1,
            "slug": "es-jeruk",
            "name": "Es Jeruk",
            "category": "minuman",
            "price_rupiah": 8000,
            "description_id": "Minuman jeruk dingin yang segar.",
            "description_en": "A refreshing cold orange drink.",
        },
        {
            "product_id": 2,
            "slug": "soto-ayam",
            "name": "Soto Ayam",
            "category": "makanan",
            "price_rupiah": 20000,
            "description_id": "Makanan berkuah yang hangat.",
            "description_en": "A warm soup dish.",
        },
    ]


def payload(message="Ada minuman segar?", language="id", **changes):
    value = {
        "message": message,
        "language": language,
        "correlation_id": CORRELATION_ID,
        "catalog": catalog(),
    }
    value.update(changes)
    return value


@dataclass(frozen=True)
class SyncResult:
    catalog_fingerprint: str = "catalog-v1"
    vector_space: VectorSpace = SPACE
    summary: VectorSyncSummary = VectorSyncSummary(reused=4)


class FakeRuntime:
    def __init__(self, *, failure=None):
        self.failure = failure
        self.catalogs = []
        self.queries = []
        self.ready = False

    def synchronize(self, values):
        self.catalogs.append(tuple(item.model_dump() for item in values))
        if self.failure:
            raise self.failure
        self.ready = True
        return SyncResult()

    def retrieve(self, query, *, language, max_results, expected_catalog_fingerprint=None):
        self.queries.append((query, language, max_results))
        selected = 1 if language == "id" else 2
        row = next(item for item in self.catalogs[-1] if item["product_id"] == selected)
        return (
            AssistantRetrievalResult(
                selected, row["slug"], language, 1.0, row["category"], row["price_rupiah"]
            ),
        )

    def readiness(self):
        return build_ai_readiness(
            configuration_valid=True,
            profile_recognized=True,
            embedding_available=self.ready,
            index_available=self.ready,
            runtime_available=self.ready,
        )


class DecisionClient:
    def __init__(self, terminal="finish", failure=None, malformed=False):
        self.terminal = terminal
        self.failure = failure
        self.malformed = malformed
        self.requests = []

    def decide(self, request):
        self.requests.append(request)
        if self.failure:
            raise self.failure
        if self.malformed:
            return object()
        if request.search_required:
            return CallToolAction("call_tool", "search_menu", SearchMenuArguments("menu", 5))
        if self.terminal == "cannot":
            language = request.prompt.language
            answer = "Informasi tidak tersedia." if language == "id" else "Information is unavailable."
            limitation = "Fakta tersebut tidak ada di menu." if language == "id" else "That fact is not in the menu."
            return CannotCompleteAction(
                "cannot_complete",
                StructuredLLMResponse(answer, (), True, (limitation,), language),
            )
        language = request.prompt.language
        answer = "Es Jeruk tersedia." if language == "id" else "Soto Ayam is available."
        return FinishAction(
            "finish", StructuredLLMResponse(answer, ("menu:1",), False, (), language)
        )


def install(monkeypatch, runtime=None, client=None):
    selected_runtime = runtime or FakeRuntime()
    selected_client = client or DecisionClient()
    assistant = AssistantService(selected_runtime, lambda: selected_client)
    monkeypatch.setattr(service, "AI_ASSISTANT_SERVICE", assistant)
    return selected_runtime, selected_client


@pytest.mark.parametrize(
    "message,language",
    [("Ada minuman segar?", "id"), ("Recommend something warm.", "en")],
)
def test_internal_endpoint_returns_exact_grounded_bilingual_contract(monkeypatch, message, language):
    runtime, decision = install(monkeypatch)
    with TestClient(service.app) as client:
        response = client.post("/ai/menu-assistant", json=payload(message, language))
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"answer", "language", "insufficient_information", "limitations", "sources"}
    assert body["language"] == language
    assert body["insufficient_information"] is False
    assert body["sources"] == [{"source_id": "menu:1", "product_id": 1 if language == "id" else 2}]
    assert len(body["sources"]) <= 5
    assert runtime.queries == [("menu", language, 5)]
    assert len(decision.requests) == 2
    assert decision.requests[0].prompt.correlation_id == CORRELATION_ID
    assert CORRELATION_ID not in decision.requests[0].prompt.system_instruction
    assert CORRELATION_ID not in decision.requests[0].prompt.user_input
    assert not any(key in body for key in ("score", "vector", "prompt", "trace", "correlation_id"))


@pytest.mark.parametrize(
    "message,interface_language,expected_language",
    [
        ("Recommend a soupy dish.", "en", "en"),
        ("Rekomendasikan makanan berkuah.", "en", "id"),
        ("Rekomendasikan makanan berkuah.", "id", "id"),
        ("Recommend a soupy dish.", "id", "en"),
        ("Menu?", "en", "en"),
        ("Menu?", "id", "id"),
        ("sepertinya enak ya", "en", "id"),
    ],
)
def test_answer_language_is_selected_per_message_with_interface_fallback(
    monkeypatch, message, interface_language, expected_language
):
    runtime, decision = install(monkeypatch)
    request = InternalAiRequest.model_validate(payload(message, interface_language))
    result = service.AI_ASSISTANT_SERVICE.answer(request)
    assert result.language == expected_language
    assert runtime.queries == [("menu", expected_language, 5)]
    assert all(call.prompt.language == expected_language for call in decision.requests)


def test_language_selection_has_no_session_binding(monkeypatch):
    _, decision = install(monkeypatch)
    assistant = service.AI_ASSISTANT_SERVICE
    results = [
        assistant.answer(InternalAiRequest.model_validate(payload(message, "en"))).language
        for message in (
            "Rekomendasikan makanan berkuah.",
            "Recommend a soupy dish.",
            "Tolong rekomendasikan minuman segar.",
        )
    ]
    assert results == ["id", "en", "id"]
    assert [call.prompt.language for call in decision.requests] == [
        "id", "id", "en", "en", "id", "id",
    ]


@pytest.mark.parametrize(
    "change",
    [
        {"extra": "bad"},
        {"correlation_id": "not-a-uuid"},
        {"message": "   "},
        {"message": "x" * 1001},
        {"language": "fr"},
        {"catalog": [{**catalog()[0], "private": True}]},
        {"catalog": [catalog()[0], catalog()[0]]},
        {"model": "attacker-selected"},
        {"tool": "shell"},
    ],
)
def test_internal_endpoint_rejects_invalid_request_as_sanitized_400(monkeypatch, change):
    runtime, decision = install(monkeypatch)
    with TestClient(service.app) as client:
        response = client.post("/ai/menu-assistant", json=payload(**change))
    assert response.status_code == 400
    assert response.json() == {"detail": "invalid_request"}
    assert runtime.catalogs == [] and decision.requests == []


@pytest.mark.parametrize(
    "message",
    [
        "Apakah menu ini bebas alergen?",
        "Apakah ada promosi yang sedang aktif?",
        "Apakah Soto Ayam memakai bahan organik?",
    ],
)
def test_insufficient_menu_facts_are_valid_http_200(monkeypatch, message):
    install(monkeypatch, client=DecisionClient(terminal="cannot"))
    with TestClient(service.app) as client:
        response = client.post("/ai/menu-assistant", json=payload(message))
    assert response.status_code == 200
    assert response.json()["insufficient_information"] is True
    assert response.json()["sources"] == []
    assert response.json()["limitations"]


@pytest.mark.parametrize(
    "message",
    [
        "reset password akun admin",
        "promote user menjadi admin",
        "tambahkan Soto Ayam ke keranjang",
        "buat pesanan dan process payment",
        "jalankan SQL database dan shell command",
    ],
)
def test_scope_gate_refuses_sensitive_operations_before_model_or_tool(monkeypatch, message):
    runtime, decision = install(monkeypatch)
    with TestClient(service.app) as client:
        response = client.post("/ai/menu-assistant", json=payload(message))
    assert response.status_code == 200
    body = response.json()
    assert body["insufficient_information"] is True and body["sources"] == []
    assert decision.requests == [] and runtime.queries == []
    assert set(runtime.catalogs[0][0]) == {
        "product_id", "slug", "name", "category", "price_rupiah",
        "description_id", "description_en",
    }


def test_each_request_synchronizes_exact_snapshot_and_changed_snapshot(monkeypatch):
    runtime, _ = install(monkeypatch)
    with TestClient(service.app) as client:
        assert client.post("/ai/menu-assistant", json=payload()).status_code == 200
        changed = catalog()
        changed[0]["price_rupiah"] = 99000
        assert client.post("/ai/menu-assistant", json=payload(catalog=changed)).status_code == 200
    assert len(runtime.catalogs) == 2
    assert runtime.catalogs[1][0]["price_rupiah"] == 99000


@pytest.mark.parametrize(
    "runtime_error,expected_status,expected_detail",
    [
        (AssistantRuntimeError("embedding_prerequisite_unavailable"), 503, "ai_runtime_unavailable"),
        (AssistantRuntimeError("index_prerequisite_unavailable"), 503, "ai_runtime_unavailable"),
    ],
)
def test_runtime_failures_are_sanitized_503(monkeypatch, runtime_error, expected_status, expected_detail):
    install(monkeypatch, runtime=FakeRuntime(failure=runtime_error))
    with TestClient(service.app, raise_server_exceptions=False) as client:
        response = client.post("/ai/menu-assistant", json=payload())
    assert response.status_code == expected_status
    assert response.json() == {"detail": expected_detail}
    assert "prerequisite" not in response.text


@pytest.mark.parametrize(
    "failure,status,detail",
    [
        (LLMTimeoutError("raw provider timeout /private"), 504, "upstream_timeout"),
        (LLMNetworkError("raw provider unavailable /private"), 503, "ai_runtime_unavailable"),
    ],
)
def test_provider_failures_are_sanitized(monkeypatch, failure, status, detail):
    install(monkeypatch, client=DecisionClient(failure=failure))
    with TestClient(service.app, raise_server_exceptions=False) as client:
        response = client.post("/ai/menu-assistant", json=payload())
    assert response.status_code == status
    assert response.json() == {"detail": detail}
    assert "/private" not in response.text


def test_malformed_agent_result_is_sanitized_invalid_upstream(monkeypatch):
    install(monkeypatch, client=DecisionClient(malformed=True))
    with TestClient(service.app, raise_server_exceptions=False) as client:
        response = client.post("/ai/menu-assistant", json=payload())
    assert response.status_code == 502
    assert response.json() == {"detail": "invalid_upstream_response"}


def test_liveness_stays_independent_and_ai_readiness_is_safe(monkeypatch):
    runtime, _ = install(monkeypatch)
    with TestClient(service.app) as client:
        health = client.get("/health")
        not_ready = client.get("/ai/readiness")
        client.post("/ai/menu-assistant", json=payload())
        ready = client.get("/ai/readiness")
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    assert not_ready.status_code == 200 and not_ready.json()["status"] == "not_ready"
    assert ready.status_code == 200 and ready.json() == {
        "status": "ready", "profile_id": "phase-8.customer-menu-e5-v1", "reasons": [],
        "provider_configuration": "unconfigured", "provider_probe": "not_performed",
    }
    serialized = str(not_ready.json()) + str(ready.json())
    assert not any(value in serialized for value in ("/Users/", "api_key", ".env", "cache"))


def test_service_answer_requires_validated_contract():
    assistant = AssistantService(FakeRuntime(), lambda: DecisionClient())
    with pytest.raises(Exception) as caught:
        assistant.answer(payload())
    assert str(caught.value) == "invalid_request"


def test_validated_contract_can_be_used_without_fastapi():
    assistant = AssistantService(FakeRuntime(), lambda: DecisionClient())
    result = assistant.answer(InternalAiRequest.model_validate(payload()))
    assert isinstance(result, InternalAiResponse)


class MutableClock:
    def __init__(self):
        self.value = 0.0

    def __call__(self):
        return self.value


def test_request_deadline_shrinks_across_decisions_and_stops_new_work():
    clock = MutableClock()

    class ExpiringClient(DecisionClient):
        def decide(self, request):
            result = super().decide(request)
            clock.value += 1.1
            return result

    decision = ExpiringClient()
    assistant = AssistantService(
        FakeRuntime(), lambda: decision,
        operation_timeout_seconds=1.0, clock=clock,
    )
    with pytest.raises(Exception) as caught:
        assistant.answer(InternalAiRequest.model_validate(payload()))
    assert str(caught.value) == "upstream_timeout"
    assert len(decision.requests) == 1
    assert decision.requests[0].timeout_seconds == pytest.approx(1.0)


def test_expired_deadline_does_not_initialize_or_call_provider():
    clock = MutableClock()
    factory_calls = []
    events = []

    class ExpiringRuntime(FakeRuntime):
        def synchronize(self, values):
            result = super().synchronize(values)
            clock.value += 2
            return result

    def factory():
        factory_calls.append(True)
        return DecisionClient()

    assistant = AssistantService(
        ExpiringRuntime(), factory,
        operation_timeout_seconds=1.0, clock=clock, failure_logger=events.append,
    )
    with pytest.raises(Exception) as caught:
        assistant.answer(InternalAiRequest.model_validate(payload()))
    assert str(caught.value) == "upstream_timeout"
    assert factory_calls == []
    assert events[0]["category"] == "operation.timeout"
    assert events[0]["subsystem"] == "assistant"

    clock.value = 0
    provider = DecisionClient()

    def slow_factory():
        factory_calls.append(True)
        clock.value += 2
        return provider

    assistant = AssistantService(
        FakeRuntime(), slow_factory,
        operation_timeout_seconds=1.0, clock=clock,
        failure_logger=events.append,
    )
    with pytest.raises(Exception) as caught:
        assistant.answer(InternalAiRequest.model_validate(payload()))
    assert str(caught.value) == "upstream_timeout"
    assert factory_calls == [True]
    assert provider.requests == []


def test_remaining_budget_is_passed_to_each_decision_without_retry():
    clock = MutableClock()

    class AdvancingClient(DecisionClient):
        def decide(self, request):
            result = super().decide(request)
            clock.value += 1.5
            return result

    decision = AdvancingClient()
    assistant = AssistantService(
        FakeRuntime(), lambda: decision,
        operation_timeout_seconds=5.0, clock=clock,
    )
    result = assistant.answer(InternalAiRequest.model_validate(payload()))
    assert isinstance(result, InternalAiResponse)
    assert [request.timeout_seconds for request in decision.requests] == pytest.approx([5.0, 3.5])
    assert len(decision.requests) == 2


def test_provider_waits_are_not_serialized_by_service_lock():
    barrier = Barrier(2, timeout=1)

    class ConcurrentClient(DecisionClient):
        def decide(self, request):
            if request.search_required:
                barrier.wait()
            return super().decide(request)

    assistant = AssistantService(
        FakeRuntime(), lambda: ConcurrentClient(), max_concurrent_operations=2,
    )
    request = InternalAiRequest.model_validate(payload())
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: assistant.answer(request), range(2)))
    assert all(isinstance(result, InternalAiResponse) for result in results)


def test_admission_is_bounded_fail_fast_and_released_after_success():
    entered = Event()
    release = Event()

    class BlockingClient(DecisionClient):
        def decide(self, request):
            if request.search_required:
                entered.set()
                assert release.wait(1)
            return super().decide(request)

    assistant = AssistantService(
        FakeRuntime(), lambda: BlockingClient(), max_concurrent_operations=1,
    )
    request = InternalAiRequest.model_validate(payload())
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(assistant.answer, request)
        assert entered.wait(1)
        with pytest.raises(Exception) as saturated:
            assistant.answer(request)
        assert str(saturated.value) == "ai_runtime_unavailable"
        release.set()
        assert isinstance(pending.result(timeout=1), InternalAiResponse)
    assert isinstance(assistant.answer(request), InternalAiResponse)


def test_admission_slot_is_released_after_provider_and_deadline_failures():
    request = InternalAiRequest.model_validate(payload())
    decision = DecisionClient(failure=LLMNetworkError("private"))
    assistant = AssistantService(
        FakeRuntime(), lambda: decision, max_concurrent_operations=1,
    )
    with pytest.raises(Exception) as provider_failure:
        assistant.answer(request)
    assert str(provider_failure.value) == "ai_runtime_unavailable"
    decision.failure = None
    assert isinstance(assistant.answer(request), InternalAiResponse)

    clock = MutableClock()

    class OnceExpiringClient(DecisionClient):
        expire = True

        def decide(self, value):
            result = super().decide(value)
            if self.expire:
                clock.value += 2
                self.expire = False
            return result

    expiring = OnceExpiringClient()
    deadline_service = AssistantService(
        FakeRuntime(), lambda: expiring, operation_timeout_seconds=1,
        max_concurrent_operations=1, clock=clock,
    )
    with pytest.raises(Exception) as deadline_failure:
        deadline_service.answer(request)
    assert str(deadline_failure.value) == "upstream_timeout"
    assert isinstance(deadline_service.answer(request), InternalAiResponse)


@pytest.mark.parametrize(
    "failure,category,public_code",
    [
        (LLMConfigError("secret config detail"), "provider.config", "ai_runtime_unavailable"),
        (LLMAuthenticationError("secret key detail"), "provider.auth", "ai_runtime_unavailable"),
        (LLMRateLimitError("raw provider body"), "provider.rate_limit", "ai_runtime_unavailable"),
        (LLMNetworkError("private network path"), "provider.network", "ai_runtime_unavailable"),
        (LLMTimeoutError("private timeout"), "provider.timeout", "upstream_timeout"),
        (LLMMalformedResponseError("raw provider response"), "provider.response", "invalid_upstream_response"),
        (LLMUnexpectedToolResponseError("raw tool response"), "provider.response", "invalid_upstream_response"),
    ],
)
def test_internal_failure_categories_are_logged_without_sensitive_data(
    failure, category, public_code
):
    events = []
    decision = DecisionClient(failure=failure)
    request = InternalAiRequest.model_validate(payload(
        message="DO NOT LOG user-secret-prompt",
        catalog=[{**catalog()[0], "description_id": "DO NOT LOG catalog-secret"}],
    ))
    assistant = AssistantService(
        FakeRuntime(), lambda: decision, failure_logger=events.append,
    )
    with pytest.raises(Exception) as caught:
        assistant.answer(request)
    assert caught.value.code == public_code
    assert caught.value.category == category
    assert events == [{
        "event": "ai_request_failure",
        "correlation_id": CORRELATION_ID,
        "subsystem": "provider",
        "phase": "initialize" if category == "provider.config" else (
            "validate_response" if category == "provider.response" else "decision"
        ),
        "category": category,
        "public_code": public_code,
        "elapsed_ms": events[0]["elapsed_ms"],
    }]
    serialized = str(events)
    assert not any(secret in serialized for secret in (
        "user-secret-prompt", "catalog-secret", "secret config detail",
        "secret key detail", "raw provider body", "private network path",
        "private timeout", "raw provider response",
        "raw tool response",
    ))


def test_runtime_and_admission_categories_are_distinct_and_slots_still_release():
    events = []
    request = InternalAiRequest.model_validate(payload())
    failing = AssistantService(
        FakeRuntime(failure=AssistantRuntimeError("index_prerequisite_unavailable")),
        lambda: DecisionClient(), failure_logger=events.append,
    )
    with pytest.raises(Exception) as caught:
        failing.answer(request)
    assert caught.value.category == "runtime.index"
    assert events[0]["subsystem"] == "runtime"

    entered = Event()
    release = Event()

    class BlockingClient(DecisionClient):
        def decide(self, value):
            if value.search_required:
                entered.set()
                assert release.wait(1)
            return super().decide(value)

    admission_events = []
    bounded = AssistantService(
        FakeRuntime(), lambda: BlockingClient(), max_concurrent_operations=1,
        failure_logger=admission_events.append,
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(bounded.answer, request)
        assert entered.wait(1)
        with pytest.raises(Exception) as saturated:
            bounded.answer(request)
        assert saturated.value.category == "admission.saturated"
        release.set()
        pending.result(timeout=1)
    assert admission_events[0]["phase"] == "acquire"


def test_readiness_separates_local_runtime_from_static_provider_status_without_work():
    runtime = FakeRuntime()
    provider_checks = []
    factory_calls = []
    assistant = AssistantService(
        runtime, lambda: factory_calls.append(True),
        provider_status=lambda: provider_checks.append(True) or "invalid",
    )
    readiness = assistant.readiness().model_dump()
    assert readiness == {
        "status": "not_ready",
        "profile_id": "phase-8.customer-menu-e5-v1",
        "reasons": ("embedding_prerequisite_unavailable", "index_prerequisite_unavailable", "runtime_prerequisite_unavailable"),
        "provider_configuration": "invalid",
        "provider_probe": "not_performed",
    }
    assert provider_checks == [True]
    assert factory_calls == []
    assert runtime.catalogs == [] and runtime.queries == []


def test_service_import_loads_no_e5_gemini_network_or_index(tmp_path):
    source_root = Path(__file__).resolve().parents[1] / "src"
    probe = """
import hashlib
import pathlib
import sys
def reject_network(event, args):
    if event == 'socket.connect':
        raise AssertionError('service import must not access the network')
sys.addaudithook(reject_network)
from sari_rasa_data.assistant_runtime import DEFAULT_PHASE8_E5_INDEX_PATH
path = DEFAULT_PHASE8_E5_INDEX_PATH
def state():
    return (path.exists(), hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns) if path.exists() else (False, None, None)
before = state()
import sari_rasa_data.service
forbidden = {'sentence_transformers', 'sari_rasa_data.llm_gemini'}
print(','.join(sorted(forbidden & set(sys.modules))))
print(before == state())
"""
    completed = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=tmp_path,
        env={"PYTHONPATH": str(source_root)},
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    assert completed.stdout == "\nTrue\n"
