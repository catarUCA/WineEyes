"""Evaluation-only Qdrant collections, indexing, and branch retrieval."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import asdict, dataclass

from eval.config import (
    BRANCH_CANDIDATE_DEPTH,
    COLLECTIONS,
    DENSE_DIM,
    DENSE_VECTOR_NAME,
    FINAL_RESULTS,
    SPARSE_VECTOR_NAME,
    SYSTEM_SPECS,
)
from eval.data_io import CorpusItem, canonical_eval_id, load_cache, load_corpus
from eval.embeddings import BGEEmbedder, HybridEmbedding
from eval.retrieval_core import RankedLabel, SegmentHit, aggregate_segments_by_best_rank, reciprocal_rank_fusion
from eval.segmentation import text_units


POINT_NAMESPACE = uuid.UUID("9a56a717-b97e-4e40-bf73-2ab36b25f4ea")


@dataclass(frozen=True)
class EvaluationDocument:
    eval_id: str
    image_path: str
    group: int
    filename: str
    segment_id: str
    segment_type: str
    segment_text: str


def documents_for_item(item: CorpusItem, mode: str) -> list[EvaluationDocument]:
    documents: list[EvaluationDocument] = []
    for index, (segment_type, segment_text) in enumerate(text_units(item.text, mode)):
        segment_id = f"{item.eval_id}:full" if segment_type == "full" else f"{item.eval_id}:segment:{index:03d}"
        documents.append(
            EvaluationDocument(
                eval_id=canonical_eval_id(item.eval_id),
                image_path=item.image_path,
                group=item.group,
                filename=item.filename,
                segment_id=segment_id,
                segment_type=segment_type,
                segment_text=segment_text,
            )
        )
    return documents


def deterministic_point_id(collection: str, segment_id: str) -> str:
    return str(uuid.uuid5(POINT_NAMESPACE, f"{collection}:{segment_id}"))


def _existing_collections(client) -> set[str]:
    return {collection.name for collection in client.get_collections().collections}


def create_collection(client, name: str, hybrid: bool, reset: bool) -> bool:
    try:
        from qdrant_client.models import Distance, SparseVectorParams, VectorParams
    except ImportError as exc:
        raise RuntimeError("qdrant-client is required") from exc
    exists = name in _existing_collections(client)
    if exists and reset:
        client.delete_collection(name)
        exists = False
    if exists:
        return False
    kwargs = {
        "collection_name": name,
        "vectors_config": {DENSE_VECTOR_NAME: VectorParams(size=DENSE_DIM, distance=Distance.COSINE)},
    }
    if hybrid:
        kwargs["sparse_vectors_config"] = {SPARSE_VECTOR_NAME: SparseVectorParams()}
    client.create_collection(**kwargs)
    return True


def _point(document: EvaluationDocument, embedding: HybridEmbedding, hybrid: bool, collection: str):
    try:
        from qdrant_client.models import PointStruct, SparseVector
    except ImportError as exc:
        raise RuntimeError("qdrant-client is required") from exc
    vectors = {DENSE_VECTOR_NAME: embedding.dense}
    if hybrid:
        vectors[SPARSE_VECTOR_NAME] = SparseVector(
            indices=embedding.sparse_indices,
            values=embedding.sparse_values,
        )
    return PointStruct(
        id=deterministic_point_id(collection, document.segment_id),
        vector=vectors,
        payload=asdict(document),
    )


def index_system(client, embedder: BGEEmbedder, system_name: str, reset: bool, batch_size: int = 16) -> dict:
    spec = SYSTEM_SPECS[system_name]
    collection = COLLECTIONS[system_name]
    created = create_collection(client, collection, bool(spec["hybrid"]), reset)
    if not created:
        return {"system": system_name, "collection": collection, "status": "reused"}

    cache = load_cache()
    documents = [
        document
        for item in load_corpus(str(spec["cache_field"]), cache)
        for document in documents_for_item(item, str(spec["mode"]))
    ]
    for start in range(0, len(documents), batch_size):
        batch = documents[start : start + batch_size]
        embeddings = embedder.encode(
            [document.segment_text for document in batch],
            dense=True,
            sparse=bool(spec["hybrid"]),
        )
        points = [_point(document, embedding, bool(spec["hybrid"]), collection) for document, embedding in zip(batch, embeddings)]
        client.upsert(collection_name=collection, points=points, wait=True)
    return {
        "system": system_name,
        "collection": collection,
        "status": "built",
        "points": len(documents),
        "eval_ids": len({document.eval_id for document in documents}),
    }


def _query_hits(client, collection: str, query, using: str, limit: int):
    return client.query_points(
        collection_name=collection,
        query=query,
        using=using,
        limit=limit,
        with_payload=True,
    ).points


def _branch_ranking(hits) -> list[RankedLabel]:
    segment_hits = [
        SegmentHit(canonical_eval_id(hit.payload["eval_id"]), rank, float(hit.score))
        for rank, hit in enumerate(hits, 1)
    ]
    return aggregate_segments_by_best_rank(segment_hits)


def _require_complete(ranking: list[RankedLabel], system_name: str) -> list[RankedLabel]:
    if len(ranking) != FINAL_RESULTS or len({item.eval_id for item in ranking}) != FINAL_RESULTS:
        raise RuntimeError(f"{system_name} returned {len(ranking)} unique labels; expected {FINAL_RESULTS}")
    return ranking


def search_dense(client, embedder: BGEEmbedder, system_name: str, query: str) -> list[RankedLabel]:
    collection = COLLECTIONS[system_name]
    count = int(client.count(collection_name=collection, exact=True).count)
    hits = _query_hits(client, collection, embedder.embed_dense(query), DENSE_VECTOR_NAME, count)
    return _require_complete(_branch_ranking(hits), system_name)


def hybrid_branch_rankings(client, embedder: BGEEmbedder, system_name: str, query: str):
    try:
        from qdrant_client.models import SparseVector
    except ImportError as exc:
        raise RuntimeError("qdrant-client is required") from exc
    collection = COLLECTIONS[system_name]
    embedding = embedder.embed_hybrid(query)
    count = int(client.count(collection_name=collection, exact=True).count)
    limit = min(max(FINAL_RESULTS, BRANCH_CANDIDATE_DEPTH), count)
    dense_hits = _query_hits(client, collection, embedding.dense, DENSE_VECTOR_NAME, limit)
    sparse_hits = _query_hits(
        client,
        collection,
        SparseVector(indices=embedding.sparse_indices, values=embedding.sparse_values),
        SPARSE_VECTOR_NAME,
        limit,
    )
    dense = _require_complete(_branch_ranking(dense_hits), system_name + ":dense")
    # Sparse retrieval only returns documents sharing lexical dimensions with
    # the query. A partial (or empty) sparse branch is therefore valid; the
    # complete dense branch still guarantees a full fused ranking.
    sparse = _branch_ranking(sparse_hits)
    return {"dense": dense, "sparse": sparse}, {"dense_hits": dense_hits, "sparse_hits": sparse_hits}


def search_hybrid(client, embedder: BGEEmbedder, system_name: str, query: str) -> list[RankedLabel]:
    branches, _ = hybrid_branch_rankings(client, embedder, system_name, query)
    return _require_complete(reciprocal_rank_fusion(branches), system_name)


def scroll_payloads(client, collection: str) -> list[dict]:
    payloads: list[dict] = []
    offset = None
    while True:
        points, offset = client.scroll(
            collection_name=collection,
            limit=256,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        payloads.extend(point.payload for point in points)
        if offset is None:
            break
    return payloads
