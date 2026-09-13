"""Lazy, local sentence-transformers adapter for multilingual embeddings."""

from collections.abc import Callable
from numbers import Real
from typing import Any

from .embedding_contracts import (
    EmbeddingConfigUnavailableError,
    EmbeddingInferenceError,
    EmbeddingInvalidInputError,
    EmbeddingInvalidVectorError,
    EmbeddingModelLoadError,
    EmbeddingRequest,
    EmbeddingVector,
)


class SentenceTransformerEmbeddingClient:
    """CPU-first adapter; model loading occurs only on the first embed call."""

    def __init__(
        self,
        model_name: str,
        *,
        device: str = "cpu",
        local_files_only: bool = True,
        loader: Callable[..., Any] | None = None,
    ) -> None:
        if not isinstance(model_name, str) or not model_name.strip():
            raise EmbeddingConfigUnavailableError("a local embedding model name is required")
        if not isinstance(device, str) or not device.strip():
            raise EmbeddingConfigUnavailableError("an embedding device is required")
        self._model_name = model_name.strip()
        self._device = device.strip()
        self._local_files_only = local_files_only
        self._loader = loader
        self._model: Any | None = None

    def _load(self) -> Any:
        if self._model is not None:
            return self._model
        try:
            loader = self._loader
            if loader is None:
                from sentence_transformers import SentenceTransformer

                loader = SentenceTransformer
            self._model = loader(
                self._model_name,
                device=self._device,
                local_files_only=self._local_files_only,
            )
        except Exception as exc:
            raise EmbeddingModelLoadError("local embedding model could not be loaded") from exc
        return self._model

    def embed(self, request: EmbeddingRequest) -> EmbeddingVector:
        if not isinstance(request, EmbeddingRequest):
            raise EmbeddingInvalidInputError("request must be an EmbeddingRequest")
        model = self._load()
        try:
            raw = model.encode(request.semantic_text, convert_to_numpy=True)
            if hasattr(raw, "tolist"):
                raw = raw.tolist()
            if any(isinstance(value, bool) or not isinstance(value, Real) for value in raw):
                raise EmbeddingInvalidVectorError("vector components must be numeric")
            vector = tuple(float(value) for value in raw)
        except EmbeddingInvalidVectorError:
            raise
        except Exception as exc:
            raise EmbeddingInferenceError("local embedding inference failed") from exc
        return EmbeddingVector(
            provider="sentence-transformers",
            model=self._model_name,
            dimensions=len(vector),
            vector=vector,
        )
