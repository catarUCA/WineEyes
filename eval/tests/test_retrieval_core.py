from __future__ import annotations

import unittest

from eval.data_io import EXPECTED_EVAL_IDS
from eval.retrieval_core import RankedLabel, SegmentHit, aggregate_segments_by_best_rank, reciprocal_rank_fusion


class RetrievalCoreTests(unittest.TestCase):
    def test_segment_aggregation_returns_one_label_per_rank(self):
        hits = [
            SegmentHit("1_01", 1, 0.9),
            SegmentHit("1_01", 2, 0.8),
            SegmentHit("1_02", 3, 0.7),
        ]
        ranking = aggregate_segments_by_best_rank(hits)
        self.assertEqual([item.eval_id for item in ranking], ["1_01", "1_02"])
        self.assertEqual([item.rank for item in ranking], [1, 2])

    def test_rrf_has_one_contribution_per_label_and_branch(self):
        dense = [RankedLabel("1_01", 1, 1.0), RankedLabel("1_02", 2, 0.9)]
        sparse = [RankedLabel("1_02", 1, 1.0), RankedLabel("1_01", 2, 0.9)]
        fused = reciprocal_rank_fusion({"dense": dense, "sparse": sparse}, final_results=2)
        expected = 1 / 61 + 1 / 62
        self.assertAlmostEqual(fused[0].score, expected)
        self.assertAlmostEqual(fused[1].score, expected)
        self.assertEqual([item.eval_id for item in fused], ["1_01", "1_02"])

    def test_rrf_accepts_label_in_only_one_branch(self):
        dense = [RankedLabel("1_01", 1, 1.0)]
        sparse = [RankedLabel("1_02", 1, 1.0)]
        fused = reciprocal_rank_fusion({"dense": dense, "sparse": sparse}, final_results=2)
        self.assertEqual([item.eval_id for item in fused], ["1_01", "1_02"])

    def test_rrf_accepts_empty_sparse_branch(self):
        dense = [RankedLabel("1_01", 1, 1.0), RankedLabel("1_02", 2, 0.9)]
        fused = reciprocal_rank_fusion({"dense": dense, "sparse": []}, final_results=2)
        self.assertEqual([item.eval_id for item in fused], ["1_01", "1_02"])

    def test_rrf_rejects_duplicate_label_within_branch(self):
        duplicate = [RankedLabel("1_01", 1, 1.0), RankedLabel("1_01", 2, 0.9)]
        with self.assertRaises(ValueError):
            reciprocal_rank_fusion({"dense": duplicate})

    def test_complete_ranking_has_50_unique_labels(self):
        dense = [RankedLabel(eval_id, rank, 1 / rank) for rank, eval_id in enumerate(EXPECTED_EVAL_IDS, 1)]
        sparse = list(reversed([RankedLabel(eval_id, rank, 1 / rank) for rank, eval_id in enumerate(EXPECTED_EVAL_IDS, 1)]))
        sparse = [RankedLabel(item.eval_id, rank, item.score) for rank, item in enumerate(sparse, 1)]
        fused = reciprocal_rank_fusion({"dense": dense, "sparse": sparse})
        self.assertEqual(len(fused), 50)
        self.assertEqual(len({item.eval_id for item in fused}), 50)


if __name__ == "__main__":
    unittest.main()
