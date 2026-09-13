"""Conservative, deterministic lexical reranking for Phase 7H evaluation."""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
import math
import unicodedata

from .menu_prompts import PublicMenuItem
from .vector_contracts import VectorSearchResult


SEMANTIC_RETRIEVAL_POLICY = "7h-retrieval-semantic-v1"
HYBRID_RETRIEVAL_POLICY = "7h-retrieval-hybrid-v1"
SUPPORTED_RETRIEVAL_POLICIES = frozenset(
    {SEMANTIC_RETRIEVAL_POLICY, HYBRID_RETRIEVAL_POLICY}
)
HYBRID_CANDIDATE_COUNT = 10
FINAL_RESULT_COUNT = 5
LEXICAL_BONUS_LIMIT = 0.05

_CATEGORY_LABELS = {
    "makanan": ("makanan", "food"),
    "minuman": ("minuman", "drink"),
    "snack": ("camilan", "snack"),
}


class HybridRetrievalError(ValueError):
    """A sanitized hybrid-policy input failure."""


@dataclass(frozen=True)
class HybridSearchResult:
    product_id: int
    score: float
    semantic_score: float
    lexical_coverage: float


def normalized_tokens(value: str) -> frozenset[str]:
    """Tokenize with NFKC, case folding, and punctuation-to-space normalization."""
    if not isinstance(value, str):
        raise HybridRetrievalError("lexical text must be a string")
    normalized = unicodedata.normalize("NFKC", value).casefold()
    characters = (
        character if unicodedata.category(character)[0] in {"L", "N"} else " "
        for character in normalized
    )
    return frozenset("".join(characters).split())


def lexical_coverage(query: str, item: PublicMenuItem) -> float:
    """Return best per-field query-token coverage using canonical bilingual data."""
    if not isinstance(item, PublicMenuItem):
        raise HybridRetrievalError("catalog entries must be PublicMenuItem values")
    query_tokens = normalized_tokens(query)
    if not query_tokens:
        return 0.0
    category_key = " ".join(sorted(normalized_tokens(item.category)))
    try:
        category_id, category_en = _CATEGORY_LABELS[category_key]
    except KeyError as exc:
        raise HybridRetrievalError("catalog category is not supported") from exc
    fields = (
        item.name,
        category_id,
        category_en,
        item.description_id,
        item.description_en,
    )
    return max(
        len(query_tokens & normalized_tokens(field)) / len(query_tokens)
        for field in fields
    )


def rerank_hybrid(
    query: str,
    semantic_results: Iterable[VectorSearchResult],
    catalog_by_id: Mapping[int, PublicMenuItem],
    *,
    top_k: int = FINAL_RESULT_COUNT,
) -> tuple[HybridSearchResult, ...]:
    """Apply a bounded lexical bonus while retaining semantic rank as first tie-break."""
    if not isinstance(query, str):
        raise HybridRetrievalError("query must be a string")
    if isinstance(top_k, bool) or not isinstance(top_k, int) or top_k < 1:
        raise HybridRetrievalError("top_k must be a positive integer")
    query_tokens = normalized_tokens(query)
    if not query_tokens:
        return ()

    unique: dict[int, tuple[int, VectorSearchResult]] = {}
    for semantic_rank, result in enumerate(semantic_results, start=1):
        if not isinstance(result, VectorSearchResult):
            raise HybridRetrievalError("semantic results must be VectorSearchResult values")
        if result.product_id not in unique:
            unique[result.product_id] = (semantic_rank, result)

    ranked = []
    for product_id, (semantic_rank, result) in unique.items():
        item = catalog_by_id.get(product_id)
        if item is None:
            raise HybridRetrievalError("semantic result has no canonical catalog product")
        coverage = lexical_coverage(query, item)
        score = float(result.score) + LEXICAL_BONUS_LIMIT * coverage
        if not math.isfinite(score):
            raise HybridRetrievalError("hybrid score must be finite")
        ranked.append(
            (
                -score,
                semantic_rank,
                product_id,
                HybridSearchResult(product_id, score, float(result.score), coverage),
            )
        )
    ranked.sort(key=lambda value: value[:3])
    return tuple(value[3] for value in ranked[:top_k])
