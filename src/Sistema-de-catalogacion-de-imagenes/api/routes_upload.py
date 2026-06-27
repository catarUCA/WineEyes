from fastapi import APIRouter, Request, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Dict
import asyncio
import json
import logging
import os
import time
import tempfile
import shutil
from pathlib import Path
from datetime import datetime

import preprocesadoV3
from feature_extractor import ocr_image_bytes, describe_image_bytes

import base64
import io
import uuid
import threading
from concurrent.futures import ThreadPoolExecutor

PROCESSING_EXECUTOR = ThreadPoolExecutor(max_workers=6)

_sessions: Dict[str, dict] = {}
_sessions_lock = threading.Lock()

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/upload", tags=["upload"])

DEBUG_DIR = os.getenv("DEBUG_DIR", "/app/debug")

_current_image = {"filename": "", "phase": "", "started_at": 0.0, "estimated_s": 1.0}

_mb = 1.0 / (1024 * 1024)


def _get_calibration(request: Request):
    return request.app.state.calibration


def _debug_save(subdir: str, name: str, img_bytes: bytes, text: str = None):
    try:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        safe_name = name.replace("/", "_").replace("\\", "_").split(".")[0][:60]
        ddir = os.path.join(DEBUG_DIR, subdir)
        os.makedirs(ddir, exist_ok=True)
        img_path = os.path.join(ddir, f"{ts}_{safe_name}.png")
        with open(img_path, "wb") as f:
            f.write(img_bytes)
        if text:
            txt_path = os.path.join(ddir, f"{ts}_{safe_name}.txt")
            with open(txt_path, "w", encoding="utf-8") as f:
                f.write(text)
        logger.info(f"[DEBUG] {subdir}: {img_path}" + (f" + txt" if text else ""))
    except Exception as e:
        logger.warning(f"[DEBUG] error saving {subdir}: {e}")


async def _heartbeat_loop(queue: asyncio.Queue, stop_event: asyncio.Event):
    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=0.5)
            break
        except asyncio.TimeoutError:
            pass
        cur = _current_image
        if cur.get("started_at") and cur["filename"]:
            elapsed = time.time() - cur["started_at"]
            fraction = min(1.0, elapsed / cur["estimated_s"]) if cur["estimated_s"] > 0 else 1.0
            await queue.put({
                "filename": cur["filename"],
                "image_progress": cur["base_pct"] + fraction * cur["phase_weight"],
                "phase": cur["phase"],
                "heartbeat": True,
                "total": cur.get("total", 0),
                "processed": cur.get("processed", 0),
            })


def _drain_heartbeat(queue: asyncio.Queue):
    events = []
    while not queue.empty():
        try:
            events.append(queue.get_nowait())
        except asyncio.QueueEmpty:
            break
    return events


def _phase_range(calib, phase: str):
    weights = calib["weights"]
    order = ["ocr", "crop", "describe", "index"]
    idx = order.index(phase)
    base = sum(weights[order[i]] for i in range(idx))
    return base, weights[phase]


def _img_size_mb(data: dict) -> float:
    for key in ("orig_bytes", "image_bytes"):
        if key in data and data[key]:
            return len(data[key]) * _mb
    return 1.0


def _estimated_s(calib, phase: str, size_mb: float) -> float:
    return calib["ratios_s_per_mb"].get(phase, 6.0) * size_mb


