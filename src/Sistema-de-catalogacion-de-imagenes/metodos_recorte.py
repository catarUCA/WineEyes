"""Métodos de recorte de etiquetas para comparar en local."""

from __future__ import annotations

import base64
import io
import os
import time
from dataclasses import dataclass
from typing import Callable

import cv2
import numpy as np
import requests
from PIL import Image

REMBG_URL = os.getenv("REMBG_URL", "http://localhost:8001")
LUM_FONDO = 45  # píxeles más oscuros se consideran fondo negro


@dataclass
class ResultadoRecorte:
    metodo: str
    imagen: Image.Image | None
    ok: bool
    ms: float
    detalle: str = ""
    area_ratio: float | None = None


def _cargar_bgr(source: bytes | str) -> np.ndarray:
    if isinstance(source, bytes):
        arr = np.frombuffer(source, np.uint8)
        bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    else:
        bgr = cv2.imread(source, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("No se pudo leer la imagen")
    return bgr


def _rgba_a_pil(rgba: np.ndarray) -> Image.Image:
    rgb = cv2.cvtColor(rgba, cv2.COLOR_BGRA2RGBA)
    return Image.fromarray(rgb)


def _morph(mask: np.ndarray, op: int, ksize: int, iterations: int = 1) -> np.ndarray:
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksize, ksize))
    return cv2.morphologyEx(mask, op, kernel, iterations=iterations)


def _alpha_desde_luminancia(gray: np.ndarray, umbral: int = LUM_FONDO) -> np.ndarray:
    return (gray > umbral).astype(np.uint8) * 255


def _seleccionar_blob_central(mask: np.ndarray) -> tuple[int | None, str]:
    H, W = mask.shape[:2]
    num, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if num <= 1:
        return None, "sin componentes"

    cx_img, cy_img = W / 2, H / 2
    best_i = None
    best_score = -1e9
    for i in range(1, num):
        x, y, w, h, area = stats[i]
        area_ratio = area / float(W * H)
        if area_ratio < 0.04 or area_ratio > 0.75:
            continue
        ccx, ccy = centroids[i]
        dist = np.hypot(ccx - cx_img, ccy - cy_img) / max(W, H)
        touch = int(x <= 2) + int(y <= 2) + int(x + w >= W - 2) + int(y + h >= H - 2)
        if touch >= 4 and area_ratio > 0.40:
            continue
        score = area_ratio - dist * 0.8 - touch * 0.2
        if score < 0:
            continue
        if score > best_score:
            best_score = score
            best_i = i

    if best_i is None:
        return None, "sin blob central válido"
    x, y, w, h, _ = stats[best_i]
    return best_i, f"blob={best_i} bbox={x},{y},{w},{h} score={best_score:.2f}"


