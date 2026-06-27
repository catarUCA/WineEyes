import csv

import cv2
import numpy as np
from PIL import Image


def _parse_poly(s):
    return [tuple(map(float, p.split())) for p in s.split(";") if p.strip()]


def _mask_from_poly(poly, shape):
    m = np.zeros(shape[:2], np.uint8)
    cv2.fillPoly(m, [np.array(poly, np.int32)], 255)
    return m > 0


def iou_mask(pred_mask, gt_mask):
    a, b = pred_mask > 0, gt_mask > 0
    inter, union = np.logical_and(a, b).sum(), np.logical_or(a, b).sum()
    return inter / union if union else 0.0


def evaluate(gt_csv, cropper, sample):
    paths = {r["id"]: r["path"] for r in sample}
    ious = []
    for r in csv.DictReader(open(gt_csv, encoding="utf-8")):
        if r["id"] not in paths:
            continue
        shape = np.array(Image.open(paths[r["id"]])).shape
        gt = _mask_from_poly(_parse_poly(r["polygon"]), shape)
        pred = cropper.mask(paths[r["id"]])
        if pred is None:
            continue
        ious.append(iou_mask(pred, gt))
    if ious:
        print(f"{cropper.name}: IoU medio={np.mean(ious):.3f} (n={len(ious)})")
