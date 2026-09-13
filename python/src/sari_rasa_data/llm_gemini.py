"""Gemini Developer API adapter for provider-neutral LLM contracts."""

import asyncio
from dataclasses import dataclass
import re
import time
from collections.abc import Callable
from typing import Any

import httpx

from .llm_client import LLMConfig
from .llm_contracts import (
    LLMAuthenticationError,
    LLMCancelledError,
    LLMConfigError,
    LLMEmptyResponseError,
    LLMMalformedResponseError,
    LLMMalformedToolResponseError,
    LLMNetworkError,
    LLMProviderClientError,
    LLMProviderServerError,
    LLMRateLimitError,
    LLMRefusalError,
    LLMRequest,
    LLMResponse,
    LLMResponseTooLargeError,
    LLMTimeoutError,
    LLMUnexpectedToolResponseError,
    LLMStructuredContractError,
    LLMToolCallLoopError,
    LLMUsage,
)
from .llm_structured import (
    MAX_TOOL_CALLS,
    PUBLIC_MENU_RESPONSE_SCHEMA,
    StructuredLLMRequest,
    StructuredLLMResponse,
    ToolCall,
    parse_structured_menu_response,
)
from .menu_tools import execute_menu_tool, tool_call_fingerprint
from .agent_contracts import (
    AGENT_ACTION_SCHEMA,
    INITIAL_SEARCH_AGENT_ACTION_SCHEMA,
    TERMINAL_AGENT_ACTION_SCHEMA,
    AgentDecisionRequest,
    parse_agent_action,
)


_MODEL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_FINISH_REASONS = {"STOP": "stop", "MAX_TOKENS": "length"}
_SAFETY_REASONS = {"SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"}
_TOOL_REASONS = {"MALFORMED_FUNCTION_CALL", "UNEXPECTED_TOOL_CALL"}


@dataclass(frozen=True)
class _GeminiFunctionCall:
    call: ToolCall
    call_id: str | None
    content: dict[str, Any]


