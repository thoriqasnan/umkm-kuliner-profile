"""One-shot, harmless Phase 7A live acceptance command."""

from dataclasses import asdict
import json

from .llm_client import create_llm_client
from .llm_contracts import LLMRequest


def main() -> None:
    client = create_llm_client()
    response = client.generate(LLMRequest(
        system_instruction="Jawab singkat dalam bahasa Indonesia. Jangan meminta data pribadi.",
        user_input="Tulis satu kalimat tentang menu fiktif SariRasa bernama Nasi Rempah Ceria.",
        language="id",
        max_output_tokens=48,
        correlation_id="phase-7a-live-acceptance",
    ))
    print(json.dumps(asdict(response), ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
