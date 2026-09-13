"""Single bounded read-only tool for caller-supplied public menu data."""

from dataclasses import asdict
import json
import unicodedata
from typing import Any

from .llm_contracts import LLMInvalidToolArgumentsError, LLMUnknownToolError
from .llm_structured import ToolCall, ToolDefinition, ToolResult
from .menu_prompts import Language, PublicMenuItem


SEARCH_MENU_TOOL_NAME = "search_menu"
MAX_SEARCH_RESULTS = 5
MAX_SEARCH_QUERY_LENGTH = 200

SEARCH_MENU_TOOL = ToolDefinition(
    name=SEARCH_MENU_TOOL_NAME,
    description="Search only the caller-supplied public SariRasa menu catalog.",
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "language": {"type": "string", "enum": ["id", "en"]},
            "limit": {"type": "integer", "minimum": 1, "maximum": MAX_SEARCH_RESULTS},
        },
        "required": ["query"],
    },
)


def execute_menu_tool(
    call: ToolCall,
    catalog: tuple[PublicMenuItem, ...],
    default_language: Language,
) -> ToolResult:
    """Execute only the explicitly registered, read-only menu search tool."""

    if call.name != SEARCH_MENU_TOOL_NAME:
        raise LLMUnknownToolError("unknown tool name")
    arguments = call.arguments
    if not isinstance(arguments, dict) or not set(arguments).issubset({"query", "language", "limit"}):
        raise LLMInvalidToolArgumentsError("invalid search_menu arguments")
    if "query" not in arguments:
        raise LLMInvalidToolArgumentsError("search_menu query is required")
    query = arguments["query"]
    language = arguments.get("language", default_language)
    limit = arguments.get("limit", MAX_SEARCH_RESULTS)
    if not isinstance(query, str) or not query.strip():
        raise LLMInvalidToolArgumentsError("search_menu query must be non-blank")
    if len(query) > MAX_SEARCH_QUERY_LENGTH:
        raise LLMInvalidToolArgumentsError("search_menu query is too long")
    if language not in ("id", "en"):
        raise LLMInvalidToolArgumentsError("search_menu language must be 'id' or 'en'")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_SEARCH_RESULTS:
        raise LLMInvalidToolArgumentsError(
            f"search_menu limit must be between 1 and {MAX_SEARCH_RESULTS}"
        )

    needle = _normalize(query)
    description_field = "description_id" if language == "id" else "description_en"
    matches = []
    for item in sorted(catalog, key=lambda value: (value.product_id, value.slug)):
        haystack = " ".join(
            (item.slug, item.name, item.category, getattr(item, description_field))
        )
        if needle in _normalize(haystack):
            public_item = asdict(item)
            matches.append(public_item)
            if len(matches) == limit:
                break
    return ToolResult(
        name=SEARCH_MENU_TOOL_NAME,
        result={"items": matches, "language": language},
    )


def tool_call_fingerprint(call: ToolCall) -> str:
    try:
        arguments = json.dumps(call.arguments, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError):
        raise LLMInvalidToolArgumentsError("tool arguments must be JSON-compatible") from None
    return f"{call.name}:{arguments}"


def _normalize(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return " ".join(normalized.split())
