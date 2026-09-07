"""Paired significance tests and bootstrap confidence intervals.

Reads results/rankings_full.json, recomputes per-query nDCG@10 and MAP@10 with
the same metric code as ``eval.evaluate_rankings`` (so figures match Table 2
exactly), and reports, over the 15 queries:

  * 95% percentile bootstrap confidence intervals per system, and
  * paired mean differences with bootstrap CIs, exact Wilcoxon signed-rank
    p-values, and sign-flip permutation p-values for the headline contrasts.

Outputs (generated; do not edit by hand):
  results/significance.csv          machine-readable summary
  results/table_significance.tex    LaTeX table for the manuscript
  results/table_perquery.tex        per-query nDCG@10 table

The analysis is deterministic (fixed RNG seed) and depends only on numpy.
"""

from __future__ import annotations

import csv
import sys

import numpy as np

from eval.config import (
    RANKINGS_FULL_PATH,
    METRICS_FULL_PATH,
    ensure_results_dir,
)
from eval.data_io import load_qrels, read_json
from eval.metrics import metrics_for_ranking
from eval.runtime import append_run_log

RESULTS_DIR = METRICS_FULL_PATH.parent
SIGNIFICANCE_CSV = RESULTS_DIR / "significance.csv"
SIGNIFICANCE_TEX = RESULTS_DIR / "table_significance.tex"
PERQUERY_TEX = RESULTS_DIR / "table_perquery.tex"

SEED = 20260619
N_BOOT = 10_000
N_PERM = 100_000
METRICS = ("ndcg_at_10", "map_at_10")

# Systems compared pairwise (first minus second).
CONTRASTS = (
    ("ocr_vlm_hybrid_segmented", "bm25_fusion"),
    ("ocr_vlm_hybrid_segmented", "ocr_vlm_hybrid_full"),
)
# Systems shown in the per-query table and with per-system CIs.
PERQUERY_SYSTEMS = (
    "solo_vlm",
    "ocr_vlm",
    "ocr_vlm_hybrid_full",
    "ocr_vlm_hybrid_segmented",
    "bm25_fusion",
)
LABELS = {
    "solo_ocr": "OCR dense",
    "solo_vlm": "VLM dense",
    "ocr_vlm": "OCR+VLM dense",
    "ocr_vlm_hybrid_full": "Hybrid, full",
    "ocr_vlm_hybrid_segmented": "Hybrid, segmented",
    "bm25_ocr": "BM25 OCR",
    "bm25_fusion": "BM25 fusion",
    "clip_zeroshot": "CLIP zero-shot",
}
TYPE_SHORT = {
    "textual": "txt",
    "iconografica_simple": "icon.\\ simple",
    "iconografica_relacional": "icon.\\ rel.",
}
METRIC_LABEL = {"ndcg_at_10": "nDCG@10", "map_at_10": "MAP@10"}


def per_query_matrix(rankings, gains, binary):
    """Return {system: {metric: np.ndarray over queries}} and the query order."""
    qids = list(rankings["queries"].keys())
    acc: dict[str, dict[str, list]] = {}
    types: list[str] = []
    for qid in qids:
        types.append(rankings["queries"][qid]["type"])
        for system, record in rankings["queries"][qid]["systems"].items():
            values = metrics_for_ranking(
                record["eval_ids"], gains[qid], binary[qid], bool(record["complete"])
            )
            slot = acc.setdefault(system, {m: [] for m in METRICS})
            for metric in METRICS:
                slot[metric].append(float(values[metric]))
    matrix = {s: {m: np.asarray(v) for m, v in md.items()} for s, md in acc.items()}
    return matrix, qids, types


def boot_ci(x, rng, n_boot=N_BOOT, alpha=0.05):
    x = np.asarray(x)
    n = len(x)
    means = x[rng.integers(0, n, (n_boot, n))].mean(axis=1)
    return tuple(np.percentile(means, [100 * alpha / 2, 100 * (1 - alpha / 2)]))


