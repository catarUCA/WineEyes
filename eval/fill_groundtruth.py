import csv
import shutil

PRED = "data/ocr_pred.csv"
GT = "data/ocr_groundtruth.csv"


def main():
    pred_rows = list(csv.DictReader(open(PRED, encoding="utf-8")))
    if not pred_rows:
        print(f"{PRED} vacio. Ejecuta la fase 3 primero.")
        return

    backup = GT.replace(".csv", "_backup.csv")
    shutil.copyfile(GT, backup)
    print(f"Backup de ground truth original en {backup}")

    pred_dict = {r["id"]: r["texto_ocr"] for r in pred_rows}
    gt_rows = list(csv.DictReader(open(GT, encoding="utf-8")))

    written = 0
    for gt_row in gt_rows:
        if gt_row["id"] in pred_dict and pred_dict[gt_row["id"]]:
            if not gt_row["texto_referencia"].strip():
                gt_row["texto_referencia"] = pred_dict[gt_row["id"]]
                written += 1

    fieldnames = ["id", "texto_referencia"]
    with open(GT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(gt_rows)

    print(f"Rellenadas {written} filas desde {PRED} -> {GT}")
    print("Revisa y corrige a mano las transcripciones generadas por OCR.")


if __name__ == "__main__":
    main()
