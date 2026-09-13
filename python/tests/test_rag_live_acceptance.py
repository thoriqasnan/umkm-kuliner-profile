import importlib
import sys

import pytest


def test_acceptance_requires_every_scenario_to_pass():
    from sari_rasa_data.rag_live_acceptance import _require_all_pass

    _require_all_pass([{"status": "PASS"}, {"status": "PASS"}])
    with pytest.raises(SystemExit, match="Phase 7F live RAG acceptance failed"):
        _require_all_pass([{"status": "PASS"}, {"status": "FAIL"}])


def test_unsupported_scenario_requires_empty_sources():
    from sari_rasa_data.rag_live_acceptance import _sources_satisfy_scenario

    allowed = {"menu:1"}
    assert _sources_satisfy_scenario((), allowed, must_be_insufficient=True)
    assert not _sources_satisfy_scenario(
        ("menu:1",), allowed, must_be_insufficient=True
    )
    assert _sources_satisfy_scenario(
        ("menu:1",), allowed, must_be_insufficient=False
    )
    assert not _sources_satisfy_scenario(
        ("menu:999",), allowed, must_be_insufficient=False
    )


def test_acceptance_diagnostics_identify_unsupported_allergen_contract_fields():
    from sari_rasa_data.rag_live_acceptance import _acceptance_contract_failures

    failures = _acceptance_contract_failures(
        language="id",
        insufficient_information=False,
        sources=("menu:1",),
        allowed_sources={"menu:1"},
        must_be_insufficient=True,
    )

    assert failures == (
        "insufficient_information must be true",
        "sources must be empty for insufficient information",
    )


def test_acceptance_diagnostics_report_unknown_source_without_exposing_values():
    from sari_rasa_data.rag_live_acceptance import _acceptance_contract_failures

    failures = _acceptance_contract_failures(
        language="en",
        insufficient_information=True,
        sources=("menu:999",),
        allowed_sources={"menu:1"},
        must_be_insufficient=True,
    )

    assert failures == (
        "language must be id",
        "sources contain IDs outside the supplied evidence",
        "sources must be empty for insufficient information",
    )


def test_acceptance_import_does_not_load_model_or_create_provider_client():
    for name in ("sentence_transformers", "sari_rasa_data.rag_live_acceptance"):
        sys.modules.pop(name, None)
    module = importlib.import_module("sari_rasa_data.rag_live_acceptance")
    assert module.main
    assert "sentence_transformers" not in sys.modules
