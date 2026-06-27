import numpy as np
from qdrant_client.models import VectorParams, Distance, PointStruct

from eval.systems import BaseSystem, SearchHit


def ensure_collection(client, name, dim):
    import time
    existing = [c.name for c in client.get_collections().collections]
    if name in existing:
        client.delete_collection(name)
        for _ in range(30):
            if name not in [c.name for c in client.get_collections().collections]:
                break
            time.sleep(1.0)
    client.create_collection(
        collection_name=name,
        vectors_config={"semantico": VectorParams(size=dim, distance=Distance.COSINE)},
    )


def index_descriptions(rs, name, items, mode="full"):
    import sys
    import time
    import requests
    import os

    OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
    TEXT_EMBED_MODEL = os.getenv("TEXT_EMBED_MODEL", "bge-m3:latest")

    ensure_collection(rs.client, name, 1024)
    pid = 0
    points = []
    total_units = 0
    pending_texts = []
    pending_payloads = []

    def flush_batch():
        nonlocal pid
        if not pending_texts:
            return
        for attempt in range(3):
            try:
                r = requests.post(
                    f"{OLLAMA_HOST}/api/embed",
                    json={"model": TEXT_EMBED_MODEL, "input": pending_texts},
                    timeout=120,
                )
                r.raise_for_status()
                embeddings = r.json()["embeddings"]
                break
            except Exception:
                if attempt < 2:
                    time.sleep(2.0 * (attempt + 1))
                else:
                    raise
        for i, emb in enumerate(embeddings):
            norm = np.linalg.norm(emb)
            if norm > 0:
                emb = (np.array(emb) / norm).tolist()
            pid += 1
            points.append(PointStruct(
                id=pid, vector={"semantico": emb},
                payload=pending_payloads[i],
            ))
        pending_texts.clear()
        pending_payloads.clear()

    for img_id, path, desc in items:
        units = []
        if mode in ("full", "both"):
            units.append(" ".join(rs.split_description(desc)))
        if mode in ("segments", "both"):
            units.extend(rs.split_description(desc))
        for text in units:
            if not text.strip():
                continue
            pending_texts.append(text)
            pending_payloads.append({"img_id": img_id, "path": path, "segment_text": text})
            total_units += 1
            if len(pending_texts) >= 20:
                flush_batch()
                print(f"  [{name}] {total_units} textos embedidos...")
                sys.stdout.flush()
    flush_batch()
    if points:
        rs.client.upsert(collection_name=name, points=points)
    print(f"[{name}] {len(points)} puntos indexados (mode={mode})")


class VariantSystem(BaseSystem):
    def __init__(self, rs, collection_name, name):
        self.rs = rs
        self.collection = collection_name
        self.name = name

    def search(self, query, k):
        vec = self.rs._embed_text(query)
        q = np.array(vec, dtype=np.float32)
        hits = self.rs.client.query_points(
            collection_name=self.collection, query=q.tolist(),
            using="semantico", limit=k * 3,
        ).points
        seen = {}
        for h in hits:
            iid = h.payload["img_id"]
            if iid not in seen or h.score > seen[iid].score:
                seen[iid] = SearchHit(iid, h.payload["path"], float(h.score), 0)
        out = sorted(seen.values(), key=lambda x: -x.score)[:k]
        for r, hit in enumerate(out):
            hit.rank = r + 1
        return out
