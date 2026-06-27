import time
import os
import sys
import json
import glob
import requests
from datetime import datetime

BACKEND_URL = os.getenv("BENCHMARK_BACKEND", "http://localhost:10000")
TEST_DIR = os.path.join(os.path.dirname(__file__), "pruebas")
OUTPUT = os.path.join(os.path.dirname(__file__), "source", "Sistema-de-catalogacion-de-imagenes", "calibration.json")
API = f"{BACKEND_URL}/api"

PHASES = ["ocr", "crop", "describe", "index"]


def get_size_mb(path):
    return os.path.getsize(path) / (1024 * 1024)


def read_sse(response):
    buffer = b""
    events = []
    for chunk in response.iter_content(chunk_size=4096):
        if not chunk:
            continue
        buffer += chunk
        while b"\n\n" in buffer:
            part, buffer = buffer.split(b"\n\n", 1)
            line = part.decode("utf-8", errors="replace")
            if line.startswith("data: "):
                data = json.loads(line[6:])
                events.append(data)
    return events


def main():
    images = sorted(glob.glob(os.path.join(TEST_DIR, "*.JPG")))
    if not images:
        print("ERROR: no hay imagenes en " + TEST_DIR)
        sys.exit(1)

    print(f"Imagenes de calibracion: {len(images)}")
    for img in images:
        print(f"  {os.path.basename(img)} ({get_size_mb(img):.2f} MB)")

    sessions = []

    for img_path in images:
        fname = os.path.basename(img_path)
        size_mb = get_size_mb(img_path)
        print(f"\n--- Calibrando {fname} ({size_mb:.2f} MB) ---")

        # Fase 1: Upload + OCR
        print("  Fase 1: Upload + OCR...")
        with open(img_path, "rb") as fh:
            t0 = time.time()
            r = requests.post(
                f"{API}/upload/batch/upload",
                files=[("files", (fname, fh, "image/jpeg"))],
                timeout=300, stream=True
            )
            r.raise_for_status()
            events = read_sse(r)
        session_id = events[-1].get("session_id")
        ocr_s = time.time() - t0
        ocr_s_mb = ocr_s / size_mb if size_mb else 0
        print(f"    {ocr_s:.1f}s -> {ocr_s_mb:.2f} s/MB")

        if not session_id:
            print("   ERROR: sin session_id")
            continue

        accepted = []
        for evt in events:
            if evt.get("ok") and not evt.get("done"):
                accepted.append(evt["filename"])
        if not accepted:
            accepted = [fname]

        # Fase 2: Crop
        print("  Fase 2: Crop...")
        t0 = time.time()
        r = requests.post(
            f"{API}/upload/batch/crop",
            json={"session_id": session_id, "accepted": accepted},
            timeout=300, stream=True
        )
        r.raise_for_status()
        crop_events = read_sse(r)
        crop_s = time.time() - t0
        crop_s_mb = crop_s / size_mb if size_mb else 0
        crop_accepted = []
        for evt in crop_events:
            if evt.get("ok") and not evt.get("done"):
                crop_accepted.append(evt["filename"])
        if not crop_accepted:
            crop_accepted = accepted
        print(f"    {crop_s:.1f}s -> {crop_s_mb:.2f} s/MB")

        # Fase 3: Describe
        print("  Fase 3: Describe...")
        t0 = time.time()
        r = requests.post(
            f"{API}/upload/batch/describe",
            json={"session_id": session_id},
            timeout=600, stream=True
        )
        r.raise_for_status()
        desc_events = read_sse(r)
        desc_s = time.time() - t0
        desc_s_mb = desc_s / size_mb if size_mb else 0
        print(f"    {desc_s:.1f}s -> {desc_s_mb:.2f} s/MB")

        # Fase 4: Index
        print("  Fase 4: Index...")
        t0 = time.time()
        r = requests.post(
            f"{API}/upload/batch/index",
            json={"session_id": session_id, "accepted": crop_accepted},
            timeout=300, stream=True
        )
        r.raise_for_status()
        index_events = read_sse(r)
        index_s = time.time() - t0
        index_s_mb = index_s / size_mb if size_mb else 0
        print(f"    {index_s:.1f}s -> {index_s_mb:.2f} s/MB")

        sessions.append({
            "filename": fname,
            "size_mb": size_mb,
            "ocr_s": ocr_s,
            "ocr_s_mb": ocr_s_mb,
            "crop_s": crop_s,
            "crop_s_mb": crop_s_mb,
            "desc_s": desc_s,
            "desc_s_mb": desc_s_mb,
            "index_s": index_s,
            "index_s_mb": index_s_mb,
        })

        try:
            requests.delete(f"{API}/upload/batch/session/{session_id}", timeout=5)
        except Exception:
            pass

    if not sessions:
        print("ERROR: no se procesaron imagenes")
        sys.exit(1)

    ratios = {}
    for phase in PHASES:
        key = f"{phase}_s_mb" if phase != "describe" else "desc_s_mb"
        avg = sum(s[key] for s in sessions) / len(sessions)
        ratios[phase] = round(avg, 2)

    total_ratio = sum(ratios.values())
    weights = {p: round(ratios[p] / total_ratio, 3) for p in PHASES}

    avg_size = sum(s["size_mb"] for s in sessions) / len(sessions)

    calibration = {
        "ratios_s_per_mb": ratios,
        "weights": weights,
        "reference_mb": round(avg_size, 2),
        "calibrated_at": datetime.now().isoformat(),
        "samples": len(sessions),
    }

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(calibration, f, indent=2, ensure_ascii=False)

    print(f"\n{'=' * 50}")
    print(f"Calibracion completada: {OUTPUT}")
    print(json.dumps(calibration, indent=2, ensure_ascii=False))
    print(f"\nResumen por fase:")
    for p in PHASES:
        print(f"  {p}: {ratios[p]:.2f} s/MB (peso={weights[p]:.1%})")


if __name__ == "__main__":
    for attempt in range(1, 20):
        try:
            r = requests.get(f"{BACKEND_URL}/health", timeout=5)
            if r.status_code == 200:
                print("Backend disponible")
                break
        except Exception:
            pass
        print(f"  Esperando backend (intento {attempt})...")
        time.sleep(3)
    else:
        print("WARN Backend no disponible -- continuando de todos modos")

    main()
