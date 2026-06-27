"""
Recompute metrics from existing rankings including both P@5 and P@10.
"""
import json, csv, os, sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "source", "Sistema-de-catalogacion-de-imagenes"))
from eval.metrics import (ndcg_at_k, average_precision, precision_at_k, mrr)

RANKINGS = "results/rankings.json"
QRELS = "data/qrels.json"
QUERIES = "data/queries.csv"
METRICS = "results/retrieval_metrics.json"
K = 10

rankings = json.load(open(RANKINGS))
qrels_all = json.load(open(QRELS))

queries = list(csv.DictReader(open(QUERIES, encoding="utf-8")))
qtype = {q["query_id"]: q.get("type", "todas") for q in queries}

glob = defaultdict(lambda: defaultdict(list))
bytype = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
for qid, by_sys in rankings.items():
    qrels = {str(i): int(g) for i, g in qrels_all.get(qid, {}).items()}
    if not qrels:
        continue
    for sysname, ranked in by_sys.items():
        vals = {
            "ndcg": ndcg_at_k(ranked, qrels, K),
            "map": average_precision(ranked, qrels),
            "p5": precision_at_k(ranked, qrels, 5),
            "p10": precision_at_k(ranked, qrels, 10),
            "mrr": mrr(ranked, qrels),
        }
        for m, v in vals.items():
            glob[sysname][m].append(v)
            bytype[qtype[qid]][sysname][m].append(v)

def mean(vals):
    return sum(vals) / len(vals) if vals else 0.0

output = {}
metric_keys = ["ndcg", "map", "p5", "p10", "mrr"]
for sysname, m in glob.items():
    output[sysname] = {"aggregate": {x: mean(m[x]) for x in metric_keys}}
    for qtyp, d in bytype.items():
        if sysname in d:
            output[sysname][qtyp] = {x: mean(d[sysname][x]) for x in metric_keys}

with open(METRICS, "w") as f:
    json.dump(output, f, indent=2)

# Print summary aggregated
print(f"{'system':16s} | nDCG   mAP    P@5    P@10   MRR")
for sysname in output:
    ag = output[sysname]["aggregate"]
    print(f"{sysname:16s} | {ag['ndcg']:.3f}  {ag['map']:.3f}  {ag['p5']:.3f}  {ag['p10']:.3f}  {ag['mrr']:.3f}")

for qtyp in sorted(bytype):
    print(f"\n  === {qtyp} ===")
    for sysname in sorted(bytype[qtyp].keys()):
        d = output[sysname].get(qtyp, {})
        vals = [f"{d.get(m, 0):.3f}" for m in metric_keys]
        print(f"  {sysname:16s} | {'  '.join(vals)}")

print(f"\nSaved to {METRICS}")
print(f"Systems: {list(output.keys())}")
