import cv2
import numpy as np
from PIL import Image


class BaseSegmenter:
    name = "base_seg"

    def mask(self, image_path):
        raise NotImplementedError


class RembgSegmenter(BaseSegmenter):
    def __init__(self, model="u2net"):
        from rembg import new_session, remove
        self.name = f"rembg_{model}"
        self._remove, self._session = remove, new_session(model)

    def mask(self, image_path):
        img = np.array(Image.open(image_path).convert("RGB"))
        out = self._remove(img, session=self._session)
        alpha = out[:, :, 3] if out.shape[2] == 4 else cv2.cvtColor(out, cv2.COLOR_RGB2GRAY)
        _, m = cv2.threshold(alpha, 10, 255, cv2.THRESH_BINARY)
        return m


class GrabCutSegmenter(BaseSegmenter):
    name = "grabcut"

    def mask(self, image_path):
        img = cv2.cvtColor(np.array(Image.open(image_path).convert("RGB")), cv2.COLOR_RGB2BGR)
        h, w = img.shape[:2]
        m = np.zeros((h, w), np.uint8)
        bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
        try:
            cv2.grabCut(img, m, (int(w*.05), int(h*.05), int(w*.9), int(h*.9)),
                        bgd, fgd, 5, cv2.GC_INIT_WITH_RECT)
        except Exception:
            return None
        return np.where((m == cv2.GC_FGD) | (m == cv2.GC_PR_FGD), 255, 0).astype("uint8")


class OtsuSegmenter(BaseSegmenter):
    name = "otsu"

    def mask(self, image_path):
        g = cv2.cvtColor(np.array(Image.open(image_path).convert("RGB")), cv2.COLOR_RGB2GRAY)
        _, m = cv2.threshold(cv2.GaussianBlur(g, (5, 5), 0), 0, 255,
                             cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return cv2.bitwise_not(m) if m.mean() > 127 else m


class SamSegmenter(BaseSegmenter):
    name = "sam"

    def __init__(self, checkpoint, model_type="vit_b", device="cpu"):
        from segment_anything import sam_model_registry, SamPredictor
        self.predictor = SamPredictor(sam_model_registry[model_type](checkpoint=checkpoint).to(device))

    def mask(self, image_path):
        rgb = np.array(Image.open(image_path).convert("RGB"))
        h, w = rgb.shape[:2]
        self.predictor.set_image(rgb)
        masks, scores, _ = self.predictor.predict(
            box=np.array([w*.05, h*.05, w*.95, h*.95]), multimask_output=True)
        return (masks[int(np.argmax(scores))] * 255).astype("uint8")


def _largest_contour(mask):
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return max(cnts, key=cv2.contourArea) if cnts else None


def _order_quad(pts):
    pts = np.array(pts, dtype="float32")
    s, d = pts.sum(1), np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)],
                     pts[np.argmax(s)], pts[np.argmax(d)]], dtype="float32")


def _warp_quad(img_bgr, quad):
    tl, tr, br, bl = _order_quad(quad)
    W = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
    H = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
    if W < 10 or H < 10:
        return None
    dst = np.array([[0, 0], [W-1, 0], [W-1, H-1], [0, H-1]], dtype="float32")
    M = cv2.getPerspectiveTransform(np.array([tl, tr, br, bl], dtype="float32"), dst)
    return Image.fromarray(cv2.cvtColor(cv2.warpPerspective(img_bgr, M, (W, H)), cv2.COLOR_BGR2RGB))


def geom_quad4(image_path, mask):
    c = _largest_contour(mask)
    if c is None:
        return None
    peri, eps, approx = cv2.arcLength(c, True), 0.001, None
    for _ in range(100):
        approx = cv2.approxPolyDP(c, eps * peri, True)
        if len(approx) <= 4:
            break
        eps += 0.005
    img = cv2.cvtColor(np.array(Image.open(image_path).convert("RGB")), cv2.COLOR_RGB2BGR)
    if approx is not None and len(approx) == 4:
        return _warp_quad(img, approx.reshape(-1, 2))
    return _warp_quad(img, cv2.boxPoints(cv2.minAreaRect(c)))


def geom_minarearect(image_path, mask):
    c = _largest_contour(mask)
    if c is None:
        return None
    img = cv2.cvtColor(np.array(Image.open(image_path).convert("RGB")), cv2.COLOR_RGB2BGR)
    return _warp_quad(img, cv2.boxPoints(cv2.minAreaRect(c)))


class Cropper:
    def __init__(self, segmenter, geom_fn, name):
        self.segmenter, self.geom_fn, self.name = segmenter, geom_fn, name

    def crop(self, image_path):
        m = self.segmenter.mask(image_path)
        if m is None:
            return None
        h, w = m.shape
        if (m > 0).sum() / (h * w) < 0.20:
            return None
        return self.geom_fn(image_path, m)

    def mask(self, image_path):
        return self.segmenter.mask(image_path)
