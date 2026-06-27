from __future__ import annotations

import unittest

from eval.metrics import metrics_for_ranking, ndcg_at_k, precision_at_k


class MetricTests(unittest.TestCase):
    def test_ndcg_at_10_binary(self):
        ranking = ["1_01", "1_02", "1_03"]
        gains = {"1_01": 1, "1_03": 1}
        self.assertAlmostEqual(ndcg_at_k(ranking, gains, 10), 0.9197207891)

    def test_map_and_map_at_10_are_separate(self):
        ranking = [f"1_{index:02d}" for index in range(1, 11)] + ["2_01"]
        qrels = {"2_01": 1}
        metrics = metrics_for_ranking(ranking, qrels, qrels, complete=True)
        self.assertAlmostEqual(metrics["map"], 1 / 11)
        self.assertEqual(metrics["map_at_10"], 0.0)

    def test_mrr_and_mrr_at_10_are_separate(self):
        ranking = [f"1_{index:02d}" for index in range(1, 11)] + ["2_01"]
        qrels = {"2_01": 1}
        metrics = metrics_for_ranking(ranking, qrels, qrels, complete=True)
        self.assertAlmostEqual(metrics["mrr"], 1 / 11)
        self.assertEqual(metrics["mrr_at_10"], 0.0)

    def test_precision_at_10(self):
        ranking = [f"1_{index:02d}" for index in range(1, 11)]
        qrels = {"1_01": 1, "1_10": 1}
        self.assertEqual(precision_at_k(ranking, qrels, 10), 0.2)

    def test_partial_ranking_marks_full_metrics_unavailable(self):
        ranking = ["1_01"]
        qrels = {"1_01": 1}
        metrics = metrics_for_ranking(ranking, qrels, qrels, complete=False)
        self.assertIsNone(metrics["map"])
        self.assertIsNone(metrics["mrr"])
        self.assertEqual(metrics["map_at_10"], 1.0)
        self.assertEqual(metrics["mrr_at_10"], 1.0)


if __name__ == "__main__":
    unittest.main()

