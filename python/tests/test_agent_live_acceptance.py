import importlib
import sys

from sari_rasa_data.agent_contracts import MenuAgentResult
from sari_rasa_data.llm_structured import StructuredLLMResponse


def result(terminal, decisions, calls, *, sources=(), insufficient=True):
    return MenuAgentResult(
        StructuredLLMResponse("Jawaban", sources, insufficient, ("Batasan",), "id"),
        (), terminal, decisions, calls,
    )


def test_live_scenario_contracts_are_strict():
    from sari_rasa_data.agent_live_acceptance import _scenario_failures

    assert _scenario_failures(
        result("cannot_complete", 2, 1), "cannot_complete", (1, 2)
    ) == ()
    failures = _scenario_failures(
        result("finish", 2, 0, insufficient=True), "finish", (1, 2)
    )
    assert failures == (
        "unexpected tool-call count",
        "unexpected decision count",
        "finish must be grounded and sufficient",
    )


def test_live_scenario_allows_two_distinct_searches_before_terminal_action():
    from sari_rasa_data.agent_live_acceptance import _scenario_failures

    assert _scenario_failures(
        result("finish", 3, 2, sources=("menu:1",), insufficient=False),
        "finish",
        (1, 2),
    ) == ("sources must belong to observed evidence",)


def test_acceptance_import_has_no_model_provider_or_network_side_effect():
    for name in (
        "sentence_transformers",
        "sari_rasa_data.agent_live_acceptance",
    ):
        sys.modules.pop(name, None)
    module = importlib.import_module("sari_rasa_data.agent_live_acceptance")
    assert module.main
    assert "sentence_transformers" not in sys.modules
