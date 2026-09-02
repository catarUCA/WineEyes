"""Pipeline de recorte v2: análisis escena+forma → elección de método → recorte."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import cv2
import numpy as np
from PIL import Image

from metodos_recorte import (
    MAX_DESKEW_GRADOS,
    MIN_DESKEW_GRADOS,
    _angulo_inclinacion,
    _cargar_bgr,
    _enderezar_rgba,
    _luminancia_esquinas,
    _mascara_fondo_claro,
    _mascara_fondo_oscuro,
    _morph,
    _recorte_rgba,
    _refinar_alpha_claro,
    _rgba_a_pil,
    _silueta_rellena,
    rembg_crop,
)

if TYPE_CHECKING:
    from parametros_recorte import ParametrosRecorte

MAX_AREA_MALLA = 0.52


@dataclass
class Escena:
    tipo: str
    luminancia: float
    tiene_fringe: bool = False


@dataclass
class Forma:
    tipo: str
    circularidad: float
    angulo: float


@dataclass
class Analisis:
    escena: Escena
    forma: Forma
    es_malla: bool
    ruta: str
    razon: str
    ancho: int
    alto: int

    @property
    def escena_etiqueta(self) -> str:
        if self.es_malla:
            return f"{self.escena.tipo}+malla"
        return self.escena.tipo


def clasificar_escena(bgr: np.ndarray) -> Escena:
    lum = _luminancia_esquinas(bgr)
    if lum < 55:
        return Escena("negro", lum, False)
    if lum < 140:
        return Escena("gris", lum, False)
    return Escena("claro", lum, False)


def puntuar_mascara(mask: np.ndarray, W: int, H: int) -> tuple[float, dict]:
    """Mayor puntuación = máscara más plausible para una etiqueta."""
    ys, xs = np.where(mask > 127)
    if len(xs) < 200:
        return -1.0, {}

    x1, x2 = int(xs.min()), int(xs.max())
    y1, y2 = int(ys.min()), int(ys.max())
    bw, bh = x2 - x1 + 1, y2 - y1 + 1
    bbox_ratio = (bw * bh) / float(W * H)
    mask_ratio = len(xs) / float(W * H)
    fill_ratio = len(xs) / float(bw * bh)

    if bbox_ratio < 0.08 or bbox_ratio > 0.78:
        return -1.0, {}
    if mask_ratio > 0.82:
        return -1.0, {}

    aspect = max(bw, bh) / max(min(bw, bh), 1)
    if bw / W > 0.78 and aspect < 2.5:
        return -1.0, {}

    touch = (
        int(x1 <= 3)
        + int(y1 <= 3)
        + int(x2 >= W - 4)
        + int(y2 >= H - 4)
    )
    if touch >= 3 and bbox_ratio > 0.65:
        return -1.0, {}
    if x1 <= 3 and x2 >= W - 4 and bw / W > 0.82:
        return -1.0, {}

    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    dist = np.hypot(cx - W / 2, cy - H / 2) / max(W, H)

    score = bbox_ratio * 0.35 + fill_ratio * 0.18 + (1 - dist) * 0.22 - touch * 0.08
    if bbox_ratio > 0.55:
        score -= (bbox_ratio - 0.55) * 0.9
    if 0.18 <= bbox_ratio <= 0.55:
        score += 0.12

    meta = {"bbox_ratio": bbox_ratio, "touch": touch, "bw": bw, "bh": bh}
    return float(score), meta


def _mascaras_candidatas(bgr: np.ndarray, escena: Escena) -> list[tuple[str, np.ndarray, str]]:
    candidatos: list[tuple[str, np.ndarray, str]] = []
    if escena.tipo in ("negro", "gris"):
        m, info = _mascara_fondo_oscuro(bgr)
        candidatos.append(("otsu", m, info))
    if escena.tipo in ("gris", "claro"):
        m, info = _mascara_fondo_claro(bgr)
        candidatos.append(("grabcut", m, info))
    if escena.tipo == "negro":
        return candidatos
    return candidatos


def mascaras_ranked(
    bgr: np.ndarray,
    escena: Escena,
    preferir: str | None = None,
) -> list[tuple[str, np.ndarray, str, float]]:
    """Candidatos ordenados por puntuación; `preferir` impulsa otsu o grabcut."""
    H, W = bgr.shape[:2]
    candidatos = _mascaras_candidatas(bgr, escena)
    ranked: list[tuple[str, np.ndarray, str, float]] = []
    for nombre, mask, info in candidatos:
        score, meta = puntuar_mascara(mask, W, H)
        if score < 0:
            continue
        if escena.tipo == "gris" and nombre == "otsu" and meta.get("bbox_ratio", 1) < 0.58:
            score += 0.04
        if preferir and nombre == preferir:
            score += 0.15
        ranked.append((nombre, mask, info, score))
    ranked.sort(key=lambda x: x[3], reverse=True)
    return ranked


def detectar_forma(mask: np.ndarray) -> Forma:
    bin_a = (mask > 127).astype(np.uint8)
    cnts, _ = cv2.findContours(bin_a, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return Forma("irregular", 0.0, 0.0)

    c = max(cnts, key=cv2.contourArea)
    area = cv2.contourArea(c)
    if area < 500:
        return Forma("irregular", 0.0, 0.0)

    perim = cv2.arcLength(c, True)
    circ = float(4 * np.pi * area / (perim * perim + 1e-6))
    hull = cv2.convexHull(c)
    solidity = float(area / (cv2.contourArea(hull) + 1e-6))
    _, _, bw, bh = cv2.boundingRect(c)
    extent = float(area / (bw * bh + 1e-6))

    epsilon = 0.02 * perim
    approx = cv2.approxPolyDP(c, epsilon, True)
    ang = _angulo_inclinacion(mask) or 0.0

    # Die-cut / formas con puntas: baja compacidad respecto al bbox
    if extent < 0.72 or circ < 0.52:
        return Forma("irregular", circ, ang)

    if circ >= 0.72:
        ys, xs = np.where(mask > 127)
        if len(xs) > 0:
            bw = int(xs.max() - xs.min() + 1)
            bh = int(ys.max() - ys.min() + 1)
            aspect = max(bw, bh) / max(min(bw, bh), 1)
            if aspect < 1.4:
                return Forma("circulo", circ, ang)

    if len(approx) == 4 and solidity > 0.84:
        pts = approx.reshape(4, 2).astype(np.float32)
        angles = []
        for i in range(4):
            p0, p1, p2 = pts[i], pts[(i + 1) % 4], pts[(i + 2) % 4]
            v1, v2 = p0 - p1, p2 - p1
            denom = np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-6
            cos_a = float(np.dot(v1, v2) / denom)
            angles.append(float(np.degrees(np.arccos(np.clip(cos_a, -1, 1)))))
        if max(abs(a - 90) for a in angles) > 25:
            return Forma("rombo", circ, ang)
        return Forma("rectangulo", circ, ang)

    if solidity < 0.88:
        return Forma("irregular", circ, ang)
    return Forma("rectangulo", circ, ang)


def _textura_local(gray: np.ndarray) -> np.ndarray:
    g = gray.astype(np.float32)
    blur = cv2.GaussianBlur(g, (0, 0), 2.5)
    return np.sqrt(cv2.GaussianBlur((g - blur) ** 2, (0, 0), 7))


def _es_fondo_texturizado(bgr: np.ndarray) -> bool:
    """Fondo gris con malla/tejido: bordes más rugosos que el centro de la etiqueta."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    H, W = gray.shape[:2]
    lstd = _textura_local(gray)
    cx0, cx1 = int(W * 0.30), int(W * 0.70)
    cy0, cy1 = int(H * 0.30), int(H * 0.70)
    border = np.ones((H, W), dtype=bool)
    border[cy0:cy1, cx0:cx1] = False
    tex_border = float(lstd[border].mean())
    tex_center = float(lstd[cy0:cy1, cx0:cx1].mean())
    lum = _luminancia_esquinas(bgr)
    return 55 < lum < 140 and tex_border > 7.0 and tex_border > tex_center * 0.85


