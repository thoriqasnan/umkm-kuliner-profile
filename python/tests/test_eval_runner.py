import json
from hashlib import sha256
from pathlib import Path
import subprocess
import sys

import pytest

from sari_rasa_data.embedding_contracts import EmbeddingConfigUnavailableError, EmbeddingModelLoadError, EmbeddingVector
from sari_rasa_data.embeddings import CATALOG_TEXT_VERSION_V2
from sari_rasa_data.embedding_profiles import E5_MODEL_ID, E5_PROFILE_ID, MINILM_MODEL_ID, MINILM_PROFILE_ID
from sari_rasa_data.eval_contracts import EvaluationContractError
from sari_rasa_data import eval_runner
from sari_rasa_data.eval_runner import format_scorecard, run_evaluation
from sari_rasa_data.hybrid_retrieval import HYBRID_RETRIEVAL_POLICY, SEMANTIC_RETRIEVAL_POLICY


class SemanticStub:
    def __init__(self, model_name, *, local_files_only):
        self.model_name = model_name
        self.local_files_only = local_files_only
        self.calls = []

    def embed(self, request):
        self.calls.append(request)
        digest = sha256(f"{request.language}\0{request.semantic_text}".encode()).digest()
        vector = tuple((digest[index] + 1) / 256 for index in range(4))
        return EmbeddingVector("sentence-transformers", self.model_name, 4, vector)


def test_offline_runner_uses_no_provider_and_does_not_claim_semantic_quality():
    result = run_evaluation()
    assert result["semantic_retrieval_quality"] is None
    assert result["observability"]["provider_llm_call_count"] == 0
    assert result["offline_orchestration"]["passed"] is True
    assert result["safety"]["hard_gates_pass"] is True
    assert result["agent"]["hard_bounds_pass"] is True
    assert all(item["passed"] for item in result["boundary_probes"])
    assert "NOT RUN" in format_scorecard(result)


def test_output_requires_explicit_new_path(tmp_path):
    path = tmp_path / "result.json"
    run_evaluation(output_path=path)
    assert json.loads(path.read_text())["metadata"]["run_mode"] == "offline"
    with pytest.raises(EvaluationContractError):
        run_evaluation(output_path=path)


@pytest.mark.parametrize("mode", ["controlled-live", "other"])
def test_stop_gated_modes_fail_closed(mode):
    with pytest.raises(EvaluationContractError):
        run_evaluation(mode=mode)


