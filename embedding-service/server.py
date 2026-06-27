"""
Embedding service: dense + sparse + hybrid via FlagEmbedding.
Serves BGE-M3 and can store vectors in Qdrant.
"""
import os, json, logging
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

import numpy as np
from FlagEmbedding import BGEM3FlagModel

EMBED_MODEL = os.getenv("EMBED_MODEL", "BAAI/bge-m3")
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
LISTEN_PORT = int(os.getenv("EMBED_PORT", "8002"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("embedding-service")

logger.info("Loading BGEM3FlagModel: %s ...", EMBED_MODEL)
model = BGEM3FlagModel(EMBED_MODEL, use_fp16=True)
logger.info("Model loaded (dim=%d)", model.model.config.hidden_size)

def embed_batch(texts, return_dense=True, return_sparse=True):
    out = model.encode(
        texts,
        return_dense=return_dense,
        return_sparse=return_sparse,
        max_length=1024,
    )
    result = {}
    if return_dense:
        result["dense"] = out["dense_vecs"].tolist()
    if return_sparse:
        result["sparse"] = []
        for vec in out["lexical_weights"]:
            idxs = list(vec.keys())
            vals = [float(vec[k]) for k in idxs]
            result["sparse"].append({"indices": idxs, "values": vals})
    return result


class EmbedHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        texts = body.get("input", [])
        if isinstance(texts, str):
            texts = [texts]
        return_dense = body.get("dense", True)
        return_sparse = body.get("sparse", True)
        try:
            result = embed_batch(texts, return_dense, return_sparse)
            self.send_json(result)
        except Exception as e:
            logger.error("Embedding error: %s", e)
            self.send_error(500, str(e))

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self.send_json({"status": "ok", "model": EMBED_MODEL})
        elif parsed.path == "/info":
            self.send_json({
                "model": EMBED_MODEL,
                "dim": model.model.config.hidden_size,
                "supports_dense": True,
                "supports_sparse": True,
            })
        else:
            self.send_error(404)

    def send_json(self, data, code=200):
        enc = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(enc)))
        self.end_headers()
        self.wfile.write(enc)

    def send_error(self, code, msg=""):
        self.send_json({"error": msg}, code)

    def log_message(self, fmt, *args):
        logger.info(fmt, *args)


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", LISTEN_PORT), EmbedHandler)
    logger.info("Embedding service listening on port %d", LISTEN_PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down")
        server.server_close()