def _luminancia_esquinas(bgr: np.ndarray) -> float:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    H, W = gray.shape
    m = min(250, H // 5, W // 5)
    patches = [
        gray[0:m, 0:m],
        gray[0:m, W - m : W],
        gray[H - m : H, 0:m],
        gray[H - m : H, W - m : W],
    ]
    return float(np.mean([p.mean() for p in patches]))


def _tipo_fondo(bgr: np.ndarray) -> str:
    """oscuro = etiqueta clara sobre negro; claro = etiqueta sobre fondo blanco/gris."""
    esquinas = _luminancia_esquinas(bgr)
    if esquinas < 55:
        return "oscuro"
    return "claro"


def _roi_sin_fringe(bgr: np.ndarray) -> tuple[np.ndarray, int]:
    """Recorta la zona útil ignorando franjas laterales (p. ej. papel azul escáner)."""
    H, W = bgr.shape[:2]
    b, g, r = cv2.split(bgr)
    col_score = (b.astype(np.int16) - r.astype(np.int16)) - (g.astype(np.int16) // 2)
    col_mean = col_score.mean(axis=0)
    umbral = np.percentile(col_mean, 70)
    limite = W
    for x in range(W - 1, int(W * 0.55), -1):
        if col_mean[x] < umbral:
            limite = min(W, x + 20)
            break
    limite = max(int(W * 0.72), limite)
    return bgr[:, :limite], limite


def _seleccionar_blob_etiqueta(
    mask: np.ndarray,
    max_ancho_ratio: float = 0.78,
    max_alto_ratio: float = 0.82,
    min_area_ratio: float = 0.05,
    max_area_ratio: float = 0.38,
) -> tuple[int | None, str]:
    H, W = mask.shape[:2]
    num, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if num <= 1:
        return None, "sin componentes"

    cx_img, cy_img = W / 2, H / 2
    best_i = None
    best_score = -1e9
    for i in range(1, num):
        x, y, w, h, area = stats[i]
        area_ratio = area / float(W * H)
        if area_ratio < min_area_ratio or area_ratio > max_area_ratio:
            continue
        if w / W > max_ancho_ratio or h / H > max_alto_ratio:
            continue
        ccx, ccy = centroids[i]
        dist = np.hypot(ccx - cx_img, ccy - cy_img) / max(W, H)
        touch = int(x <= 3) + int(y <= 3) + int(x + w >= W - 3) + int(y + h >= H - 3)
        score = area_ratio - dist * 0.7 - touch * 0.12
        if score > best_score:
            best_score = score
            best_i = i

    if best_i is None:
        return None, "sin blob de etiqueta válido"
    x, y, w, h, _ = stats[best_i]
    return best_i, f"blob={best_i} bbox={x},{y},{w},{h} score={best_score:.2f}"


def _mascara_grabcut_centro(bgr: np.ndarray, max_side: int = 1800, margen_x: float = 0.08, margen_y: float = 0.10) -> np.ndarray:
    H, W = bgr.shape[:2]
    scale = min(1.0, max_side / max(H, W))
    if scale < 1.0:
        sw, sh = int(W * scale), int(H * scale)
        small = cv2.resize(bgr, (sw, sh), interpolation=cv2.INTER_AREA)
    else:
        small = bgr
        sw, sh = W, H

    mx, my = int(sw * margen_x), int(sh * margen_y)
    rw, rh = sw - 2 * mx, sh - 2 * my
    rect = (mx, my, rw, rh)
    mask = np.full((sh, sw), cv2.GC_BGD, dtype=np.uint8)
    mask[my : my + rh, mx : mx + rw] = cv2.GC_PR_FGD

    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(small, mask, rect, bgd, fgd, 3, cv2.GC_INIT_WITH_RECT)
    fgm = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)

    if scale < 1.0:
        fgm = cv2.resize(fgm, (W, H), interpolation=cv2.INTER_NEAREST)

    return _morph(fgm, cv2.MORPH_CLOSE, 21, iterations=3)


def _banda_borde(alpha: np.ndarray, grosor: int = 3) -> np.ndarray:
    """Máscara booleana de píxeles en el borde exterior de alpha."""
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (grosor * 2 + 1, grosor * 2 + 1))
    inner = cv2.erode(alpha, k, iterations=1)
    return (alpha > 0) & (inner == 0)