def _mascara_sonda(bgr: np.ndarray, escena: Escena) -> np.ndarray:
    """Máscara rápida para estimar la forma antes de elegir método."""
    if escena.tipo in ("negro", "gris"):
        mask, _ = _mascara_fondo_oscuro(bgr)
        return mask
    mask, _ = _mascara_fondo_claro(bgr)
    return mask


def _elegir_ruta(escena: Escena, forma: Forma, es_malla: bool) -> tuple[str, str]:
    """Devuelve (id_ruta, motivo) según escena × forma."""
    if es_malla:
        return (
            "rembg",
            f"fondo gris texturizado (malla) + {forma.tipo} → rembg + enderezar",
        )

    if escena.tipo == "negro":
        rutas = {
            "circulo": ("otsu_circulo", "fondo negro + círculo → Otsu + máscara circular"),
            "rombo": ("otsu_rombo", "fondo negro + rombo → Otsu + expansión rombo"),
            "irregular": ("otsu_irregular", "fondo negro + irregular → Otsu + silueta"),
            "rectangulo": ("otsu_amplio", "fondo negro + rectángulo → Otsu amplio + enderezar"),
        }
        return rutas.get(forma.tipo, rutas["rectangulo"])

    if escena.tipo == "gris":
        compleja = forma.tipo in ("irregular", "rombo") or forma.circularidad < 0.55
        if compleja and forma.tipo != "circulo":
            return (
                "otsu_amplio",
                f"fondo gris + {forma.tipo} (die-cut/puntas) → Otsu amplio",
            )
        rutas = {
            "circulo": ("otsu_circulo", "fondo gris + círculo → Otsu circular"),
            "rombo": ("otsu_rombo", "fondo gris + rombo → Otsu rombo"),
            "irregular": ("otsu_amplio", "fondo gris + irregular → Otsu amplio"),
            "rectangulo": ("otsu_rect", "fondo gris + rectángulo → Otsu"),
        }
        return rutas.get(forma.tipo, rutas["rectangulo"])

    # claro
    rutas = {
        "circulo": ("grabcut_circulo", "fondo claro + círculo → GrabCut circular"),
        "rombo": ("grabcut_rombo", "fondo claro + rombo → GrabCut rombo"),
        "irregular": ("grabcut_irregular", "fondo claro + irregular → GrabCut silueta"),
        "rectangulo": ("grabcut", "fondo claro + rectángulo → GrabCut"),
    }
    return rutas.get(forma.tipo, rutas["rectangulo"])


