#!/usr/bin/env python3
"""
eval/run_all.py -- Orquestador completo de la evaluacion.

python -m eval.run_all --yes
"""

import argparse
import os
import sys
import time
import traceback
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
os.chdir(_ROOT)

LOG = []


def hdr(n, title):
    print(f"\n{'='*64}")
    print(f"  Fase {n:02d}: {title}")
    print('='*64)


def status(n, code, msg):
    print(f"  [{code:>4s}]  {msg}")
    LOG.append((n, code, msg))


def ask_confirm(msg):
    try:
        r = input(f"  [SLOW]  {msg} [s/N] ").strip().lower()
        return r in ("s", "si", "y", "yes")
    except (KeyboardInterrupt, EOFError):
        return False


def exists(*paths):
    return all(Path(p).exists() for p in paths)


def check_qdrant(args):
    if not args._qdrant_ok:
        try:
            from qdrant_client import QdrantClient
            host = os.getenv("QDRANT_HOST", "localhost")
            port = int(os.getenv("QDRANT_PORT", 6333))
            QdrantClient(host=host, port=port).get_collections()
            args._qdrant_ok = True
            from eval.utils import get_rs
            if args._rs is None:
                args._rs = get_rs()
        except Exception:
            return False
    return args._qdrant_ok


def check_ollama(args):
    if not args._ollama_ok:
        try:
            import feature_extractor as _fe
            args._ollama_ok = True
        except Exception:
            return False
    return args._ollama_ok


def check_sample(args):
    if not args._sample_ok:
        try:
            from eval.folder_sample import load_folder_sample
            sample = load_folder_sample()
            if sample:
                args._sample = sample
                args._sample_ok = True
        except Exception:
            return False
    return args._sample_ok


def safe_run(fn):
    try:
        fn()
        return True, ""
    except Exception:
        return False, traceback.format_exc(limit=4)


def fase_0(args):
    hdr(0, "Comprobaciones de entorno y test de metricas")
    os.makedirs("data", exist_ok=True)
    os.makedirs("results", exist_ok=True)

    try:
        from eval.metrics import ndcg_at_k, average_precision, precision_at_k, mrr
        ranked, qrels = [1, 2, 3, 4], {1: 1, 3: 1}
        assert abs(precision_at_k(ranked, qrels, 2) - 0.5) < 1e-9
        assert abs(mrr(ranked, qrels) - 1.0) < 1e-9
        assert abs(average_precision(ranked, qrels) - 0.8333) < 1e-3
        assert abs(ndcg_at_k(ranked, qrels, 4) - 0.91972) < 1e-3
        status(0, "OK", "eval.metrics: todos los asserts pasan")
    except Exception as e:
        status(0, "FAIL", f"eval.metrics fallo: {e}")

    missing = []
    for pkg in ("rank_bm25", "jiwer", "sklearn", "rembg", "cv2", "qdrant_client", "open_clip"):
        try:
            __import__(pkg if pkg != "sklearn" else "sklearn.metrics")
        except ImportError:
            missing.append(pkg)
    if missing:
        status(0, "SKIP", f"Paquetes no instalados: {', '.join(missing)}")
    else:
        status(0, "OK", "Todas las dependencias disponibles")

    try:
        from qdrant_client import QdrantClient
        host = os.getenv("QDRANT_HOST", "localhost")
        port = int(os.getenv("QDRANT_PORT", 6333))
        QdrantClient(host=host, port=port).get_collections()
        args._qdrant_ok = True
        status(0, "OK", f"Qdrant accesible en {host}:{port}")
    except Exception as e:
        args._qdrant_ok = False
        status(0, "SKIP", f"Qdrant no disponible ({e})")

    try:
        import feature_extractor as _fe
        args._ollama_ok = True
        ocr_m = getattr(_fe, "OCR_MODEL", "?")
        vis_m = getattr(_fe, "VISION_MODEL", "?")
        status(0, "OK", f"feature_extractor cargado (OCR={ocr_m}, VLM={vis_m})")
    except Exception as e:
        args._ollama_ok = False
        status(0, "SKIP", f"feature_extractor no importable ({e})")


def fase_1(args):
    hdr(1, "Escaneo de carpetas de muestra -> data/muestra_50.csv")
    try:
        from eval.folder_sample import load_folder_sample, export_sample_csv, BASE
        sample = load_folder_sample()
        if not sample:
            status(1, "SKIP", f"No hay imagenes en {BASE}/1..5")
            args._sample_ok = False
            return
        args._sample = sample
        args._sample_ok = True
        export_sample_csv()
        n_por_grupo = {}
        for r in sample:
            n_por_grupo[r["grupo"]] = n_por_grupo.get(r["grupo"], 0) + 1
        resumen = "  ".join(f"{g[:8]}={n}" for g, n in n_por_grupo.items())
        status(1, "OK", f"{len(sample)} etiquetas detectadas  [{resumen}]")
    except Exception as e:
        status(1, "FAIL", f"{e}")
        args._sample_ok = False