def _refinar_alpha_claro(bgr: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Devuelve la máscara binaria sin alterar colores del píxel."""
    return (alpha > 0).astype(np.uint8) * 255


def _mascara_fondo_claro(bgr: np.ndarray) -> tuple[np.ndarray, str]:
    """Separa etiqueta de fondo claro: GrabCut amplio; conserva zonas claras/cyan."""
    H, W = bgr.shape[:2]
    roi, limite = _roi_sin_fringe(bgr)

    gc_mask = _mascara_grabcut_centro(roi, margen_x=0.04, margen_y=0.05)
    combined = _morph(gc_mask, cv2.MORPH_CLOSE, 25, iterations=5)

    blob_i, blob_info = _seleccionar_blob_etiqueta(
        combined,
        max_ancho_ratio=0.98,
        max_alto_ratio=0.98,
        min_area_ratio=0.03,
        max_area_ratio=0.65,
    )
    if blob_i is not None:
        _, labels, _, _ = cv2.connectedComponentsWithStats(combined, connectivity=8)
        comp = (labels == blob_i).astype(np.uint8) * 255
        comp = _morph(comp, cv2.MORPH_CLOSE, 31, iterations=5)
        mascara_roi = comp
        info = f"roi_w={limite}; {blob_info}"
    else:
        mascara_roi = combined
        info = f"roi_w={limite}; fallback sin blob"

    full_mask = np.zeros((H, W), np.uint8)
    full_mask[:, :limite] = mascara_roi
    return full_mask, info


MAX_DESKEW_GRADOS = 12.0
MIN_DESKEW_GRADOS = 0.4


def _angulo_inclinacion(alpha: np.ndarray) -> float | None:
    """Inclinación de la etiqueta respecto a la horizontal (grados)."""
    bin_a = (alpha > 127).astype(np.uint8)
    cnts, _ = cv2.findContours(bin_a, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    c = max(cnts, key=cv2.contourArea)
    if cv2.contourArea(c) < 500:
        return None
    (_, _), (rw, rh), angle = cv2.minAreaRect(c)
    if rw < rh:
        angle += 90
    while angle <= -45:
        angle += 90
    while angle > 45:
        angle -= 90
    return float(angle)


def _enderezar_rgba(
    rgba: np.ndarray,
    min_grados: float = MIN_DESKEW_GRADOS,
    max_grados: float = MAX_DESKEW_GRADOS,
) -> tuple[np.ndarray, float]:
    """Rota la etiqueta para alinear bordes horizontales; fondo transparente."""
    ang = _angulo_inclinacion(rgba[:, :, 3])
    if ang is None or abs(ang) < min_grados or abs(ang) > max_grados:
        return rgba, 0.0

    H, W = rgba.shape[:2]
    M = cv2.getRotationMatrix2D((W / 2, H / 2), ang, 1.0)
    cos_a, sin_a = abs(M[0, 0]), abs(M[0, 1])
    nW = int(H * sin_a + W * cos_a)
    nH = int(H * cos_a + W * sin_a)
    M[0, 2] += nW / 2 - W / 2
    M[1, 2] += nH / 2 - H / 2
    rotated = cv2.warpAffine(
        rgba,
        M,
        (nW, nH),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )
    corners = np.float32([[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]])
    pts = cv2.transform(corners.reshape(1, -1, 2), M).reshape(-1, 2)
    pad = max(4, int(max(W, H) * 0.012))
    x1 = max(0, int(np.floor(pts[:, 0].min())) - pad)
    y1 = max(0, int(np.floor(pts[:, 1].min())) - pad)
    x2 = min(nW - 1, int(np.ceil(pts[:, 0].max())) + pad)
    y2 = min(nH - 1, int(np.ceil(pts[:, 1].max())) + pad)
    return rotated[y1 : y2 + 1, x1 : x2 + 1], ang


def _recorte_rgba(
    bgr: np.ndarray,
    fg_mask: np.ndarray,
    padding_pct: float = 0.03,
    umbral_lum: int = LUM_FONDO,
    filtrar_lum: bool = True,
    enderezar: bool = False,
) -> tuple[Image.Image | None, str, float | None]:
    """Recorta al bbox del primer plano. Con filtrar_lum quita fondo negro."""
    H, W = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    alpha = fg_mask.copy()
    if filtrar_lum:
        alpha = cv2.bitwise_and(alpha, _alpha_desde_luminancia(gray, umbral_lum))
    else:
        alpha = _refinar_alpha_claro(bgr, alpha)

    ys, xs = np.where(alpha > 0)
    if len(xs) == 0:
        return None, "máscara vacía", None

    x1, x2 = int(xs.min()), int(xs.max())
    y1, y2 = int(ys.min()), int(ys.max())
    bw, bh = x2 - x1 + 1, y2 - y1 + 1
    pad_x = int(bw * padding_pct)
    pad_y = int(bh * padding_pct)
    x1 = max(0, x1 - pad_x)
    y1 = max(0, y1 - pad_y)
    x2 = min(W - 1, x2 + pad_x)
    y2 = min(H - 1, y2 + pad_y)

    crop_bgr = bgr[y1 : y2 + 1, x1 : x2 + 1]
    crop_alpha = alpha[y1 : y2 + 1, x1 : x2 + 1]
    rgba = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = crop_alpha

    rot_ang = 0.0
    if enderezar:
        rgba, rot_ang = _enderezar_rgba(rgba)

    fh, fw = rgba.shape[:2]
    area_ratio = (fw * fh) / float(W * H)
    detalle = f"crop={x1},{y1},{x2 - x1 + 1},{y2 - y1 + 1} fg={(crop_alpha > 0).mean() * 100:.0f}%"
    if abs(rot_ang) >= MIN_DESKEW_GRADOS:
        detalle += f" rot={rot_ang:+.1f}°"
    return _rgba_a_pil(rgba), detalle, area_ratio


def _ejecutar(nombre: str, fn: Callable[[], tuple[Image.Image | None, str, float | None]]) -> ResultadoRecorte:
    t0 = time.perf_counter()
    try:
        imagen, detalle, area_ratio = fn()
        ms = (time.perf_counter() - t0) * 1000
        return ResultadoRecorte(
            metodo=nombre,
            imagen=imagen,
            ok=imagen is not None,
            ms=ms,
            detalle=detalle,
            area_ratio=area_ratio,
        )
    except Exception as exc:
        ms = (time.perf_counter() - t0) * 1000
        return ResultadoRecorte(
            metodo=nombre,
            imagen=None,
            ok=False,
            ms=ms,
            detalle=str(exc),
        )


def _silueta_rellena(mask: np.ndarray) -> np.ndarray:
    """Rellena el interior del contorno exterior."""
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return mask
    c = max(cnts, key=cv2.contourArea)
    filled = np.zeros_like(mask)
    cv2.drawContours(filled, [c], -1, 255, thickness=cv2.FILLED)
    return filled


def _componente_principal_alpha(alpha: np.ndarray) -> np.ndarray:
    """Elimina motas de fondo: conserva solo el mayor componente opaco."""
    bin_a = (alpha > 127).astype(np.uint8)
    num, labels, stats, _ = cv2.connectedComponentsWithStats(bin_a, connectivity=8)
    if num <= 1:
        return alpha
    main_i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    out = np.zeros_like(alpha)
    out[labels == main_i] = 255
    return out


def _negro_conectado_borde(gray: np.ndarray, umbral: int = 50) -> np.ndarray:
    """Fondo negro del escaneo: píxeles oscuros conectados al borde de la imagen."""
    H, W = gray.shape
    oscuro = (gray < umbral).astype(np.uint8) * 255
    work = oscuro.copy()
    ff = np.zeros((H + 2, W + 2), np.uint8)
    mark = 128
    step_x = max(1, W // 40)
    step_y = max(1, H // 40)
    for x in range(0, W, step_x):
        for y in (0, H - 1):
            if work[y, x] == 255:
                cv2.floodFill(work, ff, (x, y), mark)
    for y in range(0, H, step_y):
        for x in (0, W - 1):
            if work[y, x] == 255:
                cv2.floodFill(work, ff, (x, y), mark)
    return work == mark


def _alpha_fondo_oscuro(bgr: np.ndarray, region_mask: np.ndarray) -> np.ndarray:
    """Silueta rellena menos fondo negro exterior; conserva tinta negra interior."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    sil = _silueta_rellena(region_mask)
    bg = _negro_conectado_borde(gray)
    alpha = np.zeros_like(sil)
    alpha[sil > 0] = 255
    alpha[bg] = 0
    alpha = _componente_principal_alpha(alpha)
    return alpha


def _mascara_binaria_etiqueta(
    gray: np.ndarray,
    thresh: int = 50,
) -> tuple[np.ndarray, int | None, str]:
    """Separa etiqueta clara del fondo; Otsu si el umbral fijo une textura gris del negro."""
    candidatos: list[tuple[str, np.ndarray]] = [
        (f"thresh={thresh}", cv2.threshold(gray, thresh, 255, cv2.THRESH_BINARY)[1]),
    ]
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    candidatos.append(("otsu", otsu))
    for t in range(max(thresh + 5, 55), 95, 5):
        _, m = cv2.threshold(gray, t, 255, cv2.THRESH_BINARY)
        candidatos.append((f"thresh={t}", m))

    ultima: np.ndarray | None = None
    for etiqueta, raw in candidatos:
        mask = _morph(raw, cv2.MORPH_CLOSE, 15, iterations=4)
        ultima = mask
        blob_i, blob_info = _seleccionar_blob_central(mask)
        if blob_i is not None:
            return mask, blob_i, f"{etiqueta}; {blob_info}"

    _, blob_info = _seleccionar_blob_central(ultima if ultima is not None else candidatos[0][1])
    return ultima if ultima is not None else candidatos[0][1], None, blob_info


def _mascara_fondo_oscuro(
    bgr: np.ndarray,
    thresh: int = 50,
    dilate: int = 2,
) -> tuple[np.ndarray, str]:
    """Máscara alpha para etiqueta clara sobre fondo negro."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    mask, blob_i, blob_info = _mascara_binaria_etiqueta(gray, thresh)
    if blob_i is None:
        return _alpha_fondo_oscuro(bgr, mask), blob_info
    _, labels, _, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    comp = (labels == blob_i).astype(np.uint8) * 255
    if dilate > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
        comp = cv2.dilate(comp, k, iterations=dilate)
    return _alpha_fondo_oscuro(bgr, comp), blob_info


def recorte_fondo_oscuro(source: bytes | str, thresh: int = 50) -> ResultadoRecorte:
    """Etiqueta clara sobre fondo negro: conserva puntas y laterales."""

    def run():
        bgr = _cargar_bgr(source)
        comp_mask, blob_info = _mascara_fondo_oscuro(bgr, thresh=thresh, dilate=2)
        if blob_info.startswith("sin"):
            return None, blob_info, None
        img, det, ratio = _recorte_rgba(
            bgr, comp_mask, padding_pct=0.05, filtrar_lum=False, enderezar=True
        )
        return img, f"{blob_info}; {det}", ratio

    return _ejecutar("fondo_oscuro", run)


def recorte_fondo_oscuro_amplio(source: bytes | str) -> ResultadoRecorte:
    """Variante conservadora: más margen en bordes cóncavos y laterales."""

    def run():
        bgr = _cargar_bgr(source)
        comp_mask, blob_info = _mascara_fondo_oscuro(bgr, thresh=48, dilate=3)
        if blob_info.startswith("sin"):
            return None, blob_info, None
        img, det, ratio = _recorte_rgba(
            bgr, comp_mask, padding_pct=0.06, filtrar_lum=False, enderezar=True
        )
        return img, f"{blob_info}; {det}", ratio

    return _ejecutar("fondo_oscuro_amplio", run)


def recorte_fondo_oscuro_grabcut(source: bytes | str, thresh: int = 50) -> ResultadoRecorte:
    """Refina el blob inicial con GrabCut para bordes más limpios."""

    def run():
        bgr = _cargar_bgr(source)
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        H, W = gray.shape[:2]
        comp_mask, blob_info = _mascara_fondo_oscuro(bgr, thresh=thresh, dilate=0)
        if blob_info.startswith("sin"):
            return None, blob_info, None

        _, labels, stats, _ = cv2.connectedComponentsWithStats(
            (comp_mask > 0).astype(np.uint8) * 255, connectivity=8
        )
        blob_i = 1 + np.argmax(stats[1:, 4])
        x, y, w, h, _ = stats[blob_i]
        pad_x, pad_y = int(w * 0.08), int(h * 0.08)
        rect = (
            max(0, x - pad_x),
            max(0, y - pad_y),
            min(W, x + w + pad_x),
            min(H, y + h + pad_y),
        )

        bgd = np.zeros((1, 65), np.float64)
        fgd = np.zeros((1, 65), np.float64)
        gc_mask = np.zeros((H, W), np.uint8)
        gc_mask[rect[1] : rect[3], rect[0] : rect[2]] = cv2.GC_PR_FGD
        gc_mask[labels == blob_i] = cv2.GC_FGD
        gc_mask[gray < 30] = cv2.GC_BGD

        cv2.grabCut(bgr, gc_mask, rect, bgd, fgd, 4, cv2.GC_INIT_WITH_MASK)
        fg_mask = np.where((gc_mask == cv2.GC_FGD) | (gc_mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
        fg_mask = _morph(fg_mask, cv2.MORPH_CLOSE, 9, iterations=2)
        fg_mask = _alpha_fondo_oscuro(bgr, fg_mask)

        img, det, ratio = _recorte_rgba(
            bgr, fg_mask, padding_pct=0.05, filtrar_lum=False, enderezar=True
        )
        return img, f"{blob_info}; {det}", ratio

    return _ejecutar("fondo_oscuro_grabcut", run)


def recorte_fondo_claro(source: bytes | str) -> ResultadoRecorte:
    """Etiqueta sobre fondo blanco/gris: GrabCut central + diferencia de color."""

    def run():
        bgr = _cargar_bgr(source)
        mask, info = _mascara_fondo_claro(bgr)
        img, det, ratio = _recorte_rgba(bgr, mask, padding_pct=0.06, filtrar_lum=False, enderezar=True)
        return img, f"{info}; {det}", ratio

    return _ejecutar("fondo_claro", run)


def recorte_auto_v1(source: bytes | str) -> ResultadoRecorte:
    """Router v1: solo oscuro/claro binario."""

    def run():
        bgr = _cargar_bgr(source)
        tipo = _tipo_fondo(bgr)
        esquinas = _luminancia_esquinas(bgr)
        if tipo == "oscuro":
            comp_mask, blob_info = _mascara_fondo_oscuro(bgr, thresh=50, dilate=2)
            if blob_info.startswith("sin"):
                return None, f"tipo=oscuro(l={esquinas:.0f}); {blob_info}", None
            img, det, ratio = _recorte_rgba(
                bgr, comp_mask, padding_pct=0.05, filtrar_lum=False, enderezar=True
            )
            return img, f"tipo=oscuro(l={esquinas:.0f}); {blob_info}; {det}", ratio

        mask, info = _mascara_fondo_claro(bgr)
        img, det, ratio = _recorte_rgba(bgr, mask, padding_pct=0.06, filtrar_lum=False, enderezar=True)
        return img, f"tipo=claro(l={esquinas:.0f}); {info}; {det}", ratio

    return _ejecutar("auto_v1", run)


def recorte_auto(source: bytes | str) -> ResultadoRecorte:
    """Router v2: escena → máscara → forma → recorte."""

    def run():
        from pipeline_v2 import recortar_v2

        return recortar_v2(source)

    return _ejecutar("auto", run)


def recorte_contorno_claro(source: bytes | str) -> ResultadoRecorte:
    """Alias de fondo_claro para compatibilidad."""

    def run():
        res = recorte_fondo_claro(source)
        return res.imagen, res.detalle, res.area_ratio

    return _ejecutar("contorno_claro", run)


def recorte_circulo_contorno(source: bytes | str, padding_pct: float = 0.06) -> ResultadoRecorte:
    def run():
        bgr = _cargar_bgr(source)
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        _, mask = cv2.threshold(blur, 55, 255, cv2.THRESH_BINARY)
        mask = _morph(mask, cv2.MORPH_CLOSE, 11, iterations=3)

        blob_i, blob_info = _seleccionar_blob_central(mask)
        if blob_i is None:
            return None, blob_info, None

        _, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        comp = (labels == blob_i).astype(np.uint8) * 255
        cnts, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            return None, "sin contorno", None
        cnt = max(cnts, key=cv2.contourArea)
        circ = 4 * np.pi * cv2.contourArea(cnt) / (cv2.arcLength(cnt, True) ** 2 + 1e-6)

        circle_mask = np.zeros_like(comp)
        if circ >= 0.45:
            (cx, cy), radius = cv2.minEnclosingCircle(cnt)
            cv2.circle(circle_mask, (int(cx), int(cy)), int(radius * 1.02), 255, -1)
            det = f"circ={circ:.2f}, r={radius:.0f}"
        else:
            cv2.drawContours(circle_mask, [cnt], -1, 255, -1)
            det = f"contorno circ={circ:.2f}"

        img, det2, ratio = _recorte_rgba(bgr, circle_mask, padding_pct)
        return img, f"{det}; {det2}", ratio

    return _ejecutar("circulo_contorno", run)


def recorte_hough(source: bytes | str, padding_pct: float = 0.06) -> ResultadoRecorte:
    def run():
        bgr = _cargar_bgr(source)
        H, W = bgr.shape[:2]
        scale = min(1.0, 1600 / max(H, W))
        if scale < 1.0:
            bgr_s = cv2.resize(bgr, (int(W * scale), int(H * scale)), interpolation=cv2.INTER_AREA)
        else:
            bgr_s = bgr

        gray = cv2.cvtColor(bgr_s, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (9, 9), 2)
        h_s, w_s = gray.shape[:2]
        circles = cv2.HoughCircles(
            blur,
            cv2.HOUGH_GRADIENT,
            dp=1.2,
            minDist=min(h_s, w_s) // 3,
            param1=80,
            param2=35,
            minRadius=int(min(h_s, w_s) * 0.15),
            maxRadius=int(min(h_s, w_s) * 0.48),
        )
        if circles is None:
            return None, "sin círculos detectados", None

        cx, cy, radius = max(circles[0], key=lambda c: c[2])
        if scale < 1.0:
            cx, cy, radius = cx / scale, cy / scale, radius / scale

        circle_mask = np.zeros((H, W), np.uint8)
        cv2.circle(circle_mask, (int(cx), int(cy)), int(radius * 1.03), 255, -1)
        gray_full = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        circle_mask = cv2.bitwise_and(circle_mask, _alpha_desde_luminancia(gray_full, 40))

        img, det, ratio = _recorte_rgba(bgr, circle_mask, padding_pct)
        return img, f"cx={cx:.0f},cy={cy:.0f},r={radius:.0f}; {det}", ratio

    return _ejecutar("hough_circulo", run)


def _enderezar_pil(img: Image.Image) -> tuple[Image.Image, float]:
    """Endereza una imagen RGBA usando el canal alpha."""
    bgra = cv2.cvtColor(np.array(img.convert("RGBA")), cv2.COLOR_RGBA2BGRA)
    bgra, ang = _enderezar_rgba(bgra)
    out = _rgba_a_pil(bgra)
    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    return out, ang


def rembg_crop(
    source: bytes | str,
    enderezar: bool = True,
) -> tuple[Image.Image | None, str, float | None]:
    """Recorte vía rembg-service (mismo endpoint que producción). None si no disponible."""
    if isinstance(source, str):
        with open(source, "rb") as f:
            img_bytes = f.read()
    else:
        img_bytes = source
    try:
        img_base64 = base64.b64encode(img_bytes).decode()
        r = requests.post(f"{REMBG_URL}/crop", json={"image": img_base64}, timeout=120)
        r.raise_for_status()
        data = r.json()
        if not data.get("success"):
            return None, data.get("error", "success=false"), None
        result_bytes = base64.b64decode(data["image"])
        img = Image.open(io.BytesIO(result_bytes)).convert("RGBA")
        bbox = img.getbbox()
        if not bbox:
            return None, "máscara vacía", None
        img = img.crop(bbox)
        if enderezar:
            img, ang = _enderezar_pil(img)
        else:
            ang = 0.0
        orig = _cargar_bgr(img_bytes)
        area_ratio = (img.size[0] * img.size[1]) / float(orig.shape[0] * orig.shape[1])
        detalle = "rembg-service ok"
        if abs(ang) >= MIN_DESKEW_GRADOS:
            detalle += f" rot={ang:+.1f}°"
        return img, detalle, area_ratio
    except requests.RequestException as exc:
        return None, f"rembg no disponible ({exc})", None


def recorte_rembg_servicio(source: bytes | str) -> ResultadoRecorte:
    def run():
        return rembg_crop(source)

    return _ejecutar("rembg_servicio", run)


METODOS_OPENCV = {
    "auto": recorte_auto,
    "auto_v1": recorte_auto_v1,
    "fondo_oscuro": recorte_fondo_oscuro,
    "fondo_oscuro_amplio": recorte_fondo_oscuro_amplio,
    "fondo_claro": recorte_fondo_claro,
    "fondo_oscuro_grabcut": recorte_fondo_oscuro_grabcut,
    "contorno_claro": recorte_contorno_claro,
    "circulo_contorno": recorte_circulo_contorno,
    "hough_circulo": recorte_hough,
}

METODOS_CATEGORIA = {
    "auto": ("recomendado", "Router v2: escena × forma → método óptimo"),
    "auto_v1": ("recomendado", "Router v1 (legacy): solo oscuro/claro"),
    "fondo_oscuro": ("fondo_oscuro", "Etiqueta clara sobre negro — equilibrado"),
    "fondo_oscuro_amplio": ("fondo_oscuro", "Sobre negro — conserva laterales y puntas"),
    "fondo_oscuro_grabcut": ("fondo_oscuro", "Sobre negro — bordes finos con GrabCut (lento)"),
    "fondo_claro": ("fondo_claro", "Etiqueta sobre blanco/gris de escaneo"),
    "contorno_claro": ("fondo_claro", "Alias de fondo_claro"),
    "circulo_contorno": ("formas", "Etiquetas circulares por contorno"),
    "hough_circulo": ("formas", "Etiquetas circulares — Hough (lento)"),
    "rembg_servicio": ("externo", "Servicio rembg remoto"),
}

METODOS_RECOMENDADOS = {
    "oscuro": ["auto", "fondo_oscuro_amplio", "fondo_oscuro"],
    "negro": ["auto", "fondo_oscuro_amplio", "fondo_oscuro"],
    "gris": ["rembg_servicio", "auto", "fondo_oscuro_amplio", "fondo_claro"],
    "claro": ["auto", "fondo_claro"],
    "escaneo": ["auto", "fondo_claro"],
}


def info_metodo(nombre: str) -> tuple[str, str]:
    return METODOS_CATEGORIA.get(nombre, ("otros", ""))


def recomendados_para(tipo_fondo: str) -> list[str]:
    return METODOS_RECOMENDADOS.get(tipo_fondo, ["auto"])


def ejecutar_metodo(nombre: str, source: bytes | str) -> ResultadoRecorte:
    if nombre == "rembg_servicio":
        return recorte_rembg_servicio(source)
    if nombre in METODOS_OPENCV:
        return METODOS_OPENCV[nombre](source)
    raise ValueError(f"Método desconocido: {nombre}")


def listar_metodos(incluir_rembg: bool = True, incluir_hough: bool = True) -> list[str]:
    nombres = list(METODOS_OPENCV.keys())
    if not incluir_hough and "hough_circulo" in nombres:
        nombres.remove("hough_circulo")
    if incluir_rembg:
        nombres.append("rembg_servicio")
    return nombres


def todos_los_metodos(
    source: bytes | str,
    incluir_rembg: bool = True,
    incluir_hough: bool = True,
) -> list[ResultadoRecorte]:
    return [
        ejecutar_metodo(nombre, source)
        for nombre in listar_metodos(incluir_rembg=incluir_rembg, incluir_hough=incluir_hough)
    ]
