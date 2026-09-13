from dataclasses import asdict

import pytest

from sari_rasa_data.llm_contracts import (
    LLMInvalidToolArgumentsError,
    LLMUnknownToolError,
)
from sari_rasa_data.llm_structured import ToolCall
from sari_rasa_data.menu_prompts import PublicMenuItem
from sari_rasa_data.menu_tools import (
    MAX_SEARCH_RESULTS,
    SEARCH_MENU_TOOL,
    execute_menu_tool,
    tool_call_fingerprint,
)


@pytest.fixture
def catalog():
    return (
        PublicMenuItem(2, "es-teh", "Es Teh", "Minuman", 5000, "Teh dingin", "Iced tea"),
        PublicMenuItem(1, "nasi-goreng", "Nasi Goreng", "Makanan", 18000, "Nasi gurih", "Savory rice"),
        PublicMenuItem(3, "jus-mangga", "Jus Mangga", "Minuman", 9000, "Mangga segar", "Fresh mango"),
    )


def test_search_is_read_only_deterministic_and_public_safe(catalog):
    before = tuple(asdict(item) for item in catalog)
    first = execute_menu_tool(ToolCall("search_menu", {"query": "minuman"}), catalog, "id")
    second = execute_menu_tool(ToolCall("search_menu", {"query": "MINUMAN"}), tuple(reversed(catalog)), "id")
    assert first == second
    assert [item["product_id"] for item in first.result["items"]] == [2, 3]
    assert set(first.result["items"][0]) == {
        "product_id", "slug", "name", "category", "price_rupiah", "description_id", "description_en"
    }
    assert tuple(asdict(item) for item in catalog) == before


def test_search_language_selects_matching_description(catalog):
    assert execute_menu_tool(ToolCall("search_menu", {"query": "gurih", "language": "id"}), catalog, "en").result["items"]
    assert execute_menu_tool(ToolCall("search_menu", {"query": "savory", "language": "en"}), catalog, "id").result["items"]
    assert not execute_menu_tool(ToolCall("search_menu", {"query": "savory", "language": "id"}), catalog, "id").result["items"]


def test_limit_is_enforced(catalog):
    result = execute_menu_tool(ToolCall("search_menu", {"query": "m", "limit": 1}), catalog, "id")
    assert len(result.result["items"]) == 1
    assert MAX_SEARCH_RESULTS == 5


@pytest.mark.parametrize(
    "arguments",
    [
        {},
        {"query": ""},
        {"query": 3},
        {"query": "tea", "language": "fr"},
        {"query": "tea", "limit": 0},
        {"query": "tea", "limit": 6},
        {"query": "tea", "limit": True},
        {"query": "x" * 201},
        {"query": "tea", "sql": "select *"},
    ],
)
def test_malformed_arguments_rejected(catalog, arguments):
    with pytest.raises(LLMInvalidToolArgumentsError):
        execute_menu_tool(ToolCall("search_menu", arguments), catalog, "id")


def test_unknown_tool_rejected(catalog):
    with pytest.raises(LLMUnknownToolError):
        execute_menu_tool(ToolCall("delete_product", {"query": "x"}), catalog, "id")


def test_tool_definition_is_strict_and_small():
    assert SEARCH_MENU_TOOL.name == "search_menu"
    assert "additionalProperties" not in SEARCH_MENU_TOOL.parameters
    assert set(SEARCH_MENU_TOOL.parameters["properties"]) == {"query", "language", "limit"}


def test_fingerprint_is_stable_and_rejects_non_json_arguments():
    assert tool_call_fingerprint(ToolCall("search_menu", {"limit": 2, "query": "rice"})) == tool_call_fingerprint(
        ToolCall("search_menu", {"query": "rice", "limit": 2})
    )
    with pytest.raises(LLMInvalidToolArgumentsError):
        tool_call_fingerprint(ToolCall("search_menu", {"query": object()}))
