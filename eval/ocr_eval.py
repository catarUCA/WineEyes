import csv
import re
import unicodedata
from collections import Counter, defaultdict

import jiwer

from eval.folder_sample import load_folder_sample


def normalize(text):
    text = (text or "").lower().strip()
    text = unicodedata.normalize("NFC", text)
    text = re.sub(r"[^\w\sáéíóúüñ]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def tokens(text):
    return normalize(text).split()


def token_prf(ref, hyp):
    r, h = Counter(tokens(ref)), Counter(tokens(hyp))
    tp = sum((r & h).values())
    prec = tp / sum(h.values()) if sum(h.values()) else 0.0
    rec = tp / sum(r.values()) if sum(r.values()) else 0.0
    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
    return prec, rec, f1


def cer_wer(ref, hyp):
    r, h = normalize(ref), normalize(hyp)
    return (jiwer.cer(r, h), jiwer.wer(r, h)) if r else (None, None)


def evaluate(gt="data/ocr_groundtruth.csv", pred="data/ocr_pred.csv"):
    ref = {r["id"]: r["texto_referencia"] for r in csv.DictReader(open(gt, encoding="utf-8"))}
    hyp = {r["id"]: r["texto_ocr"] for r in csv.DictReader(open(pred, encoding="utf-8"))}
    meta = {r["id"]: r for r in load_folder_sample()}
    by_group, by_leg, allrows = defaultdict(list), defaultdict(list), []
    for iid, rtext in ref.items():
        if iid not in hyp:
            continue
        cer, wer = cer_wer(rtext, hyp[iid])
        if cer is None:
            continue
        _, _, f1 = token_prf(rtext, hyp[iid])
        row = {"id": iid, "cer": cer, "wer": wer, "tokenF1": f1}
        allrows.append(row)
        by_group[meta[iid]["grupo"]].append(row)
        if meta[iid].get("legibilidad"):
            by_leg[meta[iid]["legibilidad"]].append(row)

    def agg(rows):
        n = len(rows)
        return {m: round(sum(r[m] for r in rows) / n, 3) for m in ("cer", "wer", "tokenF1")} if n else {}

    print("== Global ==", agg(allrows))
    for titulo, d in (("grupo", by_group), ("legibilidad", by_leg)):
        print(f"== Por {titulo} ==")
        for g, rows in d.items():
            print(f"  {g:22s} (n={len(rows)})", agg(rows))
    return allrows


if __name__ == "__main__":
    evaluate()
