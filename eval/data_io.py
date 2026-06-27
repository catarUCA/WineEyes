"""Canonical loading and validation of WineEyes evaluation inputs."""

from __future__ import annotations

import csv
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from eval.config import (
    CACHE_PATH,
    EVAL_IMAGE_DIR,
    GRADED_BINARY_THRESHOLD,
    GRADED_QRELS_PATH,
    PROJECT_ROOT,
    QRELS_PATH,
    QUERIES_PATH,
)


EVAL_ID_RE = re.compile(r"^[1-5]_(?:0[1-9]|10)$")
EXPECTED_EVAL_IDS = tuple(f"{group}_{index:02d}" for group in range(1, 6) for index in range(1, 11))


@dataclass(frozen=True)
class Query:
    query_id: str
    text: str
    query_type: str


@dataclass(frozen=True)
class CorpusItem:
    eval_id: str
    image_path: str
    group: int
    filename: str
    text: str


def read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def load_queries(path: Path = QUERIES_PATH) -> list[Query]:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    return [Query(row["query_id"].strip(), row["query"].strip(), row["type"].strip()) for row in rows]


def load_cache(path: Path = CACHE_PATH) -> dict[str, dict[str, str]]:
    raw = read_json(path)
    return {field: {str(key): str(value) for key, value in values.items()} for field, values in raw.items()}


def canonical_eval_id(value: str) -> str:
    value = str(value).strip()
    if not EVAL_ID_RE.fullmatch(value):
        raise ValueError(f"Invalid eval_id {value!r}; expected canonical form such as '2_08'")
    return value


def image_map(base: Path = EVAL_IMAGE_DIR) -> dict[str, Path]:
    """Map files to IDs from their directory and filename, never directory order."""
    mapped: dict[str, Path] = {}
    for path in base.glob("*/*"):
        if not path.is_file() or path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            continue
        try:
            group = int(path.parent.name)
            index = int(path.stem)
        except ValueError as exc:
            raise ValueError(f"Cannot derive canonical eval_id from image path {path}") from exc
        eval_id = canonical_eval_id(f"{group}_{index:02d}")
        if eval_id in mapped:
            raise ValueError(f"Duplicate image for eval_id {eval_id}: {mapped[eval_id]} and {path}")
        mapped[eval_id] = path
    return mapped


def load_corpus(cache_field: str, cache: dict[str, dict[str, str]] | None = None) -> list[CorpusItem]:
    cache = cache or load_cache()
    if cache_field not in cache:
        raise KeyError(f"Missing cache representation {cache_field!r}")
    paths = image_map()
    items: list[CorpusItem] = []
    for eval_id in EXPECTED_EVAL_IDS:
        text = cache[cache_field].get(eval_id, "")
        path = paths.get(eval_id)
        if path is None:
            raise ValueError(f"Missing image path for {eval_id}")
        items.append(
            CorpusItem(
                eval_id=eval_id,
                image_path=str(path.relative_to(PROJECT_ROOT)),
                group=int(eval_id.split("_", 1)[0]),
                filename=path.name,
                text=text,
            )
        )
    return items


def load_qrels(
    binary_path: Path = QRELS_PATH,
    graded_path: Path = GRADED_QRELS_PATH,
    threshold: int = GRADED_BINARY_THRESHOLD,
) -> tuple[dict[str, dict[str, int]], dict[str, dict[str, int]], dict[str, Any]]:
    """Return original gains, binary qrels, and qrels metadata."""
    path = graded_path if graded_path.exists() else binary_path
    graded = path == graded_path
    raw = read_json(path)
    gains: dict[str, dict[str, int]] = {}
    binary: dict[str, dict[str, int]] = {}
    for query_id, judgements in raw.items():
        gains[query_id] = {}
        binary[query_id] = {}
        for eval_id, value in judgements.items():
            canonical = canonical_eval_id(eval_id)
            gain = int(value)
            if graded:
                if gain < 0 or gain > 3:
                    raise ValueError(f"graded_qrels value outside 0..3 for {query_id}/{canonical}: {gain}")
                relevant = gain >= threshold
            else:
                if gain not in (0, 1):
                    raise ValueError(f"Binary qrels value outside 0/1 for {query_id}/{canonical}: {gain}")
                relevant = gain == 1
            gains[query_id][canonical] = gain
            if relevant:
                binary[query_id][canonical] = 1
    metadata = {
        "path": str(path.relative_to(PROJECT_ROOT)),
        "graded": graded,
        "binary_threshold": threshold if graded else 1,
    }
    return gains, binary, metadata
