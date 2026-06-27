import csv
import os
import tempfile
from collections import defaultdict

import feature_extractor as fe
from eval.croppers import (Cropper, RembgSegmenter, GrabCutSegmenter, OtsuSegmenter,
                           geom_quad4, geom_minarearect)
from eval.folder_sample import load_folder_sample
from eval.ocr_eval import cer_wer, token_prf

GT = "data/ocr_groundtruth.csv"


def build_croppers():
    rembg_u2 = RembgSegmenter("u2net")
    return [
        Cropper(rembg_u2, geom_quad4, "u2net+quad4"),
        # Cropper(RembgSegmenter("isnet-general-use"), geom_quad4, "isnet+quad4"),
        Cropper(GrabCutSegmenter(), geom_quad4, "grabcut+quad4"),
        Cropper(OtsuSegmenter(), geom_quad4, "otsu+quad4"),
        Cropper(rembg_u2, geom_minarearect, "u2net+minrect"),
    ]


def main():
    sample = load_folder_sample()
    ref = {r["id"]: r["texto_referencia"] for r in csv.DictReader(open(GT, encoding="utf-8"))}
    meta = {r["id"]: r for r in sample}
    for cr in build_croppers():
        ok, rows = 0, []
        with tempfile.TemporaryDirectory() as tmp:
            for r in sample:
                crop = cr.crop(r["path"])
                if crop is None:
                    continue
                ok += 1
                p = os.path.join(tmp, f"{r['id']}.png")
                crop.convert("RGB").save(p)
                if r["id"] not in ref:
                    continue
                cer, wer = cer_wer(ref[r["id"]], fe.ocr_image(p))
                if cer is None:
                    continue
                _, _, f1 = token_prf(ref[r["id"]], fe.ocr_image(p))
                rows.append({**meta[r["id"]], "cer": cer, "wer": wer, "f1": f1})
        n = len(rows)
        glob = {m: round(sum(x[m] for x in rows) / n, 3) for m in ("cer", "wer", "f1")} if n else {}
        print(f"\n== {cr.name} ==  exito={ok/len(sample):.2f} ({ok}/{len(sample)})  OCR={glob}")
        for clave in ("fondo", "forma"):
            by = defaultdict(list)
            for x in rows:
                if x.get(clave):
                    by[x[clave]].append(x)
            if by:
                print(f"   por {clave}:")
                for v, gr in by.items():
                    agg = {m: round(sum(x[m] for x in gr) / len(gr), 3) for m in ("cer", "wer", "f1")}
                    print(f"     {v:14s} (n={len(gr)}) {agg}")


if __name__ == "__main__":
    main()
