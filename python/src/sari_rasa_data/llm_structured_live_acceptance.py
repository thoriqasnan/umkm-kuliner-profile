"""Two bounded, public-safe Phase 7C live acceptance checks."""

from contextlib import contextmanager
from dataclasses import asdict
import json
import time
from typing import Iterator

from . import llm_gemini
from .llm_client import StructuredLLMClient, load_llm_config
from .llm_gemini import GeminiLLMClient
from .llm_structured import StructuredLLMRequest, StructuredLLMResponse
from .menu_prompts import PublicMenuItem, build_structured_menu_request


_CATALOG = (
    PublicMenuItem(
        7101,
        "nasi-rempah-ceria",
        "Nasi Rempah Ceria",
        "Makanan",
        21000,
        "Nasi fiktif dengan rempah harum dan sayuran.",
        "Fictional rice with aromatic spices and vegetables.",
    ),
    PublicMenuItem(
        7102,
        "es-jeruk-pelangi",
        "Es Jeruk Pelangi",
        "Minuman",
        9000,
        "Minuman jeruk fiktif yang disajikan dingin.",
        "A fictional chilled orange drink.",
    ),
)
_SOURCE_IDS = frozenset(f"product:{item.product_id}" for item in _CATALOG)


def _requests() -> tuple[tuple[str, StructuredLLMRequest, bool], ...]:
    return (
        (
            "structured_response",
            build_structured_menu_request(
                "Jawab langsung tanpa alat: menu nasi fiktif apa yang tercantum? "
                "Cantumkan source ID product:7101.",
                _CATALOG,
                _SOURCE_IDS,
                language="id",
                max_output_tokens=160,
                correlation_id="phase-7c-live-structured",
                enable_search_menu_tool=False,
            ),
            False,
        ),
        (
            "tool_calling",
            build_structured_menu_request(
                "Gunakan search_menu untuk mencari minuman jeruk, lalu jawab hanya dari "
                "hasil alat dan cantumkan source ID yang sesuai.",
                _CATALOG,
                _SOURCE_IDS,
                language="id",
                max_output_tokens=160,
                correlation_id="phase-7c-live-tool",
            ),
            True,
        ),
    )


@contextmanager
def _count_tool_executions() -> Iterator[list[int]]:
    count = [0]
    original = llm_gemini.execute_menu_tool

    def counted(*args, **kwargs):
        count[0] += 1
        return original(*args, **kwargs)

    llm_gemini.execute_menu_tool = counted
    try:
        yield count
    finally:
        llm_gemini.execute_menu_tool = original


def _validate_response(
    response: StructuredLLMResponse, request: StructuredLLMRequest
) -> None:
    if not isinstance(response, StructuredLLMResponse):
        raise TypeError("client did not return the provider-neutral structured response")
    if response.language != request.prompt.language:
        raise ValueError("response language did not match the request")
    if not set(response.sources).issubset(request.allowed_source_ids):
        raise ValueError("response contained an untrusted source ID")


def run_acceptance(
    client: StructuredLLMClient, *, provider: str, model: str
) -> list[dict[str, object]]:
    """Run both scenarios and return only sanitized, manually useful fields."""

    results: list[dict[str, object]] = []
    for scenario, request, require_tool in _requests():
        started = time.perf_counter()
        tool_count = 0
        try:
            with _count_tool_executions() as count:
                try:
                    response = client.generate_structured(request)
                finally:
                    tool_count = count[0]
            _validate_response(response, request)
            if require_tool and tool_count < 1:
                raise ValueError("required search_menu call was not exercised")
            if not require_tool and tool_count != 0:
                raise ValueError("direct structured scenario unexpectedly used a tool")
            result: dict[str, object] = {
                "scenario": scenario,
                "status": "PASS",
                "provider": provider,
                "model": model,
                **asdict(response),
            }
        except Exception as error:
            result = {
                "scenario": scenario,
                "status": "FAIL",
                "provider": provider,
                "model": model,
                "language": request.prompt.language,
                "answer": None,
                "sources": [],
                "insufficient_information": None,
                "limitations": [],
                "error_type": type(error).__name__,
                "error_message": str(error),
            }
        result["tool_call_count"] = tool_count
        result["latency_ms"] = max(0, round((time.perf_counter() - started) * 1000))
        results.append(result)
    return results


def main() -> None:
    config = load_llm_config()
    client = GeminiLLMClient(config)
    print(
        json.dumps(
            run_acceptance(client, provider=config.provider, model=config.model),
            ensure_ascii=False,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