def fase_2(args):
    hdr(2, "Test de modulos de recuperacion (smoke)")
    if not check_qdrant(args):
        status(2, "SKIP", "Qdrant no disponible")
        return
    try:
        from eval.utils import get_rs
        rs = get_rs()
        args._rs = rs
        status(2, "OK", "ImageRetrievalSystem conectado")
    except Exception as e:
        status(2, "FAIL", f"get_rs() fallo: {e}")
        args._rs = None
        return
    try:
        from eval.systems import OwnSystem, ClipSystem, Bm25System
        own = OwnSystem(rs)
        clip = ClipSystem(rs)
        bm25 = Bm25System(rs)
        for sys_obj, q in [(own, "vino"), (clip, "wine"), (bm25, "jerez")]:
            hits = sys_obj.search(q, 3)
            assert isinstance(hits, list)
        status(2, "OK", "OwnSystem, ClipSystem, Bm25System OK")
        args._systems = [own, clip, bm25]
    except Exception as e:
        status(2, "FAIL", f"Sistemas: {e}")
        args._systems = []


def fase_3(args):
    hdr(3, "Predicciones de OCR -> data/ocr_pred.csv")
    if not check_sample(args):
        status(3, "SKIP", "Muestra no disponible")
        return
    if not check_ollama(args):
        status(3, "SKIP", "Ollama no disponible")
        return
    if exists("data/ocr_pred.csv"):
        status(3, "SKIP", "data/ocr_pred.csv ya existe")
        return
    t0 = time.time()
    ok, err = safe_run(lambda: __import__("eval.ocr_predict", fromlist=["main"]).main())
    if ok:
        status(3, "OK", f"OCR completado en {time.time()-t0:.0f}s")
    else:
        status(3, "FAIL", err.splitlines()[-1])


def fase_4(args):
    hdr(4, "Evaluacion de OCR -> CER / WER / tokenF1")
    if not exists("data/ocr_pred.csv"):
        status(4, "SKIP", "data/ocr_pred.csv no existe")
        return
    if not exists("data/ocr_groundtruth.csv"):
        status(4, "SKIP", "data/ocr_groundtruth.csv no existe (anotacion pendiente)")
        return
    ok, err = safe_run(lambda: __import__("eval.ocr_eval", fromlist=["evaluate"]).evaluate())
    if ok:
        status(4, "OK", "Metricas de OCR calculadas")
    else:
        status(4, "FAIL", err.splitlines()[-1])


def fase_5(args):
    hdr(5, "Generacion de descripciones de finalistas [LENTO]")
    if not check_sample(args):
        status(5, "SKIP", "Muestra no disponible")
        return
    if not check_ollama(args):
        status(5, "SKIP", "Ollama no disponible")
        return
    if exists("data/descripciones.csv"):
        status(5, "SKIP", "data/descripciones.csv ya existe")
        return
    n = len(args._sample) if hasattr(args, "_sample") else "~50"
    from eval.quality_generate import FINALISTAS
    msg = f"Generara descripciones de {n} etiquetas x {len(FINALISTAS)} modelos. Continuar?"
    if not args.yes and not ask_confirm(msg):
        status(5, "SKIP", "Cancelado")
        return
    t0 = time.time()
    ok, err = safe_run(lambda: __import__("eval.quality_generate", fromlist=["hoja_ciega", "generar"])
                       .hoja_ciega(__import__("eval.quality_generate", fromlist=["generar"]).generar()))
    if ok:
        status(5, "OK", f"Listo en {time.time()-t0:.0f}s")
    else:
        status(5, "FAIL", err.splitlines()[-1])


def fase_6(args):
    hdr(6, "Tabla calidad x coste")
    if not exists("data/descripciones.csv"):
        status(6, "SKIP", "data/descripciones.csv no existe")
        return
    ok, err = safe_run(lambda: __import__("eval.model_compare", fromlist=["main"]).main())
    if ok:
        status(6, "OK", "Tabla calidad x coste mostrada")
    else:
        status(6, "FAIL", err.splitlines()[-1])


