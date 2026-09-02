"""Parámetros tunables y ejecución manual de recortes."""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from typing import Any

from PIL import Image

from metodos_recorte import (
    ResultadoRecorte,
    _cargar_bgr,
    _recorte_rgba,
    _mascara_fondo_oscuro,
    _mascara_fondo_claro,
    ejecutar_metodo,
    info_metodo,
    listar_metodos,
)


@dataclass
class ParametrosRecorte:
    metodo: str = "auto"
    forzar_ruta: str | None = None
    padding_pct: float = 0.06
    otsu_thresh: int = 48
    otsu_dilate: int = 3
    enderezar: bool | None = None
    color_diff: int = 25
    umbral_lum: int = 45
    rembg_enderezar: bool = True

    @classmethod
    def desde_dict(cls, data: dict[str, Any]) -> ParametrosRecorte:
        campos = {k: v for k, v in data.items() if k in cls.__dataclass_fields__}
        return cls(**campos)


RUTAS_AUTO = [
    "rembg",
    "otsu_amplio",
    "otsu_rect",
    "otsu_circulo",
    "otsu_rombo",
    "otsu_irregular",
    "grabcut",
    "grabcut_circulo",
    "pequeña",
]

SCHEMA_UI: dict[str, Any] = {
    "metodos": [],
    "rutas": RUTAS_AUTO,
    "parametros": [
        {
            "id": "metodo",
            "label": "Método",
            "tipo": "select",
            "grupo": "general",
        },
        {
            "id": "forzar_ruta",
            "label": "Forzar ruta (solo auto)",
            "tipo": "select",
            "opciones": [""] + RUTAS_AUTO,
            "grupo": "router",
        },
        {
            "id": "padding_pct",
            "label": "Margen borde (%)",
            "tipo": "range",
            "min": 0,
            "max": 15,
            "step": 1,
            "default": 6,
            "grupo": "opencv",
        },
        {
            "id": "otsu_thresh",
            "label": "Umbral Otsu",
            "tipo": "range",
            "min": 30,
            "max": 90,
            "step": 1,
            "default": 48,
            "grupo": "opencv",
        },
        {
            "id": "otsu_dilate",
            "label": "Dilatación máscara",
            "tipo": "range",
            "min": 0,
            "max": 8,
            "step": 1,
            "default": 3,
            "grupo": "opencv",
        },
        {
            "id": "umbral_lum",
            "label": "Luminancia fondo negro",
            "tipo": "range",
            "min": 20,
            "max": 80,
            "step": 1,
            "default": 45,
            "grupo": "opencv",
        },
        {
            "id": "enderezar",
            "label": "Enderezar etiqueta",
            "tipo": "tristate",
            "opciones": ["auto", "sí", "no"],
            "default": "auto",
            "grupo": "opencv",
        },
        {
            "id": "color_diff",
            "label": "Diff. color esquinas (pequeña)",
            "tipo": "range",
            "min": 10,
            "max": 60,
            "step": 1,
            "default": 25,
            "grupo": "pequeña",
        },
        {
            "id": "rembg_enderezar",
            "label": "Enderezar tras rembg",
            "tipo": "bool",
            "default": True,
            "grupo": "rembg",
        },
    ],
}


def schema_metodos(incluir_rembg: bool = True) -> dict[str, Any]:
    schema = dict(SCHEMA_UI)
    metodos = []
    for nombre in listar_metodos(incluir_rembg=incluir_rembg, incluir_hough=False):
        cat, desc = info_metodo(nombre)
        metodos.append({"id": nombre, "categoria": cat, "descripcion": desc})
    schema["metodos"] = metodos
  # actualizar opciones del select metodo
    for p in schema["parametros"]:
        if p["id"] == "metodo":
            p["opciones"] = [m["id"] for m in metodos]
    return schema


def _enderezar_flag(params: ParametrosRecorte, default: bool) -> bool:
    if params.enderezar is None:
        return default
    return params.enderezar


def _recorte_otsu_manual(
    source: bytes | str,
    params: ParametrosRecorte,
    amplio: bool = True,
) -> tuple[Image.Image | None, str, float | None]:
    bgr = _cargar_bgr(source)
    comp_mask, blob_info = _mascara_fondo_oscuro(
        bgr, thresh=params.otsu_thresh, dilate=params.otsu_dilate
    )
    if blob_info.startswith("sin"):
        return None, blob_info, None
    pad = params.padding_pct / 100.0 if amplio else params.padding_pct / 100.0 * 0.85
    end = _enderezar_flag(params, amplio)
    img, det, ratio = _recorte_rgba(
        bgr,
        comp_mask,
        padding_pct=pad,
        umbral_lum=params.umbral_lum,
        filtrar_lum=False,
        enderezar=end,
    )
    modo = "otsu_amplio" if amplio else "otsu"
    return img, f"{modo} thresh={params.otsu_thresh} dil={params.otsu_dilate}; {blob_info}; {det}", ratio


def _recorte_grabcut_manual(
    source: bytes | str,
    params: ParametrosRecorte,
) -> tuple[Image.Image | None, str, float | None]:
    bgr = _cargar_bgr(source)
    mask, info = _mascara_fondo_claro(bgr)
    img, det, ratio = _recorte_rgba(
        bgr,
        mask,
        padding_pct=params.padding_pct / 100.0,
        filtrar_lum=False,
        enderezar=_enderezar_flag(params, True),
    )
    return img, f"grabcut pad={params.padding_pct}%; {info}; {det}", ratio


def recortar_con_parametros(
    source: bytes | str,
    params: ParametrosRecorte,
) -> ResultadoRecorte:
    t0 = time.perf_counter()
    metodo = params.metodo

    try:
        if metodo == "auto":
            from pipeline_v2 import recortar_v2

            img, det, ratio = recortar_v2(source, params=params)
        elif metodo in ("fondo_oscuro_amplio", "otsu_amplio"):
            img, det, ratio = _recorte_otsu_manual(source, params, amplio=True)
        elif metodo == "fondo_oscuro":
            p = ParametrosRecorte(
                **{**asdict(params), "otsu_dilate": max(1, params.otsu_dilate - 1)}
            )
            img, det, ratio = _recorte_otsu_manual(source, p, amplio=False)
        elif metodo in ("fondo_claro", "contorno_claro", "grabcut"):
            img, det, ratio = _recorte_grabcut_manual(source, params)
        elif metodo == "rembg_servicio":
            from metodos_recorte import rembg_crop

            img, det, ratio = rembg_crop(source, enderezar=params.rembg_enderezar)
        else:
            res = ejecutar_metodo(metodo, source)
            return res

        ms = (time.perf_counter() - t0) * 1000
        return ResultadoRecorte(
            metodo=metodo,
            imagen=img,
            ok=img is not None,
            ms=ms,
            detalle=det or "",
            area_ratio=ratio,
        )
    except Exception as exc:
        ms = (time.perf_counter() - t0) * 1000
        return ResultadoRecorte(
            metodo=metodo,
            imagen=None,
            ok=False,
            ms=ms,
            detalle=str(exc),
            area_ratio=None,
        )
