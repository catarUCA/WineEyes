# WineEyes v1.2

WineEyes is an open-source pipeline for cataloguing and retrieving heritage
wine labels with natural-language queries. It combines image rectification,
near-duplicate detection, OCR-conditioned vision-language descriptions, and
BGE-M3 dense–sparse retrieval with Reciprocal Rank Fusion (RRF).

Version 1.2 extends the ingestion pipeline with a scene- and shape-aware
label-cropping router (`pipeline_v2.py`) and an interactive Crop Tuner
("afinador") for operator refinement. The router analyses background scene and
label geometry before selecting an extraction method (OpenCV Otsu/GrabCut,
deep-learning segmentation via rembg, or colour-difference masking for
pre-cropped images). When automatic cropping is unsatisfactory, an operator can
inspect the analysis, adjust parameters, deskew, and export a refined crop,
which then replaces the automatic one downstream.

The repository also contains the complete evaluation used in the SoftwareX
manuscript: 50 sample labels, 15 queries, binary relevance judgements,
rankings, metrics, latency measurements, an ablation, and a strict provenance
audit.

## Repository layout

- `src/Sistema-de-catalogacion-de-imagenes/`: FastAPI application and pipeline.
  - `api_server.py`, `api/`: REST API — `routes_search.py`, `routes_upload.py`,
    `routes_images.py`, `routes_auth.py`, `routes_admin.py`, and
    `routes_afinador.py` (Crop Tuner endpoint).
  - `retrieval_system.py`: dense–sparse retrieval and RRF.
  - `feature_extractor.py`: OCR and VLM description via Ollama.
  - `pipeline_v2.py`, `metodos_recorte.py`, `parametros_recorte.py`,
    `preprocesadoV3.py`: label-cropping router and methods.
- `eval/`: reproducible evaluation package (retrieval, metrics, significance,
  ablations, crop/OCR component evaluation, ingestion timing, latency, tests).
  See `eval/README_REPRODUCIBLE_EVALUATION.md`.
- `embedding-service/`: standalone BGE-M3 embedding service (dense + sparse via
  FlagEmbedding, `server.py`, default port `8002`). Independent of the compose
  stack, which serves text embeddings through Ollama (`bge-m3:latest`);
  provided as an alternative embedding backend.
- `rembg-service/`: background-removal service (`service.py`).
- `frontend/Oderismo/`: web client (`index.html`, `app.html`,
  `afinador.html`, `css/`, `js/`) with a PHP backend (`php/`).
- `data/`: queries, qrels, cached model outputs, and annotation files
  (including `ocr_groundtruth.csv` for the crop/OCR evaluation).
- `results/`: audit and run log; evaluation artefacts are generated here.
- `WineEyes.sql`: MariaDB/MySQL catalogue schema; contains no user records or
  credentials.

## Requirements

- Python 3.11 or 3.12
- Qdrant 1.17.1 (pinned) or a compatible `qdrant-client` local store
- MariaDB 10.6 or a compatible MySQL server for the application
- Ollama for ingestion with `glm-ocr:latest` (OCR) and `gemma4:26b` (VLM)
- Docker and Docker Compose for service deployment
- A CUDA-capable GPU is recommended for OCR/VLM ingestion; the core evaluation
  (Table 2 and significance) runs on CPU from cached descriptions.

Model tags are read from the environment (`OCR_MODEL`, `VISION_MODEL`,
`TEXT_EMBED_MODEL`); the pinned defaults are `glm-ocr:latest`, `gemma4:26b`,
and `bge-m3:latest`.

## Reproducing the paper

### Core evaluation (CPU, from cached descriptions)

Does not invoke OCR, the VLM, or CLIP; uses the released cached descriptions
and Qdrant local persistence.

```bash
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
python -m pip install -r requirements-eval.txt

export EVAL_QDRANT_MODE=local        # PowerShell: $env:EVAL_QDRANT_MODE="local"

python -m unittest discover -s eval/tests -v
python -m eval.audit_inputs
python -m eval.build_eval_indices --reset
python -m eval.run_retrieval         # writes results/rankings_full.json
python -m eval.evaluate_rankings     # writes results/metrics_by_query.csv, table4.tex
python -m eval.significance          # writes results/table_significance.tex,
                                     #        results/table_perquery.tex,
                                     #        results/significance.csv
python -m eval.benchmark_hybrid --repeats 20
python -m eval.audit_inputs --strict
```

The strict audit should report 355 checks and zero critical failures.
`eval.significance` depends only on `numpy`; its `k=60` figures match Table 2
and it reports paired Wilcoxon and permutation tests with 95% bootstrap CIs.

### Ablations

Branch and parameter ablation over the segmented representation (needs Qdrant +
BGE-M3); reproduces the ablation table in the paper:

