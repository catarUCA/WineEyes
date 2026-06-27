from eval.metrics import ndcg_at_k, average_precision, precision_at_k, mrr

ranked = [1, 2, 3, 4]
qrels = {1: 1, 3: 1}
assert abs(precision_at_k(ranked, qrels, 2) - 0.5) < 1e-9
assert abs(mrr(ranked, qrels) - 1.0) < 1e-9
assert abs(average_precision(ranked, qrels) - 0.8333333) < 1e-6
assert abs(ndcg_at_k(ranked, qrels, 4) - 0.91972) < 1e-4
print("metrics OK")
