"""
Sparse + hybrid indexing and search using FlagEmbedding service.
"""
import os
import json
import requests
import numpy as np
from qdrant_client.models import (
    VectorParams, Distance, SparseVectorParams, SparseIndexParams,
    PointStruct, NamedSparseVector, NamedVector,
)
from eval.systems import BaseSystem, SearchHit


EMBED_HOST = os.getenv("EMBED_HOST", "localhost")
EMBED_PORT = int(os.getenv("EMBED_PORT", "8002"))
EMBED_URL = f"http://{EMBED_HOST}:{EMBED_PORT}"


def embed_texts(texts, dense=True, sparse=True):
    r = requests.post(f"{EMBED_URL}/", json={
        "input": texts, "dense": dense, "sparse": sparse,
    }, timeout=120)
    r.raise_for_status()
    return r.json()


def ensure_sparse_collection(client, name, dim):
    existing = [c.name for c in client.get_collections().collections]
    if name in existing:
        client.delete_collection(name)
        import time
        for _ in range(30):
            if name not in [c.name for c in client.get_collections().collections]:
                break
            time.sleep(1.0)
    client.create_collection(
        collection_name=name,
        vectors_config={
            "dense": VectorParams(size=dim, distance=Distance.COSINE),
        },
        sparse_vectors_config={
            "sparse": SparseVectorParams(index=SparseIndexParams()),
        },
    )


def index_descriptions_sparse(rs, name, items):
    dim = 1024
    ensure_sparse_collection(rs.client, name, dim)
    pid = 0
    points = []
    total = 0
    batch_size = 10

    def flush():
        nonlocal pid
        if not points:
            return
        rs.client.upsert(collection_name=name, points=points)
        print(f"  [{name}] {len(points)} puntos insertados")
        points.clear()

    for img_id, path, desc in items:
        texts = rs.split_description(desc)
        full_text = " ".join(texts)
        pending = [full_text] + texts
        emb = embed_texts(pending, dense=True, sparse=True)

        for i, txt in enumerate(pending):
            pid += 1
            vec = NamedVector(name="dense", vector=emb["dense"][i])
            spv = NamedSparseVector(
                name="sparse",
                vector={
                    "indices": emb["sparse"][i]["indices"],
                    "values": emb["sparse"][i]["values"],
                },
            )
            points.append(PointStruct(
                id=pid,
                vector=vec,
                vector_sparse=spv,
                payload={"img_id": img_id, "path": path, "segment_text": txt},
            ))
            total += 1
            if len(points) >= 50:
                flush()
    flush()
    print(f"[{name}] {total} segmentos indexados con vectores sparse")


def hybrid_search(client, collection, query, k=10, dense_weight=0.5):
    emb = embed_texts([query], dense=True, sparse=True)
    dense_vec = emb["dense"][0]
    sp = emb["sparse"][0]

    hits = client.query_points(
        collection_name=collection,
        prefetch=[
            {"query": dense_vec, "using": "dense", "limit": k * 3},
            {"query": sp, "using": "sparse", "limit": k * 3},
        ],
        query=dense_vec,
        using="dense",
        limit=k,
    ).points

    seen = {}
    for h in hits:
        iid = h.payload["img_id"]
        score = h.score
        if iid not in seen or score > seen[iid].score:
            seen[iid] = SearchHit(iid, h.payload["path"], float(score), 0)
    out = sorted(seen.values(), key=lambda x: -x.score)[:k]
    for r, hit in enumerate(out):
        hit.rank = r + 1
    return out


class SparseDenseSystem(BaseSystem):
    def __init__(self, rs, collection_name, name):
        self.rs = rs
        self.collection = collection_name
        self.name = name

    def search(self, query, k):
        return hybrid_search(self.rs.client, self.collection, query, k)
