"""Measure per-image ingestion cost (OCR and VLM) on the 50-label sample.

Runs the real OCR and vision-language calls through feature_extractor against
the containerised Ollama, timing each stage with a wall clock. Writes a
per-image CSV and prints aggregate statistics for the manuscript.

Run exactly like eval.crop_eval (same environment):

    $env:PYTHONPATH  = "C:\\Users\\User\\Documents\\ProyectoEtiquetas\\eval"
    $env:OCR_MODEL    = "glm-ocr:latest"
    $env:VISION_MODEL = "gemma4:26b"
    $env:OLLAMA_HOST  = "http://localhost:11434"
    python -m eval.measure_ingestion
"""

import csv
import statistics
import time

import feature_extractor as fe
from eval.folder_sample import load_folder_sample

OUT_CSV = "results/ingestion_cost.csv"


def _p(values, q):
    s = sorted(values)
    if not s:
        return 0.0
    k = (len(s) - 1) * q
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def main() -> int:
    sample = load_folder_sample()
    print(f"Loaded {len(sample)} labels\n")

    # Warm-up on the first image so model-load time does not enter the means.
    warm = sample[0]["path"]
    print("Warming up models (discarded)…")
    t = time.perf_counter()
    ocr0 = fe.ocr_image(warm)
    fe.describe_image(warm, ocr0)
    print(f"  warm-up done in {time.perf_counter() - t:.1f} s\n")

    rows = []
    for i, r in enumerate(sample, 1):
        path = r["path"]
        t0 = time.perf_counter()
        ocr = fe.ocr_image(path)
        t1 = time.perf_counter()
        fe.describe_image(path, ocr)
        t2 = time.perf_counter()
        ocr_s, vlm_s = t1 - t0, t2 - t1
        rows.append({"id": r["id"], "ocr_s": round(ocr_s, 3), "vlm_s": round(vlm_s, 3),
                     "total_s": round(ocr_s + vlm_s, 3)})
        print(f"[{i:2d}/{len(sample)}] {r['id']:>6}  OCR={ocr_s:6.2f}s  VLM={vlm_s:6.2f}s")

    ensure = __import__("os").makedirs
    ensure("results", exist_ok=True)
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["id", "ocr_s", "vlm_s", "total_s"])
        w.writeheader()
        w.writerows(rows)

    ocr = [x["ocr_s"] for x in rows]
    vlm = [x["vlm_s"] for x in rows]
    tot = [x["total_s"] for x in rows]
    n = len(rows)

    def line(name, v):
        print(f"  {name:14s} mean={statistics.fmean(v):6.2f}s  "
              f"median={statistics.median(v):6.2f}s  p95={_p(v, 0.95):6.2f}s  "
              f"sum={sum(v):7.1f}s")

    print(f"\n== Ingestion cost over {n} labels (OCR + VLM, per image) ==")
    line("OCR", ocr)
    line("VLM", vlm)
    line("OCR+VLM", tot)
    print(f"\n  total OCR+VLM for the {n}-label sample: {sum(tot)/60:.1f} min")
    print(f"  wrote {OUT_CSV}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