def boot_ci_diff(x, y, rng, n_boot=N_BOOT, alpha=0.05):
    x = np.asarray(x)
    y = np.asarray(y)
    n = len(x)
    idx = rng.integers(0, n, (n_boot, n))
    diffs = (x[idx] - y[idx]).mean(axis=1)
    return float((x - y).mean()), tuple(np.percentile(diffs, [100 * alpha / 2, 100 * (1 - alpha / 2)]))


def perm_p(x, y, rng, n_perm=N_PERM):
    d = np.asarray(x) - np.asarray(y)
    obs = d.mean()
    n = len(d)
    signs = rng.integers(0, 2, (n_perm, n)) * 2 - 1
    dist = (d * signs).mean(axis=1)
    return float((np.sum(np.abs(dist) >= abs(obs) - 1e-12) + 1) / (n_perm + 1))


def wilcoxon_exact_p(x, y):
    """Two-sided exact Wilcoxon signed-rank p-value (average ranks, subset-sum DP).

    Matches scipy.stats.wilcoxon(mode='exact') on tie-free and tied inputs while
    depending only on numpy.
    """
    d = np.asarray(x, float) - np.asarray(y, float)
    d = d[d != 0]
    n = len(d)
    if n == 0:
        return float("nan")
    order = np.argsort(np.abs(d), kind="mergesort")
    absd = np.abs(d)[order]
    signs = np.sign(d)[order]
    ranks = np.empty(n)
    i = 0
    while i < n:
        j = i
        while j < n and absd[j] == absd[i]:
            j += 1
        ranks[i:j] = (i + j - 1) / 2 + 1
        i = j
    w_plus = ranks[signs > 0].sum()
    r2 = np.rint(ranks * 2).astype(int)      # exact half-integer arithmetic
    total = int(r2.sum())
    dist = np.zeros(total + 1)
    dist[0] = 1.0
    for v in r2:
        shifted = np.zeros_like(dist)
        shifted[v:] = dist[: total + 1 - v]
        dist = dist + shifted
    grid = np.arange(total + 1) / 2.0
    mean = r2.sum() / 4.0
    mask = np.abs(grid - mean) >= abs(w_plus - mean) - 1e-9
    return float(dist[mask].sum() / dist.sum())


def _fmt_ci(ci):
    return f"[{ci[0]:+.3f}, {ci[1]:+.3f}]"


def render_significance(matrix, rng):
    lines = [
        "% Generated by python -m eval.significance. Do not edit manually.",
        "\\begin{table*}[!h]",
        "\\centering",
        "\\resizebox{\\textwidth}{!}{%",
        "\\begin{tabular}{llccc}",
        "\\toprule",
        "\\textbf{Comparison} & \\textbf{Metric} & \\textbf{$\\Delta$ (95\\% CI)} & "
        "\\textbf{Wilcoxon $p$} & \\textbf{Perm. $p$} \\\\",
        "\\midrule",
    ]
    csv_rows = []
    any_sig = False
    for a, b in CONTRASTS:
        comp = f"{LABELS[a]} vs {LABELS[b]}"
        for k, metric in enumerate(METRICS):
            diff, ci = boot_ci_diff(matrix[a][metric], matrix[b][metric], rng)
            pw = wilcoxon_exact_p(matrix[a][metric], matrix[b][metric])
            pp = perm_p(matrix[a][metric], matrix[b][metric], rng)
            any_sig = any_sig or (pw < 0.05)
            cell = comp if k == 0 else ""
            lines.append(
                f"{cell} & {METRIC_LABEL[metric]} & ${diff:+.3f}$ {_fmt_ci(ci)} & "
                f"{pw:.2f} & {pp:.2f} \\\\"
            )
            csv_rows.append(
                {
                    "kind": "contrast",
                    "name": f"{a} vs {b}",
                    "metric": metric,
                    "value": f"{diff:.6f}",
                    "ci_low": f"{ci[0]:.6f}",
                    "ci_high": f"{ci[1]:.6f}",
                    "wilcoxon_p": f"{pw:.6f}",
                    "perm_p": f"{pp:.6f}",
                }
            )
        lines.append("\\addlinespace")
    lines[-1] = "\\bottomrule"
    verdict = (
        "No comparison is significant at $\\alpha=0.05$."
        if not any_sig
        else "Significance at $\\alpha=0.05$ is indicated in the table."
    )
    lines.extend(
        [
            "\\end{tabular}%",
            "}",
            "\\caption{Paired comparisons over the 15 queries. $\\Delta$ is the mean "
            "per-query difference (first system minus second) with a 95\\% percentile "
            "bootstrap confidence interval; $p$-values are two-sided (exact Wilcoxon "
            "signed-rank and sign-flip permutation, $10^5$ resamples). " + verdict + "}",
            "\\label{tab:significance}",
            "\\end{table*}",
            "",
        ]
    )
    # per-system CIs go to the CSV too
    for system in PERQUERY_SYSTEMS:
        for metric in METRICS:
            mean = float(matrix[system][metric].mean())
            ci = boot_ci(matrix[system][metric], rng)
            csv_rows.append(
                {
                    "kind": "system",
                    "name": system,
                    "metric": metric,
                    "value": f"{mean:.6f}",
                    "ci_low": f"{ci[0]:.6f}",
                    "ci_high": f"{ci[1]:.6f}",
                    "wilcoxon_p": "",
                    "perm_p": "",
                }
            )
    return "\n".join(lines), csv_rows


