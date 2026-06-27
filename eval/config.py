"""Shared configuration for the isolated WineEyes retrieval evaluation."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
RESULTS_DIR = PROJECT_ROOT / "results"
EVAL_IMAGE_DIR = PROJECT_ROOT / "eval" / "muestra"

CACHE_PATH = DATA_DIR / "ablation_cache.json"
QUERIES_PATH = DATA_DIR / "queries.csv"
QRELS_PATH = DATA_DIR / "qrels.json"
GRADED_QRELS_PATH = DATA_DIR / "graded_qrels.json"
LEGACY_RANKINGS_PATH = RESULTS_DIR / "rankings.json"
LEGACY_METRICS_PATH = RESULTS_DIR / "retrieval_metrics.json"

RANKINGS_FULL_PATH = RESULTS_DIR / "rankings_full.json"
METRICS_FULL_PATH = RESULTS_DIR / "retrieval_metrics_full.json"
METRICS_BY_QUERY_PATH = RESULTS_DIR / "metrics_by_query.csv"
METRICS_BY_TYPE_PATH = RESULTS_DIR / "metrics_by_type.csv"
AUDIT_JSON_PATH = RESULTS_DIR / "evaluation_audit.json"
AUDIT_MD_PATH = RESULTS_DIR / "evaluation_audit.md"
TABLE4_PATH = RESULTS_DIR / "table4.tex"
BENCHMARK_JSON_PATH = RESULTS_DIR / "benchmark_hybrid.json"
BENCHMARK_CSV_PATH = RESULTS_DIR / "benchmark_hybrid.csv"
MANIFEST_PATH = RESULTS_DIR / "experiment_manifest.json"
RUN_LOG_PATH = RESULTS_DIR / "run_log.txt"

BGE_MODEL = os.getenv("BGE_MODEL", "BAAI/bge-m3")
BGE_REVISION = os.getenv("BGE_REVISION") or None
BGE_DEVICE = os.getenv("BGE_DEVICE") or None
BGE_BATCH_SIZE = max(1, int(os.getenv("BGE_BATCH_SIZE", "8")))
DENSE_DIM = 1024
DENSE_VECTOR_NAME = "semantico"
SPARSE_VECTOR_NAME = "lexico"
RRF_K = 60
BRANCH_CANDIDATE_DEPTH = int(os.getenv("EVAL_BRANCH_DEPTH", "100000"))
FINAL_RESULTS = 50
GRADED_BINARY_THRESHOLD = int(os.getenv("GRADED_BINARY_THRESHOLD", "1"))
BENCHMARK_REPEATS = max(20, int(os.getenv("BENCHMARK_REPEATS", "20")))
BENCHMARK_WARMUP = max(1, int(os.getenv("BENCHMARK_WARMUP", "2")))

COLLECTIONS = {
    "solo_ocr": "wineeyes_eval_solo_ocr_dense",
    "solo_vlm": "wineeyes_eval_solo_vlm_dense",
    "ocr_vlm": "wineeyes_eval_ocr_vlm_dense",
    "ocr_vlm_hybrid_full": "wineeyes_eval_ocr_vlm_hybrid_full",
    "ocr_vlm_hybrid_segmented": "wineeyes_eval_ocr_vlm_hybrid_segmented",
}

SYSTEM_SPECS = {
    "solo_ocr": {"cache_field": "ocr", "hybrid": False, "mode": "full_description"},
    "solo_vlm": {"cache_field": "vlm_solo", "hybrid": False, "mode": "full_description"},
    "ocr_vlm": {"cache_field": "vlm_fusion", "hybrid": False, "mode": "full_description"},
    "ocr_vlm_hybrid_full": {
        "cache_field": "vlm_fusion",
        "hybrid": True,
        "mode": "full_description",
    },
    "ocr_vlm_hybrid_segmented": {
        "cache_field": "vlm_fusion",
        "hybrid": True,
        "mode": "full_plus_segments",
    },
}


@dataclass(frozen=True)
class QdrantSettings:
    mode: str
    url: str | None
    api_key: str | None
    local_path: Path


def qdrant_settings() -> QdrantSettings:
    mode = os.getenv("EVAL_QDRANT_MODE", "remote").strip().lower()
    if mode not in {"remote", "local"}:
        raise ValueError("EVAL_QDRANT_MODE must be 'remote' or 'local'")
    host = os.getenv("QDRANT_HOST", "localhost")
    port = int(os.getenv("QDRANT_PORT", "6333"))
    url = os.getenv("QDRANT_URL") or f"http://{host}:{port}"
    return QdrantSettings(
        mode=mode,
        url=url if mode == "remote" else None,
        api_key=os.getenv("QDRANT_API_KEY") or None,
        local_path=Path(os.getenv("QDRANT_LOCAL_PATH", RESULTS_DIR / "qdrant_eval_storage")),
    )


def ensure_results_dir() -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
