"""Single BGE-M3 backend used by every new evaluation system."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Iterable

import numpy as np

from eval.config import BGE_BATCH_SIZE, BGE_DEVICE, BGE_MODEL, BGE_REVISION


@dataclass(frozen=True)
class HybridEmbedding:
    dense: list[float]
    sparse_indices: list[int]
    sparse_values: list[float]


class BGEEmbedder:
    def __init__(
        self,
        model_name: str = BGE_MODEL,
        revision: str | None = BGE_REVISION,
        device: str | None = BGE_DEVICE,
        batch_size: int = BGE_BATCH_SIZE,
    ):
        self.model_name = model_name
        self.revision = revision
        self.device = device
        self.batch_size = batch_size
        self._model = None
        self._lock = threading.Lock()

    def resolved_device(self) -> str:
        if self.device:
            return self.device
        try:
            import torch
        except ImportError as exc:
            raise RuntimeError("PyTorch is required by FlagEmbedding") from exc
        return "cuda:0" if torch.cuda.is_available() else "cpu"

    def load(self):
        if self._model is None:
            with self._lock:
                if self._model is None:
                    try:
                        from FlagEmbedding import BGEM3FlagModel
                    except ImportError as exc:
                        raise RuntimeError(
                            "FlagEmbedding is required. Install project evaluation dependencies first."
                        ) from exc
                    device = self.resolved_device()
                    self._model = BGEM3FlagModel(
                        self.model_name,
                        use_fp16=False,
                        devices=device,
                        batch_size=self.batch_size,
                    )
        return self._model

    @staticmethod
    def _dense_vector(value) -> list[float]:
        vector = np.asarray(value, dtype=np.float32).reshape(-1)
        norm = float(np.linalg.norm(vector))
        if norm:
            vector = vector / norm
        return vector.tolist()

    @staticmethod
    def _sparse_vector(value: dict) -> tuple[list[int], list[float]]:
        pairs = sorted((int(index), float(weight)) for index, weight in value.items() if float(weight) != 0.0)
        return [index for index, _ in pairs], [weight for _, weight in pairs]

    def encode(self, texts: Iterable[str], dense: bool, sparse: bool) -> list[HybridEmbedding]:
        values = list(texts)
        if not values:
            return []
        output = self.load().encode(
            values,
            batch_size=self.batch_size,
            return_dense=dense,
            return_sparse=sparse,
            return_colbert_vecs=False,
        )
        result: list[HybridEmbedding] = []
        for index in range(len(values)):
            dense_vector = self._dense_vector(output["dense_vecs"][index]) if dense else []
            sparse_indices: list[int] = []
            sparse_values: list[float] = []
            if sparse:
                sparse_indices, sparse_values = self._sparse_vector(output["lexical_weights"][index])
            result.append(HybridEmbedding(dense_vector, sparse_indices, sparse_values))
        return result

    def embed_dense(self, text: str) -> list[float]:
        return self.encode([text], dense=True, sparse=False)[0].dense

    def embed_sparse(self, text: str) -> tuple[list[int], list[float]]:
        encoded = self.encode([text], dense=False, sparse=True)[0]
        return encoded.sparse_indices, encoded.sparse_values

    def embed_hybrid(self, text: str) -> HybridEmbedding:
        return self.encode([text], dense=True, sparse=True)[0]


_DEFAULT_EMBEDDER = BGEEmbedder()


def embed_dense(text: str) -> list[float]:
    return _DEFAULT_EMBEDDER.embed_dense(text)


def embed_sparse(text: str) -> tuple[list[int], list[float]]:
    return _DEFAULT_EMBEDDER.embed_sparse(text)


def embed_hybrid(text: str) -> HybridEmbedding:
    return _DEFAULT_EMBEDDER.embed_hybrid(text)
