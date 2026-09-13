from dataclasses import FrozenInstanceError

import pytest

from sari_rasa_data.rag_contracts import (
    MAX_EVIDENCE_PRODUCTS,
    MAX_RETRIEVAL_CANDIDATES,
    RAGEvidence,
    RAGInvalidRequestError,
    RAGRequest,
)
from sari_rasa_data.vector_contracts import VectorSpace


SPACE = VectorSpace("fake", "query", 2, "none", "7d-catalog-text-v1")


def test_valid_id_and_en_requests_are_immutable_and_bounded():
    for language in ("id", "en"):
        request = RAGRequest("menu question", SPACE, language=language)
        assert request.retrieve_top_k == MAX_RETRIEVAL_CANDIDATES == 10
        assert request.max_evidence == MAX_EVIDENCE_PRODUCTS == 5
        with pytest.raises(FrozenInstanceError):
            request.language = "id"


@pytest.mark.parametrize(
    "changes",
    [
        {"user_input": ""},
        {"user_input": "x" * 1001},
        {"language": "fr"},
        {"retrieve_top_k": 0},
        {"retrieve_top_k": 11},
        {"max_evidence": 0},
        {"max_evidence": 6},
        {"max_output_tokens": 0},
    ],
)
def test_invalid_request_rejected(changes):
    values = {"user_input": "question", "vector_space": SPACE}
    values.update(changes)
    with pytest.raises(RAGInvalidRequestError):
        RAGRequest(**values)


def test_evidence_source_ids_are_request_local_and_scores_finite():
    values = dict(
        product_id=1,
        slug="item",
        name="Item",
        category="Food",
        price_rupiah=1,
        description="Description",
        language="id",
        score=0.5,
        content_hash="a" * 64,
    )
    assert RAGEvidence(source_id="menu:1", **values).source_id == "menu:1"
    with pytest.raises(RAGInvalidRequestError):
        RAGEvidence(source_id="product:1", **values)
    with pytest.raises(RAGInvalidRequestError):
        RAGEvidence(source_id="menu:1", **{**values, "score": float("nan")})
