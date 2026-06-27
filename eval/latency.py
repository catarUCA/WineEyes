import csv
from collections import defaultdict

import numpy as np


def main(path="data/lat_prod.csv"):
    d = defaultdict(list)
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            d[r["etapa"]].append(float(r["segundos"]))
    print(f"{'etapa':14s}  n     p50     p95")
    for etapa in sorted(d.keys()):
        vals = d[etapa]
        v = np.array(vals)
        print(f"{etapa:14s}  {len(v):4d}  {np.percentile(v, 50):6.2f}  {np.percentile(v, 95):6.2f}")


if __name__ == "__main__":
    main()
