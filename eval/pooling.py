import csv
import json
import os
from collections import defaultdict

from eval.utils import ensure_dirs

DEPTH = 20
RANKINGS = "results/rankings.json"
POOL = "data/pool_para_anotar.csv"
QRELS = "data/qrels.json"


def build_pool():
    rankings = json.load(open(RANKINGS))
    ensure_dirs()
    with open(POOL, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["query_id", "img_id", "relevante_0_1"])
        w.writeheader()
        for qid, by_sys in rankings.items():
            pool = set()
            for ranked in by_sys.values():
                pool.update(ranked[:DEPTH])
            for img_id in sorted(pool):
                w.writerow({"query_id": qid, "img_id": img_id, "relevante_0_1": ""})
    print(f"Pool exportado a {POOL}")


def pool_to_qrels():
    qrels = defaultdict(dict)
    with open(POOL, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            rel = (r["relevante_0_1"] or "").strip()
            if rel in ("1", "2", "3"):
                qrels[r["query_id"]][r["img_id"]] = int(rel)
    json.dump(qrels, open(QRELS, "w"), indent=2)
    if os.path.exists(QRELS):
        print(f"qrels escrito en {QRELS} ({sum(len(v) for v in qrels.values())} juicios)")


if __name__ == "__main__":
    import sys
    pool_to_qrels() if "--to-qrels" in sys.argv else build_pool()
