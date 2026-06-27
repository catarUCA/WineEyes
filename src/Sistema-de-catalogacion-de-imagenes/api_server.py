import os
os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'

import logging
import json
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse

def _configured_origins() -> set[str]:
    raw = os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,http://localhost:3300,http://localhost:5173",
    )
    return {origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()}


ALLOWED_ORIGINS = _configured_origins()

from api.database import get_db, init_db
from jose import jwt, JWTError

from retrieval_system import ImageRetrievalSystem

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

IMAGE_DEST = os.getenv("IMAGE_DEST", "/app/images/processed")
THUMB_DEST = os.getenv("THUMB_DEST", "/app/images/thumbnails")

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY must be set in the environment")
ALGORITHM = "HS256"

app = FastAPI(
    title="Image Gallery API",
    description="API para búsqueda semántica de imágenes",
    version="2.0.0"
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.warning(f"Validation error on {request.method} {request.url.path}: {exc.errors()}")
    logger.warning(f"Headers: {dict(request.headers)}")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()},
    )


@app.middleware("http")
async def origin_block_middleware(request: Request, call_next):
    if request.url.path.startswith("/images/") or request.url.path.startswith("/thumbs/") or request.url.path.startswith("/api/public/"):
        return await call_next(request)
    if request.url.path in ("/health", "/", "/docs", "/openapi.json"):
        return await call_next(request)
    if request.method == "OPTIONS":
        return await call_next(request)
    origin = (request.headers.get("origin") or "").rstrip("/")
    referer = (request.headers.get("referer") or "").rstrip("/")
    if not origin and not referer:
        return await call_next(request)
    for src in (origin, referer):
        if src and any(src.startswith(o) for o in ALLOWED_ORIGINS):
            return await call_next(request)
    return JSONResponse(status_code=403, content={"detail": "Acceso no permitido desde este origen"})


app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(ALLOWED_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



def _auth_query(token: str | None):
    if not token:
        raise HTTPException(status_code=401, detail="Token requerido")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido")
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT u.id, u.email, u.full_name, u.is_active FROM users u WHERE u.email = %s",
                (email,)
            )
            user = cur.fetchone()
    finally:
        conn.close()
    if not user or not user["is_active"]:
        raise HTTPException(status_code=401, detail="Usuario no encontrado")
    return user


def _check_referer(request: Request):
    referer = (request.headers.get("referer") or "").rstrip("/")
    if not referer:
        raise HTTPException(status_code=403, detail="Acceso directo no permitido. Usa la web para ver imágenes.")
    if any(referer.startswith(o) for o in ALLOWED_ORIGINS):
        return
    raise HTTPException(status_code=403, detail="Acceso no permitido")


@app.on_event("startup")
async def startup_event():
    logger.info("=== Iniciando Image Gallery API v2 ===")
    Path(IMAGE_DEST).mkdir(parents=True, exist_ok=True)
    Path(THUMB_DEST).mkdir(parents=True, exist_ok=True)
    logger.info(f"Directorio de imagenes: {IMAGE_DEST}")

    try:
        init_db()
        retrieval_system = ImageRetrievalSystem(reset_index=False)
        app.state.retrieval_system = retrieval_system
        app.state.image_dest = IMAGE_DEST
        logger.info("Qdrant conectado")
    except Exception as e:
        logger.error(f"ERROR en startup: {e}")
        logger.error("La API arranco en modo degradado. Verifica Qdrant.")
        app.state.retrieval_system = None
        app.state.image_dest = IMAGE_DEST

    calibration_path = os.path.join(os.path.dirname(__file__), "calibration.json")
    try:
        with open(calibration_path, "r", encoding="utf-8") as f:
            app.state.calibration = json.load(f)
        logger.info(f"Calibracion cargada: {calibration_path}")
    except Exception as e:
        logger.warning(f"No se pudo cargar calibration.json ({e}), usando defaults")
        app.state.calibration = {
            "ratios_s_per_mb": {"ocr": 8.0, "crop": 4.0, "describe": 16.0, "index": 6.0},
            "weights": {"ocr": 0.235, "crop": 0.118, "describe": 0.471, "index": 0.176},
            "reference_mb": 3.5,
            "calibrated_at": "defaults",
            "samples": 0,
        }

    logger.info("=== Sistema inicializado ===")


@app.get("/images/{filename:path}")
async def serve_image(filename: str, token: str = Query(None), request: Request = None):
    _auth_query(token)
    _check_referer(request)
    path = os.path.join(IMAGE_DEST, filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Imagen no encontrada")
    return FileResponse(path)


@app.get("/thumbs/{filename:path}")
async def serve_thumb(filename: str, token: str = Query(None), request: Request = None):
    _auth_query(token)
    _check_referer(request)
    path = os.path.join(THUMB_DEST, filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Miniatura no encontrada")
    return FileResponse(path)


from api import routes_auth, routes_images, routes_search, routes_upload, routes_admin

app.include_router(routes_auth.router, prefix="/api")
app.include_router(routes_images.router, prefix="/api")
app.include_router(routes_search.router, prefix="/api")
app.include_router(routes_upload.router, prefix="/api")
app.include_router(routes_admin.router, prefix="/api")


@app.get("/api/public/random-image")
async def serve_random_image(request: Request):
    _check_referer(request)
    retrieval_system = request.app.state.retrieval_system
    if retrieval_system is None:
        raise HTTPException(status_code=503, detail="Sistema no disponible")
    payload = retrieval_system.get_random_image()
    if payload is None:
        raise HTTPException(status_code=404, detail="No hay imagenes")
    path = payload["path"]
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Imagen no encontrada")
    return FileResponse(path)


@app.get("/")
async def root():
    return {
        "message": "Image Gallery API v2",
        "status": "running",
        "docs": "/docs"
    }


@app.get("/health")
async def health():
    import requests
    checks = {}
    system_ready = app.state.retrieval_system is not None

    for svc, url in [("rembg-service", "http://rembg-service:8001/health")]:
        try:
            r = requests.get(url, timeout=5)
            checks[svc] = r.json()
        except Exception as e:
            checks[svc] = {"status": "unreachable", "error": str(e)}

    return {
        "status": "healthy" if system_ready else "degraded",
        "retrieval_system": "ok" if system_ready else "not initialized",
        "services": checks,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
