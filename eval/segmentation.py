"""Deterministic semantic-block segmentation for structured VLM descriptions."""

from __future__ import annotations

import re


HEADING_RE = re.compile(r"^[^.!?]{2,120}:$")
SENTENCE_BOUNDARY_RE = re.compile(r"(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÜÑ0-9])")
LIST_PREFIX_RE = re.compile(r"^\s*[-*•]\s*")


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _flush_block(heading: str | None, content: list[str], output: list[str]) -> None:
    body = _normalise(" ".join(content))
    if not body:
        return
    block = f"{heading} {body}" if heading else body
    block = _normalise(block)
    if block:
        output.append(block)


def semantic_segments(text: str) -> list[str]:
    """Split structured text into semantic blocks and real prose sentences."""
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return []

    blocks: list[str] = []
    heading: str | None = None
    content: list[str] = []
    for raw_line in text.split("\n"):
        line = _normalise(raw_line)
        if not line:
            _flush_block(heading, content, blocks)
            heading, content = None, []
            continue
        if HEADING_RE.fullmatch(line):
            _flush_block(heading, content, blocks)
            heading, content = line, []
            continue
        content.append(LIST_PREFIX_RE.sub("", line))
    _flush_block(heading, content, blocks)

    expanded: list[str] = []
    for block in blocks:
        sentences = [_normalise(part) for part in SENTENCE_BOUNDARY_RE.split(block)]
        sentences = [part for part in sentences if part]
        expanded.extend(sentences if len(sentences) > 1 else [block])

    unique: list[str] = []
    seen: set[str] = set()
    full = _normalise(text)
    for segment in expanded:
        normalised = _normalise(segment)
        key = normalised.casefold()
        if not normalised or HEADING_RE.fullmatch(normalised) or key in seen:
            continue
        if normalised == full:
            continue
        seen.add(key)
        unique.append(normalised)
    return unique


def text_units(text: str, mode: str) -> list[tuple[str, str]]:
    full = _normalise(text)
    if not full:
        return []
    if mode == "full_description":
        return [("full", full)]
    if mode != "full_plus_segments":
        raise ValueError(f"Unknown segmentation mode: {mode}")
    segments = semantic_segments(text)
    if len(segments) <= 1:
        return [("full", full)]
    return [("full", full)] + [("segment", segment) for segment in segments]