def fase_7(args):
    hdr(7, "Driver de recuperacion -> results/rankings.json")
    if not check_qdrant(args):
        status(7, "SKIP", "Qdrant no disponible")
        return
    if not exists("data/queries.csv"):
        status(7, "SKIP", "data/queries.csv no existe")
        return
    if not hasattr(args, "_systems") or not args._systems:
        status(7, "SKIP", "Sistemas no iniciados")
        return
    try:
        from eval.run_retrieval import load_queries, run_and_save, evaluate
        queries = load_queries()
        rankings = run_and_save(args._systems, queries)
        status(7, "OK", f"{len(queries)} consultas -> results/rankings.json")
        evaluate(rankings, queries)
    except Exception as e:
        status(7, "FAIL", str(e))


def fase_8(args):
    hdr(8, "Pool de relevancia -> data/pool_para_anotar.csv")
    if not exists("results/rankings.json"):
        status(8, "SKIP", "results/rankings.json no existe")
        return
    try:
        from eval.pooling import build_pool
        build_pool()
        status(8, "OK", "data/pool_para_anotar.csv generado")
    except Exception as e:
        status(8, "FAIL", str(e))
    if exists("data/qrels.json"):
        status(8, "OK", "qrels.json detectado -> recalculando metricas")
        try:
            from eval.run_retrieval import load_queries, evaluate
            import json
            with open("results/rankings.json") as f:
                rankings = json.load(f)
            evaluate(rankings, load_queries())
        except Exception as e:
            status(8, "FAIL", f"Metricas con qrels: {e}")
    else:
        status(8, "SKIP", "qrels.json no existe. Completa pool --to-qrels")


def fase_9(args):
    hdr(9, "Evaluacion de calidad: kappa + medias por modelo")
    blanks = list(Path("data").glob("calidad_scoring_*.csv"))
    blanks = [p for p in blanks if "blank" not in p.name and "key" not in p.name]
    if len(blanks) < 2:
        status(9, "SKIP", f"Solo {len(blanks)} hojas de puntuacion")
        return
    if not exists("data/blind_key.csv"):
        status(9, "SKIP", "data/blind_key.csv no existe")
        return
    try:
        from eval.quality_eval import main as qeval
        qeval(str(blanks[0]), str(blanks[1]))
        status(9, "OK", f"Kappa con {blanks[0].name} y {blanks[1].name}")
    except Exception as e:
        status(9, "FAIL", str(e))


def fase_10(args):
    hdr(10, "Ablation: completa / segmentos / ambas [LENTO]")
    if not check_qdrant(args):
        status(10, "SKIP", "Qdrant no disponible")
        return
    if not exists("data/queries.csv"):
        status(10, "SKIP", "data/queries.csv no existe")
        return
    msg = "Reindexara el corpus 3 veces. Continuar?"
    if not args.yes and not ask_confirm(msg):
        status(10, "SKIP", "Cancelado")
        return
    t0 = time.time()
    ok, err = safe_run(lambda: __import__("eval.ablation_segmentation", fromlist=["main"]).main())
    if ok:
        status(10, "OK", f"Ablation completado en {time.time()-t0:.0f}s")
    else:
        status(10, "FAIL", err.splitlines()[-1])


def fase_11(args):
    hdr(11, "Ablation: solo-OCR / solo-VLM / OCR->VLM [LENTO]")
    if not check_qdrant(args) or not check_ollama(args):
        status(11, "SKIP", "Qdrant/Ollama no disponibles")
        return
    if not check_sample(args):
        status(11, "SKIP", "Muestra no disponible")
        return
    msg = "Generara 3 modos de descripcion y reindexara. Continuar?"
    if not args.yes and not ask_confirm(msg):
        status(11, "SKIP", "Cancelado")
        return
    t0 = time.time()
    ok, err = safe_run(lambda: __import__("eval.ablation_fusion", fromlist=["main"]).main())
    if ok:
        status(11, "OK", f"Ablation completado en {time.time()-t0:.0f}s")
    else:
        status(11, "FAIL", err.splitlines()[-1])


def fase_12(args):
    hdr(12, "Sensibilidad de umbrales de duplicados")
    if not check_qdrant(args):
        status(12, "SKIP", "Qdrant no disponible")
        return
    if not exists("data/duplicados_gt.csv"):
        status(12, "SKIP", "data/duplicados_gt.csv no existe")
        return
    ok, err = safe_run(lambda: __import__("eval.dup_sensitivity", fromlist=["main"]).main())
    if ok:
        status(12, "OK", "Curva precision/recall vs umbral mostrada")
    else:
        status(12, "FAIL", err.splitlines()[-1])


