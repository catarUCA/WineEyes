from __future__ import annotations

import base64
import io
import json
import logging
import threading

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from PIL import Image

from metodos_recorte import _cargar_bgr
from parametros_recorte import ParametrosRecorte, recortar_con_parametros, schema_metodos
from pipeline_v2 import analizar

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/upload/afinar", tags=["afinador"])

_sessions_lock_ref = None


def _get_sessions():
    from api.routes_upload import _sessions, _sessions_lock
    global _sessions_lock_ref
    _sessions_lock_ref = _sessions_lock
    return _sessions


def _analisis_dict(bgr) -> dict:
    a = analizar(bgr)
    return {
        "escena": a.escena_etiqueta,
        "luminancia": round(a.escena.luminancia),
        "forma": a.forma.tipo,
        "circularidad": round(a.forma.circularidad, 3),
        "angulo": round(a.forma.angulo, 1),
        "es_malla": a.es_malla,
        "ruta": a.ruta,
        "razon": a.razon,
        "size": f"{a.ancho}x{a.alto}",
        "params_sugeridos": {
            "metodo": "auto",
            "forzar_ruta": a.ruta if a.ruta != "pequeña" else "",
        },
    }


def _preview_jpeg_b64(img: Image.Image, max_side: int = 900) -> str:
    thumb = img.copy().convert("RGBA")
    thumb.thumbnail((max_side, max_side), Image.LANCZOS)
    bg = Image.new("RGBA", thumb.size, (210, 210, 210, 255))
    bg.alpha_composite(thumb)
    buf = io.BytesIO()
    bg.convert("RGB").save(buf, format="JPEG", quality=88)
    return base64.b64encode(buf.getvalue()).decode("ascii")


class AfinarIniciarRequest(BaseModel):
    session_id: str
    filename: str


class AfinarRecortarRequest(BaseModel):
    session_id: str
    filename: str
    params: dict


class AfinarAplicarRequest(BaseModel):
    session_id: str
    filename: str
    params: dict


@router.post("/iniciar")
async def afinar_iniciar(body: AfinarIniciarRequest):
    sessions = _get_sessions()
    lock = _sessions_lock_ref

    with lock:
        session_data = sessions.get(body.session_id)
        if session_data is None:
            raise HTTPException(status_code=404, detail="Sesión no encontrada")
        entry = session_data.get(body.filename)
        if entry is None:
            raise HTTPException(status_code=404, detail="Imagen no encontrada en sesión")

        orig_bytes = entry.get("orig_bytes")
        if orig_bytes is None:
            raise HTTPException(status_code=400, detail="Imagen original no disponible")

    try:
        bgr = _cargar_bgr(orig_bytes)
        analisis = _analisis_dict(bgr)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error analizando: {e}")

    with Image.open(io.BytesIO(orig_bytes)) as img:
        original_b64 = _preview_jpeg_b64(img)

    crop_actual_b64 = None
    if entry.get("crop_preview"):
        crop_actual_b64 = entry["crop_preview"]
    elif entry.get("image_bytes"):
        try:
            with Image.open(io.BytesIO(entry["image_bytes"])) as img:
                crop_actual_b64 = _preview_jpeg_b64(img)
        except Exception:
            pass

    schema = schema_metodos(incluir_rembg=True)

    return {
        "original_b64": original_b64,
        "crop_actual_b64": crop_actual_b64,
        "analisis": analisis,
        "schema": schema,
    }


@router.post("/recortar")
async def afinar_recortar(body: AfinarRecortarRequest):
    sessions = _get_sessions()
    lock = _sessions_lock_ref

    with lock:
        session_data = sessions.get(body.session_id)
        if session_data is None:
            raise HTTPException(status_code=404, detail="Sesión no encontrada")
        entry = session_data.get(body.filename)
        if entry is None:
            raise HTTPException(status_code=404, detail="Imagen no encontrada")
        orig_bytes = entry.get("orig_bytes")

    if orig_bytes is None:
        raise HTTPException(status_code=400, detail="Imagen original no disponible")

    pdict = body.params

    if pdict.get("enderezar") == "auto":
        pdict["enderezar"] = None
    elif pdict.get("enderezar") == "sí":
        pdict["enderezar"] = True
    elif pdict.get("enderezar") == "no":
        pdict["enderezar"] = False

    if not pdict.get("forzar_ruta"):
        pdict["forzar_ruta"] = None

    try:
        prm = ParametrosRecorte.desde_dict(pdict)
        res = recortar_con_parametros(orig_bytes, prm)
    except Exception as e:
        return {"ok": False, "detalle": str(e), "ms": 0}

    out: dict = {
        "ok": res.ok,
        "metodo": res.metodo,
        "ms": round(res.ms, 1),
        "detalle": res.detalle,
        "area_ratio": res.area_ratio,
        "preview_b64": None,
    }
    if res.imagen is not None:
        out["preview_b64"] = _preview_jpeg_b64(res.imagen)
        out["size"] = f"{res.imagen.size[0]}x{res.imagen.size[1]}"
    return out


@router.post("/aplicar")
async def afinar_aplicar(body: AfinarAplicarRequest):
    sessions = _get_sessions()
    lock = _sessions_lock_ref

    with lock:
        session_data = sessions.get(body.session_id)
        if session_data is None:
            raise HTTPException(status_code=404, detail="Sesión no encontrada")
        entry = session_data.get(body.filename)
        if entry is None:
            raise HTTPException(status_code=404, detail="Imagen no encontrada")
        orig_bytes = entry.get("orig_bytes")

    if orig_bytes is None:
        raise HTTPException(status_code=400, detail="Imagen original no disponible")

    pdict = body.params
    if pdict.get("enderezar") == "auto":
        pdict["enderezar"] = None
    elif pdict.get("enderezar") == "sí":
        pdict["enderezar"] = True
    elif pdict.get("enderezar") == "no":
        pdict["enderezar"] = False
    if not pdict.get("forzar_ruta"):
        pdict["forzar_ruta"] = None

    try:
        prm = ParametrosRecorte.desde_dict(pdict)
        res = recortar_con_parametros(orig_bytes, prm)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not res.ok or res.imagen is None:
        raise HTTPException(status_code=400, detail=res.detalle or "Recorte falló")

    buf = io.BytesIO()
    res.imagen.save(buf, format="PNG", optimize=True)
    image_bytes = buf.getvalue()

    preview_b64 = _preview_jpeg_b64(res.imagen)

    with lock:
        entry["image_bytes"] = image_bytes
        entry["crop_preview"] = preview_b64

    return {
        "ok": True,
        "size": f"{res.imagen.size[0]}x{res.imagen.size[1]}",
        "preview_b64": preview_b64,
    }
