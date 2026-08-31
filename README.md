# WineEyes v1.2

WineEyes is an open-source pipeline for cataloguing and retrieving heritage
wine labels with natural-language queries. It combines image rectification,
near-duplicate detection, OCR-conditioned vision-language descriptions, and
BGE-M3 dense-sparse retrieval with Reciprocal Rank Fusion (RRF).

Version 1.2 extends the ingestion pipeline with an **intelligent label-cropping
router** and an interactive **Crop Tuner** for operator refinement. The router
analyses background scene and label geometry before selecting the best
extraction method (OpenCV Otsu/GrabCut, deep-learning segmentation via rembg,
or colour-difference masking for pre-cropped images). When automatic cropping
is unsatisfactory, the Crop Tuner provides a web panel to inspect the analysis,
adjust parameters, and export a refined PNG.

The repository also contains the complete evaluation used in the SoftwareX
manuscript: 50 sample labels, 15 queries, binary relevance judgements,
rankings, metrics, latency measurements, and a strict provenance audit.

## Repository layout

- `src/Sistema-de-catalogacion-de-imagenes/`: FastAPI application and
  retrieval implementation.
- `frontend/`: web client and Nginx configuration.
- `recortes/`: label-cropping engine (router v2), parameterised methods, Crop
  Tuner server, and benchmark scripts.
- `rembg-service/`: background-removal service.
- `embedding-service/`: embedding service.
- `eval/`: reproducible evaluation modules and tests.
- `data/`: queries, qrels, cached model outputs, and annotation files.
- `results/`: generated rankings, metrics, audit, and benchmark outputs.
- `oderismo.sql`: MariaDB/MySQL catalogue schema, constraints, and initial
  role definitions; it contains no user records or credentials.

## Requirements

- Python 3.11 or 3.12
- Qdrant 1.17 or a compatible `qdrant-client` local store
- MariaDB 10.6 or compatible MySQL server for the application
- Ollama for ingestion with `glm-ocr:bf16` and `gemma4:26b`
- Docker and Docker Compose for service deployment
- A CUDA-capable GPU is recommended for OCR/VLM ingestion; evaluation can run
  on CPU.

Production deployment additionally uses a MySQL database for accounts and
catalogue metadata. Configure all credentials through `.env`; never commit
production secrets.

Label cropping additionally requires:

- **rembg service** (port `8001` by default) for textured backgrounds and as a
  production fallback.
- **OpenCV** (installed via the main Python requirements) for scene-aware Otsu
  and GrabCut routes.
- **Crop Tuner** (optional, development and edge cases): local FastAPI server
  on port `9877`.

## Evaluation quick start

The evaluation does not invoke OCR, the VLM, CLIP, or image preprocessing. It
uses the released cached descriptions and can use Qdrant local persistence.

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
python -m pip install -r requirements-eval.txt

export EVAL_QDRANT_MODE=local  # PowerShell: $env:EVAL_QDRANT_MODE="local"
python -m unittest discover -s eval/tests -v
python -m eval.audit_inputs
python -m eval.build_eval_indices --reset
python -m eval.run_retrieval
python -m eval.evaluate_rankings
python -m eval.benchmark_hybrid --repeats 20
python -m eval.audit_inputs --strict
```

Generated outputs are written to `results/`. The final strict audit should
report 355 checks and zero critical failures. See
[`eval/README_REPRODUCIBLE_EVALUATION.md`](eval/README_REPRODUCIBLE_EVALUATION.md)
for environment variables, remote Qdrant configuration, and output details.

## Application configuration

Copy `example.env` to `.env` and replace every placeholder. The main service
uses these endpoints by default:

- API: `http://localhost:10000`
- Qdrant: `http://localhost:6333`
- Ollama: `http://localhost:11434`
- rembg service: `http://localhost:8001`

Create the application database before starting the API:

```bash
mysql -u root -p -e "CREATE DATABASE oderismo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p oderismo < oderismo.sql
```

Then set `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and
`MYSQL_DATABASE=oderismo` in `.env`. The SQL file creates no application
users; provision the first account according to your deployment policy.

Compose stores processed images, thumbnails, and debug output below
`./runtime/` by default. Override `IMAGE_DEST_HOST`, `THUMB_DEST_HOST`, and
`DEBUG_DIR_HOST` in `.env` when persistent storage belongs elsewhere. The
evaluation workflow above remains the shortest path for reproducing the paper.

For label cropping, set `REMBG_URL` (default `http://localhost:8001`) so the
router can reach the rembg service.

