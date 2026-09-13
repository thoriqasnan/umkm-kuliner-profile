"""Provider-neutral contracts and failures for single-turn text generation."""

from dataclasses import dataclass
from typing import Literal


MIN_OUTPUT_TOKENS = 1
MAX_OUTPUT_TOKENS = 1024


class LLMError(Exception):
    """Base class for safe, provider-neutral LLM failures."""


class LLMInvalidRequestError(LLMError):
    pass


class LLMConfigError(LLMError):
    pass


class LLMAuthenticationError(LLMError):
    pass


class LLMTimeoutError(LLMError):
    pass


class LLMCancelledError(LLMError):
    pass


class LLMNetworkError(LLMError):
    pass


class LLMRateLimitError(LLMError):
    pass


class LLMProviderClientError(LLMError):
    pass


class LLMProviderServerError(LLMError):
    pass


class LLMMalformedResponseError(LLMError):
    pass


class LLMEmptyResponseError(LLMError):
    pass


class LLMResponseTooLargeError(LLMError):
    pass


class LLMRefusalError(LLMError):
    pass


class LLMUnexpectedToolResponseError(LLMError):
    pass


class LLMStructuredOutputParseError(LLMError):
    pass


class LLMStructuredContractError(LLMError):
    pass


class LLMSourceValidationError(LLMError):
    pass


class LLMUnknownToolError(LLMError):
    pass


class LLMInvalidToolArgumentsError(LLMError):
    pass


class LLMToolCallLimitError(LLMError):
    pass


class LLMToolCallLoopError(LLMError):
    pass


class LLMMalformedToolResponseError(LLMError):
    pass


@dataclass(frozen=True)
class LLMRequest:
    system_instruction: str
    user_input: str
    language: Literal["id", "en"]
    max_output_tokens: int
    correlation_id: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.system_instruction, str) or not self.system_instruction.strip():
            raise LLMInvalidRequestError("system_instruction must not be blank")
        if not isinstance(self.user_input, str) or not self.user_input.strip():
            raise LLMInvalidRequestError("user_input must not be blank")
        if self.language not in ("id", "en"):
            raise LLMInvalidRequestError("language must be 'id' or 'en'")
        if isinstance(self.max_output_tokens, bool) or not isinstance(self.max_output_tokens, int):
            raise LLMInvalidRequestError("max_output_tokens must be an integer")
        if not MIN_OUTPUT_TOKENS <= self.max_output_tokens <= MAX_OUTPUT_TOKENS:
            raise LLMInvalidRequestError(
                f"max_output_tokens must be between {MIN_OUTPUT_TOKENS} and {MAX_OUTPUT_TOKENS}"
            )
        if self.correlation_id is not None:
            if not isinstance(self.correlation_id, str) or not self.correlation_id.strip():
                raise LLMInvalidRequestError("correlation_id must be a non-blank string")
            if len(self.correlation_id) > 128:
                raise LLMInvalidRequestError("correlation_id must not exceed 128 characters")


@dataclass(frozen=True)
class LLMUsage:
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None


@dataclass(frozen=True)
class LLMResponse:
    content: str
    provider: str
    model: str
    finish_reason: Literal["stop", "length", "safety", "other"]
    usage: LLMUsage | None
    latency_ms: int
    correlation_id: str | None = None
