from __future__ import annotations

import json
import statistics
import unittest

from eval.config import LEGACY_METRICS_PATH, LEGACY_RANKINGS_PATH
from eval.data_io import load_qrels
from eval.metrics import metrics_for_ranking


class LegacyMetricTests(unittest.TestCase):
    def test_reproduces_historical_top10_metrics(self):
        rankings = json.loads(LEGACY_RANKINGS_PATH.read_text(encoding="utf-8"))
        stored = json.loads(LEGACY_METRICS_PATH.read_text(encoding="utf-8"))
        gains, binary, _ = load_qrels()
        for system_name in stored:
            rows = []
            for query_id in sorted(rankings):
                rows.append(
                    metrics_for_ranking(
                        rankings[query_id][system_name], gains[query_id], binary[query_id], complete=False
                    )
                )
            self.assertAlmostEqual(statistics.fmean(row["ndcg_at_10"] for row in rows), stored[system_name]["aggregate"]["ndcg"])
            self.assertAlmostEqual(statistics.fmean(row["map_at_10"] for row in rows), stored[system_name]["aggregate"]["map"])
            self.assertAlmostEqual(statistics.fmean(row["p_at_5"] for row in rows), stored[system_name]["aggregate"]["p5"])
            self.assertAlmostEqual(statistics.fmean(row["p_at_10"] for row in rows), stored[system_name]["aggregate"]["p10"])
            self.assertAlmostEqual(statistics.fmean(row["mrr_at_10"] for row in rows), stored[system_name]["aggregate"]["mrr"])


if __name__ == "__main__":
    unittest.main()

