import os
import pymysql
from passlib.context import CryptContext
from dbutils.pooled_db import PooledDB

MYSQL_HOST = os.getenv("MYSQL_HOST", "localhost")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_USER = os.getenv("MYSQL_USER", "wineeyes")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "oderismo")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

_pool = None


def _get_pool():
    global _pool
    if _pool is None:
        _pool = PooledDB(
            creator=pymysql,
            maxconnections=10,
            host=MYSQL_HOST,
            port=MYSQL_PORT,
            user=MYSQL_USER,
            password=MYSQL_PASSWORD,
            database=MYSQL_DATABASE,
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
        )
    return _pool


def get_db():
    return _get_pool().connection()


def init_db():
    conn = get_db()
    conn.close()


def get_all_labels():
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, slug, color FROM labels WHERE is_active = 1 ORDER BY name")
            return cur.fetchall()
    finally:
        conn.close()


def get_labels_for_image(image_id):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT l.id, l.name, l.slug, l.color "
                "FROM labels l JOIN image_labels il ON l.id = il.label_id "
                "WHERE il.image_id = %s AND l.is_active = 1 "
                "ORDER BY l.name",
                (image_id,)
            )
            return cur.fetchall()
    finally:
        conn.close()


def get_labels_for_images(image_ids):
    if not image_ids:
        return {}
    conn = get_db()
    try:
        placeholders = ",".join(["%s"] * len(image_ids))
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT il.image_id, l.id, l.name, l.slug, l.color "
                f"FROM labels l JOIN image_labels il ON l.id = il.label_id "
                f"WHERE il.image_id IN ({placeholders}) AND l.is_active = 1 "
                f"ORDER BY l.name",
                image_ids
            )
            rows = cur.fetchall()
        result = {}
        for row in rows:
            img_id = row["image_id"]
            if img_id not in result:
                result[img_id] = []
            result[img_id].append({
                "id": row["id"],
                "name": row["name"],
                "slug": row["slug"],
                "color": row["color"],
            })
        return result
    finally:
        conn.close()


def get_image_ids_by_labels(label_ids, match_all=False):
    if not label_ids:
        return []
    conn = get_db()
    try:
        if match_all:
            placeholders = ",".join(["%s"] * len(label_ids))
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT il.image_id FROM image_labels il "
                    f"WHERE il.label_id IN ({placeholders}) "
                    f"GROUP BY il.image_id "
                    f"HAVING COUNT(DISTINCT il.label_id) = %s",
                    (*label_ids, len(label_ids))
                )
                return [row["image_id"] for row in cur.fetchall()]
        else:
            placeholders = ",".join(["%s"] * len(label_ids))
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT DISTINCT il.image_id FROM image_labels il "
                    f"WHERE il.label_id IN ({placeholders})",
                    label_ids
                )
                return [row["image_id"] for row in cur.fetchall()]
    finally:
        conn.close()


def set_image_labels(image_id, label_ids, user_id=None):
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM image_labels WHERE image_id = %s", (image_id,))
            for lid in label_ids:
                cur.execute(
                    "INSERT INTO image_labels (image_id, label_id, assigned_by) VALUES (%s, %s, %s)",
                    (image_id, lid, user_id or 1)
                )
            conn.commit()
    finally:
        conn.close()


def get_label_ids_by_names(names):
    if not names:
        return []
    conn = get_db()
    try:
        placeholders = ",".join(["%s"] * len(names))
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id FROM labels WHERE name IN ({placeholders}) AND is_active = 1",
                names
            )
            return [row["id"] for row in cur.fetchall()]
    finally:
        conn.close()


def ensure_labels_exist(names, created_by=None):
    conn = get_db()
    try:
        result = {}
        with conn.cursor() as cur:
            for name in names:
                slug = name.lower().replace(" ", "-")
                cur.execute("SELECT id FROM labels WHERE name = %s", (name,))
                existing = cur.fetchone()
                if existing:
                    result[name] = existing["id"]
                else:
                    cur.execute(
                        "INSERT INTO labels (name, slug, created_by) VALUES (%s, %s, %s)",
                        (name, slug, created_by or 1)
                    )
                    result[name] = cur.lastrowid
            conn.commit()
        return result
    finally:
        conn.close()
