import json

import pytest

from sari_rasa_data.eval_contracts import EvaluationContractError
from sari_rasa_data.eval_dataset import DEFAULT_EVAL_DATASET_PATH, load_evaluation_dataset


def test_repository_dataset_has_approved_distribution_and_pairs():
    dataset = load_evaluation_dataset()
    assert (len(dataset.retrieval_cases), len(dataset.rag_cases), len(dataset.agent_cases), len(dataset.boundary_probes)) == (12, 14, 10, 4)
    assert dataset.evaluation_case_count == 36
    assert dataset.total_entry_count == 40


@pytest.mark.parametrize("mutation", ["top", "duplicate", "reference", "range"])
def test_dataset_fails_closed_for_invalid_structure(tmp_path, mutation):
    value = json.loads(DEFAULT_EVAL_DATASET_PATH.read_text())
    if mutation == "top": value["unexpected"] = True
    elif mutation == "duplicate": value["rag_cases"][0]["case_id"] = value["retrieval_cases"][0]["case_id"]
    elif mutation == "reference": value["retrieval_cases"][0]["expected_product_ids"] = ["999"]
    else: value["agent_cases"][0]["max_tool_calls"] = 3
    path = tmp_path / "invalid.json"
    path.write_text(json.dumps(value))
    with pytest.raises(EvaluationContractError):
        load_evaluation_dataset(path)
