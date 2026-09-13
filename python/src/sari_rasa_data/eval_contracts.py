"""Frozen, provider-neutral contracts for the Phase 7H evaluation layer."""

from dataclasses import dataclass
from typing import Literal

from .agent_contracts import (
    MAX_AGENT_DECISIONS,
    MAX_AGENT_EVIDENCE,
    MAX_AGENT_TOOL_CALLS,
)


DATASET_VERSION = "7h-eval-v1"
EVAL_SCHEMA_VERSION = "v1"
METRIC_DEFINITIONS_VERSION = "7h-metrics-v1"
SUPPORTED_LANGUAGES = frozenset({"id", "en"})

Language = Literal["id", "en"]
RunMode = Literal["offline", "local-model", "controlled-live"]
ResponseClass = Literal["supported", "insufficient"]
TerminalClass = Literal["finish", "cannot_complete", "error"]
SafetyOutcome = Literal["allow", "refuse", "reject"]


class EvaluationContractError(ValueError):
    """A sanitized, fail-closed evaluation contract failure."""


@dataclass(frozen=True)
class CatalogProduct:
    product_id: str
    name: str
    category: str
    price_rupiah: int
    description_id: str
    description_en: str


@dataclass(frozen=True)
class RetrievalEvalCase:
    case_id: str
    language: Language
    query: str
    tags: tuple[str, ...]
    live_eligible: bool
    expected_product_ids: frozenset[str]
    bilingual_pair_id: str


@dataclass(frozen=True)
class RAGEvalCase:
    case_id: str
    language: Language
    query: str
    tags: tuple[str, ...]
    live_eligible: bool
    expected_response_class: ResponseClass
    expected_product_ids: frozenset[str]
    source_required: bool
    expected_safety_outcome: SafetyOutcome
    bilingual_pair_id: str | None = None


@dataclass(frozen=True)
class AgentEvalCase:
    case_id: str
    language: Language
    query: str
    tags: tuple[str, ...]
    live_eligible: bool
    expected_terminal_class: TerminalClass
    expected_product_ids: frozenset[str]
    min_decisions: int
    max_decisions: int
    min_tool_calls: int
    max_tool_calls: int
    max_evidence: int
    expected_safety_outcome: SafetyOutcome
    bilingual_pair_id: str | None = None

    def __post_init__(self) -> None:
        ranges = (
            ("decisions", self.min_decisions, self.max_decisions, MAX_AGENT_DECISIONS),
            ("tool calls", self.min_tool_calls, self.max_tool_calls, MAX_AGENT_TOOL_CALLS),
        )
        for name, minimum, maximum, hard_limit in ranges:
            if any(isinstance(v, bool) or not isinstance(v, int) for v in (minimum, maximum)):
                raise EvaluationContractError(f"{name} ranges must be integers")
            if minimum < 0 or maximum < minimum or maximum > hard_limit:
                raise EvaluationContractError(f"invalid {name} range")
        if (
            isinstance(self.max_evidence, bool)
            or not isinstance(self.max_evidence, int)
            or not 0 <= self.max_evidence <= MAX_AGENT_EVIDENCE
        ):
            raise EvaluationContractError("invalid evidence maximum")


@dataclass(frozen=True)
class BoundaryProbeCase:
    case_id: str
    probe: Literal[
        "stale_vector_record",
        "missing_canonical_product",
        "malformed_structured_response",
        "invalid_agent_action",
    ]
    expected_outcome: str
    tags: tuple[str, ...]


@dataclass(frozen=True)
class EvaluationDataset:
    dataset_version: str
    schema_version: str
    fixture_classification: Literal["public-synthetic-only"]
    catalog: tuple[CatalogProduct, ...]
    retrieval_cases: tuple[RetrievalEvalCase, ...]
    rag_cases: tuple[RAGEvalCase, ...]
    agent_cases: tuple[AgentEvalCase, ...]
    boundary_probes: tuple[BoundaryProbeCase, ...]

    @property
    def evaluation_case_count(self) -> int:
        return len(self.retrieval_cases) + len(self.rag_cases) + len(self.agent_cases)

    @property
    def total_entry_count(self) -> int:
        return self.evaluation_case_count + len(self.boundary_probes)


@dataclass(frozen=True)
class HumanRubricScore:
    faithfulness: Literal[0, 1, 2]
    relevance: Literal[0, 1, 2]