def render_perquery(matrix, qids, types):
    header = " & ".join(f"\\textbf{{{LABELS[s]}}}" for s in PERQUERY_SYSTEMS)
    lines = [
        "% Generated by python -m eval.significance. Do not edit manually.",
        "\\begin{table*}[!h]",
        "\\centering",
        "\\resizebox{\\textwidth}{!}{%",
        "\\begin{tabular}{ll" + "c" * len(PERQUERY_SYSTEMS) + "}",
        "\\toprule",
        f"\\textbf{{Query}} & \\textbf{{Type}} & {header} \\\\",
        "\\midrule",
    ]
    for i, qid in enumerate(qids):
        t = TYPE_SHORT.get(types[i], types[i])
        row = " & ".join(f"{matrix[s]['ndcg_at_10'][i]:.3f}" for s in PERQUERY_SYSTEMS)
        lines.append(f"{qid} & {t} & {row} \\\\")
    lines.append("\\midrule")
    means = " & ".join(f"\\textbf{{{matrix[s]['ndcg_at_10'].mean():.3f}}}" for s in PERQUERY_SYSTEMS)
    lines.append(f"\\textbf{{Mean}} & & {means} \\\\")
    lines.extend(
        [
            "\\bottomrule",
            "\\end{tabular}%",
            "}",
            "\\caption{Per-query nDCG@10 for representative configurations; full "
            "per-system scores are in \\texttt{results/metrics\\_by\\_query.csv}. "
            "Category means are over the five queries of each type.}",
            "\\label{tab:perquery}",
            "\\end{table*}",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    ensure_results_dir()
    append_run_log("significance started")
    if not RANKINGS_FULL_PATH.exists():
        print(f"ERROR: missing {RANKINGS_FULL_PATH}", file=sys.stderr)
        append_run_log("significance FAILED: rankings_full.json missing")
        return 1
    try:
        gains, binary, _ = load_qrels()
        matrix, qids, types = per_query_matrix(read_json(RANKINGS_FULL_PATH), gains, binary)
        rng = np.random.default_rng(SEED)
        sig_tex, csv_rows = render_significance(matrix, rng)
        SIGNIFICANCE_TEX.write_text(sig_tex, encoding="utf-8")
        PERQUERY_TEX.write_text(render_perquery(matrix, qids, types), encoding="utf-8")
        with SIGNIFICANCE_CSV.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=["kind", "name", "metric", "value", "ci_low", "ci_high", "wilcoxon_p", "perm_p"],
            )
            writer.writeheader()
            writer.writerows(csv_rows)
    except Exception as exc:  # noqa: BLE001
        append_run_log(f"significance FAILED: {type(exc).__name__}: {exc}")
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    append_run_log("significance completed")
    print(f"Wrote {SIGNIFICANCE_TEX}, {PERQUERY_TEX}, and {SIGNIFICANCE_CSV}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())