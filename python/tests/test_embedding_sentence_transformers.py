import importlib
import sys

import pytest

from sari_rasa_data.embedding_contracts import (
    EmbeddingInferenceError,
    EmbeddingInvalidVectorError,
    EmbeddingModelLoadError,
    EmbeddingRequest,
)
from sari_rasa_data.embedding_sentence_transformers import SentenceTransformerEmbeddingClient


class ArrayLike:
    def __init__(self, values):
        self.values = values

    def tolist(self):
        return self.values


class Model:
    def __init__(self, values=(0.1, 0.2, 0.3)):
        self.values = values
        self.calls = []

    def encode(self, text, **kwargs):
        self.calls.append((text, kwargs))
        return ArrayLike(self.values)


def test_module_import_does_not_import_provider_or_load_model():
    sys.modules.pop("sentence_transformers", None)
    module = importlib.reload(importlib.import_module("sari_rasa_data.embedding_sentence_transformers"))
    assert "sentence_transformers" not in sys.modules
    assert module.SentenceTransformerEmbeddingClient


def test_loading_is_lazy_once_and_vector_is_provider_neutral_tuple():
    model = Model()
    loader_calls = []

    def loader(*args, **kwargs):
        loader_calls.append((args, kwargs))
        return model

    client = SentenceTransformerEmbeddingClient("local/model", loader=loader)
    assert loader_calls == []
    result = client.embed(EmbeddingRequest("name: Soto", "id"))
    client.embed(EmbeddingRequest("name: Soup", "en"))
    assert len(loader_calls) == 1
    assert loader_calls[0] == (("local/model",), {"device": "cpu", "local_files_only": True})
    assert result.provider == "sentence-transformers"
    assert result.model == "local/model"
    assert result.vector == (0.1, 0.2, 0.3)
    assert model.calls[0][1] == {"convert_to_numpy": True}


def test_load_failure_is_sanitized_and_typed():
    def loader(*args, **kwargs):
        raise RuntimeError("/private/path/token-like-detail")

    client = SentenceTransformerEmbeddingClient("missing", loader=loader)
    with pytest.raises(EmbeddingModelLoadError) as caught:
        client.embed(EmbeddingRequest("text", "id"))
    assert str(caught.value) == "local embedding model could not be loaded"
    assert "/private" not in str(caught.value)


def test_inference_failure_is_sanitized_and_typed():
    class Broken:
        def encode(self, *args, **kwargs):
            raise RuntimeError("internal model path")

    client = SentenceTransformerEmbeddingClient("local", loader=lambda *a, **k: Broken())
    with pytest.raises(EmbeddingInferenceError) as caught:
        client.embed(EmbeddingRequest("text", "en"))
    assert str(caught.value) == "local embedding inference failed"


@pytest.mark.parametrize(
    "values,error",
    [([float("nan")], EmbeddingInvalidVectorError), ([float("inf")], EmbeddingInvalidVectorError),
     (["not-number"], EmbeddingInvalidVectorError), ([True], EmbeddingInvalidVectorError)],
)
def test_invalid_provider_vector_becomes_typed_safe_failure(values, error):
    client = SentenceTransformerEmbeddingClient("local", loader=lambda *a, **k: Model(values))
    with pytest.raises(error):
        client.embed(EmbeddingRequest("text", "id"))
