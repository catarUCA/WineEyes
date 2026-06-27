"""Build the five isolated evaluation collections from cached text only."""

from __future__ import annotations

import argparse
import sys

from eval.config import SYSTEM_SPECS, ensure_results_dir
from eval.embeddings import BGEEmbedder
from eval.qdrant_eval import index_system
from eval.runtime import append_run_log, get_qdrant_client, write_manifest


def parse_args(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="Delete and rebuild evaluation collections")
    parser.add_argument("--batch-size", type=int, default=16)
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    ensure_results_dir()
    append_run_log(f"build_eval_indices reset={args.reset} batch_size={args.batch_size}")
    try:
        client = get_qdrant_client()
        embedder = BGEEmbedder()
        print(
            f"Loading {embedder.model_name} once on {embedder.resolved_device()} "
            f"(FlagEmbedding batch_size={embedder.batch_size}, use_fp16=False)...",
            flush=True,
        )
        embedder.load()
        print("BGE-M3 loaded. Building evaluation collections...", flush=True)
        reports = []
        for position, system_name in enumerate(SYSTEM_SPECS, start=1):
            print(f"[{position}/{len(SYSTEM_SPECS)}] {system_name}", flush=True)
            report = index_system(
                client,
                embedder,
                system_name,
                reset=args.reset,
                batch_size=args.batch_size,
            )
            reports.append(report)
            print(f"  {report}", flush=True)
        write_manifest(embedder, {"index_build": reports})
    except Exception as exc:
        append_run_log(f"build_eval_indices FAILED: {type(exc).__name__}: {exc}")
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    for report in reports:
        print(report)
    append_run_log("build_eval_indices completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
