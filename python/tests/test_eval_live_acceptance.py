import json
from pathlib import Path
import subprocess
import sys

import pytest

from sari_rasa_data.agent_contracts import CallToolAction, CannotCompleteAction, FinishAction, SearchMenuArguments
from sari_rasa_data.embedding_contracts import EmbeddingVector
from sari_rasa_data.eval_contracts import EvaluationContractError, EvaluationDataset
from sari_rasa_data.eval_dataset import load_evaluation_dataset
from sari_rasa_data.eval_live_acceptance import (
    AGENT_LIVE_CASE_IDS,
    RAG_LIVE_CASE_IDS,
    format_live_scorecard,
    run_controlled_live_evaluation,
    select_controlled_live_cases,
    _hard_gates,
)
from sari_rasa_data.llm_client import LLMConfig
from sari_rasa_data.llm_contracts import LLMMalformedResponseError, LLMRateLimitError
from sari_rasa_data.llm_structured import StructuredLLMResponse


class LocalEmbeddingStub:
    def __init__(self, model_name, *, local_files_only):
        self.model_name = model_name
        self.local_files_only = local_files_only

    def embed(self, request):
        text = request.semantic_text.lower()
        if "nasi goreng" in text:
            vector = (1.0, 0.0, 0.0, 0.0)
        elif "mie ayam" in text:
            vector = (0.0, 1.0, 0.0, 0.0)
        elif "ayam geprek" in text:
            vector = (0.0, 0.0, 1.0, 0.0)
        elif "jeruk" in text or "refresh" in text or "segar" in text:
            vector = (0.0, 0.0, 0.0, 1.0)
        else:
            vector = (0.5, 0.4, 0.3, 0.2)
        return EmbeddingVector("sentence-transformers", self.model_name, 4, vector)


class ScriptedProvider:
    def generate_structured(self, request):
        unsupported = "alergen" in request.prompt.user_input.lower() or "allergen" in request.prompt.user_input.lower()
        if unsupported:
            return StructuredLLMResponse("Informasi tidak tersedia." if request.prompt.language == "id" else "Information is unavailable.", (), True, ("Allergen information is not in the catalog.",), request.prompt.language)
        source = sorted(request.allowed_source_ids)[0]
        return StructuredLLMResponse("Jawaban berdasarkan menu." if request.prompt.language == "id" else "Answer based on the menu.", (source,), False, (), request.prompt.language)

    def decide(self, request):
        language = request.prompt.language
        user = request.prompt.user_input.lower()
        if request.search_required:
            return CallToolAction("call_tool", "search_menu", SearchMenuArguments(request.prompt.user_input, 5))
        unsupported = "alergen" in user or "allergen" in user
        if unsupported:
            return CannotCompleteAction("cannot_complete", StructuredLLMResponse("Informasi tidak tersedia." if language == "id" else "Information is unavailable.", (), True, ("Allergen information is not in the catalog.",), language))
        source = sorted(request.allowed_source_ids)[0]
        return FinishAction("finish", StructuredLLMResponse("Rekomendasi menu." if language == "id" else "Menu recommendation.", (source,), False, (), language))


def _run(**kwargs):
    clients = []
    def embedding_factory(model_name, *, local_files_only):
        client = LocalEmbeddingStub(model_name, local_files_only=local_files_only)
        clients.append(client)
        return client
    result = run_controlled_live_evaluation(
        embedding_model="test/model",
        _config_loader=lambda: LLMConfig("gemini", "test-gemini", "TOP-SECRET", 10),
        _embedding_factory=embedding_factory,
        _provider_factory=lambda config: ScriptedProvider(),
        **kwargs,
    )
    return result, clients


def test_exact_validated_live_subset_is_four_rag_plus_four_agent():
    dataset = load_evaluation_dataset()
    rag, agent = select_controlled_live_cases(dataset)
    assert tuple(case.case_id for case in rag) == RAG_LIVE_CASE_IDS
    assert tuple(case.case_id for case in agent) == AGENT_LIVE_CASE_IDS
    assert len(rag) == 4 and len(agent) == 4
    pairs = (rag[:2], rag[2:], agent[:2], agent[2:])
    assert all({case.language for case in pair} == {"id", "en"} for pair in pairs)
    assert {case.bilingual_pair_id for case in rag[:2]} == {"rag-fact"}
    assert {case.expected_response_class for case in rag[:2]} == {"supported"}
    assert {case.bilingual_pair_id for case in rag[2:]} == {"rag-allergen-guarantee"}
    assert {case.expected_response_class for case in rag[2:]} == {"insufficient"}
    assert all({"allergen", "guarantee"} <= set(case.tags) for case in rag[2:])
    assert {case.bilingual_pair_id for case in agent[:2]} == {"agent-recommend"}
    assert {case.expected_terminal_class for case in agent[:2]} == {"finish"}
    assert all("recommendation" in case.tags for case in agent[:2])
    assert {case.bilingual_pair_id for case in agent[2:]} == {"agent-allergen-guarantee"}
    assert {case.expected_terminal_class for case in agent[2:]} == {"cannot_complete"}
    assert all({"allergen", "guarantee"} <= set(case.tags) for case in agent[2:])

    selected = (*rag, *agent)
    regression_tags = {"invalid-action", "bounds", "mutation"}
    assert all(regression_tags.isdisjoint(case.tags) for case in selected)
    assert {case.case_id for case in selected}.isdisjoint(
        probe.case_id for probe in dataset.boundary_probes
    )


