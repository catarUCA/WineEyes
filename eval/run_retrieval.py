"""Run complete evaluation rankings without invoking OCR, VLM, or image models."""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone

from eval.config import (
    FINAL_RESULTS,
    LEGACY_RANKINGS_PATH,
    RANKINGS_FULL_PATH,
    SYSTEM_SPECS,
    ensure_results_dir,
)
from eval.data_io import EXPECTED_EVAL_IDS, load_queries, read_json, write_json
from eval.embeddings import BGEEmbedder
from eval.qdrant_eval import search_dense, search_hybrid
from eval.runtime import append_run_log, get_qdrant_client


def parse_args(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--without-legacy", action="store_true")
    return parser.parse_args(argv)


def _ranking_record(items, source: str, complete: bool) -> dict:
    return {
        "eval_ids": [item.eval_id if hasattr(item, "eval_id") else str(item) for item in items],
        "scores": [float(item.score) for item in items] if items and hasattr(items[0], "score") else None,
        "depth": len(items),
        "complete": complete,
        "source": source,
    }


def _legacy_records(query_id: str, legacy: dict) -> dict[str, dict]:
    records: dict[str, dict] = {}
    for system_name in ("bm25_ocr", "bm25_fusion", "clip_zeroshot"):
        ids = [str(value) for value in legacy.get(query_id, {}).get(system_name, [])]
        if not ids:
            continue
        unknown = set(ids) - set(EXPECTED_EVAL_IDS)
        if unknown:
            raise ValueError(f"Legacy {system_name}/{query_id} contains unknown IDs: {sorted(unknown)}")
        records[system_name] = _ranking_record(ids, "legacy_top10", complete=len(ids) == FINAL_RESULTS)
    return records


def main(argv=None) -> int:
    args = parse_args(argv)
    ensure_results_dir()
    append_run_log("run_retrieval started")
    try:
        client = get_qdrant_client()
        embedder = BGEEmbedder()
        queries = load_queries()
        legacy = read_json(LEGACY_RANKINGS_PATH) if LEGACY_RANKINGS_PATH.exists() and not args.without_legacy else {}
        output = {
            "metadata": {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "final_results": FINAL_RESULTS,
                "id_policy": "canonical eval_id; no offsets or positional translation",
            },
            "queries": {},
        }
        for query in queries:
            systems: dict[str, dict] = {}
            for system_name, spec in SYSTEM_SPECS.items():
                ranking = (
                    search_hybrid(client, embedder, system_name, query.text)
                    if spec["hybrid"]
                    else search_dense(client, embedder, system_name, query.text)
                )
                systems[system_name] = _ranking_record(ranking, "recomputed_bge_m3", complete=True)
            systems.update(_legacy_records(query.query_id, legacy))
            output["queries"][query.query_id] = {
                "query": query.text,
                "type": query.query_type,
                "systems": systems,
            }
            print(f"{query.query_id}: {len(systems)} systems")
        write_json(RANKINGS_FULL_PATH, output)
    except Exception as exc:
        append_run_log(f"run_retrieval FAILED: {type(exc).__name__}: {exc}")
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    append_run_log(f"run_retrieval completed output={RANKINGS_FULL_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
