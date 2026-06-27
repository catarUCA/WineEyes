from fastapi import APIRouter, HTTPException, status, Depends, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from passlib.context import CryptContext
from jose import jwt, JWTError
from datetime import datetime, timedelta
from api.database import get_db
import hashlib
import os

router = APIRouter(prefix="/auth", tags=["authentication"])
security = HTTPBearer()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY must be set in the environment")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    email: str
    roles: list[str]


class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse


def verify_password(password: str, password_hash: str) -> bool:
    try:
        if "$2y$" in password_hash:
            password_hash = password_hash.replace("$2y$", "$2b$")
        if pwd_context.verify(password, password_hash):
            return True
    except Exception:
        pass
    if len(password_hash) == 64:
        try:
            return hashlib.sha256(password.encode()).hexdigest() == password_hash
        except Exception:
            pass
    return False


def create_access_token(email: str):
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": email, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido")

    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT u.id, u.email, u.full_name, u.is_active, "
                "GROUP_CONCAT(r.code) as roles "
                "FROM users u "
                "LEFT JOIN user_roles ur ON u.id = ur.user_id "
                "LEFT JOIN roles r ON ur.role_id = r.id "
                "WHERE u.email = %s "
                "GROUP BY u.id",
                (email,)
            )
            user = cur.fetchone()
    finally:
        conn.close()

    if not user or not user["is_active"]:
        raise HTTPException(status_code=401, detail="Usuario no encontrado")

    user["roles"] = (user["roles"] or "").split(",") if user["roles"] else []
    return user


def require_admin(user=Depends(get_current_user)):
    if "ADMIN" not in user.get("roles", []):
        raise HTTPException(status_code=403, detail="Se requieren permisos de administrador")
    return user


def require_admin_or_uploader(user=Depends(get_current_user)):
    roles = user.get("roles", [])
    if "ADMIN" not in roles and "UPLOADER" not in roles:
        raise HTTPException(status_code=403, detail="Se requieren permisos de administrador o uploader")
    return user


def require_admin_or_uploader_or_researcher(user=Depends(get_current_user)):
    roles = user.get("roles", [])
    if not any(r in roles for r in ("ADMIN", "UPLOADER", "RESEARCHER")):
        raise HTTPException(status_code=403, detail="Se requieren permisos de administrador, uploader o researcher")
    return user


@router.post("/login", response_model=Token)
async def login(user_login: UserLogin):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT u.id, u.email, u.password_hash, u.is_active, "
                "GROUP_CONCAT(r.code) as roles "
                "FROM users u "
                "LEFT JOIN user_roles ur ON u.id = ur.user_id "
                "LEFT JOIN roles r ON ur.role_id = r.id "
                "WHERE u.email = %s "
                "GROUP BY u.id",
                (user_login.email,)
            )
            user = cur.fetchone()
    finally:
        conn.close()

    if not user or not user["is_active"]:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")

    if not verify_password(user_login.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenciales inválidas")

    roles = (user["roles"] or "").split(",") if user["roles"] else []

    return Token(
        access_token=create_access_token(user["email"]),
        token_type="bearer",
        user=UserResponse(id=user["id"], email=user["email"], roles=roles)
    )
