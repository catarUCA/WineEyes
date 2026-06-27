import re
import sys
import os
import unicodedata
from dataclasses import dataclass

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "source", "Sistema-de-catalogacion-de-imagenes"))

import numpy as np
from rank_bm25 import BM25Okapi

from eval.utils import iter_all_images, ClipExtractor, TextExtractor


@dataclass
class SearchHit:
    img_id: int
    path: str
    score: float
    rank: int


class BaseSystem:
    name = "base"

    def search(self, query, k):
        raise NotImplementedError


class OwnSystem(BaseSystem):
    name = "own_bge_m3"

    def __init__(self, rs):
        self.rs = rs

    def search(self, query, k):
        rows = self.rs.search_by_text(query)
        rows.sort(key=lambda x: x["score"], reverse=True)
        taken = []
        seen = set()
        for r in rows:
            iid = int(r["id"])
            if iid not in seen:
                seen.add(iid)
                taken.append(r)
                if len(taken) >= k:
                    break
        return [SearchHit(int(r["id"]), r["path"], float(r["score"]), i + 1)
                for i, r in enumerate(taken)]


class ClipSystem(BaseSystem):
    name = "clip_zeroshot"

    def __init__(self, rs):
        self.rs = rs
        self.clip = ClipExtractor(rs)

    def search(self, query, k):
        q = self.clip.encode_text(query).astype(np.float32)
        hits = self.rs.client.query_points(
            collection_name=self.rs.image_collection,
            query=q.tolist(), using="clip", limit=k,
        ).points
        return [SearchHit(int(h.payload["img_id"]), h.payload["path"], float(h.score), i + 1)
                for i, h in enumerate(hits)]


def _tok(text):
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    return re.findall(r"[a-z0-9]+", text.lower())


class Bm25System(BaseSystem):
    name = "bm25"

    def __init__(self, rs):
        self.rs = rs
        docs, self.meta = [], []
        for iid, path, desc in iter_all_images(rs):
            docs.append(_tok(desc))
            self.meta.append((iid, path))
        self.bm25 = BM25Okapi(docs)
        print(f"[bm25] indexados {len(docs)} documentos")

    def search(self, query, k):
        scores = self.bm25.get_scores(_tok(query))
        order = np.argsort(scores)[::-1][:k]
        return [SearchHit(self.meta[i][0], self.meta[i][1], float(scores[i]), r + 1)
                for r, i in enumerate(order)]
