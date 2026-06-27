import csv
import os

import feature_extractor as fe
from eval.folder_sample import load_folder_sample
from eval.utils import ensure_dirs

OUT = "data/ocr_pred.csv"


def main():
    ensure_dirs()
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["id", "texto_ocr"])
        w.writeheader()
        for r in load_folder_sample():
            try:
                texto = fe.ocr_image(r["path"])
            except Exception as e:
                texto = f"ERROR: {e}"
            w.writerow({"id": r["id"], "texto_ocr": texto})
            print(f"OCR {r['id']}: {texto[:60]!r}")
    print(f"OCR en {OUT}")


if __name__ == "__main__":
    main()
