import csv
from collections import defaultdict


def main(desc="data/descripciones.csv"):
    lat, fallos, n = defaultdict(list), defaultdict(int), defaultdict(int)
    for r in csv.DictReader(open(desc, encoding="utf-8")):
        lat[r["modelo"]].append(float(r["latencia_s"]))
        fallos[r["modelo"]] += int(r["fallo"])
        n[r["modelo"]] += 1
    print(f"{'modelo':16s}  lat_media  lat_p95   fallos")
    for m in sorted(lat.keys()):
        s = sorted(lat[m])
        p95 = s[max(0, int(len(s) * 0.95) - 1)]
        avg = sum(s) / len(s)
        print(f"{m:16s}  {avg:8.2f}  {p95:7.2f}   {fallos[m]}/{n[m]}")
    print("\nCombinar a mano con las medias de calidad (Tarea 10) "
          "para la tabla final calidad x coste.")


if __name__ == "__main__":
    main()
