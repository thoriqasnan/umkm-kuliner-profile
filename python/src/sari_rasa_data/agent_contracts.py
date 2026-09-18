"""Immutable provider-neutral contracts for the bounded Phase 7G menu agent."""

from dataclasses import dataclass
import json
from typing import Literal, Protocol

from .llm_contracts import LLMRequest, LLMStructuredContractError
from .llm_structured import (
    PUBLIC_MENU_RESPONSE_SCHEMA,
    StructuredLLMResponse,
    parse_structured_menu_response,
)
from .rag_contracts import RAGEvidence
from .vector_contracts import VectorSpace


MAX_AGENT_DECISIONS = 3
MAX_AGENT_TOOL_CALLS = 2
MAX_AGENT_EVIDENCE = 5
MAX_AGENT_QUERY_LENGTH = 1000
MAX_AGENT_TOOL_QUERY_LENGTH = 200
AGENT_ACTION_SCHEMA_VERSION = "phase-7g.menu-agent-action.v1"

AgentLanguage = Literal["id", "en"]
AgentStatus = Literal["active", "finished", "cannot_complete"]


class AgentError(Exception):
    """Base class for sanitized application-owned agent failures."""


class AgentInvalidRequestError(AgentError):
    pass


class AgentActionValidationError(AgentError):
    pass


class AgentDecisionLimitError(AgentError):
    pass


class AgentToolCallLimitError(AgentError):
    pass


class AgentRepeatedToolCallError(AgentError):
    pass


class AgentTerminalStateError(AgentError):
    pass


@dataclass(frozen=True)
class MenuAgentRequest:
    user_input: str
    vector_space: VectorSpace
    language: AgentLanguage = "id"
    max_output_tokens: int = 256
    correlation_id: str | None = None

    def __post_init__(self) -> None:
        if (
            not isinstance(self.user_input, str)
            or not self.user_input.strip()
            or len(self.user_input) > MAX_AGENT_QUERY_LENGTH
        ):
            raise AgentInvalidRequestError(
                f"user_input must contain 1-{MAX_AGENT_QUERY_LENGTH} characters"
            )
        if not isinstance(self.vector_space, VectorSpace):
            raise AgentInvalidRequestError("vector_space must be a VectorSpace")
        if self.language not in ("id", "en"):
            raise AgentInvalidRequestError("language must be 'id' or 'en'")
        if (
            isinstance(self.max_output_tokens, bool)
            or not isinstance(self.max_output_tokens, int)
            or not 1 <= self.max_output_tokens <= 1024
        ):
            raise AgentInvalidRequestError("max_output_tokens must be between 1 and 1024")


@dataclass(frozen=True)
class SearchMenuArguments:
    query: str
    limit: int = MAX_AGENT_EVIDENCE


@dataclass(frozen=True)
class CallToolAction:
    action: Literal["call_tool"]
    tool_name: Literal["search_menu"]
    arguments: SearchMenuArguments


@dataclass(frozen=True)
class FinishAction:
    action: Literal["finish"]
    response: StructuredLLMResponse


@dataclass(frozen=True)
class CannotCompleteAction:
    action: Literal["cannot_complete"]
    response: StructuredLLMResponse


AgentAction = CallToolAction | FinishAction | CannotCompleteAction


@dataclass(frozen=True)
class AgentObservation:
    tool_name: Literal["search_menu"]
    query: str
    requested_language: AgentLanguage
    evidence_language: AgentLanguage | None
    language_fallback: bool
    items: tuple[RAGEvidence, ...]
    stale_candidate_count: int


@dataclass(frozen=True)
class MenuAgentState:
    original_user_query: str
    requested_language: AgentLanguage
    decision_count: int = 0
    tool_call_count: int = 0
    observed_product_ids: tuple[int, ...] = ()
    evidence: tuple[RAGEvidence, ...] = ()
    observations: tuple[AgentObservation, ...] = ()
    executed_tool_fingerprints: frozenset[str] = frozenset()
    status: AgentStatus = "active"


@dataclass(frozen=True)
class MenuAgentResult:
    response: StructuredLLMResponse
    evidence: tuple[RAGEvidence, ...]
    terminal_action: Literal["finish", "cannot_complete"]
    decision_count: int
    tool_call_count: int


@dataclass(frozen=True)
class AgentDecisionRequest:
    prompt: LLMRequest
    allowed_source_ids: frozenset[str]
    terminal_only: bool
    search_required: bool = False
    timeout_seconds: float | None = None
    schema_version: str = AGENT_ACTION_SCHEMA_VERSION

    def __post_init__(self) -> None:
        if not isinstance(self.prompt, LLMRequest):
            raise AgentInvalidRequestError("prompt must be an LLMRequest")
        if not isinstance(self.allowed_source_ids, frozenset):
            raise AgentInvalidRequestError("allowed_source_ids must be a frozenset")
        if not isinstance(self.terminal_only, bool):
            raise AgentInvalidRequestError("terminal_only must be a boolean")
        if not isinstance(self.search_required, bool):
            raise AgentInvalidRequestError("search_required must be a boolean")
        if self.timeout_seconds is not None and (
            isinstance(self.timeout_seconds, bool)
            or not isinstance(self.timeout_seconds, (int, float))
            or self.timeout_seconds <= 0
        ):
            raise AgentInvalidRequestError("timeout_seconds must be positive when supplied")
        if self.search_required and self.terminal_only:
            raise AgentInvalidRequestError(
                "a decision cannot require search and be terminal-only"
            )
        if self.schema_version != AGENT_ACTION_SCHEMA_VERSION:
            raise AgentInvalidRequestError("unsupported agent action schema version")