def analizar(bgr: np.ndarray, forzar_ruta: str | None = None) -> Analisis:
    H, W = bgr.shape[:2]
    lum = _luminancia_esquinas(bgr)

    if max(W, H) < 900 and (not forzar_ruta or forzar_ruta == "pequeña"):
        escena = Escena("pequeña", lum)
        forma = Forma("rectangulo", 0.0, 0.0)
        return Analisis(
            escena,
            forma,
            False,
            forzar_ruta or "pequeña",
            "imagen ya recortada o < 900 px",
            W,
            H,
        )

    escena = clasificar_escena(bgr)
    es_malla = escena.tipo == "gris" and _es_fondo_texturizado(bgr)
    mask = _mascara_sonda(bgr, escena)
    forma = detectar_forma(mask)
    if forzar_ruta:
        razon = f"ruta forzada manualmente → {forzar_ruta}"
        return Analisis(escena, forma, es_malla, forzar_ruta, razon, W, H)
    ruta, razon = _elegir_ruta(escena, forma, es_malla)
    return Analisis(escena, forma, es_malla, ruta, razon, W, H)


def _expandir_hull(alpha: np.ndarray, margen_px: int = 25) -> np.ndarray:
    cnts, _ = cv2.findContours((alpha > 127).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return alpha
    c = max(cnts, key=cv2.contourArea)
    hull = cv2.convexHull(c)
    out = np.zeros_like(alpha)
    cv2.fillConvexPoly(out, hull, 255)
    if margen_px > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (margen_px * 2 + 1, margen_px * 2 + 1))
        out = cv2.dilate(out, k, iterations=1)
    return out


