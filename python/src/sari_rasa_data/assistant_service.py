"""Phase 8C composition for the internal public-menu assistant boundary."""

from dataclasses import replace
import json
import logging
from threading import BoundedSemaphore
import time
from typing import Callable

from pydantic import ValidationError

from .agent_contracts import AgentDecisionClient, AgentError, MenuAgentRequest
from .ai_contracts import (
    InternalAiRequest,
    InternalAiResponse,
    InternalAiSource,
    internal_error_http_status,
    select_response_language,
)
from .assistant_runtime import (
    AssistantRuntimeError,
    AssistantRuntimeManager,
)
from .embeddings import project_catalog_semantic_text, semantic_content_hash
from .llm_client import create_llm_client, static_llm_config_status
from .llm_contracts import (
    LLMAuthenticationError,
    LLMCancelledError,
    LLMConfigError,
    LLMEmptyResponseError,
    LLMProviderClientError,
    LLMRefusalError,
    LLMResponseTooLargeError,
    LLMMalformedResponseError,
    LLMMalformedToolResponseError,
    LLMNetworkError,
    LLMProviderServerError,
    LLMRateLimitError,
    LLMStructuredContractError,
    LLMStructuredOutputParseError,
    LLMTimeoutError,
    LLMUnexpectedToolResponseError,
    LLMError,
)
from .menu_agent import MenuRecommendationAgent
from .menu_prompts import PublicMenuItem
from .rag_contracts import RAGRetrievalResult, RetrievedMenuItem
from .vector_contracts import VectorSpace


class AssistantServiceError(Exception):
    """Sanitized service failure with a stable Phase 8A category."""

    def __init__(self, code: str, status_code: int, category: str | None = None):
        super().__init__(code)
        self.code = code
        self.status_code = status_code
        self.category = category


def _service_error(code: str, category: str | None = None) -> AssistantServiceError:
    return AssistantServiceError(code, internal_error_http_status(code), category)


def _default_failure_logger(event: dict[str, object]) -> None:
    logging.getLogger(__name__).error(
        "assistant_failure %s", json.dumps(event, sort_keys=True, separators=(",", ":"))
    )


class _LazyDecisionClient:
    def __init__(self, factory: Callable[[], AgentDecisionClient], deadline) -> None:
        self._factory = factory
        self._deadline = deadline
        self._client: AgentDecisionClient | None = None

    def decide(self, request):
        self._deadline.remaining_seconds()
        if self._client is None:
            self._client = self._factory()
        remaining = self._deadline.remaining_seconds()
        return self._client.decide(replace(request, timeout_seconds=remaining))


DEFAULT_OPERATION_TIMEOUT_SECONDS = 12.0
DEFAULT_MAX_CONCURRENT_OPERATIONS = 2


class _RequestDeadline:
    def __init__(self, timeout_seconds: float, clock: Callable[[], float]) -> None:
        self._expires_at = clock() + timeout_seconds
        self._clock = clock

    def remaining_seconds(self) -> float:
        remaining = self._expires_at - self._clock()
        if remaining <= 0:
            raise _OperationDeadlineError
        return remaining


class _OperationDeadlineError(Exception):
    pass


def _validate_operation_timeout(value: float) -> float:
    try:
        timeout = float(value)
    except (TypeError, ValueError):
        raise ValueError("AI operation timeout must be numeric") from None
    if not 0.1 <= timeout <= 60:
        raise ValueError("AI operation timeout must be between 0.1 and 60 seconds")
    return timeout


