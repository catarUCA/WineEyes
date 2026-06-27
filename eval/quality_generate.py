import csv
import random
import time

import feature_extractor as fe
from eval.folder_sample import load_folder_sample
from eval.utils import ensure_dirs

FINALISTAS = ["gemma4:26b", "qwen3-vl:8b"]
SEED = 7


def _es_fallo(desc):
    if not desc or desc.strip() == "":
        return True
    if desc.strip() == "ERROR":
        return True
    if len(desc.strip()) < 200:
        return True
    if not desc.strip().startswith("Texto propio de la etiqueta:"):
        return True
    return False


def generar():
    ensure_dirs()
    sample = load_folder_sample()
    ocr_cache = {r["id"]: fe.ocr_image(r["path"]) for r in sample}
    rows = []
    with open("data/descripciones.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["id", "grupo", "modelo", "descripcion",
                                          "latencia_s", "fallo"])
        w.writeheader()
        for modelo in FINALISTAS:
            fe.VISION_MODEL = modelo
            for r in sample:
                t0, fallo = time.perf_counter(), 0
                try:
                    desc = fe.describe_image(r["path"], ocr_cache[r["id"]])
                except Exception as e:
                    desc, fallo = f"ERROR: {e}", 1
                if fallo == 0 and _es_fallo(desc):
                    fallo = 1
                dt = round(time.perf_counter() - t0, 2)
                w.writerow({"id": r["id"], "grupo": r["grupo"], "modelo": modelo,
                            "descripcion": desc, "latencia_s": dt, "fallo": fallo})
                rows.append((r["id"], r["grupo"], modelo, desc))
                print(f"{modelo} {r['id']}: {dt}s  fallo={fallo}")
    return rows


def hoja_ciega(rows):
    rng = random.Random(SEED)
    blind, key = [], []
    for i, (iid, grupo, modelo, desc) in enumerate(rows):
        et = f"M{rng.randint(1000, 9999)}_{i}"
        blind.append({"id": iid, "grupo": grupo, "modelo_ciego": et, "descripcion": desc,
                      "A_fidelidad": "", "B_iconografia": "", "C_completitud": "",
                      "n_alucinaciones": "", "notas": ""})
        key.append({"modelo_ciego": et, "modelo_real": modelo})
    rng.shuffle(blind)
    with open("data/calidad_scoring_blank.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(blind[0].keys()))
        w.writeheader(); w.writerows(blind)
    with open("data/blind_key.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["modelo_ciego", "modelo_real"])
        w.writeheader(); w.writerows(key)
    print("Hoja ciega y clave generadas.")


if __name__ == "__main__":
    hoja_ciega(generar())
