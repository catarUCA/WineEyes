"""Pure ranking helpers: segment aggregation and client-side RRF."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping, Sequence

from eval.config import FINAL_RESULTS, RRF_K
from eval.data_io import canonical_eval_id


@dataclass(frozen=True)
class SegmentHit:
    eval_id: str
    rank: int
    score: float


@dataclass(frozen=True)
class RankedLabel:
    eval_id: str
    rank: int
    score: float


def aggregate_segments_by_best_rank(hits: Iterable[SegmentHit]) -> list[RankedLabel]:
    """Keep one contribution per label in a branch using its best segment rank."""
    best: dict[str, SegmentHit] = {}
    for hit in hits:
        eval_id = canonical_eval_id(hit.eval_id)
        current = best.get(eval_id)
        if current is None or (hit.rank, -hit.score, eval_id) < (current.rank, -current.score, eval_id):
            best[eval_id] = SegmentHit(eval_id, int(hit.rank), float(hit.score))
    ordered = sorted(best.values(), key=lambda hit: (hit.rank, -hit.score, hit.eval_id))
    return [RankedLabel(hit.eval_id, rank, hit.score) for rank, hit in enumerate(ordered, 1)]


def reciprocal_rank_fusion(
    branches: Mapping[str, Sequence[RankedLabel]],
    rrf_k: int = RRF_K,
    final_results: int = FINAL_RESULTS,
) -> list[RankedLabel]:
    if rrf_k <= 0:
        raise ValueError("rrf_k must be positive")
    scores: dict[str, float] = {}
    contributions: dict[tuple[str, str], int] = {}
    for branch_name, ranking in sorted(branches.items()):
        seen: set[str] = set()
        for item in ranking:
            eval_id = canonical_eval_id(item.eval_id)
            if eval_id in seen:
                raise ValueError(f"Duplicate eval_id {eval_id} in branch {branch_name}")
            seen.add(eval_id)
            key = (branch_name, eval_id)
            contributions[key] = contributions.get(key, 0) + 1
            if contributions[key] > 1:
                raise AssertionError(f"Multiple RRF contributions for {branch_name}/{eval_id}")
            scores[eval_id] = scores.get(eval_id, 0.0) + 1.0 / (rrf_k + int(item.rank))
    ordered = sorted(scores.items(), key=lambda item: (-item[1], item[0]))[:final_results]
    return [RankedLabel(eval_id, rank, score) for rank, (eval_id, score) in enumerate(ordered, 1)]

