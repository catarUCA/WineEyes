import numpy as np
import os
import logging
import math
import io
import base64
from rembg import new_session, remove
from PIL import Image, ImageOps
from pathlib import Path

import cv2

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(title="rembg-service", version="1.0.0")

_sessions = {}


class CropRequest(BaseModel):
    image: str


class CropResponse(BaseModel):
    success: bool
    image: str | None = None
    error: str | None = None


class background_removal:
    def __init__(self, model: str = "u2net"):
        self.model = model
        self.rembg_session = new_session(model)
        logger.info("Instancia del modelo rembg creada")

    def remove_bg(self, img, rembg_session):
        rgb = np.array(ImageOps.expand(img, border=200, fill=tuple(np.array(img)[10][10])))
        noBG = remove(rgb, session=rembg_session)

        gray = cv2.cvtColor(noBG, cv2.COLOR_RGB2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        _, bw = cv2.threshold(blurred, 1, 255, cv2.THRESH_BINARY)
        bw = self.fill(bw)
        edges = cv2.Canny(bw, 50, 150)

        return noBG, edges

    def mayor_contorno(self, edges):
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contour_list = [cv2.boundingRect(ctr) for ctr in contours]

        ind = 0
        max_area = 0
        for i in range(0, len(contour_list)):
            tmp = contour_list[i][2] * contour_list[i][3]
            if tmp > max_area:
                max_area = tmp
                ind = i

        return contours[ind]

    def poliAprox(self, contorno):
        peri = cv2.arcLength(contorno, True)
        eps = 0.001
        incr = 0.005
        min_approx = [1] * 10

        for i in range(0, 100):
            approx = cv2.approxPolyDP(contorno, eps * peri, True)

            if len(approx) == 4:
                min_approx = approx
                break
            elif len(approx) < 4:
                eps = 0.001
                incr = incr / 2
            else:
                eps += incr
                if len(approx) < len(min_approx) and len(approx) % 2 == 0:
                    min_approx = approx

        return np.squeeze(min_approx).copy()

    def sortCorners(self, corners):
        corners = sorted(corners.tolist(), key=lambda x: x[0])
        left = sorted(corners[: (len(corners) // 2)], key=lambda x: x[1])
        right = sorted(corners[(len(corners) // 2):], key=lambda x: x[1])
        del left[1: (len(left) - 1)]
        del right[1: (len(right) - 1)]

        sorted_c = left + right
        return np.array(sorted_c)

    def correctPersp(self, img, points, h, w):
        margen = ((-50, -50), (-50, 50), (50, -50), (50, 50))
        points = points + margen

        pts1 = np.float32([points[0], points[1], points[2], points[3]])
        pts2 = np.float32([[0, 0], [0, h], [w, 0], [w, h]])

        matrix = cv2.getPerspectiveTransform(pts1, pts2)
        transformed = cv2.warpPerspective(img, matrix, (w, h))

        return transformed

    def fill(self, bw):
        kernele = np.ones((5, 5), np.uint8)
        kerneld = np.ones((13, 13), np.uint8)

        bw = cv2.erode(bw, kernele, iterations=2)
        bw = cv2.medianBlur(bw, 3)
        bw = cv2.dilate(bw, kerneld, iterations=3)

        return bw

    def process_image_from_bytes(self, img_bytes: bytes, rembg_session):
        img = Image.open(io.BytesIO(img_bytes))
        img = ImageOps.exif_transpose(img)

        noBG, edges = self.remove_bg(img, rembg_session)

        contorno = self.mayor_contorno(edges)
        rect = cv2.minAreaRect(contorno)

        tam, rotacion = rect[1], rect[2]
        tam_i = img.size
        relacion = (tam[0] * tam[1]) / (tam_i[0] * tam_i[1]) * 100

        if relacion > 20:
            if rotacion < 10 or rotacion > 80:
                rect = cv2.boxPoints(rect)
                cornersRect = np.intp(rect)

                cornersAprox = self.poliAprox(contorno)

                cornersAprox = self.sortCorners(cornersAprox)
                cornersRect = self.sortCorners(cornersRect)

                h1 = round(np.linalg.norm(cornersAprox[1] - cornersAprox[0]))
                w1 = round(np.linalg.norm(cornersAprox[2] - cornersAprox[0]))

                h2 = round(np.linalg.norm(cornersRect[1] - cornersRect[0]))
                w2 = round(np.linalg.norm(cornersRect[2] - cornersRect[0]))

                dif = (h1 * w1) / (h2 * w2) * 100

                if dif > 95 and dif < 100:
                    transformed = self.correctPersp(noBG, cornersAprox, h1, w1)
                else:
                    transformed = self.correctPersp(noBG, cornersRect, h2, w2)

            else:
                x, y, w, h = cv2.boundingRect(contorno)
                corners = ((x, y), (x, y + h), (x + w, y), (x + w, y + h))
                transformed = self.correctPersp(noBG, corners, h, w)

            final = Image.fromarray(transformed)

        else:
            final = None

        return final


bg_rem = None
rembg_session = None


@app.on_event("startup")
async def startup():
    global bg_rem, rembg_session
    logger.info("Cargando u2net...")
    bg_rem = background_removal(model="u2net")
    rembg_session = bg_rem.rembg_session
    logger.info("u2net listo")


@app.get("/health")
async def health():
    return {"status": "ok", "model": "u2net"}


@app.post("/crop", response_model=CropResponse)
async def crop(req: CropRequest):
    try:
        img_bytes = base64.b64decode(req.image)
        result = bg_rem.process_image_from_bytes(img_bytes, rembg_session)

        if result is None:
            return CropResponse(success=False, error="No se pudo detectar etiqueta")

        buf = io.BytesIO()
        result.save(buf, format="JPEG", optimize=True)
        result_b64 = base64.b64encode(buf.getvalue()).decode()

        return CropResponse(success=True, image=result_b64)
    except Exception as e:
        logger.error(f"Error en crop: {e}")
        return CropResponse(success=False, error=str(e))


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
