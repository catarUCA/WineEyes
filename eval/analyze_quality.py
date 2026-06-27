import csv, json
from collections import defaultdict

KEY = "data/blind_key.csv"
BLANK = "data/calidad_scoring_blank.csv"
ANNOTATOR_A = "data/quality_scoring_annotator_a.csv"
ANNOTATOR_B = "data/quality_scoring_annotator_b.csv"
OUTPUT = "results/quality_metrics.json"

GROUP_MAP = {
    "animales": "Animals",
    "dibujos_clasicos": "Classic drawings",
    "etiquetas_actuales": "Modern labels",
    "personajes_ilustres": "Illustrious figures",
    "solo_texto": "Text only",
}

EJES = ["A_fidelidad", "B_iconografia", "C_completitud"]


def load_key():
    return {r["modelo_ciego"]: r["modelo_real"] for r in csv.DictReader(open(KEY, encoding="utf-8"))}


def load_scores(path, key):
    rows = csv.DictReader(open(path, encoding="utf-8"))
    out = {}
    for r in rows:
        model = key.get(r["modelo_ciego"], r["modelo_ciego"])
        scores = {}
        for eje in EJES:
            v = r[eje].strip()
            scores[eje] = int(v) if v else None
        hal = r.get("n_alucinaciones", "").strip()
        scores["n_alucinaciones"] = int(hal) if hal else None
        out[(r["id"], model)] = scores
    return out


def has_scores(entry):
    return all(entry[e] is not None for e in EJES) and any(entry[e] > 0 for e in EJES)


def mean_std(vals):
    n = len(vals)
    if n == 0:
        return None, None, n
    m = sum(vals) / n
    if n < 2:
        return m, None, n
    var = sum((v - m) ** 2 for v in vals) / (n - 1)
    return m, var ** 0.5, n


def main():
    key = load_key()
    annotator_a = load_scores(ANNOTATOR_A, key)
    annotator_b = load_scores(ANNOTATOR_B, key)
    blank  = load_scores(BLANK, key)

    # Invalid rows from the primary annotation file count as model errors.
    all_keys = set(annotator_a.keys()) | set(annotator_b.keys()) | set(blank.keys())

    # Build per-model, per-group data
    # Aggregate valid scores by model and sample group.
    per_model_group = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    errors_by_model_group = defaultdict(lambda: defaultdict(int))
    total_by_model_group = defaultdict(lambda: defaultdict(int))

    all_ids = sorted(set(k[0] for k in all_keys))

    # Determine the group for each sample identifier.
    id_groups = {}
    for path in [ANNOTATOR_A, ANNOTATOR_B, BLANK]:
        for r in csv.DictReader(open(path, encoding="utf-8")):
            id_groups[r["id"]] = r["grupo"]

    # Check whether each primary annotation row contains valid scores.
    for (iid, model), scores in annotator_a.items():
        grupo = id_groups.get(iid, "desconocido")
        total_by_model_group[model][grupo] += 1
        if not has_scores(scores):
            errors_by_model_group[model][grupo] += 1
        else:
            for eje in EJES:
                per_model_group[model][grupo][eje].append(scores[eje])
            if scores["n_alucinaciones"] is not None:
                per_model_group[model][grupo]["n_alucinaciones"].append(scores["n_alucinaciones"])

    output = {}
    for model in sorted(per_model_group.keys()):
        model_data = {}
        for grupo_raw, group_en in GROUP_MAP.items():
            axes = per_model_group[model].get(grupo_raw, {})
            row = {}
            for eje in EJES:
                vals = axes.get(eje, [])
                m, s, n = mean_std(vals)
                row[f"{eje}_mean"] = round(m, 2) if m is not None else None
                row[f"{eje}_std"] = round(s, 2) if s is not None else None
            hal_vals = axes.get("n_alucinaciones", [])
            row["hal_mean"] = round(sum(hal_vals) / len(hal_vals), 2) if hal_vals else None
            row["errors"] = errors_by_model_group[model].get(grupo_raw, 0)
            row["total"] = total_by_model_group[model].get(grupo_raw, 0)
            model_data[group_en] = row

        # Overall
        overall = {}
        for eje in EJES:
            all_vals = []
            for grupo_raw in GROUP_MAP:
                all_vals.extend(per_model_group[model].get(grupo_raw, {}).get(eje, []))
            m, s, n = mean_std(all_vals)
            overall[f"{eje}_mean"] = round(m, 2) if m is not None else None
            overall[f"{eje}_std"] = round(s, 2) if s is not None else None
        all_hal = []
        for grupo_raw in GROUP_MAP:
            all_hal.extend(per_model_group[model].get(grupo_raw, {}).get("n_alucinaciones", []))
        overall["hal_mean"] = round(sum(all_hal) / len(all_hal), 2) if all_hal else 0.0
        overall["errors"] = sum(errors_by_model_group[model].values())
        overall["total"] = sum(total_by_model_group[model].values())
        model_data["Overall"] = overall
        output[model] = model_data

    import os
    os.makedirs("results", exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"[ok] {OUTPUT}")

    # Print summary
    for model in sorted(output):
        print(f"\n=== {model} ===")
        for group in [v for v in GROUP_MAP.values()] + ["Overall"]:
            r = output[model][group]
            vals = []
            for eje in EJES:
                m = r.get(f"{eje}_mean")
                if m is None:
                    vals.append("---")
                else:
                    s = r.get(f"{eje}_std") or 0
                    vals.append(f"{m:.2f}±{s:.2f}")
            hal = r.get("hal_mean")
            err = f"{r['errors']}/{r['total']}"
            print(f"  {group:25s}  {'  '.join(vals)}  hal={hal}  err={err}")


if __name__ == "__main__":
    main()