class _RuntimeAgentRetriever:
    """Adapt Phase 8 hybrid retrieval to the existing Phase 7 agent contract."""

    def __init__(
        self,
        runtime: AssistantRuntimeManager,
        catalog: tuple[PublicMenuItem, ...],
        vector_space: VectorSpace,
        catalog_fingerprint: str,
    ) -> None:
        self._runtime = runtime
        self._catalog = {item.product_id: item for item in catalog}
        self._vector_space = vector_space
        self._catalog_fingerprint = catalog_fingerprint

    def retrieve(self, query, vector_space, *, language, top_k, max_items):
        if vector_space != self._vector_space:
            raise AssistantRuntimeError("runtime_prerequisite_unavailable")
        values = self._runtime.retrieve(
            query,
            language=language,
            max_results=min(top_k, max_items, 5),
            expected_catalog_fingerprint=self._catalog_fingerprint,
        )
        items = []
        for value in values:
            item = self._catalog.get(value.product_id)
            if item is None:
                raise AssistantRuntimeError("runtime_prerequisite_unavailable")
            semantic_text = project_catalog_semantic_text(
                item, language, vector_space.text_version
            )
            items.append(
                RetrievedMenuItem(
                    item,
                    language,
                    value.score,
                    semantic_content_hash(
                        semantic_text, language, vector_space.text_version
                    ),
                )
            )
        return RAGRetrievalResult(
            tuple(items), language, language if items else None, False, len(items), 0
        )