```bash
export EVAL_QDRANT_MODE=local
python -m eval.build_eval_indices --reset   # if not already built
python -m eval.ablation_rrf          # dense-only, sparse-only, RRF k in {10,30,60,100}
                                     #   -> results/table_ablation.tex, ablation.csv
```

Source- and representation-level ablations (regenerate the OCR/VLM and
full/segmented rows; these call the real models, so they need Ollama + GPU):

```bash
python -m eval.ablation_fusion --phase ocr    # OCR vs VLM vs OCR+VLM (phase 1)
python -m eval.ablation_fusion --phase vlm    # OCR vs VLM vs OCR+VLM (phase 2)
python -m eval.ablation_segmentation          # full vs segments vs both
```

### Component evaluations (need Ollama + GPU)

These call the real OCR/VLM through the containerised Ollama, so they need the
running Ollama service, the `ollama` Python package, and `eval/` on the import
path. From the project root:

```bash
pip install ollama
export PYTHONPATH=eval               # PowerShell: $env:PYTHONPATH="<repo>/eval"
export OCR_MODEL=glm-ocr:latest
export VISION_MODEL=gemma4:26b
export OLLAMA_HOST=http://localhost:11434

python -m eval.crop_eval             # crop success rate + OCR CER/WER (50-label sample)
python -m eval.measure_ingestion     # per-image OCR/VLM cost -> results/ingestion_cost.csv
```

`eval.crop_eval` requires `data/ocr_groundtruth.csv` (included). On the
50-label sample, the production route (rembg/U²-Net + quadrilateral
rectification) produced a valid crop for 46/50 labels (92%); OCR reached
CER 0.176 / WER 0.278.

> **Note.** `eval.crop_eval` and `eval.measure_ingestion` import
> `feature_extractor` from `eval/`, hence the `PYTHONPATH=eval` requirement.
> Ensure `ollama` and `numpy` are listed in `requirements-eval.txt`.

## Deployment (docker compose)

```bash
cp example.env .env                  # then edit secrets and paths
docker compose up -d --build
```

Default service endpoints:

- API: `http://localhost:10000`
- Qdrant: `http://localhost:6333`
- Ollama: `http://localhost:11434`
- rembg service: `http://localhost:8001`

Text embeddings are served by Ollama (`bge-m3:latest`) in this stack. The
standalone `embedding-service/` (port `8002`) is an optional alternative and
is not started by this compose file.

The compose stack pins `qdrant/qdrant:1.17.1` and loads `WineEyes.sql` into
MariaDB on first start. Set `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD` in
`.env`; the container fails fast if they are missing. Under compose the backend
reaches the database by service name (`mariadb`); for a local, non-Docker run
set `MYSQL_HOST=localhost`. Processed images, thumbnails, and debug output are
stored under `./runtime/` by default (override `IMAGE_DEST_HOST`,
`THUMB_DEST_HOST`, `DEBUG_DIR_HOST`).

## Label cropping

During ingestion each photograph is analysed before cropping. The automatic
router (`pipeline_v2.py`) classifies the background scene and label shape and
selects a route:

| Scene | Criterion | Typical route |
|---|---|---|
| Dark background | Corner luminance < 55 | Wide Otsu |
| Grey background | Corner luminance 55–140 | Otsu / wide Otsu |
| Textured mesh | Grey + higher edge texture than label centre | rembg + deskew |
| Light background | Corner luminance ≥ 140 | GrabCut |
| Small / pre-cropped | max(width, height) < 900 px | Corner colour difference |

Shape detection (rectangle, circle, diamond, irregular/die-cut) prevents
destructive deskewing on complex silhouettes; candidate masks are scored and
automatic fallbacks apply when the primary route fails. Production
implementation: `pipeline_v2.py`, `metodos_recorte.py`, `parametros_recorte.py`.

The Crop Tuner is the panel `frontend/Oderismo/afinador.html`, backed by the
API endpoint `api/routes_afinador.py`: an operator can inspect the automatic
analysis, override the route, adjust parameters and deskew, preview, and save a
refined crop when the automatic route is insufficient.

## Search API

```bash
curl -X POST http://localhost:10000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "escudo heraldico", "score_threshold": 0.0}'
```

The response contains label identifiers, image URLs, and relative RRF scores
(ranking values, not calibrated relevance probabilities).

## Data and rights

Released under the [MIT License](LICENSE.txt). The 50 evaluation images retain
their respective rights and are included for validation of the reported
results. The complete source collection is not redistributed. Cached OCR/VLM
text, qrels, rankings, and metrics are provided to make the reported evaluation
independently inspectable.

## Citation and support

The SoftwareX citation will be added after publication. For technical
questions, use GitHub Issues.