# =====================================================
# Phase 1: Upload + OCR on original images
# =====================================================
@router.post("/batch/upload")
async def upload_and_ocr(
    request: Request,
    files: List[UploadFile] = File(...),
    session_id: Optional[str] = Form(None),
):
    if not files:
        raise HTTPException(status_code=400, detail="No se recibieron archivos")

    calib = _get_calibration(request)
    base_pct, phase_weight = _phase_range(calib, "ocr")

    valid_data = []
    for file in files:
        if not file.content_type or not file.content_type.startswith('image/'):
            continue
        content = await file.read()
        valid_data.append((file.filename, content))

    loop = asyncio.get_event_loop()
    final_session_id = session_id or str(uuid.uuid4())
    total = len(valid_data)
    _current_image["total"] = total
    _current_image["phase"] = "ocr"
    _current_image["processed"] = 0

    async def event_stream():
        episode_data = {}
        processed = 0
        success = 0
        errors = []
        hb_queue = asyncio.Queue()
        stop_event = asyncio.Event()
        hb_task = asyncio.create_task(_heartbeat_loop(hb_queue, stop_event))

        for idx, (filename, img_bytes) in enumerate(valid_data):
            _current_image["processed"] = processed
            size_mb = len(img_bytes) * _mb
            estimated_s = _estimated_s(calib, "ocr", size_mb)

            _current_image["filename"] = filename
            _current_image["phase"] = "ocr"
            _current_image["started_at"] = time.time()
            _current_image["estimated_s"] = estimated_s
            _current_image["base_pct"] = base_pct
            _current_image["phase_weight"] = phase_weight

            try:
                _debug_save("original", filename, img_bytes)

                ocr_text = await loop.run_in_executor(
                    PROCESSING_EXECUTOR,
                    ocr_image_bytes,
                    img_bytes
                )

                _debug_save("ocr", filename, img_bytes, ocr_text)

                episode_data[filename] = {"orig_bytes": img_bytes, "ocr_text": ocr_text}
                success += 1
                processed += 1
                _current_image["processed"] = processed

                for hb in _drain_heartbeat(hb_queue):
                    yield f"data: {json.dumps(hb)}\n\n"

                event = json.dumps({
                    "filename": filename, "ok": True,
                    "ocr_text": ocr_text,
                    "processed": success, "total": total,
                    "image_progress": base_pct + phase_weight,
                    "phase": "ocr",
                })

            except Exception as e:
                logger.error(f"Error OCR {filename}: {e}")
                episode_data[filename] = {"orig_bytes": img_bytes, "ocr_text": f"[ERROR: {str(e)[:100]}]"}
                for hb in _drain_heartbeat(hb_queue):
                    yield f"data: {json.dumps(hb)}\n\n"
                event = json.dumps({
                    "filename": filename, "ok": False,
                    "ocr_text": f"[ERROR: {str(e)[:100]}]",
                    "processed": success, "total": total,
                    "image_progress": base_pct + phase_weight,
                    "phase": "ocr",
                })

            yield f"data: {event}\n\n"
            await asyncio.sleep(0)

        stop_event.set()
        hb_task.cancel()
        try:
            await hb_task
        except asyncio.CancelledError:
            pass

        with _sessions_lock:
            _sessions[final_session_id] = episode_data

        yield f"data: {json.dumps({'done': True, 'session_id': final_session_id, 'total': total, 'success': success})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
    )


class AcceptRequest(BaseModel):
    session_id: str
    accepted: List[str]


