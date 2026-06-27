import csv
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "source", "Sistema-de-catalogacion-de-imagenes"))

import numpy as np
from PIL import Image

from eval.utils import get_rs, resolve_paths, ClipExtractor


def clip_sim(rs, clip, path_a, path_b):
    fa = clip.extract_features(Image.open(path_a).convert("RGB"))
    fb = clip.extract_features(Image.open(path_b).convert("RGB"))
    return float(np.dot(fa, fb))


def main(gt="data/duplicados_gt.csv"):
    rs = get_rs()
    clip = ClipExtractor(rs)
    pairs = list(csv.DictReader(open(gt, encoding="utf-8")))
    ids = {int(r[k]) for r in pairs for k in ("img_id_a", "img_id_b")}
    paths = resolve_paths(rs, ids)

    sims, labels = [], []
    for r in pairs:
        a, b = int(r["img_id_a"]), int(r["img_id_b"])
        sims.append(clip_sim(rs, clip, paths[a], paths[b]))
        labels.append(int(r["es_duplicado_0_1"]))
    sims, labels = np.array(sims), np.array(labels)

    print(f"{'umbral':8s}  precision  recall   F1")
    for thr in np.arange(0.80, 0.991, 0.01):
        pred = sims >= thr
        tp = int((pred & (labels == 1)).sum())
        fp = int((pred & (labels == 0)).sum())
        fn = int((~pred & (labels == 1)).sum())
        prec = tp / (tp + fp) if tp + fp else 0
        rec = tp / (tp + fn) if tp + fn else 0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0
        print(f"{thr:8.2f}  {prec:9.3f}  {rec:6.3f}  {f1:.3f}")


if __name__ == "__main__":
    main()
