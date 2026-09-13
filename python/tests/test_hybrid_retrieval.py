import pytest
from pathlib import Path

from sari_rasa_data.hybrid_retrieval import (
    _CATEGORY_LABELS,
    HYBRID_CANDIDATE_COUNT,
    LEXICAL_BONUS_LIMIT,
    HybridRetrievalError,
    lexical_coverage,
    normalized_tokens,
    rerank_hybrid,
)
from sari_rasa_data.menu_prompts import PublicMenuItem
from sari_rasa_data.vector_contracts import VectorSearchResult


def item(product_id, name, category="makanan", description_id="hidangan hangat", description_en="warm dish"):
    return PublicMenuItem(product_id, f"item-{product_id}", name, category, 10_000, description_id, description_en)


def result(product_id, score, language="id"):
    return VectorSearchResult(product_id, f"item-{product_id}", language, score, "0" * 64, "makanan", 10_000)


def test_normalization_is_unicode_case_and_punctuation_deterministic():
    assert normalized_tokens("  CAFÉ—Snack! ") == frozenset({"café", "snack"})


def test_signal_uses_only_canonical_fields_and_bilingual_category_labels():
    snack = item(1, "Tahu Isi", "snack", "tahu goreng", "fried tofu")
    assert lexical_coverage("pilihan camilan", snack) == 0.5
    assert lexical_coverage("choose a snack", snack) == pytest.approx(1 / 3)
    assert lexical_coverage("unknown tokens", snack) == 0.0


def test_bonus_is_bounded_and_cannot_force_an_arbitrary_product_id():
    catalog = {
        1: item(1, "Exact Name"),
        99: item(99, "Unrelated"),
    }
    ranked = rerank_hybrid("exact name", (result(99, 0.90), result(1, 0.80)), catalog)
    assert ranked[0].product_id == 99
    assert all(0 <= row.score - row.semantic_score <= LEXICAL_BONUS_LIMIT + 1e-12 for row in ranked)


def test_category_overlap_has_bounded_influence_without_forcing_category_first():
    catalog = {1: item(1, "Meal"), 2: item(2, "Snack", "snack")}
    ranked = rerank_hybrid("camilan", (result(1, 0.80), result(2, 0.74)), catalog)
    assert [row.product_id for row in ranked] == [1, 2]
    assert ranked[1].lexical_coverage == 1.0


def test_duplicates_are_removed_and_score_ties_preserve_semantic_rank():
    catalog = {1: item(1, "One"), 2: item(2, "Two")}
    ranked = rerank_hybrid(
        "absent",
        (result(2, 0.5), result(1, 0.5), result(2, 0.4)),
        catalog,
    )
    assert [row.product_id for row in ranked] == [2, 1]


def test_final_results_are_bounded_even_with_larger_candidate_set():
    catalog = {value: item(value, f"Product {value}") for value in range(1, HYBRID_CANDIDATE_COUNT + 1)}
    ranked = rerank_hybrid(
        "product",
        tuple(result(value, 1 - value / 100) for value in catalog),
        catalog,
    )
    assert len(ranked) == 5
    assert len({row.product_id for row in ranked}) == 5


@pytest.mark.parametrize("query", ["", " \t\n", "!!!"])
def test_empty_normalized_query_returns_no_results(query):
    assert rerank_hybrid(query, (), {}) == ()


def test_malformed_query_fails_closed():
    with pytest.raises(HybridRetrievalError, match="query must be a string"):
        rerank_hybrid(None, (), {})


def test_language_filtering_is_preserved_from_semantic_candidates():
    catalog = {1: item(1, "One"), 2: item(2, "Two")}
    ranked = rerank_hybrid("one", (result(1, 0.5, "en"), result(2, 0.4, "en")), catalog)
    assert {row.product_id for row in ranked} == {1, 2}


def test_policy_source_has_no_case_ids_or_gold_labels_and_ontology_is_closed():
    source = Path(__file__).parents[1] / "src" / "sari_rasa_data" / "hybrid_retrieval.py"
    text = source.read_text(encoding="utf-8").casefold()
    assert "ret-" not in text
    assert "expected_product" not in text
    assert _CATEGORY_LABELS == {
        "makanan": ("makanan", "food"),
        "minuman": ("minuman", "drink"),
        "snack": ("camilan", "snack"),
    }
