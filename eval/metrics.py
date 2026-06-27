"""Information-retrieval metrics with explicit full-depth and @10 variants."""

from __future__ import annotations

import math
from typing import Mapping, Sequence


def _dcg(gains: Sequence[int | float]) -> float:
    return sum(float(gain) / math.log2(index + 2) for index, gain in enumerate(gains))


def ndcg_at_k(ranked_ids: Sequence[str], gains: Mapping[str, int], k: int = 10) -> float:
    observed = [(2 ** int(gains.get(eval_id, 0)) - 1) for eval_id in ranked_ids[:k]]
    ideal = sorted((int(value) for value in gains.values()), reverse=True)[:k]
    ideal_dcg = _dcg([(2 ** value - 1) for value in ideal])
    return _dcg(observed) / ideal_dcg if ideal_dcg else 0.0


def average_precision(
    ranked_ids: Sequence[str], binary_qrels: Mapping[str, int], k: int | None = None
) -> float:
    relevant = {eval_id for eval_id, value in binary_qrels.items() if int(value) > 0}
    if not relevant:
        return 0.0
    ranking = ranked_ids[:k] if k is not None else ranked_ids
    hits = 0
    total = 0.0
    for rank, eval_id in enumerate(ranking, 1):
        if eval_id in relevant:
            hits += 1
            total += hits / rank
    return total / len(relevant)


def precision_at_k(ranked_ids: Sequence[str], binary_qrels: Mapping[str, int], k: int) -> float:
    if k <= 0:
        raise ValueError("k must be positive")
    relevant = {eval_id for eval_id, value in binary_qrels.items() if int(value) > 0}
    return sum(eval_id in relevant for eval_id in ranked_ids[:k]) / k


def recall_at_k(ranked_ids: Sequence[str], binary_qrels: Mapping[str, int], k: int) -> float:
    relevant = {eval_id for eval_id, value in binary_qrels.items() if int(value) > 0}
    if not relevant:
        return 0.0
    return sum(eval_id in relevant for eval_id in ranked_ids[:k]) / len(relevant)


def reciprocal_rank(
    ranked_ids: Sequence[str], binary_qrels: Mapping[str, int], k: int | None = None
) -> float:
    relevant = {eval_id for eval_id, value in binary_qrels.items() if int(value) > 0}
    ranking = ranked_ids[:k] if k is not None else ranked_ids
    for rank, eval_id in enumerate(ranking, 1):
        if eval_id in relevant:
            return 1.0 / rank
    return 0.0


def metrics_for_ranking(
    ranked_ids: Sequence[str],
    gains: Mapping[str, int],
    binary_qrels: Mapping[str, int],
    complete: bool,
) -> dict[str, float | None]:
    return {
        "ndcg_at_10": ndcg_at_k(ranked_ids, gains, 10),
        "map": average_precision(ranked_ids, binary_qrels) if complete else None,
        "map_at_10": average_precision(ranked_ids, binary_qrels, 10),
        "p_at_5": precision_at_k(ranked_ids, binary_qrels, 5),
        "p_at_10": precision_at_k(ranked_ids, binary_qrels, 10),
        "recall_at_10": recall_at_k(ranked_ids, binary_qrels, 10),
        "mrr": reciprocal_rank(ranked_ids, binary_qrels) if complete else None,
        "mrr_at_10": reciprocal_rank(ranked_ids, binary_qrels, 10),
    }


# Backward-compatible name used by legacy scripts.
def mrr(ranked_ids, qrels):
    return reciprocal_rank(ranked_ids, qrels)