def test_module_help_is_wired_without_running_evaluation():
    completed = subprocess.run(
        (sys.executable, "-m", "sari_rasa_data.eval_runner", "--help"),
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0
    assert "Phase 7H AI evaluation" in completed.stdout
    assert "--mode" in completed.stdout
    assert "--embedding-model" in completed.stdout
    assert completed.stderr == ""


def test_local_model_uses_supplied_offline_adapter_and_temporary_store(monkeypatch):
    constructed = []
    database_paths = []
    real_store = eval_runner.SQLiteVectorStore

    def factory(model_name, *, local_files_only):
        client = SemanticStub(model_name, local_files_only=local_files_only)
        constructed.append(client)
        return client

    def tracking_store(path, vector_space):
        database_paths.append(Path(path))
        return real_store(path, vector_space)

    monkeypatch.setattr(eval_runner, "SQLiteVectorStore", tracking_store)
    result = run_evaluation(
        mode="local-model",
        embedding_model=MINILM_MODEL_ID,
        _embedding_client_factory=factory,
    )

    assert len(constructed) == 1
    assert constructed[0].model_name == MINILM_MODEL_ID
    assert constructed[0].local_files_only is True
    assert len(constructed[0].calls) == 34  # 11 products x 2 languages + 12 queries
    assert result["metadata"]["run_mode"] == "local-model"
    assert result["metadata"]["case_counts"]["evaluation_cases"] == 12
    assert result["metadata"]["case_counts"]["rag"] == 0
    assert result["metadata"]["embedding"]["local_files_only"] is True
    assert result["metadata"]["embedding"]["retrieval_policy"] == SEMANTIC_RETRIEVAL_POLICY
    assert result["metadata"]["embedding"]["embedding_profile"] == MINILM_PROFILE_ID
    assert result["semantic_retrieval_quality"]["overall"]["case_count"] == 12
    assert len(result["semantic_retrieval_quality"]["cases"]) == 12
    assert all("query" in row and len(row["retrieved_product_ids"]) == 5 for row in result["semantic_retrieval_quality"]["cases"])
    assert result["semantic_retrieval_quality"]["bilingual"]["pair_count"] == 6
    assert database_paths and not database_paths[0].exists()
    assert "Hit@1" in format_scorecard(result)
    assert "ret-direct-id" in format_scorecard(result)


def test_local_model_selects_v2_projection_without_changing_queries_or_gold():
    clients = []
    factory = lambda model_name, *, local_files_only: clients.append(
        SemanticStub(model_name, local_files_only=local_files_only)
    ) or clients[-1]
    result = run_evaluation(
        mode="local-model",
        semantic_text_version=CATALOG_TEXT_VERSION_V2,
        _embedding_client_factory=factory,
    )
    dataset = eval_runner.load_evaluation_dataset()
    catalog_calls = clients[0].calls[:22]
    query_calls = clients[0].calls[22:]
    assert result["metadata"]["embedding"]["semantic_text_version"] == CATALOG_TEXT_VERSION_V2
    assert all("description_id:" in call.semantic_text and "description_en:" in call.semantic_text for call in catalog_calls)
    assert [call.semantic_text for call in query_calls] == [case.query for case in dataset.retrieval_cases]
    assert [row["expected_product_ids"] for row in result["semantic_retrieval_quality"]["cases"]] == [sorted(case.expected_product_ids) for case in dataset.retrieval_cases]


def test_local_case_serialization_is_deterministic():
    factory = lambda model_name, *, local_files_only: SemanticStub(model_name, local_files_only=local_files_only)
    first = run_evaluation(mode="local-model", _embedding_client_factory=factory)
    second = run_evaluation(mode="local-model", _embedding_client_factory=factory)
    assert first["semantic_retrieval_quality"] == second["semantic_retrieval_quality"]


def test_explicit_semantic_policy_preserves_default_semantic_behavior():
    factory = lambda model_name, *, local_files_only: SemanticStub(model_name, local_files_only=local_files_only)
    default = run_evaluation(mode="local-model", _embedding_client_factory=factory)
    explicit = run_evaluation(mode="local-model", retrieval_policy=SEMANTIC_RETRIEVAL_POLICY, _embedding_client_factory=factory)
    assert default["semantic_retrieval_quality"] == explicit["semantic_retrieval_quality"]


def test_hybrid_policy_is_explicit_deterministic_and_keeps_final_top_five():
    factory = lambda model_name, *, local_files_only: SemanticStub(model_name, local_files_only=local_files_only)
    first = run_evaluation(mode="local-model", retrieval_policy=HYBRID_RETRIEVAL_POLICY, _embedding_client_factory=factory)
    second = run_evaluation(mode="local-model", retrieval_policy=HYBRID_RETRIEVAL_POLICY, _embedding_client_factory=factory)
    assert first["semantic_retrieval_quality"] == second["semantic_retrieval_quality"]
    assert first["metadata"]["embedding"]["retrieval_policy"] == HYBRID_RETRIEVAL_POLICY
    assert all(len(row["retrieved_product_ids"]) == 5 for row in first["semantic_retrieval_quality"]["cases"])


def test_candidate_model_automatically_selects_e5_profile_and_roles():
    clients = []
    factory = lambda model_name, *, local_files_only: clients.append(
        SemanticStub(model_name, local_files_only=local_files_only)
    ) or clients[-1]
    result = run_evaluation(
        mode="local-model",
        embedding_model=E5_MODEL_ID,
        semantic_text_version=CATALOG_TEXT_VERSION_V2,
        retrieval_policy=HYBRID_RETRIEVAL_POLICY,
        _embedding_client_factory=factory,
    )
    assert result["metadata"]["embedding"]["embedding_profile"] == E5_PROFILE_ID
    assert all(call.semantic_text.startswith("passage: ") for call in clients[0].calls[:22])
    assert all(call.semantic_text.startswith("query: ") for call in clients[0].calls[22:])


def test_runner_rejects_unknown_or_incompatible_model_profile():
    factory = lambda model_name, *, local_files_only: SemanticStub(model_name, local_files_only=local_files_only)
    with pytest.raises(EmbeddingConfigUnavailableError):
        run_evaluation(mode="local-model", embedding_model="unknown/model", _embedding_client_factory=factory)
    with pytest.raises(EmbeddingConfigUnavailableError):
        run_evaluation(
            mode="local-model",
            embedding_model=MINILM_MODEL_ID,
            embedding_profile=E5_PROFILE_ID,
            _embedding_client_factory=factory,
        )


def test_missing_cached_model_failure_remains_sanitized():
    class Missing:
        def embed(self, request):
            raise EmbeddingModelLoadError("local embedding model could not be loaded")

    with pytest.raises(EmbeddingModelLoadError) as caught:
        run_evaluation(
            mode="local-model",
            _embedding_client_factory=lambda model_name, *, local_files_only: Missing(),
        )
    assert str(caught.value) == "local embedding model could not be loaded"


def test_cli_dispatch_forwards_supplied_local_model(monkeypatch, capsys):
    captured = {}

    def fake_run(**kwargs):
        captured.update(kwargs)
        return {"metadata": {"run_mode": "local-model"}}

    monkeypatch.setattr(eval_runner, "run_evaluation", fake_run)
    monkeypatch.setattr(eval_runner, "format_scorecard", lambda result: "scorecard")
    assert eval_runner.main(["--mode", "local-model", "--embedding-model", "user/model", "--semantic-text-version", CATALOG_TEXT_VERSION_V2, "--retrieval-policy", HYBRID_RETRIEVAL_POLICY]) == 0
    assert captured["mode"] == "local-model"
    assert captured["embedding_model"] == "user/model"
    assert captured["semantic_text_version"] == CATALOG_TEXT_VERSION_V2
    assert captured["retrieval_policy"] == HYBRID_RETRIEVAL_POLICY
    assert capsys.readouterr().out == "scorecard\n"
