import pathlib
import subprocess
import sys

import pytest

from sari_rasa_data.llm_client import create_llm_client, load_llm_config, static_llm_config_status
from sari_rasa_data.llm_contracts import LLMConfigError
from sari_rasa_data.llm_gemini import GeminiLLMClient


BASE_ENV = {
    "SARI_RASA_LLM_PROVIDER": "gemini",
    "SARI_RASA_LLM_MODEL": "gemini-current-text-model",
    "SARI_RASA_LLM_API_KEY": "test-key",
    "SARI_RASA_LLM_TIMEOUT_SECONDS": "4.5",
}


@pytest.mark.parametrize(
    "missing, message",
    [
        ("SARI_RASA_LLM_PROVIDER", "PROVIDER"),
        ("SARI_RASA_LLM_MODEL", "MODEL"),
        ("SARI_RASA_LLM_API_KEY", "API_KEY"),
    ],
)
def test_config_rejects_missing_required_values(missing, message):
    env = BASE_ENV.copy()
    del env[missing]
    with pytest.raises(LLMConfigError, match=message):
        load_llm_config(env)


@pytest.mark.parametrize("timeout", ["not-a-number", "0", "61", "nan", "inf"])
def test_config_rejects_invalid_timeout(timeout):
    env = {**BASE_ENV, "SARI_RASA_LLM_TIMEOUT_SECONDS": timeout}
    with pytest.raises(LLMConfigError, match="TIMEOUT_SECONDS"):
        load_llm_config(env)


def test_static_config_status_is_sanitized_and_performs_no_client_or_network_work():
    assert static_llm_config_status({}) == "unconfigured"
    assert static_llm_config_status({"SARI_RASA_LLM_TIMEOUT_SECONDS": "10"}) == "unconfigured"
    assert static_llm_config_status({"SARI_RASA_LLM_PROVIDER": "gemini"}) == "invalid"
    assert static_llm_config_status({**BASE_ENV, "SARI_RASA_LLM_TIMEOUT_SECONDS": "bad"}) == "invalid"
    assert static_llm_config_status({**BASE_ENV, "SARI_RASA_LLM_MODEL": "../bad"}) == "invalid"
    assert static_llm_config_status(BASE_ENV) == "configured"


def test_factory_is_lazy_and_returns_provider_adapter():
    assert isinstance(create_llm_client(BASE_ENV), GeminiLLMClient)


def test_config_representation_redacts_api_key():
    config = load_llm_config(BASE_ENV)
    assert "test-key" not in repr(config)


def test_invalid_model_identifier_is_a_config_error():
    with pytest.raises(LLMConfigError, match="model identifier"):
        create_llm_client({**BASE_ENV, "SARI_RASA_LLM_MODEL": "../invalid"})


def test_import_requires_no_config_and_performs_no_network():
    source_root = pathlib.Path(__file__).resolve().parents[1] / "src"
    probe = """
import socket
def reject(*args, **kwargs):
    raise AssertionError('network attempted during import')
socket.create_connection = reject
import sari_rasa_data.llm_client
import sari_rasa_data.llm_gemini
"""
    result = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=pathlib.Path(__file__).resolve().parents[2],
        env={"PYTHONPATH": str(source_root)},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