class AssistantService:
    """Run one bounded agent against one synchronized canonical snapshot."""

    def __init__(
        self,
        runtime: AssistantRuntimeManager,
        decision_client_factory: Callable[[], AgentDecisionClient] = create_llm_client,
        *,
        operation_timeout_seconds: float | None = None,
        max_concurrent_operations: int = DEFAULT_MAX_CONCURRENT_OPERATIONS,
        clock: Callable[[], float] = time.monotonic,
        provider_status: Callable[[], str] = static_llm_config_status,
        failure_logger: Callable[[dict[str, object]], None] = _default_failure_logger,
    ) -> None:
        self._runtime = runtime
        self._decision_client_factory = decision_client_factory
        self._operation_timeout_seconds = (
            DEFAULT_OPERATION_TIMEOUT_SECONDS if operation_timeout_seconds is None
            else _validate_operation_timeout(operation_timeout_seconds)
        )
        if isinstance(max_concurrent_operations, bool) or not isinstance(max_concurrent_operations, int) or max_concurrent_operations <= 0:
            raise ValueError("max_concurrent_operations must be a positive integer")
        self._admission = BoundedSemaphore(max_concurrent_operations)
        self._clock = clock
        self._provider_status = provider_status
        self._failure_logger = failure_logger

    def readiness(self):
        local = self._runtime.readiness()
        return type(local)(
            status=local.status,
            profile_id=local.profile_id,
            reasons=local.reasons,
            provider_configuration=self._provider_status(),
            provider_probe="not_performed",
        )

    def _failure(self, request: InternalAiRequest, started: float, *, code: str,
                 category: str, subsystem: str, phase: str) -> AssistantServiceError:
        self._failure_logger({
            "event": "ai_request_failure",
            "correlation_id": request.correlation_id,
            "subsystem": subsystem,
            "phase": phase,
            "category": category,
            "public_code": code,
            "elapsed_ms": max(0, round((self._clock() - started) * 1000)),
        })
        return _service_error(code, category)

    def answer(self, request: InternalAiRequest) -> InternalAiResponse:
        if not isinstance(request, InternalAiRequest):
            raise _service_error("invalid_request")
        started = self._clock()
        if not self._admission.acquire(blocking=False):
            raise self._failure(
                request, started, code="ai_runtime_unavailable",
                category="admission.saturated", subsystem="admission", phase="acquire",
            )
        deadline = _RequestDeadline(self._operation_timeout_seconds, self._clock)
        try:
            catalog = tuple(
                PublicMenuItem(
                    item.product_id,
                    item.slug,
                    item.name,
                    item.category,
                    item.price_rupiah,
                    item.description_id,
                    item.description_en,
                )
                for item in request.catalog
            )
            synchronized = self._runtime.synchronize(request.catalog)
            deadline.remaining_seconds()
            retriever = _RuntimeAgentRetriever(
                self._runtime, catalog, synchronized.vector_space,
                synchronized.catalog_fingerprint,
            )
            agent = MenuRecommendationAgent(
                retriever, _LazyDecisionClient(self._decision_client_factory, deadline)
            )
            response_language = select_response_language(request.message, request.language)
            result = agent.run(
                MenuAgentRequest(
                    request.message,
                    synchronized.vector_space,
                    language=response_language,
                    correlation_id=request.correlation_id,
                )
            )
            deadline.remaining_seconds()
            evidence_by_source = {
                evidence.source_id: evidence for evidence in result.evidence
            }
            sources = tuple(
                InternalAiSource(
                    source_id=source_id,
                    product_id=evidence_by_source[source_id].product_id,
                )
                for source_id in result.response.sources
                if source_id in evidence_by_source
            )
            if len(sources) != len(result.response.sources):
                raise LLMStructuredContractError(
                    "agent response contains an unobserved source"
                )
            return InternalAiResponse(
                answer=result.response.answer,
                language=result.response.language,
                insufficient_information=result.response.insufficient_information,
                limitations=result.response.limitations,
                sources=sources,
            )
        except AssistantRuntimeError as exc:
            category = {
                "embedding_prerequisite_unavailable": "runtime.embedding",
                "index_prerequisite_unavailable": "runtime.index",
            }.get(exc.readiness_reason, "runtime.state")
            raise self._failure(request, started, code="ai_runtime_unavailable",
                category=category, subsystem="runtime", phase="synchronize_or_retrieve") from None
        except _OperationDeadlineError:
            raise self._failure(request, started, code="upstream_timeout",
                category="operation.timeout", subsystem="assistant", phase="deadline") from None
        except LLMTimeoutError:
            raise self._failure(request, started, code="upstream_timeout",
                category="provider.timeout", subsystem="provider", phase="decision") from None
        except LLMConfigError:
            raise self._failure(request, started, code="ai_runtime_unavailable",
                category="provider.config", subsystem="provider", phase="initialize") from None
        except LLMAuthenticationError:
            raise self._failure(request, started, code="ai_runtime_unavailable",
                category="provider.auth", subsystem="provider", phase="decision") from None
        except LLMRateLimitError:
            raise self._failure(request, started, code="ai_runtime_unavailable",
                category="provider.rate_limit", subsystem="provider", phase="decision") from None
        except LLMNetworkError:
            raise self._failure(request, started, code="ai_runtime_unavailable",
                category="provider.network", subsystem="provider", phase="decision") from None
        except LLMProviderServerError:
            raise self._failure(request, started, code="ai_runtime_unavailable",
                category="provider.unavailable", subsystem="provider", phase="decision") from None
        except (LLMMalformedResponseError, LLMMalformedToolResponseError,
                LLMUnexpectedToolResponseError, LLMStructuredOutputParseError,
                LLMEmptyResponseError, LLMResponseTooLargeError, LLMStructuredContractError):
            raise self._failure(request, started, code="invalid_upstream_response",
                category="provider.response", subsystem="provider", phase="validate_response") from None
        except AgentError:
            raise self._failure(request, started, code="invalid_upstream_response",
                category="agent.decision", subsystem="agent", phase="validate_action") from None
        except ValidationError:
            raise self._failure(request, started, code="invalid_upstream_response",
                category="assistant.response_contract", subsystem="assistant", phase="compose_response") from None
        except LLMProviderClientError:
            raise self._failure(request, started, code="ai_runtime_unavailable",
                category="provider.request", subsystem="provider", phase="decision") from None
        except LLMRefusalError:
            raise self._failure(request, started, code="ai_runtime_unavailable",
                category="provider.refusal", subsystem="provider", phase="decision") from None
        except LLMCancelledError:
            raise self._failure(request, started, code="ai_runtime_unavailable",
                category="provider.cancelled", subsystem="provider", phase="decision") from None
        except LLMError:
            raise self._failure(request, started, code="ai_runtime_unavailable",
                category="provider.other", subsystem="provider", phase="decision") from None
        except AssistantServiceError:
            raise
        except Exception:
            raise self._failure(request, started, code="internal_error",
                category="internal.unexpected", subsystem="assistant", phase="compose") from None
        finally:
            self._admission.release()


def create_default_assistant_service() -> AssistantService:
    """Create lazy runtime composition without loading E5 or Gemini."""
    return AssistantService(AssistantRuntimeManager())