# =====================================================
# Phase 2: Crop accepted images
# =====================================================
@router.post("/batch/crop")
async def crop_batch(request: Request, body: AcceptRequest):
    calib = _get_calibration(request)
    base_pct, phase_weight = _phase_range(calib, "crop")

    with _sessions_lock:
        session_data = _sessions.get(body.session_id, None)

    if session_data is None:
        raise HTTPException(status_code=404, detail="Sesion no encontrada o expirada")

    accepted = {fn: data for fn, data in session_data.items() if fn in body.accepted}
    total = len(accepted)
    _current_image["total"] = total
    _current_image["phase"] = "crop"
    _current_image["processed"] = 0
    loop = asyncio.get_event_loop()

    async def event_stream():
        success = 0
        processed = 0
        hb_queue = asyncio.Queue()
        stop_event = asyncio.Event()
        hb_task = asyncio.create_task(_heartbeat_loop(hb_queue, stop_event))

        for filename, data in accepted.items():
            _current_image["processed"] = processed
            size_mb = _img_size_mb(data)
            estimated_s = _estimated_s(calib, "crop", size_mb)

            _current_image["filename"] = filename
            _current_image["phase"] = "crop"
            _current_image["started_at"] = time.time()
            _current_image["estimated_s"] = estimated_s
            _current_image["base_pct"] = base_pct
            _current_image["phase_weight"] = phase_weight

            try:
                img_bytes = data["orig_bytes"]

                img = await loop.run_in_executor(
                    PROCESSING_EXECUTOR,
                    preprocesadoV3.crop_via_service,
                    img_bytes
                )

                for hb in _drain_heartbeat(hb_queue):
                    yield f"data: {json.dumps(hb)}\n\n"

                if img is None:
                    event = json.dumps({
                        "filename": filename, "ok": False,
                        "processed": success, "total": total,
                        "image_progress": base_pct + phase_weight,
                        "phase": "crop",
                    })
                else:
                    buf = io.BytesIO()
                    img.save(buf, format="PNG")
                    png_bytes = buf.getvalue()

                    buf_preview = io.BytesIO()
                    preview = img.copy()
                    preview.thumbnail((400, 400))
                    preview.save(buf_preview, format="PNG")
                    b64_preview = base64.b64encode(buf_preview.getvalue()).decode()

                    session_data[filename]["image_bytes"] = png_bytes
                    success += 1
                    processed += 1
                    _current_image["processed"] = processed

                    _debug_save("crop", filename, png_bytes)

                    event = json.dumps({
                        "filename": filename, "ok": True,
                        "preview": b64_preview,
                        "processed": success, "total": total,
                        "image_progress": base_pct + phase_weight,
                        "phase": "crop",
                    })

            except Exception as e:
                logger.error(f"Error crop {filename}: {e}")
                for hb in _drain_heartbeat(hb_queue):
                    yield f"data: {json.dumps(hb)}\n\n"
                event = json.dumps({
                    "filename": filename, "ok": False,
                    "processed": success, "total": total,
                    "image_progress": base_pct + phase_weight,
                    "phase": "crop",
                })

            yield f"data: {event}\n\n"
            await asyncio.sleep(0)

        stop_event.set()
        hb_task.cancel()
        try:
            await hb_task
        except asyncio.CancelledError:
            pass

        yield f"data: {json.dumps({'done': True, 'session_id': body.session_id, 'total': total, 'success': success})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
    )


class DescribeRequest(BaseModel):
    session_id: str


# =====================================================
# Phase 3: Describe cropped images
# =====================================================
@router.post("/batch/describe")
async def describe_batch(request: Request, body: DescribeRequest):
    from PIL import Image as PILImage

    calib = _get_calibration(request)
    base_pct, phase_weight = _phase_range(calib, "describe")

    with _sessions_lock:
        session_data = _sessions.get(body.session_id, None)

    if session_data is None:
        raise HTTPException(status_code=404, detail="Sesion no encontrada o expirada")

    total = len(session_data)
    _current_image["total"] = total
    _current_image["phase"] = "describe"
    _current_image["processed"] = 0
    loop = asyncio.get_event_loop()

    async def event_stream():
        success = 0
        processed = 0
        errors = []
        hb_queue = asyncio.Queue()
        stop_event = asyncio.Event()
        hb_task = asyncio.create_task(_heartbeat_loop(hb_queue, stop_event))

        for filename, data in session_data.items():
            _current_image["processed"] = processed
            if "image_bytes" not in data:
                errors.append(filename)
                logger.error(f"Saltando {filename}: sin image_bytes (crop falló)")
                yield f"data: {json.dumps({'filename': filename, 'ok': False, 'processed': 0, 'total': total, 'image_progress': 0, 'phase': 'describe'})}\n\n"
                continue
            size_mb = _img_size_mb(data)
            estimated_s = _estimated_s(calib, "describe", size_mb)

            _current_image["filename"] = filename
            _current_image["phase"] = "describe"
            _current_image["started_at"] = time.time()
            _current_image["estimated_s"] = estimated_s
            _current_image["base_pct"] = base_pct
            _current_image["phase_weight"] = phase_weight

            description = ""
            try:
                png_bytes = data["image_bytes"]
                ocr_text = data.get("ocr_text", "")

                description = await loop.run_in_executor(
                    PROCESSING_EXECUTOR,
                    describe_image_bytes,
                    png_bytes, ocr_text
                )

                _debug_save("vision", filename, png_bytes, description)

                for hb in _drain_heartbeat(hb_queue):
                    yield f"data: {json.dumps(hb)}\n\n"

                buf_preview = io.BytesIO()
                preview = PILImage.open(io.BytesIO(png_bytes))
                preview.thumbnail((400, 400))
                preview.save(buf_preview, format="PNG")
                b64_preview = base64.b64encode(buf_preview.getvalue()).decode()

                session_data[filename]["description"] = description

                success += 1
                processed += 1
                _current_image["processed"] = processed
                event = json.dumps({
                    "filename": filename, "ok": True,
                    "preview": b64_preview,
                    "ocr_text": ocr_text,
                    "description": description,
                    "processed": success, "total": total,
                    "image_progress": base_pct + phase_weight,
                    "phase": "describe",
                })

            except Exception as e:
                errors.append(filename)
                logger.error(f"Error describiendo {filename}: {e}")
                for hb in _drain_heartbeat(hb_queue):
                    yield f"data: {json.dumps(hb)}\n\n"
                event = json.dumps({
                    "filename": filename, "ok": False,
                    "processed": success, "total": total,
                    "image_progress": base_pct + phase_weight,
                    "phase": "describe",
                })

            yield f"data: {event}\n\n"
            await asyncio.sleep(0)

        stop_event.set()
        hb_task.cancel()
        try:
            await hb_task
        except asyncio.CancelledError:
            pass

        yield f"data: {json.dumps({'done': True, 'session_id': body.session_id, 'total': total, 'success': success, 'errors': errors})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
    )