## Label cropping (router v2)

During ingestion, each uploaded photograph is analysed before cropping. The
**automatic router** classifies:

| Scene | Criterion | Typical route |
|---|---|---|
| Dark background | Corner luminance < 55 | Wide Otsu |
| Grey background | Corner luminance 55–140 | Otsu / wide Otsu |
| Textured mesh | Grey + higher edge texture than label centre | rembg + deskew |
| Light background | Corner luminance ≥ 140 | GrabCut |
| Small / pre-cropped | max(width, height) < 900 px | Corner colour difference |

**Shape detection** (rectangle, circle, diamond, irregular/die-cut) prevents
destructive deskewing on pointed or complex silhouettes. Candidate masks are
scored and automatic fallbacks apply when the primary route fails.

Standalone methods available to the router and Crop Tuner:

| Method | Purpose |
|---|---|
| `auto` | Router v2: scene × shape → optimal path |
| `rembg_service` | Deep-learning segmentation (production) |
| `wide_dark_background` | Conservative Otsu on dark backgrounds |
| `dark_background` | Balanced Otsu on dark backgrounds |
| `light_background` / `light_contour` | GrabCut for light scans |
| `dark_background_grabcut` | GrabCut on dark backgrounds (fine edges) |
| `circular_contour` | Contour-based extraction for round labels |

Implementation: `recortes/pipeline_v2.py`, `recortes/metodos_recorte.py`.

### Crop Tuner quick start

Interactive panel for refining crops when the automatic router is insufficient.
Requires the project virtual environment and the rembg service when testing
rembg routes.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r recortes/requirements.txt

# Terminal 1 — rembg (production-compatible API)
python recortes/rembg_service_local.py --port 8001

# Terminal 2 — Crop Tuner
python recortes/servidor_afinado.py
```

Open **http://127.0.0.1:9877/** in the browser. Do not open
`recortes/static/afinador.html` as a `file://` URL; the panel must be served
over HTTP.

**Workflow:** upload one image → review automatic analysis (scene, shape,
suggested route) → adjust parameters → preview side-by-side → save PNG to
`recortes/resultados/afinador/`.

**Crop Tuner API**

| Endpoint | Method | Description |
|---|---|---|
| `/api/schema` | GET | Available methods and parameters |
| `/api/analizar` | POST | Automatic analysis + original preview |
| `/api/recortar` | POST | Image + JSON parameters → crop preview |
| `/api/guardar` | POST | Save PNG to `recortes/resultados/afinador/` |

**User-adjustable parameters**

| Parameter | Range / options | Effect |
|---|---|---|
| Method | `auto`, `rembg_service`, OpenCV variants | Extraction algorithm |
| Force route (auto only) | `rembg`, `wide_otsu`, `otsu_rectangular`, `grabcut`, `small_image`, … | Override router decision |
| Border margin (%) | 0–15 | Bounding-box padding |
| Otsu threshold | 30–90 | Foreground/background separation on dark scenes |
| Mask dilation | 0–8 | Recover thin edges |
| Dark-background luminance | 20–80 | Pixels darker than this value are background |
| Deskew label | auto / yes / no | Rotation correction (OpenCV) |
| Corner colour difference | 10–60 | Pre-cropped small images only |
| Deskew after rembg | on / off | Post-segmentation rotation |

### Cropping benchmark

Evaluate the automatic router on the reference corpus (`01.JPG`–`10.jpg`):

```bash
python recortes/benchmark_corpus.py -m auto
```

Outputs are written to `recortes/resultados/corpus_v2/`.

## Search API

After starting and indexing the application:

```bash
curl -X POST http://localhost:10000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"escudo heraldico","score_threshold":0.0}'
```

The response contains label identifiers, image URLs, and relative RRF scores.
RRF scores are ranking values, not calibrated relevance probabilities.

## Data and rights

The software is released under the [MIT License](LICENSE.txt). The 50 evaluation
images retain their respective rights and are included for validation of the
reported results. The complete source collection is not redistributed. Cached
OCR/VLM text, qrels, rankings, and metrics are provided
to make the reported evaluation independently inspectable.

## Live Demo

A live deployment of the web client (located in the `frontend/` directory) is available at: **[etiquetaspacoodero.com](https://etiquetaspacoodero.com)**

## Citation and support

The SoftwareX citation will be added after publication. For technical
questions, use GitHub Issues.
