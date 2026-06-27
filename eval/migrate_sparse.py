#!/usr/bin/env python3
"""
migrate_sparse.py -- Reconfigura únicamente la colección de textos 
añadiendo dinámicamente la carpeta 'source' al path de Python.
"""

import os
import sys
from pathlib import Path

# =====================================================================
# INYECCIÓN DE RUTAS (Truco para que Windows encuentre tu carpeta source)
# =====================================================================
_HERE = Path(__file__).resolve().parent
# Si estás dentro de 'eval', la raíz es el padre. Si estás en la raíz, es _HERE.
_ROOT = _HERE.parent if _HERE.name == "eval" else _HERE

# Buscamos la carpeta 'source' (o 'src') y la metemos en el motor de búsqueda de Python
_SOURCE_DIR = _ROOT / "src/Sistema-de-catalogacion-de-imagenes"
if not _SOURCE_DIR.exists():
    _SOURCE_DIR = _ROOT / "src"  # Por si acaso

if _SOURCE_DIR.exists():
    if str(_SOURCE_DIR) not in sys.path:
        sys.path.insert(0, str(_SOURCE_DIR))
    logging_path_msg = f"Carpeta de código detectada en: {_SOURCE_DIR}"
else:
    logging_path_msg = "No se encontró la carpeta 'source' o 'src'. Verifica la estructura."

# Ahora sí, importamos el resto de librerías de forma segura
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct
from retrieval_system import ImageRetrievalSystem
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Migrador")
if "No se encontró" in logging_path_msg:
    logger.error(logging_path_msg)
else:
    logger.info(logging_path_msg)

def filtrar_y_recrear():
    # Inicializar el sistema híbrido
    system = ImageRetrievalSystem(reset_index=False)
    target_collection = system.text_collection 
    
    logger.info(f"Destruyendo EXCLUSIVAMENTE la colección: '{target_collection}'...")
    system.client.delete_collection(collection_name=target_collection)
    
    logger.info(f"Recreando '{target_collection}' con la nueva estructura híbrida...")
    system.ensure_collection()
    
    logger.info("Recuperando descripciones de la colección de imágenes para repoblar...")
    puntos_imagenes, _ = system.client.scroll(
        collection_name=system.image_collection,
        limit=10000,
        with_payload=True,
        with_vectors=False
    )
    
    if not puntos_imagenes:
        logger.info("La colección de imágenes estaba vacía. Estructura híbrida lista para usar.")
        return

    logger.info(f"Generando vectores dispersos para {len(puntos_imagenes)} imágenes existentes...")
    system.last_text_id = 0
    
    for punto in puntos_imagenes:
        img_id = punto.payload["img_id"]
        descripcion = punto.payload["image_description"]
        path = punto.payload["path"]
        
        segments = system.split_description(descripcion)
        all_texts = [" ".join(segments)] + segments
        
        text_points = []
        for text in all_texts:
            system.last_text_id += 1
            dense_vec, sparse_vec = system._embed_text_hybrid(text)
            
            point = PointStruct(
                id=system.last_text_id,
                vector={
                    "semantico": dense_vec,
                    "lexico": sparse_vec
                },
                payload={
                    "img_id":        img_id,
                    "segment_id":    system.last_text_id,
                    "segment_text":  text,
                    "path":          path,
                }
            )
            text_points.append(point)
            
        if text_points:
            system.client.upsert(
                collection_name=target_collection,
                points=text_points
            )
            
    logger.info(f"¡Migración completada! Se han regenerado {system.last_text_id} segmentos híbridos.")

if __name__ == "__main__":
    filtrar_y_recrear()
