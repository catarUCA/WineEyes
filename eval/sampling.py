import csv
import random

from eval.utils import get_rs, ensure_dirs, iter_all_images

GRUPOS = ["solo_texto", "dibujos_clasicos", "personajes_ilustres",
          "etiquetas_actuales", "animales"]
POR_GRUPO = 10
SEED = 10062026


def plantilla_vacia(path="data/muestra_50.csv"):
    ensure_dirs()
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["img_id", "grupo", "legibilidad"])
        w.writeheader()
        for g in GRUPOS:
            for _ in range(POR_GRUPO):
                w.writerow({"img_id": "", "grupo": g, "legibilidad": ""})
    print(f"Plantilla en {path}: rellena img_id y legibilidad por grupo.")


def candidatos_aleatorios(n=200, path="data/candidatos.csv"):
    rs = get_rs()
    todos = [(iid, p) for iid, p, _ in iter_all_images(rs, with_description=False)]
    random.Random(SEED).shuffle(todos)
    ensure_dirs()
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["img_id", "path", "grupo", "legibilidad"])
        for iid, p in todos[:n]:
            w.writerow([iid, p, "", ""])
    print(f"{min(n, len(todos))} candidatos en {path} (semilla {SEED}).")


if __name__ == "__main__":
    plantilla_vacia()
    candidatos_aleatorios()