def fase_13(args):
    hdr(13, "Evaluacion del recorte")
    if not check_sample(args):
        status(13, "SKIP", "Muestra no disponible")
        return
    if not check_ollama(args):
        status(13, "SKIP", "Ollama no disponible")
        return
    if not exists("data/ocr_groundtruth.csv"):
        status(13, "SKIP", "data/ocr_groundtruth.csv no existe")
        return
    t0 = time.time()
    ok, err = safe_run(lambda: __import__("eval.crop_eval", fromlist=["main"]).main())
    if ok:
        status(13, "OK", f"Recorte completado en {time.time()-t0:.0f}s")
    else:
        status(13, "FAIL", err.splitlines()[-1])


def fase_14(args):
    hdr(14, "Latencias de produccion -> p50 / p95")
    if not exists("data/lat_prod.csv"):
        status(14, "SKIP", "data/lat_prod.csv no existe")
        return
    ok, err = safe_run(lambda: __import__("eval.latency", fromlist=["main"]).main())
    if ok:
        status(14, "OK", "Percentiles de latencia mostrados")
    else:
        status(14, "FAIL", err.splitlines()[-1])


def resumen():
    print(f"\n{'='*64}")
    print("  RESUMEN")
    print('='*64)

    ok_   = [(n, m) for n, c, m in LOG if c == "OK"]
    skip_ = [(n, m) for n, c, m in LOG if c == "SKIP"]
    fail_ = [(n, m) for n, c, m in LOG if c == "FAIL"]

    print(f"\n  [OK]   ({len(ok_)} pasos)")
    for n, m in ok_:
        print(f"      Fase {n:02d}: {m}")

    if fail_:
        print(f"\n  [FAIL] ({len(fail_)} pasos) <-- revisar")
        for n, m in fail_:
            print(f"      Fase {n:02d}: {m}")

    if skip_:
        print(f"\n  [SKIP] ({len(skip_)} pasos)")
        for n, m in skip_:
            print(f"      Fase {n:02d}: {m}")

    pending = []
    if not exists("data/muestra_50.csv") or not any(
        Path(p).exists() for p in ["eval/muestra/1", "eval/muestra/2"]
    ):
        pending.append("M1 - Selecciona 50 etiquetas en eval/muestra/1..5 (10 por carpeta)")
    if not exists("data/ocr_groundtruth.csv"):
        pending.append("M2 - Transcribe el texto de las 50 etiquetas -> data/ocr_groundtruth.csv")
    if not exists("data/qrels.json"):
        pending.append("M3 - Rellena relevante_0_1 en pool_para_anotar.csv y --to-qrels")
    if not any(Path("data").glob("calidad_scoring_*.csv")) or \
       len([p for p in Path("data").glob("calidad_scoring_*.csv")
             if "blank" not in p.name and "key" not in p.name]) < 2:
        pending.append("M5 - Puntuar calidad_scoring_blank.csv (2 anotadores)")
    if not exists("data/queries.csv"):
        pending.append("Crea data/queries.csv con las consultas")

    if pending:
        print(f"\n  [ANOTACION HUMANA PENDIENTE]")
        for p in pending:
            print(f"      * {p}")

    print(f"\n{'='*64}\n")


def main():
    parser = argparse.ArgumentParser(description="Orquestador de evaluacion")
    parser.add_argument("--yes", action="store_true", help="No preguntar en tareas lentas")
    parser.add_argument("--only", type=str, default="", help="Solo estas fases: --only 0,3,4")
    parser.add_argument("--skip", type=str, default="", help="Saltar fases: --skip 5,10,11")
    args = parser.parse_args()

    only = set(int(x) for x in args.only.split(",") if x.strip()) if args.only else set()
    skip = set(int(x) for x in args.skip.split(",") if x.strip()) if args.skip else set()

    args._qdrant_ok = False
    args._ollama_ok = False
    args._sample_ok = False
    args._rs = None
    args._systems = []
    args._sample = []

    fases = [
        (0,  fase_0),
        (1,  fase_1),
        (2,  fase_2),
        (3,  fase_3),
        (4,  fase_4),
        (5,  fase_5),
        (6,  fase_6),
        (7,  fase_7),
        (8,  fase_8),
        (9,  fase_9),
        (10, fase_10),
        (11, fase_11),
        (12, fase_12),
        (13, fase_13),
        (14, fase_14),
    ]

    print(f"\n{'='*64}")
    print("  EVALUACION COMPLETA -- coleccion de etiquetas de vino")
    print('='*64)

    for n, fn in fases:
        if only and n not in only:
            continue
        if n in skip:
            hdr(n, fn.__doc__ or f"fase {n}")
            status(n, "SKIP", "Saltada por --skip")
            continue
        fn(args)

    resumen()


if __name__ == "__main__":
    main()