class UpdateDescRequest(BaseModel):
    session_id: str
    filename: str
    ocr_text: Optional[str] = None
    description: Optional[str] = None


@router.patch("/batch/describe-update")
async def update_describe(body: UpdateDescRequest):
    with _sessions_lock:
        session_data = _sessions.get(body.session_id)
        if session_data is None:
            raise HTTPException(status_code=404, detail="Sesion no encontrada")
        entry = session_data.get(body.filename)
        if entry is None:
            raise HTTPException(status_code=404, detail="Imagen no encontrada en sesion")
        if body.ocr_text is not None:
            entry["ocr_text"] = body.ocr_text
        if body.description is not None:
            entry["description"] = body.description
    return {"ok": True}


class IndexRequest(BaseModel):
    session_id: str
    accepted: List[str]
    force: bool = False


# =====================================================
# Phase 4: Index accepted images
# =====================================================
@router.post("/batch/index")
async def index_batch(request: Request, body: IndexRequest):
    from PIL import Image as PILImage

    calib = _get_calibration(request)
    base_pct, phase_weight = _phase_range(calib, "index")

    retrieval_system = request.app.state.retrieval_system
    image_dest = request.app.state.image_dest

    with _sessions_lock:
        session_data = _sessions.get(body.session_id, None)

    if session_data is None:
        raise HTTPException(status_code=404, detail="Sesion no encontrada o expirada")

    accepted = {fn: data for fn, data in session_data.items() if fn in body.accepted}
    total = len(accepted)
    _current_image["total"] = total
    _current_image["phase"] = "index"
    _current_image["processed"] = 0
    loop = asyncio.get_event_loop()

    async def event_stream():
        processed = 0
        duplicates = 0
        errors = []
        hb_queue = asyncio.Queue()
        stop_event = asyncio.Event()
        hb_task = asyncio.create_task(_heartbeat_loop(hb_queue, stop_event))

        for filename, data in accepted.items():
            _current_image["processed"] = processed
            if "image_bytes" not in data:
                errors.append(filename)
                logger.error(f"Saltando {filename}: sin image_bytes (crop falló)")
                yield f"data: {json.dumps({'processed': 0, 'total': total, 'errors': errors, 'done': False, 'filename': filename, 'image_progress': base_pct + phase_weight, 'phase': 'index'})}\n\n"
                continue
            is_duplicate = False
            size_mb = _img_size_mb(data)
            estimated_s = _estimated_s(calib, "index", size_mb)

            _current_image["filename"] = filename
            _current_image["phase"] = "index"
            _current_image["started_at"] = time.time()
            _current_image["estimated_s"] = estimated_s
            _current_image["base_pct"] = base_pct
            _current_image["phase_weight"] = phase_weight

            try:
                png_bytes = data["image_bytes"]
                ocr_text = data.get("ocr_text", "")
                description = data.get("description", "")

                if not description:
                    description = await loop.run_in_executor(
                        PROCESSING_EXECUTOR,
                        describe_image_bytes,
                        png_bytes, ocr_text
                    )

                clip_vector = await loop.run_in_executor(
                    PROCESSING_EXECUTOR,
                    retrieval_system._embed_image,
                    base64.b64encode(png_bytes).decode()
                )

                if not body.force and retrieval_system.last_image_id > 0:
                    results = retrieval_system.search_by_image(png_bytes, k=1)
                    for existing_path, similarity in results:
                        if similarity > 0.95:
                            try:
                                ssim_score = preprocesadoV3.compare_image(
                                    PILImage.open(io.BytesIO(png_bytes)), existing_path
                                )
                            except Exception as ssim_err:
                                logger.warning(f"SSIM fallo para {filename}: {ssim_err}")
                                continue
                            if ssim_score > 0.9:
                                buf_preview = io.BytesIO()
                                preview = PILImage.open(io.BytesIO(png_bytes))
                                preview.thumbnail((400, 400))
                                preview.save(buf_preview, format="PNG")
                                b64_preview = base64.b64encode(buf_preview.getvalue()).decode()

                                duplicates += 1
                                is_duplicate = True

                                for hb in _drain_heartbeat(hb_queue):
                                    yield f"data: {json.dumps(hb)}\n\n"

                                event = json.dumps({
                                    "processed": processed, "total": total,
                                    "errors": errors, "done": False,
                                    "duplicate": True,
                                    "filename": filename,
                                    "new_preview": b64_preview,
                                    "existing_path": existing_path,
                                    "image_progress": base_pct + phase_weight,
                                    "phase": "index",
                                })
                                yield f"data: {event}\n\n"
                                await asyncio.sleep(0)
                                break

                if is_duplicate:
                    continue

                for hb in _drain_heartbeat(hb_queue):
                    yield f"data: {json.dumps(hb)}\n\n"

                last = retrieval_system.last_image_id
                img_path_dest = f"{image_dest}/r{1+last:06}.png"

                img = PILImage.open(io.BytesIO(png_bytes))
                img.save(img_path_dest, format="PNG", optimize=True)
                preprocesadoV3.save_mini(img, img_path_dest)

                await loop.run_in_executor(
                    PROCESSING_EXECUTOR,
                    retrieval_system.index_image,
                    img_path_dest, clip_vector, description, ocr_text
                )

                processed += 1
                _current_image["processed"] = processed

            except Exception as e:
                errors.append(filename)
                logger.error(f"Error indexando {filename}: {e}")
                for hb in _drain_heartbeat(hb_queue):
                    yield f"data: {json.dumps(hb)}\n\n"

            if not is_duplicate:
                event = json.dumps({
                    "processed": processed, "total": total,
                    "errors": errors,
                    "done": (processed + duplicates + len(errors)) == total,
                    "status": "indexed",
                    "filename": filename,
                    "image_progress": base_pct + phase_weight,
                    "phase": "index",
                })
                yield f"data: {event}\n\n"
                await asyncio.sleep(0)

        stop_event.set()
        hb_task.cancel()
        try:
            await hb_task
        except asyncio.CancelledError:
            pass

        yield f"data: {json.dumps({'done': True, 'processed': processed, 'total': total, 'errors': errors, 'duplicates': duplicates})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
    )


class UpdateOcrTextRequest(BaseModel):
    session_id: str
    filename: str
    ocr_text: str


@router.patch("/batch/ocr-text")
async def update_ocr_text(body: UpdateOcrTextRequest):
    with _sessions_lock:
        session_data = _sessions.get(body.session_id)
        if session_data is None:
            raise HTTPException(status_code=404, detail="Sesion no encontrada o expirada")
        if body.filename not in session_data:
            raise HTTPException(status_code=404, detail="Imagen no encontrada en la sesion")
        session_data[body.filename]["ocr_text"] = body.ocr_text
    return {"ok": True}


@router.delete("/batch/session/{session_id}")
async def delete_session(session_id: str):
    with _sessions_lock:
        existed = _sessions.pop(session_id, None) is not None
    return {"deleted": existed}
