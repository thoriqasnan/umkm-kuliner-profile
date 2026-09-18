"""Provider-neutral LLM client boundary and environment configuration."""

from dataclasses import dataclass, field
from os import environ
import re
from typing import Mapping, Protocol

from .llm_contracts import LLMConfigError, LLMRequest, LLMResponse


LLM_MODEL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


@dataclass(frozen=True)
class LLMConfig:
    provider: str
    model: str
    api_key: str = field(repr=False)
    timeout_seconds: float


class LLMClient(Protocol):
    def generate(self, request: LLMRequest) -> LLMResponse: ...


class StructuredLLMClient(Protocol):
    def generate_structured(self, request: "StructuredLLMRequest") -> "StructuredLLMResponse": ...


def load_llm_config(env: Mapping[str, str] | None = None) -> LLMConfig:
    values = environ if env is None else env
    provider = values.get("SARI_RASA_LLM_PROVIDER", "").strip().lower()
    model = values.get("SARI_RASA_LLM_MODEL", "").strip()
    api_key = values.get("SARI_RASA_LLM_API_KEY", "").strip()
    timeout_raw = values.get("SARI_RASA_LLM_TIMEOUT_SECONDS", "10").strip()

    if not provider:
        raise LLMConfigError("SARI_RASA_LLM_PROVIDER is required")
    if provider != "gemini":
        raise LLMConfigError("unsupported SARI_RASA_LLM_PROVIDER")
    if not model:
        raise LLMConfigError("SARI_RASA_LLM_MODEL is required")
    if not LLM_MODEL_PATTERN.fullmatch(model):
        raise LLMConfigError("invalid LLM model identifier")
    if not api_key:
        raise LLMConfigError("SARI_RASA_LLM_API_KEY is required")
    try:
        timeout = float(timeout_raw)
    except ValueError as exc:
        raise LLMConfigError("SARI_RASA_LLM_TIMEOUT_SECONDS must be numeric") from exc
    if not 0.1 <= timeout <= 60:
        raise LLMConfigError("SARI_RASA_LLM_TIMEOUT_SECONDS must be between 0.1 and 60")
    return LLMConfig(provider, model, api_key, timeout)


def create_llm_client(env: Mapping[str, str] | None = None) -> LLMClient:
    """Create a configured client lazily; importing this module has no side effects."""
    config = load_llm_config(env)
    if config.provider == "gemini":
        from .llm_gemini import GeminiLLMClient

        return GeminiLLMClient(config)
    raise LLMConfigError("unsupported SARI_RASA_LLM_PROVIDER")


def static_llm_config_status(env: Mapping[str, str] | None = None) -> str:
    """Classify local configuration without loading a client or contacting a provider."""
    values = environ if env is None else env
    required = tuple(values.get(name, "").strip() for name in (
        "SARI_RASA_LLM_PROVIDER", "SARI_RASA_LLM_MODEL", "SARI_RASA_LLM_API_KEY",
    ))
    if not any(required):
        return "unconfigured"
    try:
        load_llm_config(values)
    except (LLMConfigError, AttributeError):
        return "invalid"
    return "configured"
