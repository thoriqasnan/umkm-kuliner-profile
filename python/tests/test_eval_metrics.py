import pytest

from sari_rasa_data.eval_metrics import (
    AgentObservation, RAGObservation, RetrievalObservation, SafetyObservation,
    agent_bilingual_agreement, rag_bilingual_agreement,
    aggregate_rag, aggregate_retrieval, aggregate_safety,
    retrieval_bilingual_agreement, retrieval_case_metrics, safe_rate,
)


def test_retrieval_formulas_deduplicate_and_support_multiple_gold():
    row = RetrievalObservation("r", "id", frozenset({"2", "3"}), ("9", "9", "2"), (0.9, 0.8, 0.7))
    result = retrieval_case_metrics(row)
    assert result["hit_at_1"] == 0
    assert result["hit_at_3"] == 1
    assert result["recall_at_5"] == 0.5
    assert result["reciprocal_rank"] == 0.5
    assert result["first_gold_score"] == 0.7
    assert result["top_to_first_gold_gap"] == pytest.approx(0.2)


def test_retrieval_fewer_results_no_match_and_zero_denominator():
    row = RetrievalObservation("r", "en", frozenset({"1"}), ("2",))
    assert retrieval_case_metrics(row)["recall_at_5"] == 0
    empty = aggregate_retrieval(())
    assert empty["overall"]["hit_at_1"] is None
    assert safe_rate(0, 0) is None


def test_bilingual_pair_accounting():
    rows = [
        RetrievalObservation("id", "id", frozenset({"1"}), ("1",), bilingual_pair_id="p"),
        RetrievalObservation("en", "en", frozenset({"1"}), ("1",), bilingual_pair_id="p"),
    ]
    result = retrieval_bilingual_agreement(rows)
    assert result["pair_count"] == 1
    assert result["both_hit_at_1_rate"] == 1
    assert retrieval_bilingual_agreement(())["both_hit_at_1_rate"] is None


def test_insufficiency_confusion_math_and_citation_denominators():
    rows = [
        RAGObservation("tp", "id", "insufficient", "insufficient", True, True, True),
        RAGObservation("fn", "id", "insufficient", "supported", True, True, True, ("menu:1",), ("menu:1",), frozenset({"menu:1"})),
        RAGObservation("fp", "en", "supported", "insufficient", True, True, True),
        RAGObservation("tn", "en", "supported", "supported", True, True, True, ("menu:1",), ("menu:1",), frozenset({"menu:1"}), True),
    ]
    result = aggregate_rag(rows)
    assert result["insufficiency"]["precision"] == 0.5
    assert result["insufficiency"]["recall"] == 0.5
    assert (result["insufficiency"]["tp"], result["insufficiency"]["fp"], result["insufficiency"]["fn"], result["insufficiency"]["tn"]) == (1, 1, 1, 1)
    assert result["grounding"]["valid_cited_occurrence_rate"] == 1
    assert aggregate_rag(())["grounding"]["valid_cited_occurrence_rate"] is None


def test_attempts_are_distinct_from_accepted_safety_events():
    result = aggregate_safety([SafetyObservation(unsafe_model_action_attempts=1, unauthorized_tool_attempts=1)])
    assert result["unsafe_model_action_attempts"] == 1
    assert result["unsafe_accepted_actions"] == 0
    assert result["hard_gates_pass"] is True


def test_agent_observation_can_record_bound_violation_without_relaxing_limit():
    row = AgentObservation("a", "finish", "finish", True, False, 4, 3, 6, 4, False)
    assert row.decision_count > 3 and row.tool_call_count > 2 and row.evidence_count > 5


def test_agent_bilingual_agreement_requires_equivalent_outcome_and_bounds():
    rows = [
        AgentObservation("a-id", "finish", "finish", True, False, 2, 1, 1, 2, True, bilingual_pair_id="a", canonical_product_ids=frozenset({"1"})),
        AgentObservation("a-en", "finish", "finish", True, False, 2, 1, 1, 2, True, language="en", bilingual_pair_id="a", canonical_product_ids=frozenset({"1"})),
    ]
    assert agent_bilingual_agreement(rows)["agreement_rate"] == 1


def test_bilingual_canonical_outcome_cannot_match_one_sided_empty_evidence():
    rows = [
        RAGObservation("id", "id", "supported", "supported", True, True, True, bilingual_pair_id="p", canonical_product_ids=frozenset()),
        RAGObservation("en", "en", "supported", "supported", True, True, True, bilingual_pair_id="p", canonical_product_ids=frozenset({"1"})),
    ]
    assert rag_bilingual_agreement(rows)["agreement_rate"] == 0
