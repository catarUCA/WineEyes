import csv
import os
import re

BASE = os.path.join(os.path.dirname(__file__), "muestra")
GROUP_MAP = {"1": "solo_texto", "2": "dibujos_clasicos", "3": "personajes_ilustres",
             "4": "etiquetas_actuales", "5": "animales"}
EXTS = (".png", ".jpg", ".jpeg", ".webp")


def _natkey(s):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", str(s))]


def load_folder_sample(base=BASE):
    rows = []
    for folder in sorted(GROUP_MAP, key=_natkey):
        d = os.path.join(base, folder)
        if not os.path.isdir(d):
            continue
        files = sorted([f for f in os.listdir(d) if f.lower().endswith(EXTS)], key=_natkey)
        for i, fname in enumerate(files, 1):
            rows.append({"id": f"{folder}_{i:02d}", "grupo": GROUP_MAP[folder],
                         "path": os.path.join(d, fname), "filename": fname,
                         "legibilidad": "", "fondo": "", "forma": ""})
    return rows


def export_sample_csv(out="data/muestra_50.csv"):
    rows = load_folder_sample()
    os.makedirs("data", exist_ok=True)
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["id", "grupo", "legibilidad", "fondo", "forma",
                                           "path", "filename"])
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)} etiquetas en {out}. Rellena legibilidad / fondo / forma.")


if __name__ == "__main__":
    export_sample_csv()
