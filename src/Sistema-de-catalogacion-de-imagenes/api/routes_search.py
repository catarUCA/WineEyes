from fastapi import APIRouter, Request
from pydantic import BaseModel
from typing import List, Optional
import os

from api.database import get_all_labels, get_image_ids_by_labels

router = APIRouter(prefix="/search", tags=["search"])

class ImageResponse(BaseModel):
    id: str
    url: str
    title: str
    description: Optional[str] = None
    score: Optional[float] = None

class SearchRequest(BaseModel):
    query: str
    score_threshold: float = 0.0

class TagSearchRequest(BaseModel):
    labels: List[str]
    match_all: bool = False
    query: Optional[str] = None
    score_threshold: float = 0.0

class SearchResponse(BaseModel):
    images: List[ImageResponse]
    total: int
    has_more: bool

class LabelResponse(BaseModel):
    id: int
    name: str
    slug: str
    color: Optional[str] = None

class LabelsResponse(BaseModel):
    labels: List[LabelResponse]


@router.get("/labels", response_model=LabelsResponse)
async def get_labels():
    labels = get_all_labels()
    return LabelsResponse(labels=[LabelResponse(**l) for l in labels])


@router.post("", response_model=SearchResponse)
async def search_images(request: Request, search_request: SearchRequest):
    retrieval_system = request.app.state.retrieval_system

    results = retrieval_system.search_by_text(
        text_query=search_request.query,
        distance_threshold=search_request.score_threshold
    )

    images = []
    for result in results:
        path = result['path']
        filename = os.path.basename(path)

        images.append(ImageResponse(
            id=result['id'],
            url=f"/images/{filename}",
            title=filename,
            score=result['score']
        ))

    return SearchResponse(
        images=images,
        total=len(images),
        has_more=False
    )


@router.post("/tags", response_model=SearchResponse)
async def search_images_by_tags(request: Request, search_request: TagSearchRequest):
    retrieval_system = request.app.state.retrieval_system

    image_ids = retrieval_system.search_by_tags_direct(
        tags=search_request.labels,
        match_all=search_request.match_all
    )
    if not image_ids:
        return SearchResponse(images=[], total=0, has_more=False)

    results = retrieval_system.search_by_tags(
        image_ids=image_ids,
        text_query=search_request.query or None,
        score_threshold=search_request.score_threshold
    )

    images = []
    for result in results:
        path = result['path']
        filename = os.path.basename(path)
        images.append(ImageResponse(
            id=result['id'],
            url=f"/images/{filename}",
            title=filename,
            score=result['score']
        ))

    return SearchResponse(
        images=images,
        total=len(images),
        has_more=False
    )
