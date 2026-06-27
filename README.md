# WineEyes

WineEyes is an open-source pipeline for cataloguing and retrieving heritage
wine labels with natural-language queries. It combines image rectification,
near-duplicate detection, OCR-conditioned vision-language descriptions, and
BGE-M3 dense-sparse retrieval with Reciprocal Rank Fusion (RRF).

The repository also contains the complete evaluation used in the SoftwareX
manuscript: 50 sample labels, 15 queries, binary relevance judgements,
rankings, metrics, latency measurements, and a strict provenance audit.

## Repository layout

- `src/Sistema-de-catalogacion-de-imagenes/`: FastAPI application and
  retrieval implementation.
- `frontend/`: web client and Nginx configuration.
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

## Citation and support

The SoftwareX citation will be added after publication. For technical
questions, use GitHub Issues.
