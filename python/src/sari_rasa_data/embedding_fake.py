"""Deterministic test-only embeddings; vectors carry no semantic meaning."""

from hashlib import sha256

from .embedding_contracts import (
    EmbeddingInvalidInputError,
    EmbeddingRequest,
    EmbeddingVector,
)


class FakeEmbeddingClient:
    def __init__(self, dimensions: int = 8) -> None:
        if isinstance(dimensions, bool) or not isinstance(dimensions, int) or dimensions <= 0:
            raise EmbeddingInvalidInputError("dimensions must be a positive integer")
        self._dimensions = dimensions

    def embed(self, request: EmbeddingRequest) -> EmbeddingVector:
        if not isinstance(request, EmbeddingRequest):
            raise EmbeddingInvalidInputError("request must be an EmbeddingRequest")
        seed = f"{request.language}\0{request.semantic_text}".encode("utf-8")
        values = []
        for index in range(self._dimensions):
            digest = sha256(seed + index.to_bytes(8, "big")).digest()
            integer = int.from_bytes(digest[:8], "big")
            values.append((integer / ((1 << 64) - 1)) * 2.0 - 1.0)
        return EmbeddingVector("fake", "deterministic-sha256", self._dimensions, tuple(values))
