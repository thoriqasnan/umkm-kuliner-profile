"""Deterministic offline LLM client for tests and local learning."""

from .llm_contracts import LLMRequest, LLMResponse, LLMTimeoutError, LLMUsage


class FakeLLMClient:
    def __init__(self, mode: str = "success") -> None:
        self.mode = mode

    def generate(self, request: LLMRequest) -> LLMResponse:
        if self.mode == "timeout":
            raise LLMTimeoutError("simulated LLM timeout")
        if self.mode != "success":
            raise ValueError("unsupported fake mode")
        content = (
            "SariRasa menyajikan hidangan lezat dari bahan berkualitas."
            if request.language == "id"
            else "SariRasa serves delicious dishes made with quality ingredients."
        )
        return LLMResponse(
            content=content,
            provider="fake",
            model="deterministic-v1",
            finish_reason="stop",
            usage=LLMUsage(input_tokens=10, output_tokens=9, total_tokens=19),
            latency_ms=0,
            correlation_id=request.correlation_id,
        )