class GeminiLLMClient:
    provider = "gemini"

    def __init__(
        self,
        config: LLMConfig,
        *,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = time.perf_counter,
    ) -> None:
        if config.provider != self.provider:
            raise LLMConfigError("Gemini adapter requires provider 'gemini'")
        if not _MODEL_PATTERN.fullmatch(config.model):
            raise LLMConfigError("invalid Gemini model identifier")
        self._model = config.model
        self._api_key = config.api_key
        self._timeout = config.timeout_seconds
        self._transport = transport
        self._clock = clock

    def generate(self, request: LLMRequest) -> LLMResponse:
        payload = {
            "systemInstruction": {"parts": [
                {"text": request.system_instruction.strip()},
                {"text": "Respond in Indonesian." if request.language == "id" else "Respond in English."},
            ]},
            "contents": [{"role": "user", "parts": [{"text": request.user_input.strip()}]}],
            "generationConfig": {
                "maxOutputTokens": request.max_output_tokens,
                "candidateCount": 1,
            },
        }
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent"
        started = self._clock()
        try:
            with httpx.Client(transport=self._transport, timeout=self._timeout) as client:
                response = client.post(url, headers={"x-goog-api-key": self._api_key}, json=payload)
        except httpx.TimeoutException:
            raise LLMTimeoutError("LLM provider request timed out") from None
        except httpx.RequestError:
            raise LLMNetworkError("LLM provider network request failed") from None
        except asyncio.CancelledError:
            raise LLMCancelledError("LLM provider request was cancelled") from None
        latency_ms = max(0, round((self._clock() - started) * 1000))

        self._raise_for_status(response)
        try:
            body = response.json()
        except ValueError:
            raise LLMMalformedResponseError("LLM provider returned malformed JSON") from None
        if not isinstance(body, dict):
            raise LLMMalformedResponseError("LLM provider returned an invalid response shape")
        return self._parse_response(body, request, latency_ms)

    def generate_structured(self, request: StructuredLLMRequest) -> StructuredLLMResponse:
        """Generate one strict result with at most two sequential read-only tool calls."""

        prompt = request.prompt
        contents: list[dict[str, Any]] = [
            {"role": "user", "parts": [{"text": prompt.user_input.strip()}]}
        ]
        payload: dict[str, Any] = {
            "systemInstruction": {
                "parts": [
                    {"text": prompt.system_instruction.strip()},
                    {
                        "text": "Respond in Indonesian."
                        if prompt.language == "id"
                        else "Respond in English."
                    },
                ]
            },
            "contents": contents,
            "generationConfig": {
                "maxOutputTokens": prompt.max_output_tokens,
                "candidateCount": 1,
                "responseMimeType": "application/json",
                "responseSchema": PUBLIC_MENU_RESPONSE_SCHEMA,
            },
        }
        if request.tools:
            payload["tools"] = [
                {
                    "functionDeclarations": [
                        {
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": tool.parameters,
                        }
                        for tool in request.tools
                    ]
                }
            ]
        seen_calls: set[str] = set()
        call_count = 0
        while True:
            body = self._post_structured_payload(payload)
            text, call = self._parse_structured_turn(body)
            if text is not None:
                response = parse_structured_menu_response(text, request.allowed_source_ids)
                if response.language != prompt.language:
                    raise LLMStructuredContractError(
                        "structured response language does not match the request"
                    )
                return response

            if call is None:
                raise LLMMalformedResponseError("LLM provider returned no structured content")
            if not request.tools or call_count >= MAX_TOOL_CALLS:
                raise LLMUnexpectedToolResponseError(
                    "LLM provider returned a tool call when function calling was disabled"
                )
            fingerprint = tool_call_fingerprint(call.call)
            if fingerprint in seen_calls:
                raise LLMToolCallLoopError("structured request repeated an identical tool call")
            seen_calls.add(fingerprint)
            call_count += 1
            result = execute_menu_tool(call.call, request.catalog, prompt.language)
            function_response: dict[str, Any] = {
                "name": result.name,
                "response": result.result,
            }
            if call.call_id is not None:
                function_response["id"] = call.call_id
            contents.extend(
                [
                    call.content,
                    {
                        "role": "user",
                        "parts": [{"functionResponse": function_response}],
                    },
                ]
            )
            if call_count == MAX_TOOL_CALLS:
                payload["toolConfig"] = {"functionCallingConfig": {"mode": "NONE"}}

    def decide(self, request: AgentDecisionRequest):
        """Return one application-validated agent action without provider-native tools."""

        if not isinstance(request, AgentDecisionRequest):
            from .agent_contracts import AgentInvalidRequestError

            raise AgentInvalidRequestError("request must be an AgentDecisionRequest")
        prompt = request.prompt
        payload = {
            "systemInstruction": {
                "parts": [
                    {"text": prompt.system_instruction.strip()},
                    {
                        "text": "Respond in Indonesian."
                        if prompt.language == "id"
                        else "Respond in English."
                    },
                ]
            },
            "contents": [
                {"role": "user", "parts": [{"text": prompt.user_input.strip()}]}
            ],
            "generationConfig": {
                "maxOutputTokens": prompt.max_output_tokens,
                "candidateCount": 1,
                "responseMimeType": "application/json",
                "responseSchema": (
                    TERMINAL_AGENT_ACTION_SCHEMA
                    if request.terminal_only
                    else (
                        INITIAL_SEARCH_AGENT_ACTION_SCHEMA
                        if request.search_required
                        else AGENT_ACTION_SCHEMA
                    )
                ),
            },
        }
        body = self._post_structured_payload(payload)
        text, call = self._parse_structured_turn(body)
        if call is not None:
            raise LLMUnexpectedToolResponseError(
                "LLM provider returned a native tool call for an agent decision"
            )
        if text is None:
            raise LLMMalformedResponseError("LLM provider returned no agent action")
        return parse_agent_action(
            text,
            allowed_source_ids=request.allowed_source_ids,
            requested_language=prompt.language,
            terminal_only=request.terminal_only,
            search_required=request.search_required,
        )

    def _post_structured_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent"
        try:
            with httpx.Client(transport=self._transport, timeout=self._timeout) as client:
                response = client.post(url, headers={"x-goog-api-key": self._api_key}, json=payload)
        except httpx.TimeoutException:
            raise LLMTimeoutError("LLM provider request timed out") from None
        except httpx.RequestError:
            raise LLMNetworkError("LLM provider network request failed") from None
        except asyncio.CancelledError:
            raise LLMCancelledError("LLM provider request was cancelled") from None
        self._raise_for_status(response)
        try:
            body = response.json()
        except ValueError:
            raise LLMMalformedResponseError("LLM provider returned malformed JSON") from None
        if not isinstance(body, dict):
            raise LLMMalformedResponseError("LLM provider returned an invalid response shape")
        return body

    @staticmethod
    def _parse_structured_turn(
        body: dict[str, Any],
    ) -> tuple[str | None, _GeminiFunctionCall | None]:
        feedback = body.get("promptFeedback")
        if isinstance(feedback, dict) and feedback.get("blockReason"):
            raise LLMRefusalError("LLM provider blocked the request for safety")
        candidates = body.get("candidates")
        if not isinstance(candidates, list) or not candidates:
            raise LLMEmptyResponseError("LLM provider returned no candidates")
        candidate = candidates[0]
        if not isinstance(candidate, dict):
            raise LLMMalformedResponseError("LLM provider returned an invalid candidate")
        reason = candidate.get("finishReason", "OTHER")
        if reason in _SAFETY_REASONS:
            raise LLMRefusalError("LLM provider blocked the response for safety")
        if reason in _TOOL_REASONS:
            raise LLMMalformedToolResponseError("LLM provider returned a malformed tool call")
        content = candidate.get("content")
        if not isinstance(content, dict) or not isinstance(content.get("parts"), list):
            raise LLMEmptyResponseError("LLM provider returned no structured content")
        parts = content["parts"]
        function_parts = [part for part in parts if isinstance(part, dict) and "functionCall" in part]
        text_parts = [part for part in parts if isinstance(part, dict) and "text" in part]
        if any(not isinstance(part, dict) for part in parts):
            raise LLMMalformedResponseError("LLM provider returned an invalid content part")
        if function_parts and text_parts:
            raise LLMMalformedToolResponseError(
                "LLM provider returned tool calls and final output together"
            )
        if len(function_parts) > 1:
            raise LLMMalformedToolResponseError(
                "LLM provider returned multiple simultaneous tool calls"
            )
        if function_parts:
            raw_call = function_parts[0]["functionCall"]
            if not isinstance(raw_call, dict) or set(raw_call) not in (
                {"name", "args"},
                {"id", "name", "args"},
            ):
                raise LLMMalformedToolResponseError("LLM provider returned an invalid tool call")
            name = raw_call["name"]
            arguments = raw_call["args"]
            has_call_id = "id" in raw_call
            call_id = raw_call.get("id")
            if (
                not isinstance(name, str)
                or not name.strip()
                or not isinstance(arguments, dict)
                or (has_call_id and (not isinstance(call_id, str) or not call_id.strip()))
            ):
                raise LLMMalformedToolResponseError("LLM provider returned an invalid tool call")
            return None, _GeminiFunctionCall(
                call=ToolCall(name=name, arguments=arguments),
                call_id=call_id,
                content=content,
            )
        if len(text_parts) != 1 or not isinstance(text_parts[0]["text"], str):
            raise LLMMalformedResponseError("LLM provider returned invalid structured text")
        text = text_parts[0]["text"].strip()
        if not text:
            raise LLMEmptyResponseError("LLM provider returned empty structured text")
        return text, None

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        status = response.status_code
        if status < 400:
            return
        if status in (401, 403):
            raise LLMAuthenticationError("LLM provider rejected credentials")
        if status == 400 and _is_credential_error(response):
            raise LLMAuthenticationError("LLM provider rejected credentials")
        if status == 429:
            raise LLMRateLimitError("LLM provider rate limit exceeded")
        if 400 <= status < 500:
            raise LLMProviderClientError(f"LLM provider rejected request (status {status})")
        raise LLMProviderServerError("LLM provider is unavailable")

    def _parse_response(self, body: dict[str, Any], request: LLMRequest, latency_ms: int) -> LLMResponse:
        prompt_feedback = body.get("promptFeedback")
        if isinstance(prompt_feedback, dict) and prompt_feedback.get("blockReason"):
            raise LLMRefusalError("LLM provider blocked the request for safety")
        candidates = body.get("candidates")
        if not isinstance(candidates, list) or not candidates:
            raise LLMEmptyResponseError("LLM provider returned no candidates")
        candidate = candidates[0]
        if not isinstance(candidate, dict):
            raise LLMMalformedResponseError("LLM provider returned an invalid candidate")
        reason = candidate.get("finishReason", "OTHER")
        if reason in _SAFETY_REASONS:
            raise LLMRefusalError("LLM provider blocked the response for safety")
        if reason in _TOOL_REASONS:
            raise LLMUnexpectedToolResponseError("LLM provider returned an unexpected tool response")
        content = candidate.get("content")
        if not isinstance(content, dict) or not isinstance(content.get("parts"), list):
            raise LLMEmptyResponseError("LLM provider returned no text content")
        text_parts: list[str] = []
        for part in content["parts"]:
            if not isinstance(part, dict):
                raise LLMMalformedResponseError("LLM provider returned an invalid content part")
            if any(key in part for key in ("functionCall", "functionResponse", "executableCode", "codeExecutionResult")):
                raise LLMUnexpectedToolResponseError("LLM provider returned an unexpected tool response")
            text = part.get("text")
            if text is not None:
                if not isinstance(text, str):
                    raise LLMMalformedResponseError("LLM provider returned invalid text content")
                text_parts.append(text)
        result_text = "".join(text_parts).strip()
        if not result_text:
            raise LLMEmptyResponseError("LLM provider returned empty text content")
        metadata = body.get("usageMetadata")
        usage = None
        if metadata is not None:
            if not isinstance(metadata, dict):
                raise LLMMalformedResponseError("LLM provider returned invalid usage metadata")
            usage = LLMUsage(
                input_tokens=_optional_nonnegative_int(metadata.get("promptTokenCount")),
                output_tokens=_optional_nonnegative_int(metadata.get("candidatesTokenCount")),
                total_tokens=_optional_nonnegative_int(metadata.get("totalTokenCount")),
            )
            if usage.output_tokens is not None and usage.output_tokens > request.max_output_tokens:
                raise LLMResponseTooLargeError("LLM provider response exceeded the bounded output allowance")
        normalized_reason = "safety" if reason in _SAFETY_REASONS else _FINISH_REASONS.get(reason, "other")
        return LLMResponse(
            content=result_text,
            provider=self.provider,
            model=self._model,
            finish_reason=normalized_reason,
            usage=usage,
            latency_ms=latency_ms,
            correlation_id=request.correlation_id,
        )


def _optional_nonnegative_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise LLMMalformedResponseError("LLM provider returned invalid usage metadata")
    return value


def _is_credential_error(response: httpx.Response) -> bool:
    """Recognize credential failures from allowlisted Google error codes only."""
    try:
        body = response.json()
    except ValueError:
        return False
    if not isinstance(body, dict) or not isinstance(body.get("error"), dict):
        return False
    error = body["error"]
    if error.get("status") in {"UNAUTHENTICATED", "PERMISSION_DENIED"}:
        return True
    details = error.get("details")
    if not isinstance(details, list):
        return False
    return any(
        isinstance(detail, dict) and detail.get("reason") in {"API_KEY_INVALID", "API_KEY_SERVICE_BLOCKED"}
        for detail in details
    )
