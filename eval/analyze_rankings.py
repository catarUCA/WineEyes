"""Compute Jaccard overlap between system top-10 rankings per query.

Writes results/rankings_overlap.json with per-query and mean Jaccard values
for pairs of retrieval systems.
"""
import json
from collections import defaultdict
from eval.utils import ensure_dirs

RANKINGS = "results/rankings.json"
OUTPUT   = "results/rankings_overlap.json"


def jaccard(a, b):
    sa, sb = set(a), set(b)
    return len(sa & sb) / len(sa | sb) if sa | sb else 0.0


def main():
    rankings = json.load(open(RANKINGS))
    pairs = [("solo_ocr", "solo_vlm"), ("solo_ocr", "ocr_vlm"), ("solo_vlm", "ocr_vlm")]
    per_query = defaultdict(dict)
    all_pairs = defaultdict(list)

    for qid, by_sys in rankings.items():
        for p1, p2 in pairs:
            j = jaccard(by_sys[p1], by_sys[p2])
            per_query[qid][f"{p1}_vs_{p2}"] = round(j, 4)
            all_pairs[f"{p1}_vs_{p2}"].append(j)

    mean = {k: round(sum(v) / len(v), 4) for k, v in all_pairs.items()}
    mean_by_query = {
        k: round(sum(per_query[q][k] for q in per_query) / len(per_query), 4)
        for k in all_pairs
    }

    output = {"per_query": per_query, "mean": mean}
    ensure_dirs()
    with open(OUTPUT, "w") as f:
        json.dump(output, f, indent=2)
    print(f"[ok] {OUTPUT}")
    for k in mean:
        vals = []
        for q in sorted(per_query):
            vals.append(f"{q}={per_query[q][k]:.4f}")
        print(f"  {k}: mean={mean[k]:.4f}  ({' '.join(vals)})")


if __name__ == "__main__":
    main()
