from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, EmailStr
from passlib.context import CryptContext
from PIL import Image as PILImage
import os
from api.database import get_db, get_labels_for_image, set_image_labels, ensure_labels_exist
from api.routes_auth import require_admin, require_admin_or_uploader, require_admin_or_uploader_or_researcher, get_current_user
from feature_extractor import DESCRIBE_SCALE as _DESCRIBE_SCALE
import feature_extractor


class ResizeScaleUpdate(BaseModel):
    scale: float

router = APIRouter(prefix="/admin", tags=["admin"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

IMAGE_DIR = "/app/images/processed"
THUMB_DIR = "/app/images/thumbnails"


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    roles: list[str] = ["USER"]


class UserUpdate(BaseModel):
    roles: list[str]


class LabelsUpdate(BaseModel):
    labels: list[str]


def _get_roles_map(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT id, code FROM roles")
        return {row["code"]: row["id"] for row in cur.fetchall()}


# --- Usuarios ---

@router.get("/users")
async def list_users(user=Depends(require_admin)):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT u.id, u.email, u.full_name, u.is_active, u.created_at, "
                "GROUP_CONCAT(r.code) as roles "
                "FROM users u "
                "LEFT JOIN user_roles ur ON u.id = ur.user_id "
                "LEFT JOIN roles r ON ur.role_id = r.id "
                "GROUP BY u.id "
                "ORDER BY u.id"
            )
            users = cur.fetchall()
    finally:
        conn.close()

    result = []
    for u in users:
        result.append({
            "id": u["id"],
            "email": u["email"],
            "full_name": u["full_name"],
            "is_active": bool(u["is_active"]),
            "roles": (u["roles"] or "").split(",") if u["roles"] else [],
            "created_at": str(u["created_at"]) if u["created_at"] else None,
        })
    return {"users": result}


@router.post("/users", status_code=201)
async def create_user(data: UserCreate, admin=Depends(require_admin)):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE email = %s", (data.email,))
            if cur.fetchone():
                raise HTTPException(status_code=400, detail="El email ya está en uso")

            cur.execute(
                "INSERT INTO users (email, password_hash) VALUES (%s, %s)",
                (data.email, pwd_context.hash(data.password))
            )
            user_id = cur.lastrowid

            roles_map = _get_roles_map(conn)
            for role_code in data.roles:
                role_id = roles_map.get(role_code.upper())
                if role_id:
                    cur.execute(
                        "INSERT INTO user_roles (user_id, role_id) VALUES (%s, %s)",
                        (user_id, role_id)
                    )

            conn.commit()
    finally:
        conn.close()

    return {"id": user_id, "email": data.email, "roles": data.roles}


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(user_id: int, admin=Depends(require_admin)):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM user_roles WHERE user_id = %s", (user_id,))
            cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Usuario no encontrado")
            conn.commit()
    finally:
        conn.close()


@router.patch("/users/{user_id}")
async def update_user_roles(user_id: int, data: UserUpdate, admin=Depends(require_admin)):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE id = %s", (user_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Usuario no encontrado")

            cur.execute("DELETE FROM user_roles WHERE user_id = %s", (user_id,))

            roles_map = _get_roles_map(conn)
            for role_code in data.roles:
                role_id = roles_map.get(role_code.upper())
                if role_id:
                    cur.execute(
                        "INSERT INTO user_roles (user_id, role_id) VALUES (%s, %s)",
                        (user_id, role_id)
                    )

            conn.commit()
    finally:
        conn.close()

    return {"id": user_id, "roles": data.roles}


# --- Imágenes ---

@router.post("/images/{image_id}/rotate")
async def rotate_image(image_id: str, degrees: int, user=Depends(require_admin_or_uploader)):
    if degrees not in (90, 180, 270):
        raise HTTPException(status_code=400, detail="Grados inválidos")

    filename = f"r{image_id.zfill(6)}.png"
    pil_degrees = 360 - degrees

    for directory in [IMAGE_DIR, THUMB_DIR]:
        path = os.path.join(directory, filename)
        if os.path.exists(path):
            img = PILImage.open(path)
            img.rotate(pil_degrees, expand=True).save(path)
        else:
            raise HTTPException(status_code=404, detail=f"Imagen no encontrada en {directory}")

    return {"ok": True}


@router.get("/images/{image_id}")
async def get_image_detail(image_id: int, request: Request, user=Depends(require_admin_or_uploader)):
    retrieval_system = request.app.state.retrieval_system
    result = retrieval_system.client.retrieve(
        collection_name=retrieval_system.image_collection,
        ids=[image_id],
        with_payload=True,
        with_vectors=False
    )
    if not result:
        raise HTTPException(status_code=404, detail="Imagen no encontrada")

    payload = dict(result[0].payload)
    payload["labels"] = get_labels_for_image(image_id)
    return payload


@router.put("/images/{image_id}/labels")
async def update_image_labels(image_id: int, data: LabelsUpdate, request: Request, user=Depends(require_admin_or_uploader_or_researcher)):
    if not data.labels:
        set_image_labels(image_id, [])
        return {"ok": True, "labels": []}

    name_to_id = ensure_labels_exist(data.labels)
    label_ids = list(name_to_id.values())
    set_image_labels(image_id, label_ids)
    return {"ok": True, "labels": data.labels}


@router.get("/resize-scale")
async def get_resize_scale(user=Depends(require_admin_or_uploader)):
    return {"scale": feature_extractor.DESCRIBE_SCALE}


@router.patch("/resize-scale")
async def set_resize_scale(data: ResizeScaleUpdate, user=Depends(require_admin_or_uploader)):
    scale = data.scale
    if scale < 0.05 or scale > 1.0:
        raise HTTPException(status_code=400, detail="La escala debe estar entre 0.05 y 1.0")
    feature_extractor.DESCRIBE_SCALE = scale
    return {"ok": True, "scale": scale}
