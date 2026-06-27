"""
Ablation de fusion OCR+VLM en dos fases separadas para evitar saturacion de VRAM.

  Fase 1 - OCR:
    python -m eval.ablation_fusion --phase ocr
    - Ejecuta glm-ocr:bf16 sobre las 50 imagenes de muestra
    - Guarda los textos en data/ablation_cache.json
    - Descarga el modelo de VRAM (keep_alive=0) y espera 30 s
    - Termina

  Fase 2 - VLM (sin OCR y con OCR):
    python -m eval.ablation_fusion --phase vlm
    - Lee cache OCR de data/ablation_cache.json
    - Genera descripciones VLM *sin* OCR (solo_vlm) con gemma4:26b
    - Genera descripciones VLM *con* OCR (vlm_fusion) con gemma4:26b
    - Guarda ambas en cache
    - Indexa 3 colecciones en Qdrant: eval_fus_ocr, eval_fus_vlm, eval_fus_full
    - Lanza busquedas y escribe results/rankings.json + results/retrieval_metrics.json
"""

import json
import os
import sys
import time

# Forzar gemma4:26b como modelo VLM antes de importar feature_extractor
os.environ.setdefault("VISION_MODEL", "gemma4:26b")

from eval import feature_extractor as fe
from eval.utils import get_rs
from eval.folder_sample import load_folder_sample
from eval.index_variant import index_descriptions, VariantSystem
from eval.run_retrieval import load_queries, run_and_save, evaluate

CACHE = "data/ablation_cache.json"


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def _load_cache():
    if os.path.exists(CACHE):
        with open(CACHE, encoding="utf-8") as f:
            return json.load(f)
    return {"ocr": {}, "vlm_solo": {}, "vlm_fusion": {}}