class AgentDecisionClient(Protocol):
    def decide(self, request: AgentDecisionRequest) -> AgentAction: ...


def parse_agent_action(
    raw_json: str,
    *,
    allowed_source_ids: frozenset[str],
    requested_language: AgentLanguage,
    terminal_only: bool,
    search_required: bool = False,
) -> AgentAction:
    if not isinstance(raw_json, str):
        raise AgentActionValidationError("agent action must be JSON text")
    try:
        value = json.loads(raw_json)
    except (TypeError, ValueError):
        raise AgentActionValidationError("agent returned malformed action JSON") from None
    if not isinstance(value, dict) or not isinstance(value.get("action"), str):
        raise AgentActionValidationError("agent action must be an object with an action")
    action = value["action"]
    if search_required and action != "call_tool":
        raise AgentActionValidationError(
            "an in-scope menu request must search before a terminal action"
        )
    if action == "call_tool":
        if terminal_only:
            raise AgentDecisionLimitError("agent requested a tool on a terminal-only decision")
        if set(value) != {"action", "tool_name", "arguments"}:
            raise AgentActionValidationError("call_tool fields do not match the contract")
        if value["tool_name"] != "search_menu":
            raise AgentActionValidationError("unknown agent tool")
        arguments = _parse_search_arguments(value["arguments"])
        return CallToolAction("call_tool", "search_menu", arguments)
    if action not in ("finish", "cannot_complete"):
        raise AgentActionValidationError("unknown agent action")
    if set(value) != {"action", "response"} or not isinstance(value["response"], dict):
        raise AgentActionValidationError("terminal action fields do not match the contract")
    response_json = json.dumps(value["response"], ensure_ascii=False, separators=(",", ":"))
    try:
        response = parse_structured_menu_response(
            response_json,
            allowed_source_ids if action == "finish" else frozenset(),
        )
    except LLMStructuredContractError as exc:
        raise AgentActionValidationError("terminal response is invalid") from exc
    except Exception as exc:
        from .llm_contracts import LLMError

        if isinstance(exc, LLMError):
            raise AgentActionValidationError("terminal response is invalid") from exc
        raise
    if response.language != requested_language:
        raise AgentActionValidationError("terminal response language does not match request")
    if action == "finish":
        if response.insufficient_information or not response.sources:
            raise AgentActionValidationError(
                "finish requires a grounded sufficient response with sources"
            )
        return FinishAction("finish", response)
    if (
        not response.insufficient_information
        or response.sources
        or not response.limitations
    ):
        raise AgentActionValidationError(
            "cannot_complete requires insufficiency, empty sources, and limitations"
        )
    return CannotCompleteAction("cannot_complete", response)


def _parse_search_arguments(value: object) -> SearchMenuArguments:
    if not isinstance(value, dict) or not set(value).issubset({"query", "limit"}):
        raise AgentActionValidationError("invalid search_menu arguments")
    if "query" not in value:
        raise AgentActionValidationError("search_menu query is required")
    query = value["query"]
    limit = value.get("limit", MAX_AGENT_EVIDENCE)
    if (
        not isinstance(query, str)
        or not query.strip()
        or len(query.strip()) > MAX_AGENT_TOOL_QUERY_LENGTH
    ):
        raise AgentActionValidationError(
            f"search_menu query must contain 1-{MAX_AGENT_TOOL_QUERY_LENGTH} characters"
        )
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 5:
        raise AgentActionValidationError("search_menu limit must be between 1 and 5")
    return SearchMenuArguments(query.strip(), limit)


AGENT_ACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "enum": ["call_tool", "finish", "cannot_complete"],
            "description": (
                "Use finish only for an explicitly evidenced sufficient response with at "
                "least one observed source. Use cannot_complete for every insufficient or "
                "unsupported response; never label an insufficient response as finish."
            ),
        },
        "tool_name": {"type": "string", "enum": ["search_menu"]},
        "arguments": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "maxLength": MAX_AGENT_TOOL_QUERY_LENGTH},
                "limit": {"type": "integer", "minimum": 1, "maximum": 5},
            },
            "required": ["query"],
        },
        "response": PUBLIC_MENU_RESPONSE_SCHEMA,
    },
    "required": ["action"],
}

INITIAL_SEARCH_AGENT_ACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ["call_tool"]},
        "tool_name": {"type": "string", "enum": ["search_menu"]},
        "arguments": AGENT_ACTION_SCHEMA["properties"]["arguments"],
    },
    "required": ["action", "tool_name", "arguments"],
}

TERMINAL_AGENT_ACTION_SCHEMA = {
    **AGENT_ACTION_SCHEMA,
    "properties": {
        **AGENT_ACTION_SCHEMA["properties"],
        "action": {
            "type": "string",
            "enum": ["finish", "cannot_complete"],
            "description": (
                "Choose finish only when canonical observations explicitly support the "
                "requested claim and the response is sufficient with observed sources. "
                "Choose cannot_complete when information is insufficient or the requested "
                "fact is unsupported, with insufficient_information true and sources empty."
            ),
        },
    },
}
