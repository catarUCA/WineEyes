"""Independent latency benchmark for the segmented hybrid retrieval path."""

from __future__ import annotations

import argparse
import csv
import statistics
import sys
import time
from collections import defaultdict

from eval.config import (
    BENCHMARK_CSV_PATH,
    BENCHMARK_JSON_PATH,
    BENCHMARK_REPEATS,
    BENCHMARK_WARMUP,
    BRANCH_CANDIDATE_DEPTH,
    COLLECTIONS,
    DENSE_VECTOR_NAME,
    FINAL_RESULTS,
    RRF_K,
    SPARSE_VECTOR_NAME,
    ensure_results_dir,
)
from eval.data_io import load_queries, write_json
from eval.embeddings import BGEEmbedder
from eval.qdrant_eval import _branch_ranking, _query_hits
from eval.retrieval_core import reciprocal_rank_fusion
from eval.runtime import append_run_log, get_qdrant_client, write_manifest


PHASES = (
    "dense_encoding",
    "sparse_encoding",
    "dense_search",
    "sparse_search",
    "segment_aggregation",
    "rrf",
    "total",
)


def _summary(values):
    ordered = sorted(values)
    p95_index = min(len(ordered) - 1, max(0, int(0.95 * len(ordered) + 0.999999) - 1))
    return {
        "count": len(values),
        "mean_ms": statistics.fmean(values),
        "median_ms": statistics.median(values),
        "std_ms": statistics.pstdev(values),
        "p95_ms": ordered[p95_index],
        "min_ms": ordered[0],
        "max_ms": ordered[-1],
    }


def parse_args(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--repeats", type=int, default=BENCHMARK_REPEATS)
    parser.add_argument("--warmup", type=int, default=BENCHMARK_WARMUP)
    parser.add_argument(
        "--system",
        choices=("ocr_vlm_hybrid_full", "ocr_vlm_hybrid_segmented"),
        default="ocr_vlm_hybrid_segmented",
    )
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    if args.repeats < 20:
        print("ERROR: --repeats must be at least 20", file=sys.stderr)
        return 2
    ensure_results_dir()
    append_run_log(f"benchmark_hybrid system={args.system} repeats={args.repeats} warmup={args.warmup}")
    try:
        from qdrant_client.models import SparseVector

        client = get_qdrant_client()
        embedder = BGEEmbedder()
        load_start = time.perf_counter()
        embedder.load()
        model_load_ms = (time.perf_counter() - load_start) * 1000
        collection = COLLECTIONS[args.system]
        point_count = int(client.count(collection_name=collection, exact=True).count)
        candidate_depth = min(max(FINAL_RESULTS, BRANCH_CANDIDATE_DEPTH), point_count)
        queries = load_queries()

        for _ in range(args.warmup):
            for query in queries:
                dense = embedder.embed_dense(query.text)
                sparse_indices, sparse_values = embedder.embed_sparse(query.text)
                _query_hits(client, collection, dense, DENSE_VECTOR_NAME, candidate_depth)
                _query_hits(
                    client,
                    collection,
                    SparseVector(indices=sparse_indices, values=sparse_values),
                    SPARSE_VECTOR_NAME,
                    candidate_depth,
                )

        raw = []
        for query in queries:
            for repeat in range(args.repeats):
                total_start = time.perf_counter()
                started = time.perf_counter()
                dense = embedder.embed_dense(query.text)
                dense_encoding = (time.perf_counter() - started) * 1000

                started = time.perf_counter()
                sparse_indices, sparse_values = embedder.embed_sparse(query.text)
                sparse_encoding = (time.perf_counter() - started) * 1000

                started = time.perf_counter()
                dense_hits = _query_hits(client, collection, dense, DENSE_VECTOR_NAME, candidate_depth)
                dense_search = (time.perf_counter() - started) * 1000

                started = time.perf_counter()
                sparse_hits = _query_hits(
                    client,
                    collection,
                    SparseVector(indices=sparse_indices, values=sparse_values),
                    SPARSE_VECTOR_NAME,
                    candidate_depth,
                )
                sparse_search = (time.perf_counter() - started) * 1000

                started = time.perf_counter()
                branches = {"dense": _branch_ranking(dense_hits), "sparse": _branch_ranking(sparse_hits)}
                segment_aggregation = (time.perf_counter() - started) * 1000

                started = time.perf_counter()
                ranking = reciprocal_rank_fusion(branches, rrf_k=RRF_K, final_results=FINAL_RESULTS)
                rrf = (time.perf_counter() - started) * 1000
                if len(ranking) != FINAL_RESULTS:
                    raise RuntimeError(f"Benchmark ranking has {len(ranking)} labels, expected 50")
                total = (time.perf_counter() - total_start) * 1000
                raw.append(
                    {
                        "query_id": query.query_id,
                        "repeat": repeat + 1,
                        "dense_encoding": dense_encoding,
                        "sparse_encoding": sparse_encoding,
                        "dense_search": dense_search,
                        "sparse_search": sparse_search,
                        "segment_aggregation": segment_aggregation,
                        "rrf": rrf,
                        "total": total,
                    }
                )

        phase_values = defaultdict(list)
        for row in raw:
            for phase in PHASES:
                phase_values[phase].append(row[phase])
        summary = {phase: _summary(values) for phase, values in phase_values.items()}
        output = {
            "system": args.system,
            "queries": len(queries),
            "repeats_per_query": args.repeats,
            "warmup_rounds": args.warmup,
            "model_load_ms": model_load_ms,
            "candidate_depth_per_branch": candidate_depth,
            "rrf_k": RRF_K,
            "summary": summary,
            "raw": raw,
        }
        write_json(BENCHMARK_JSON_PATH, output)
        with BENCHMARK_CSV_PATH.open("w", newline="", encoding="utf-8") as handle:
            fields = ["phase", "count", "mean_ms", "median_ms", "std_ms", "p95_ms", "min_ms", "max_ms"]
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            for phase in PHASES:
                writer.writerow({"phase": phase, **summary[phase]})
        write_manifest(embedder, {"benchmark": {key: value for key, value in output.items() if key != "raw"}})
    except Exception as exc:
        append_run_log(f"benchmark_hybrid FAILED: {type(exc).__name__}: {exc}")
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    append_run_log("benchmark_hybrid completed")
    print(f"Wrote {BENCHMARK_JSON_PATH} and {BENCHMARK_CSV_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

