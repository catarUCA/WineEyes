"""
BM25 and CLIP baselines on the 50-image evaluation sample.
Runs searches, saves rankings, then recompute_metrics handles the rest.
"""
import csv
import json
import re
import sys
import os
import unicodedata
from collections import defaultdict

import numpy as np
from rank_bm25 import BM25Okapi

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "source", "Sistema-de-catalogacion-de-imagenes"))

from eval.utils import get_rs, ensure_dirs, ClipExtractor
from eval.folder_sample import load_folder_sample

CACHE = "data/ablation_cache.json"
QUERIES = "data/queries.csv"
RANKINGS = "results/rankings.json"
K = 10


def _tok(text):
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    return re.findall(r"[a-z0-9]+", text.lower())


def build_bm25(cache, field="vlm_fusion"):
    with open(cache, encoding="utf-8") as f:
        data = json.load(f)
    docs, ids = [], []
    for img_id in sorted(data[field].keys()):
        ids.append(img_id)
        docs.append(_tok(data[field][img_id]))
    return BM25Okapi(docs), ids


def bm25_search(bm25, ids, query, k=K):
    scores = bm25.get_scores(_tok(query))
    order = np.argsort(scores)[::-1][:k]
    return [(ids[i], float(scores[i])) for i in order]


def clip_search_local(rs, query, sample, k=K):
    cl = ClipExtractor(rs)
    qvec = cl.encode_text(query)
    qvec = qvec / np.linalg.norm(qvec)
    results = []
    for r in sample:
        try:
            ivec = cl.extract_features(r["path"])
            ivec = ivec / np.linalg.norm(ivec)
            sim = float(np.dot(qvec, ivec))
            results.append((r["id"], sim))
        except Exception:
            pass
    results.sort(key=lambda x: -x[1])
    return results[:k]


def load_queries(path=QUERIES):
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main():
    rs = get_rs()
    sample = load_folder_sample()

    # BM25 on two fields: OCR text and fusion descriptions
    bm25_ocr, ocr_ids = build_bm25(CACHE, field="ocr")
    bm25_fusion, fusion_ids = build_bm25(CACHE, field="vlm_fusion")

    queries = load_queries(QUERIES)

    # Load existing rankings (from ablation) and add baselines
    rankings = json.load(open(RANKINGS)) if os.path.exists(RANKINGS) else defaultdict(dict)

    for q in queries:
        qid, text = q["query_id"], q["query"]

        # BM25 on OCR
        ocr_hits = bm25_search(bm25_ocr, ocr_ids, text)
        rankings[qid]["bm25_ocr"] = [h[0] for h in ocr_hits]

        # BM25 on fusion descriptions
        fusion_hits = bm25_search(bm25_fusion, fusion_ids, text)
        rankings[qid]["bm25_fusion"] = [h[0] for h in fusion_hits]

        # CLIP zero-shot
        clip_hits = clip_search_local(rs, text, sample)
        rankings[qid]["clip_zeroshot"] = [h[0] for h in clip_hits]

    ensure_dirs()
    with open(RANKINGS, "w") as f:
        json.dump(rankings, f, indent=2)
    print(f"Baselines merged into {RANKINGS}")
    for qid, by_sys in rankings.items():
        print(f"  {qid}: {list(by_sys.keys())}")


if __name__ == "__main__":
    main()
