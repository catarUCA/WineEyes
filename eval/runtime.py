"""Logging, environment metadata, and Qdrant client construction."""

from __future__ import annotations

import importlib.metadata
import json
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.request import urlopen

from eval.config import (
    BGE_MODEL,
    BGE_REVISION,
    MANIFEST_PATH,
    PROJECT_ROOT,
    RUN_LOG_PATH,
    ensure_results_dir,
    qdrant_settings,
)
from eval.data_io import write_json


def append_run_log(message: str) -> None:
    ensure_results_dir()
    stamp = datetime.now(timezone.utc).isoformat()
    with RUN_LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(f"{stamp} {message}\n")


def package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def _command_output(command: list[str]) -> str | None:
    try:
        return subprocess.check_output(command, cwd=PROJECT_ROOT, text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def _cpu_name() -> str:
    candidates = [
        _command_output(["sysctl", "-n", "machdep.cpu.brand_string"]),
        _command_output(["sysctl", "-n", "hw.model"]),
        platform.processor(),
    ]
    return next((value for value in candidates if value), "unknown")


def _gpu_info() -> dict[str, Any]:
    result: dict[str, Any] = {"available": False, "devices": []}
    try:
        import torch

        result["torch_version"] = getattr(torch, "__version__", None)
        result["available"] = bool(torch.cuda.is_available())
        if result["available"]:
            result["devices"] = [torch.cuda.get_device_name(index) for index in range(torch.cuda.device_count())]
    except ImportError:
        result["torch_version"] = None
    return result


def qdrant_server_version() -> str | None:
    settings = qdrant_settings()
    if not settings.url:
        return "local-mode (qdrant-client)"
    try:
        with urlopen(settings.url.rstrip("/") + "/", timeout=3) as response:
            payload = json.load(response)
        return payload.get("version") or payload.get("title")
    except Exception:
        return None


def resolved_model_revision(embedder=None) -> str | None:
    if BGE_REVISION:
        return BGE_REVISION
    model = getattr(embedder, "_model", None)
    candidates = [
        getattr(getattr(model, "model", None), "config", None),
        getattr(model, "config", None),
    ]
    for config in candidates:
        revision = getattr(config, "_commit_hash", None)
        if revision:
            return str(revision)
    return None


def build_manifest(embedder=None) -> dict[str, Any]:
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "python": {"version": platform.python_version(), "executable": sys.executable},
        "packages": {
            "FlagEmbedding": package_version("FlagEmbedding"),
            "qdrant-client": package_version("qdrant-client"),
            "numpy": package_version("numpy"),
            "torch": package_version("torch"),
        },
        "model": {
            "name": BGE_MODEL,
            "requested_revision": BGE_REVISION,
            "resolved_revision": resolved_model_revision(embedder),
            "use_fp16": False,
            "device": embedder.resolved_device() if embedder is not None else None,
            "batch_size": getattr(embedder, "batch_size", None),
        },
        "qdrant": {
            "server_version": qdrant_server_version(),
            "mode": qdrant_settings().mode,
            "url": qdrant_settings().url,
            "local_path": str(qdrant_settings().local_path.relative_to(PROJECT_ROOT))
            if qdrant_settings().local_path.is_relative_to(PROJECT_ROOT)
            else str(qdrant_settings().local_path),
        },
        "system": {
            "os": platform.platform(),
            "machine": platform.machine(),
            "cpu": _cpu_name(),
            "gpu": _gpu_info(),
        },
        "git_commit": _command_output(["git", "rev-parse", "HEAD"]),
        "git_dirty": bool(_command_output(["git", "status", "--porcelain"])),
    }


def write_manifest(embedder=None, updates: dict[str, Any] | None = None) -> dict[str, Any]:
    manifest = build_manifest(embedder)
    if MANIFEST_PATH.exists():
        try:
            previous = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
            previous.update(manifest)
            manifest = previous
        except json.JSONDecodeError:
            pass
    if updates:
        manifest.update(updates)
    write_json(MANIFEST_PATH, manifest)
    return manifest


def get_qdrant_client():
    try:
        from qdrant_client import QdrantClient
    except ImportError as exc:
        raise RuntimeError("qdrant-client is required for index and retrieval commands") from exc
    settings = qdrant_settings()
    if settings.mode == "remote":
        return QdrantClient(url=settings.url, api_key=settings.api_key, timeout=120)
    settings.local_path.mkdir(parents=True, exist_ok=True)
    return QdrantClient(path=str(settings.local_path))
