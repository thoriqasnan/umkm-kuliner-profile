from dataclasses import FrozenInstanceError
import json

import pytest

from sari_rasa_data.agent_contracts import (
    AgentActionValidationError,
    AgentDecisionLimitError,
    MenuAgentRequest,
    MenuAgentState,
    parse_agent_action,
)
from sari_rasa_data.vector_contracts import VectorSpace


SPACE = VectorSpace("fake", "agent", 2, "none", "7d-catalog-text-v1")


def response(*, sources=None, insufficient=False, limitations=None, language="id"):
    return {
        "answer": "Jawaban",
        "sources": ["menu:1"] if sources is None else sources,
        "insufficient_information": insufficient,
        "limitations": [] if limitations is None else limitations,
        "language": language,
    }


def test_requests_default_to_id_and_new_states_are_clean_and_frozen():
    request = MenuAgentRequest("Rekomendasikan menu", SPACE)
    state = MenuAgentState(request.user_input, request.language)
    assert request.language == "id"
    assert state.decision_count == state.tool_call_count == 0
    assert state.evidence == state.observations == state.observed_product_ids == ()
    assert state.executed_tool_fingerprints == frozenset()
    with pytest.raises(FrozenInstanceError):
        state.status = "finished"


@pytest.mark.parametrize(
    "changes",
    [
        {"user_input": ""},
        {"user_input": "x" * 1001},
        {"language": "fr"},
        {"max_output_tokens": 0},
        {"max_output_tokens": 1025},
    ],
)
def test_invalid_agent_requests_fail_closed(changes):
    values = {"user_input": "menu", "vector_space": SPACE}
    values.update(changes)
    with pytest.raises(Exception):
        MenuAgentRequest(**values)


def test_strict_call_tool_action_and_arguments():
    action = parse_agent_action(
        json.dumps(
            {"action": "call_tool", "tool_name": "search_menu", "arguments": {"query": "nasi"}}
        ),
        allowed_source_ids=frozenset(),
        requested_language="id",
        terminal_only=False,
    )
    assert action.arguments.limit == 5
    for value in (
        {"action": "call_tool", "tool_name": "delete", "arguments": {"query": "x"}},
        {"action": "call_tool", "tool_name": "search_menu", "arguments": {}},
        {"action": "call_tool", "tool_name": "search_menu", "arguments": {"query": "x", "extra": 1}},
        {"action": "call_tool", "tool_name": "search_menu", "arguments": {"query": " ", "limit": 1}},
        {"action": "call_tool", "tool_name": "search_menu", "arguments": {"query": "x" * 201}},
        {"action": "call_tool", "tool_name": "search_menu", "arguments": {"query": "x", "limit": True}},
        {"action": "call_tool", "tool_name": "search_menu", "arguments": {"query": "x", "limit": 0}},
        {"action": "call_tool", "tool_name": "search_menu", "arguments": {"query": "x", "limit": 6}},
        {"action": "call_tool", "tool_name": "search_menu", "arguments": {"query": "x"}, "reasoning": "hidden"},
    ):
        with pytest.raises(AgentActionValidationError):
            parse_agent_action(
                json.dumps(value), allowed_source_ids=frozenset(),
                requested_language="id", terminal_only=False,
            )


def test_terminal_only_rejects_call_tool():
    with pytest.raises(AgentDecisionLimitError):
        parse_agent_action(
            json.dumps({"action": "call_tool", "tool_name": "search_menu", "arguments": {"query": "x"}}),
            allowed_source_ids=frozenset(), requested_language="id", terminal_only=True,
        )


def test_search_required_rejects_premature_cannot_complete():
    with pytest.raises(AgentActionValidationError, match="must search"):
        parse_agent_action(
            json.dumps({
                "action": "cannot_complete",
                "response": response(
                    sources=[], insufficient=True, limitations=["Katalog menu kosong"]
                ),
            }),
            allowed_source_ids=frozenset(),
            requested_language="id",
            terminal_only=False,
            search_required=True,
        )


def test_finish_reuses_strict_source_and_language_validation():
    parsed = parse_agent_action(
        json.dumps({"action": "finish", "response": response()}),
        allowed_source_ids=frozenset({"menu:1"}), requested_language="id",
        terminal_only=False,
    )
    assert parsed.response.sources == ("menu:1",)
    for invalid in (
        response(sources=["menu:999"]),
        response(sources=["menu:1", "menu:1"]),
        response(language="en"),
        response(sources=[]),
        response(insufficient=True),
    ):
        with pytest.raises(AgentActionValidationError):
            parse_agent_action(
                json.dumps({"action": "finish", "response": invalid}),
                allowed_source_ids=frozenset({"menu:1"}), requested_language="id",
                terminal_only=False,
            )


def test_cannot_complete_requires_empty_sources_insufficiency_and_limitation():
    valid = response(sources=[], insufficient=True, limitations=["Tidak didukung"])
    assert parse_agent_action(
        json.dumps({"action": "cannot_complete", "response": valid}),
        allowed_source_ids=frozenset({"menu:1"}), requested_language="id",
        terminal_only=False,
    ).response.sources == ()
    for invalid in (
        response(sources=["menu:1"], insufficient=True, limitations=["x"]),
        response(sources=[], insufficient=False, limitations=["x"]),
        response(sources=[], insufficient=True, limitations=[]),
    ):
        with pytest.raises(AgentActionValidationError):
            parse_agent_action(
                json.dumps({"action": "cannot_complete", "response": invalid}),
                allowed_source_ids=frozenset({"menu:1"}), requested_language="id",
                terminal_only=False,
            )


def test_terminal_schema_describes_strict_finish_and_cannot_complete_mapping():
    from sari_rasa_data.agent_contracts import TERMINAL_AGENT_ACTION_SCHEMA

    description = TERMINAL_AGENT_ACTION_SCHEMA["properties"]["action"]["description"]
    assert "finish only" in description
    assert "cannot_complete" in description
    assert "insufficient_information true" in description
    assert "sources empty" in description


def test_unknown_extra_and_reasoning_fields_are_rejected():
    for value in (
        {"action": "think", "reasoning": "secret"},
        {"action": "finish", "response": response(), "rationale": "secret"},
    ):
        with pytest.raises(AgentActionValidationError):
            parse_agent_action(
                json.dumps(value), allowed_source_ids=frozenset({"menu:1"}),
                requested_language="id", terminal_only=False,
            )
