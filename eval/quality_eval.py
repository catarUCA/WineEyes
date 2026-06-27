import csv
from collections import defaultdict

from sklearn.metrics import cohen_kappa_score

from eval.metrics import bootstrap_ci

EJES = ["A_fidelidad", "B_iconografia", "C_completitud"]


def cargar(path):
    return {(r["id"], r["modelo_ciego"]): r for r in csv.DictReader(open(path, encoding="utf-8"))}


def main(hoja_a, hoja_b, key="data/blind_key.csv"):
    a, b = cargar(hoja_a), cargar(hoja_b)
    clave = {r["modelo_ciego"]: r["modelo_real"] for r in csv.DictReader(open(key, encoding="utf-8"))}
    comunes = sorted(set(a) & set(b))

    print("== Kappa de Cohen ponderado (cuadratico) por eje ==")
    for eje in EJES:
        va = [int(a[c][eje]) for c in comunes if a[c][eje] and b[c][eje]]
        vb = [int(b[c][eje]) for c in comunes if a[c][eje] and b[c][eje]]
        k = cohen_kappa_score(va, vb, weights="quadratic")
        print(f"  {eje:16s} kappa={k:.3f} (n={len(va)})")

    print("\n== Medias por modelo real (consenso = promedio de anotadores) ==")
    por_modelo = defaultdict(lambda: defaultdict(list))
    halluc = defaultdict(list)
    for c in comunes:
        modelo = clave[c[1]]
        for eje in EJES:
            if a[c][eje] and b[c][eje]:
                por_modelo[modelo][eje].append((int(a[c][eje]) + int(b[c][eje])) / 2)
        if a[c]["n_alucinaciones"] and b[c]["n_alucinaciones"]:
            halluc[modelo].append((int(a[c]["n_alucinaciones"]) + int(b[c]["n_alucinaciones"])) / 2)
    for modelo, ejes in por_modelo.items():
        print(f"\n  Modelo {modelo}:")
        for eje in EJES:
            m, lo, hi = bootstrap_ci(ejes[eje])
            print(f"    {eje:16s} media={m:.2f}  IC95=[{lo:.2f},{hi:.2f}]")
        if halluc[modelo]:
            print(f"    alucinaciones/desc = {sum(halluc[modelo])/len(halluc[modelo]):.2f}")


if __name__ == "__main__":
    import sys
    main(sys.argv[1], sys.argv[2])
