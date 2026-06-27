from fastapi import APIRouter, Request, Query, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import os
from api.database import get_labels_for_images

router = APIRouter(prefix="/images", tags=["images"])

class LabelResponse(BaseModel):
    id: int
    name: str
    slug: str
    color: Optional[str] = None

class ImageResponse(BaseModel):
    id: str
    url: str
    title: str
    description: Optional[str] = None
    score: Optional[float] = None
    created_at: Optional[str] = None
    labels: List[LabelResponse] = []

class ImagesListResponse(BaseModel):
    images: List[ImageResponse]
    total: int
    page: int
    limit: int
    has_more: bool

class UpdateDescriptionRequest(BaseModel):
    description: str


@router.get("", response_model=ImagesListResponse)
async def get_images(
    request: Request,
    page: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100)
):
    retrieval_system = request.app.state.retrieval_system

    points = retrieval_system.get_metadata()

    total = len(points)
    start = page * limit
    end = start + limit

    page_points = points[start:end]
    img_ids = [p.payload["img_id"] for p in page_points]
    labels_map = get_labels_for_images(img_ids)

    images = []
    for point in page_points:
        payload = point.payload
        filename = os.path.basename(payload['path'])
        img_id = payload["img_id"]

        images.append(ImageResponse(
            id=str(img_id),
            url=f"/images/{filename}",
            title=filename,
            description=payload.get('image_description', ''),
            created_at=payload.get('indexed_at'),
            labels=[LabelResponse(**l) for l in labels_map.get(img_id, [])]
        ))

    return ImagesListResponse(
        images=images,
        total=total,
        page=page,
        limit=limit,
        has_more=end < total
    )

@router.get("/random")
async def get_random_image(request: Request):
    retrieval_system = request.app.state.retrieval_system
    payload = retrieval_system.get_random_image()
    if payload is None:
        raise HTTPException(status_code=404, detail="No hay imagenes")
    filename = os.path.basename(payload['path'])
    img_id = payload["img_id"]
    labels_map = get_labels_for_images([img_id])
    return {
        "id": str(img_id),
        "url": f"/images/{filename}",
        "title": filename,
        "description": payload.get('image_description', ''),
        "labels": [l for l in labels_map.get(img_id, [])],
    }

@router.patch("/{image_id}/description")
async def update_image_description(
    image_id: int,
    body: UpdateDescriptionRequest,
    request: Request
):
    retrieval_system = request.app.state.retrieval_system
    try:
        retrieval_system.update_description(image_id, body.description)
        return {"ok": True, "id": image_id}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{image_id}")
async def delete_image(
    image_id: int,
    request: Request
):
    retrieval_system = request.app.state.retrieval_system

    try:
        retrieval_system.delete_images([image_id])
        return {"message": "Imagen eliminada correctamente", "id": image_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
