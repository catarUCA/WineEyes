import numpy as np
import os
import logging
import math
import io
import base64
import requests
from PIL import Image
from pathlib import Path
from skimage.metrics import structural_similarity

import cv2

logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

REMBG_URL = os.getenv("REMBG_URL", "http://rembg-service:8001")


def crop_via_service(img_bytes: bytes):
    img_base64 = base64.b64encode(img_bytes).decode()
    r = requests.post(f"{REMBG_URL}/crop",
                      json={"image": img_base64}, timeout=120)
    data = r.json()
    if not data.get("success"):
        return None
    result_bytes = base64.b64decode(data["image"])
    return Image.open(io.BytesIO(result_bytes))


def compare_image(img, path):
    img2 = np.array(Image.open(path).convert('RGB'))
    img = np.array(_reduce_size(img, 5))
    img2 = cv2.resize(img2, (img.shape[1], img.shape[0]))
    score = structural_similarity(img, img2, channel_axis=-1, full=False)
    logger.info(f"SSIM score: {score:.02}")
    return score


def _reduce_size(img, factor):
    x, y = img.size
    x = math.floor(x / factor)
    y = math.floor(y / factor)
    img = img.resize((x, y), Image.LANCZOS)
    return img


MIN_THUMB_SIDE = 150

def save_mini(img, path):
    w, h = img.size
    thumb_w = math.floor(w / 10)
    thumb_h = math.floor(h / 10)
    if thumb_w >= MIN_THUMB_SIDE and thumb_h >= MIN_THUMB_SIDE:
        img = img.resize((thumb_w, thumb_h), Image.LANCZOS)
    thumb_path = path.replace("processed", "thumbnails")
    os.makedirs(os.path.dirname(thumb_path), exist_ok=True)
    img.save(thumb_path, optimize=True)


def add_image(img_path, image_dest, retrieval_system, bg_rem, rem_session):
    pass


def rem_and_index(images_dir, image_dest, retrieval_system, bg_rem, rem_session):
    pass