def _save_cache(cache):
    with open(CACHE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# Unload helper
# ---------------------------------------------------------------------------

def _unload_model(model: str, wait: int = 30):
    """Pide a Ollama que descargue el modelo y espera `wait` segundos."""
    import requests
    host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
    try:
        r = requests.post(
            f"{host}/api/generate",
            json={"model": model, "prompt": "ok", "keep_alive": 0,
                  "stream": False, "options": {"num_predict": 1}},
            timeout=30,
        )
        print(f"  [unload] {model} -> HTTP {r.status_code}")
    except Exception as exc:
        print(f"  [unload] {model} -> {exc}")
    print(f"  Esperando {wait} s para que la VRAM se libere...")
    time.sleep(wait)


# ---------------------------------------------------------------------------
# Fase OCR
# ---------------------------------------------------------------------------

def phase_ocr(sample):
    """Ejecuta OCR con glm-ocr:bf16, guarda en cache, descarga modelo."""
    cache = _load_cache()
    need = [r for r in sample if r["id"] not in cache["ocr"]]
    if not need:
        print("[OCR] Todo ya esta en cache, nada que hacer.")
    else:
        print(f"[OCR] Procesando {len(need)}/{len(sample)} imagenes con {fe.OCR_MODEL}...")
        for i, r in enumerate(need, 1):
            txt = fe.ocr_image(r["path"])
            cache["ocr"][r["id"]] = txt
            print(f"  {i:3d}/{len(need)}  {r['id']}  {txt[:70]}...")
            if i % 10 == 0:
                _save_cache(cache)
        _save_cache(cache)
        print(f"[OCR] Listo. Cache guardada en {CACHE}")

    _unload_model(fe.OCR_MODEL)
    print("\n*** Fase OCR completada. ***")
    print("*** Ejecuta ahora: python -m eval.ablation_fusion --phase vlm ***")


# ---------------------------------------------------------------------------
# Fase VLM
# ---------------------------------------------------------------------------

def phase_vlm(sample):
    """
    Lee OCR de cache, genera vlm_solo y vlm_fusion con gemma4:26b,
    indexa en Qdrant y calcula metricas.
    """
    cache = _load_cache()

    # Comprobar que el OCR esta completo
    missing_ocr = [r["id"] for r in sample if r["id"] not in cache["ocr"]]
    if missing_ocr:
        print(f"[ERROR] Faltan {len(missing_ocr)} entradas OCR en cache.")
        print("  Ejecuta primero: python -m eval.ablation_fusion --phase ocr")
        sys.exit(1)

    # --- VLM sin OCR (solo_vlm) ---
    need_solo = [r for r in sample if r["id"] not in cache["vlm_solo"]]
    if not need_solo:
        print("[VLM-solo] Todo ya esta en cache.")
    else:
        print(f"\n[VLM-solo] {len(need_solo)}/{len(sample)} imagenes con {fe.VISION_MODEL} (sin OCR)...")
        for i, r in enumerate(need_solo, 1):
            txt = fe.describe_image(r["path"], "")
            cache["vlm_solo"][r["id"]] = txt
            print(f"  {i:3d}/{len(need_solo)}  {r['id']}  {txt[:70]}...")
            if i % 10 == 0:
                _save_cache(cache)
        _save_cache(cache)
        print(f"[VLM-solo] Listo. Cache guardada en {CACHE}")

    # --- VLM con OCR (vlm_fusion) ---
    need_fusion = [r for r in sample if r["id"] not in cache["vlm_fusion"]]
    if not need_fusion:
        print("[VLM-fusion] Todo ya esta en cache.")
    else:
        print(f"\n[VLM-fusion] {len(need_fusion)}/{len(sample)} imagenes con {fe.VISION_MODEL} (con OCR)...")
        for i, r in enumerate(need_fusion, 1):
            ocr_txt = cache["ocr"][r["id"]]
            txt = fe.describe_image(r["path"], ocr_txt)
            cache["vlm_fusion"][r["id"]] = txt
            print(f"  {i:3d}/{len(need_fusion)}  {r['id']}  {txt[:70]}...")
            if i % 10 == 0:
                _save_cache(cache)
        _save_cache(cache)
        print(f"[VLM-fusion] Listo. Cache guardada en {CACHE}")

    # Construir listas para indexacion
    solo_ocr_data   = [(r["id"], r["path"], cache["ocr"][r["id"]])         for r in sample]
    solo_vlm_data   = [(r["id"], r["path"], cache["vlm_solo"][r["id"]])    for r in sample]
    fusion_data     = [(r["id"], r["path"], cache["vlm_fusion"][r["id"]])  for r in sample]

    # --- Indexar en Qdrant ---
    rs = get_rs()
    colecciones = {
        "eval_fus_ocr":  solo_ocr_data,   # solo texto OCR
        "eval_fus_vlm":  solo_vlm_data,   # solo descripcion VLM (sin OCR)
        "eval_fus_full": fusion_data,      # descripcion VLM enriquecida con OCR
    }
    print("\n[Indexado] Creando 3 colecciones en Qdrant...")
    for col, data in colecciones.items():
        print(f"  {col} ({len(data)} items)...")
        index_descriptions(rs, col, data, mode="full")

    # --- Busqueda y metricas ---
    print("\n[Metricas] Lanzando busquedas...")
    systems = [
        VariantSystem(rs, "eval_fus_ocr",  "solo_ocr"),
        VariantSystem(rs, "eval_fus_vlm",  "solo_vlm"),
        VariantSystem(rs, "eval_fus_full", "ocr_vlm"),
    ]
    queries = load_queries("data/queries.csv")
    rankings = run_and_save(systems, queries)
    evaluate(rankings, queries)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    phase = "ocr"
    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg.startswith("--phase="):
            phase = arg.split("=", 1)[1]
        elif arg == "--phase" and i + 1 < len(args):
            phase = args[i + 1]

    sample = load_folder_sample()

    if phase == "ocr":
        phase_ocr(sample)
    elif phase == "vlm":
        phase_vlm(sample)
    else:
        print(f"[ERROR] Fase desconocida: {phase!r}. Usa --phase ocr o --phase vlm")
        sys.exit(1)


if __name__ == "__main__":
    main()
