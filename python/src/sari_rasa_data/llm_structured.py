"""Provider-neutral structured-output contracts and strict validation."""

from dataclasses import dataclass
import json
from typing import Any, Literal

from .llm_contracts import (
    LLMRequest,
    LLMSourceValidationError,
    LLMStructuredContractError,
    LLMStructuredOutputParseError,
)
from .menu_prompts import PublicMenuItem
from .ai_contracts import (
    MAX_AI_ANSWER_LENGTH,
    MAX_AI_LIMITATION_LENGTH,
    MAX_AI_LIMITATIONS,
    MAX_AI_SOURCES,
)


STRUCTURED_MENU_SCHEMA_VERSION = "phase-7c.public-menu-response.v1"
MAX_TOOL_CALLS = 2

PUBLIC_MENU_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "answer": {"type": "string", "maxLength": MAX_AI_ANSWER_LENGTH},
        "sources": {"type": "array", "maxItems": MAX_AI_SOURCES, "items": {"type": "string"}},
        "insufficient_information": {"type": "boolean"},
        "limitations": {
            "type": "array", "maxItems": MAX_AI_LIMITATIONS,
            "items": {"type": "string", "maxLength": MAX_AI_LIMITATION_LENGTH},
        },
        "language": {"type": "string", "enum": ["id", "en"]},
    },
    "required": [
        "answer",
        "sources",
        "insufficient_information",
        "limitations",
        "language",
    ],
}


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    parameters: dict[str, Any]

    def __post_init__(self) -> None:
        if not isinstance(self.name, str) or not self.name.strip():
            raise LLMStructuredContractError("tool name must be a non-blank string")
        if not isinstance(self.description, str) or not self.description.strip():
            raise LLMStructuredContractError("tool description must be a non-blank string")
        if not isinstance(self.parameters, dict):
            raise LLMStructuredContractError("tool parameters must be an object schema")


@dataclass(frozen=True)
class ToolCall:
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ToolResult:
    name: str
    result: dict[str, Any]


@dataclass(frozen=True)
class StructuredLLMRequest:
    """Existing text request plus caller-owned grounding and tool context."""

    prompt: LLMRequest
    allowed_source_ids: frozenset[str]
    catalog: tuple[PublicMenuItem, ...]
    tools: tuple[ToolDefinition, ...]
    schema_version: str = STRUCTURED_MENU_SCHEMA_VERSION

    def __post_init__(self) -> None:
        if not isinstance(self.prompt, LLMRequest):
            raise LLMStructuredContractError("prompt must be an LLMRequest")
        if not isinstance(self.allowed_source_ids, frozenset):
            raise LLMStructuredContractError("allowed_source_ids must be a frozenset")
        if any(not isinstance(source, str) or not source.strip() for source in self.allowed_source_ids):
            raise LLMStructuredContractError("allowed source IDs must be non-blank strings")
        if not isinstance(self.catalog, tuple) or any(
            not isinstance(item, PublicMenuItem) for item in self.catalog
        ):
            raise LLMStructuredContractError("catalog must contain PublicMenuItem values")
        if not isinstance(self.tools, tuple) or len(self.tools) > 1:
            raise LLMStructuredContractError("only the registered search_menu tool is allowed")
        if self.tools and (
            not isinstance(self.tools[0], ToolDefinition)
            or self.tools[0].name != "search_menu"
        ):
            raise LLMStructuredContractError("only the registered search_menu tool is allowed")
        if self.schema_version != STRUCTURED_MENU_SCHEMA_VERSION:
            raise LLMStructuredContractError("unsupported structured schema version")


@dataclass(frozen=True)
class StructuredLLMResponse:
    answer: str
    sources: tuple[str, ...]
    insufficient_information: bool
    limitations: tuple[str, ...]
    language: Literal["id", "en"]


def parse_structured_menu_response(
    raw_json: str, allowed_source_ids: frozenset[str]
) -> StructuredLLMResponse:
    """Strictly parse and source-validate a public-menu response."""

    if not isinstance(raw_json, str):
        raise LLMStructuredOutputParseError("structured output must be JSON text")
    try:
        value = json.loads(raw_json)
    except (TypeError, ValueError):
        raise LLMStructuredOutputParseError("LLM returned malformed structured JSON") from None
    if not isinstance(value, dict):
        raise LLMStructuredContractError("structured response must be an object")

    expected = {
        "answer",
        "sources",
        "insufficient_information",
        "limitations",
        "language",
    }
    if set(value) != expected:
        raise LLMStructuredContractError("structured response fields do not match the contract")
    answer = value["answer"]
    sources = value["sources"]
    insufficient = value["insufficient_information"]
    limitations = value["limitations"]
    language = value["language"]
    if (
        not isinstance(answer, str)
        or not answer.strip()
        or len(answer.strip()) > MAX_AI_ANSWER_LENGTH
    ):
        raise LLMStructuredContractError("answer must be a non-blank string")
    if not isinstance(sources, list) or any(
        not isinstance(source, str) or not source.strip() for source in sources
    ):
        raise LLMStructuredContractError("sources must be a list of non-blank strings")
    if len(sources) != len(set(sources)):
        raise LLMStructuredContractError("sources must not contain duplicates")
    if len(sources) > MAX_AI_SOURCES:
        raise LLMStructuredContractError("sources exceed the bounded contract")
    unknown = set(sources) - allowed_source_ids
    if unknown:
        raise LLMSourceValidationError("structured response contains an unknown source ID")
    if not isinstance(insufficient, bool):
        raise LLMStructuredContractError("insufficient_information must be a boolean")
    if not isinstance(limitations, list) or any(
        not isinstance(item, str) or not item.strip() for item in limitations
    ):
        raise LLMStructuredContractError("limitations must be a list of non-blank strings")
    if len(limitations) > MAX_AI_LIMITATIONS or any(
        len(item) > MAX_AI_LIMITATION_LENGTH for item in limitations
    ):
        raise LLMStructuredContractError("limitations exceed the bounded contract")
    if language not in ("id", "en"):
        raise LLMStructuredContractError("language must be 'id' or 'en'")
    return StructuredLLMResponse(
        answer=answer.strip(),
        sources=tuple(sources),
        insufficient_information=insufficient,
        limitations=tuple(item.strip() for item in limitations),
        language=language,
    )
