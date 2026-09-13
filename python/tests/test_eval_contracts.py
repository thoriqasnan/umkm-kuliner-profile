import pytest

from sari_rasa_data.eval_contracts import AgentEvalCase, EvaluationContractError


def test_agent_contract_is_frozen_and_enforces_hard_limits():
    case = AgentEvalCase("a", "id", "q", ("tag",), False, "finish", frozenset({"1"}), 1, 3, 1, 2, 5, "allow")
    with pytest.raises(AttributeError):
        case.max_decisions = 4
    with pytest.raises(EvaluationContractError):
        AgentEvalCase("a", "id", "q", ("tag",), False, "finish", frozenset(), 1, 4, 0, 2, 5, "allow")