def _mascara_rect_expandida(alpha: np.ndarray, margen_pct: float = 0.05) -> np.ndarray:
    ys, xs = np.where(alpha > 127)
    if len(xs) < 50:
        return alpha
    pts = np.column_stack([xs, ys]).astype(np.float32)
    (cx, cy), (rw, rh), ang = cv2.minAreaRect(pts)
    rw = max(rw, 1.0) * (1.0 + margen_pct)
    rh = max(rh, 1.0) * (1.0 + margen_pct)
    box = np.int32(cv2.boxPoints(((cx, cy), (rw, rh), ang)))
    out = np.zeros_like(alpha)
    cv2.fillConvexPoly(out, box, 255)
    return out


def _alpha_para_forma(bgr: np.ndarray, mask: np.ndarray, forma: Forma, escena: Escena) -> np.ndarray:
    if escena.tipo == "negro":
        alpha = mask.copy()
    else:
        alpha = _refinar_alpha_claro(bgr, mask)

    if forma.tipo == "circulo":
        cnts, _ = cv2.findContours(
            (alpha > 127).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        if cnts:
            c = max(cnts, key=cv2.contourArea)
            (cx, cy), r = cv2.minEnclosingCircle(c)
            ys, xs = np.where(alpha > 127)
            bbox_area = float((xs.max() - xs.min() + 1) * (ys.max() - ys.min() + 1))
            circle_area = float(np.pi * r * r)
            if circle_area >= bbox_area * 0.68:
                circle = np.zeros_like(alpha)
                cv2.circle(circle, (int(cx), int(cy)), int(r * 1.03), 255, -1)
                alpha = cv2.bitwise_and(alpha, circle)
    elif forma.tipo == "rombo":
        alpha = _morph(alpha, cv2.MORPH_CLOSE, 15, iterations=3)
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
        alpha = cv2.dilate(alpha, k, iterations=2)
    elif forma.tipo == "irregular":
        alpha = _silueta_rellena((alpha > 127).astype(np.uint8) * 255)
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
        alpha = cv2.dilate(alpha, k, iterations=2)
    else:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        alpha = cv2.dilate(alpha, k, iterations=1)
        if escena.tipo in ("gris", "claro") and not _es_fondo_texturizado(bgr):
            margen = 0.06 if escena.tipo == "gris" else 0.04
            alpha = _mascara_rect_expandida(alpha, margen_pct=margen)

    return alpha


def _padding_para_forma(
    forma: Forma, escena: Escena | None = None, bgr: np.ndarray | None = None
) -> float:
    if forma.tipo == "circulo":
        return 0.05
    if forma.tipo == "rombo":
        return 0.07
    if forma.tipo == "irregular":
        return 0.06
    if escena and escena.tipo == "gris":
        return 0.07
    return 0.05


def _debe_enderezar(forma: Forma, bgr: np.ndarray | None = None) -> bool:
    if forma.tipo != "rectangulo":
        return False
    if forma.circularidad < 0.55:
        return False
    if bgr is not None and _es_fondo_texturizado(bgr):
        return False
    return MIN_DESKEW_GRADOS <= abs(forma.angulo) <= MAX_DESKEW_GRADOS


def _recorte_desde_alpha(
    bgr: np.ndarray,
    alpha: np.ndarray,
    padding_pct: float,
    enderezar: bool,
) -> tuple[Image.Image | None, str, float | None]:
    H, W = bgr.shape[:2]
    ys, xs = np.where(alpha > 127)
    if len(xs) == 0:
        return None, "máscara vacía", None

    x1, x2 = int(xs.min()), int(xs.max())
    y1, y2 = int(ys.min()), int(ys.max())
    bw, bh = x2 - x1 + 1, y2 - y1 + 1
    pad_x = max(3, int(bw * padding_pct))
    pad_y = max(3, int(bh * padding_pct))
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
    detalle = f"crop={x1},{y1},{x2 - x1 + 1},{y2 - y1 + 1} fg={(crop_alpha > 127).mean() * 100:.0f}%"
    if abs(rot_ang) >= MIN_DESKEW_GRADOS:
        detalle += f" rot={rot_ang:+.1f}°"
    return _rgba_a_pil(rgba), detalle, area_ratio


def _recorte_imagen_pequena(
    bgr: np.ndarray,
    color_diff: int = 25,
) -> tuple[Image.Image, str, float]:
    """Imágenes ya recortadas: quita solo el fondo exterior (esquinas), conserva color interno."""
    H, W = bgr.shape[:2]
    m = min(30, H // 8, W // 8)
    patches = [
        bgr[0:m, 0:m],
        bgr[0:m, W - m :],
        bgr[H - m :, 0:m],
        bgr[H - m :, W - m :],
    ]
    fondo_bgr = np.median(np.vstack([p.reshape(-1, 3) for p in patches]), axis=0)
    diff = np.linalg.norm(bgr.astype(np.float32) - fondo_bgr, axis=2)

    umbral = color_diff
    alpha = (diff > umbral).astype(np.uint8) * 255
    alpha = _morph(alpha, cv2.MORPH_CLOSE, 7, iterations=2)
    alpha = _morph(alpha, cv2.MORPH_OPEN, 3, iterations=1)

    fg_ratio = (alpha > 127).mean()
    if fg_ratio < 0.2 or fg_ratio > 0.98:
        rgba = cv2.cvtColor(bgr, cv2.COLOR_BGR2BGRA)
        rgba[:, :, 3] = 255
        img = _rgba_a_pil(rgba)
        return img, "pequeña opaca (etiqueta llena marco)", 1.0

    img, det, ratio = _recorte_desde_alpha(bgr, alpha, 0.01, enderezar=False)
    detalle = f"pequeña color_diff>{umbral} fg={fg_ratio * 100:.0f}%; {det}"
    return img or _rgba_a_pil(cv2.cvtColor(bgr, cv2.COLOR_BGR2BGRA)), detalle, ratio or 1.0


def _detalle_router(analisis: Analisis, extra: str) -> str:
    return (
        f"router→{analisis.ruta} | escena={analisis.escena_etiqueta}"
        f"(l={analisis.escena.luminancia:.0f}) forma={analisis.forma.tipo}"
        f"(c={analisis.forma.circularidad:.2f}) | {analisis.razon} | {extra}"
    )


def _opencv_otsu_amplio(
    bgr: np.ndarray,
    analisis: Analisis,
    thresh: int = 48,
    dilate: int = 3,
    padding_pct: float = 0.06,
    enderezar_override: bool | None = None,
) -> tuple[Image.Image | None, str, float | None]:
    comp_mask, blob_info = _mascara_fondo_oscuro(bgr, thresh=thresh, dilate=dilate)
    if blob_info.startswith("sin"):
        return None, blob_info, None
    if enderezar_override is not None:
        enderezar = enderezar_override
    else:
        enderezar = (
            analisis.forma.tipo == "rectangulo" and analisis.forma.circularidad >= 0.55
        )
    img, det, ratio = _recorte_rgba(
        bgr, comp_mask, padding_pct=padding_pct, filtrar_lum=False, enderezar=enderezar
    )
    return img, f"otsu_amplio; {blob_info}; {det}", ratio


def _opencv_por_mascara(
    bgr: np.ndarray,
    analisis: Analisis,
    preferir: str | None,
    padding_pct: float | None = None,
    enderezar_override: bool | None = None,
) -> tuple[Image.Image | None, str, float | None]:
    ranked = mascaras_ranked(bgr, analisis.escena, preferir=preferir)
    if not ranked:
        m, info = _mascara_fondo_claro(bgr)
        ranked = [("grabcut", m, info, 0.0)]

    min_ratio = 0.38 if max(analisis.ancho, analisis.alto) > 2000 else 0.25
    mejor: tuple[Image.Image, str, float] | None = None

    for nombre, mask, info, score in ranked:
        alpha = _alpha_para_forma(bgr, mask, analisis.forma, analisis.escena)
        padding = padding_pct if padding_pct is not None else _padding_para_forma(
            analisis.forma, analisis.escena, bgr
        )
        if enderezar_override is not None:
            enderezar = enderezar_override
        else:
            enderezar = _debe_enderezar(analisis.forma, bgr)
        img, det_crop, ratio = _recorte_desde_alpha(bgr, alpha, padding, enderezar)
        if img is None or ratio is None:
            continue
        info_mascara = f"{nombre} score={score:.2f}; {info}"
        detalle = _detalle_router(analisis, f"{nombre}; {info_mascara}; {det_crop}")
        if ratio >= min_ratio:
            return img, detalle, ratio
        if mejor is None or ratio > mejor[2]:
            mejor = (img, detalle, ratio)

    if mejor is not None:
        return mejor
    return None, _detalle_router(analisis, "sin recorte OpenCV válido"), None


def _ejecutar_ruta(
    source: bytes | str,
    bgr: np.ndarray,
    analisis: Analisis,
    params: ParametrosRecorte | None = None,
) -> tuple[Image.Image | None, str, float | None]:
    pad = (params.padding_pct / 100.0) if params else None
    end_override = params.enderezar if params else None
    color_diff = params.color_diff if params else 25

    if analisis.ruta == "pequeña":
        img, det, ratio = _recorte_imagen_pequena(bgr, color_diff=color_diff)
        return img, _detalle_router(analisis, det), ratio

    if analisis.ruta == "rembg":
        img, det, ratio = rembg_crop(
            source, enderezar=False if params and not params.rembg_enderezar else True
        )
        if img is not None and ratio is not None:
            if params and not params.rembg_enderezar:
                det += " (sin enderezar)"
            return img, _detalle_router(analisis, det), ratio
        return None, _detalle_router(analisis, det or "rembg falló"), ratio

    if analisis.ruta == "otsu_amplio":
        kw = {}
        if params:
            kw = {
                "thresh": params.otsu_thresh,
                "dilate": params.otsu_dilate,
                "padding_pct": params.padding_pct / 100.0,
                "enderezar_override": end_override,
            }
        img, det, ratio = _opencv_otsu_amplio(bgr, analisis, **kw)
        if img is not None:
            return img, _detalle_router(analisis, det), ratio

    preferir = "otsu" if analisis.ruta.startswith("otsu") else "grabcut"
    return _opencv_por_mascara(
        bgr, analisis, preferir=preferir, padding_pct=pad, enderezar_override=end_override
    )


def recortar_v2(
    source: bytes | str,
    params: ParametrosRecorte | None = None,
) -> tuple[Image.Image | None, str, float | None]:
    from parametros_recorte import ParametrosRecorte as PR

    bgr = _cargar_bgr(source)
    forzar = params.forzar_ruta if params else None
    analisis = analizar(bgr, forzar_ruta=forzar)
    img, detalle, ratio = _ejecutar_ruta(source, bgr, analisis, params=params)

    if img is not None:
        return img, detalle, ratio

    # Fallback: rembg en gris sin malla, o segunda máscara OpenCV
    if analisis.escena.tipo == "gris" and not analisis.es_malla:
        img, det, ratio = rembg_crop(source)
        if img is not None:
            fb = _detalle_router(analisis, f"fallback rembg; {det}")
            return img, fb, ratio

    alt = "grabcut" if analisis.ruta.startswith("otsu") else "otsu"
    img, detalle, ratio = _opencv_por_mascara(bgr, analisis, preferir=alt)
    if img is not None:
        detalle = detalle.replace("router→", "router→fallback_") if "router→" in detalle else detalle
        return img, detalle, ratio

    return None, _detalle_router(analisis, "sin recorte válido"), None
