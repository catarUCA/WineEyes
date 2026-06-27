import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "source", "Sistema-de-catalogacion-de-imagenes"))

import csv
import numpy as np
from PIL import Image

_RS = None

IMAGES_LOCAL = os.path.join(os.path.dirname(__file__), "..", "procesadas")


def docker_to_local(path):
    basename = os.path.basename(path)
    return os.path.join(IMAGES_LOCAL, basename)


def get_rs():
    global _RS
    if _RS is None:
        from retrieval_system import ImageRetrievalSystem
        _RS = ImageRetrievalSystem(reset_index=False)
    return _RS


class ClipExtractor:
    def __init__(self, rs):
        self._rs = rs

    def encode_text(self, text):
        import torch
        from retrieval_system import _get_clip
        import open_clip
        model, _ = _get_clip()
        tokenizer = open_clip.get_tokenizer("ViT-L-14")
        with torch.no_grad():
            tokens = tokenizer([text])
            feats = model.encode_text(tokens)
            feats = feats / feats.norm(dim=-1, keepdim=True)
        return feats.squeeze(0).numpy()

    def extract_features(self, image):
        import torch
        from retrieval_system import _get_clip
        model, preprocess = _get_clip()
        if isinstance(image, str):
            image = Image.open(image).convert("RGB")
        with torch.no_grad():
            img = preprocess(image).unsqueeze(0)
            feats = model.encode_image(img)
            feats = feats / feats.norm(dim=-1, keepdim=True)
        return feats.squeeze(0).numpy()


class TextExtractor:
    def __init__(self, rs):
        self._rs = rs
        from retrieval_system import TEXT_DIM
        self.feature_dim = TEXT_DIM

    def encode_text(self, text):
        return self.extract_features(text)

    def extract_features(self, text):
        import time
        for attempt in range(3):
            try:
                vec = self._rs._embed_text(text)
                return np.array(vec, dtype=np.float32)
            except Exception as e:
                if attempt < 2:
                    time.sleep(1.0)
                else:
                    raise


def resolve_paths(rs, img_ids):
    pts = rs.client.retrieve(
        collection_name=rs.image_collection,
        ids=list(img_ids),
        with_payload=True, with_vectors=False,
    )
    return {int(p.payload["img_id"]): docker_to_local(p.payload["path"]) for p in pts}


def load_sample(path="data/muestra_50.csv"):
    with open(path, encoding="utf-8") as f:
        return [r for r in csv.DictReader(f) if r.get("img_id")]


def iter_all_images(rs, with_description=True):
    offset = None
    while True:
        points, offset = rs.client.scroll(
            collection_name=rs.image_collection,
            with_payload=True, with_vectors=False, limit=512, offset=offset,
        )
        for p in points:
            yield (
                int(p.payload["img_id"]),
                p.payload["path"],
                p.payload.get("image_description", "") if with_description else None,
            )
        if offset is None:
            break


def ensure_dirs():
    os.makedirs("data", exist_ok=True)
    os.makedirs("results", exist_ok=True)