def test_dataset_drift_or_missing_case_fails_closed():
    dataset = load_evaluation_dataset()
    missing = EvaluationDataset(
        dataset.dataset_version, dataset.schema_version, dataset.fixture_classification,
        dataset.catalog, dataset.retrieval_cases,
        tuple(case for case in dataset.rag_cases if case.case_id != RAG_LIVE_CASE_IDS[0]),
        dataset.agent_cases, dataset.boundary_probes,
    )
    with pytest.raises(EvaluationContractError):
        select_controlled_live_cases(missing)


def test_live_harness_reuses_boundaries_and_emits_sanitized_eight_case_result(tmp_path):
    output = tmp_path / "live.json"
    result, clients = _run(output_path=output)
    assert result["run_status"] == "pass"
    assert len(result["rag_cases"]) == 4
    assert len(result["agent_cases"]) == 4
    assert result["metadata"]["case_counts"] == {"rag": 4, "agent": 4, "gemini_backed": 8}
    assert clients[0].model_name == "test/model"
    assert clients[0].local_files_only is True
    assert all(item["source_valid"] for item in result["rag_cases"])
    assert all(not item["unsupported_guarantee_accepted_count"] for item in result["rag_cases"])
    assert all(item["decision_count"] <= 3 and item["tool_call_count"] <= 2 and item["evidence_count"] <= 5 for item in result["agent_cases"])
    assert result["hard_gates"]["pass"] is True
    assert result["observability"]["provider_call_count"] == 12
    assert result["observability"]["input_tokens"] is None
    assert len(result["human_review"]["cases"]) == 8
    assert result["human_review"]["scores"] is None
    serialized = output.read_text()
    assert "TOP-SECRET" not in serialized
    assert '"vector":' not in serialized.lower()
    assert "provider payload" not in serialized.lower()
    assert "chain-of-thought" not in serialized.lower()
    assert "Hard gates: PASS" in format_live_scorecard(result)
    assert set(result["human_review"]["cases"][0]) <= {
        "case_id", "language", "query", "answer", "limitations",
        "insufficient_information", "accepted_source_ids", "observed_product_ids",
    }
    with pytest.raises(EvaluationContractError):
        _run(output_path=output)


def test_provider_failure_is_infrastructure_not_quality_failure():
    class RateLimited(ScriptedProvider):
        def generate_structured(self, request):
            raise LLMRateLimitError("LLM provider rate limit exceeded")

    result = run_controlled_live_evaluation(
        embedding_model="test/model",
        _config_loader=lambda: LLMConfig("gemini", "test-gemini", "secret", 10),
        _embedding_factory=LocalEmbeddingStub,
        _provider_factory=lambda config: RateLimited(),
    )
    assert result["run_status"] == "infrastructure_failure"
    assert result["infrastructure_failure"]["failure_type"] == "LLMRateLimitError"
    assert not result["rag_cases"]


def test_malformed_provider_envelope_is_infrastructure_not_quality_failure():
    class Malformed(ScriptedProvider):
        def generate_structured(self, request):
            raise LLMMalformedResponseError("LLM provider returned an invalid response shape")

    result = run_controlled_live_evaluation(
        embedding_model="test/model",
        _config_loader=lambda: LLMConfig("gemini", "test-gemini", "secret", 10),
        _embedding_factory=LocalEmbeddingStub,
        _provider_factory=lambda config: Malformed(),
    )
    assert result["run_status"] == "infrastructure_failure"
    assert result["infrastructure_failure"]["failure_type"] == "LLMMalformedResponseError"


def test_attempts_remain_distinct_from_acceptance_and_execution():
    rows = [{
        "unsafe_attempt_count": 1,
        "unsafe_accepted_count": 0,
        "invented_source_attempt_count": 1,
        "invented_source_accepted_count": 0,
        "invalid_action_attempt_count": 1,
        "unknown_action_accepted_count": 0,
        "unauthorized_tool_attempt_count": 1,
        "unauthorized_tool_execution_count": 0,
        "mutation_attempt_count": 1,
        "mutation_execution_count": 0,
    }]
    gates = _hard_gates(rows, [])
    assert gates["pass"] is True
    rows[0]["mutation_execution_count"] = 1
    assert _hard_gates(rows, [])["pass"] is False


def test_import_and_help_do_not_construct_models_or_read_configuration():
    completed = subprocess.run(
        (sys.executable, "-m", "sari_rasa_data.eval_live_acceptance", "--help"),
        capture_output=True, text=True, check=False,
    )
    assert completed.returncode == 0
    assert "controlled eight-case" in completed.stdout
    assert completed.stderr == ""
    assert "SARI_RASA_LLM_API_KEY" not in completed.stdout
