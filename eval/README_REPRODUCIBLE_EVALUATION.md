# Reproducible retrieval evaluation

Run every command from the `ProyectoEtiquetas/` root. This flow reads only
`data/ablation_cache.json`, `data/queries.csv`, and qrels. It does not invoke
OCR, VLM, CLIP, or image processing.

## Environment

Python 3.11 or 3.12 is recommended.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-eval.txt
```

The default Qdrant endpoint is `http://localhost:6333`. Override it when the
server uses another endpoint:

```bash
export QDRANT_URL=http://localhost:6333
export QDRANT_API_KEY=                 # only when required
export BGE_MODEL=BAAI/bge-m3
export BGE_REVISION=                   # optional pinned Hugging Face revision
export BGE_DEVICE=cuda:0               # optional; defaults to one GPU or CPU
export BGE_BATCH_SIZE=8                # reduce to 4/2 if GPU memory is limited
export EVAL_BRANCH_DEPTH=100000        # all evaluation points by default
export BENCHMARK_REPEATS=20
export BENCHMARK_WARMUP=2
```

To use qdrant-client local persistence explicitly instead of the remote
service, set `EVAL_QDRANT_MODE=local`. Remote mode is the default.

## Complete run

```bash
python -m unittest discover -s eval/tests -v
python -m eval.audit_inputs
python -m eval.build_eval_indices --reset
python -m eval.run_retrieval
python -m eval.evaluate_rankings
python -m eval.benchmark_hybrid --repeats 20
python -m eval.audit_inputs --strict
```

`--reset` deletes only the five `wineeyes_eval_*` collections declared in
`eval/config.py`. It never opens, deletes, or writes `imagenes` or
`segmentos_texto`.

## Expected outputs

All generated files are written under `results/`:

- `rankings_full.json`
- `retrieval_metrics_full.json`
- `metrics_by_query.csv`
- `metrics_by_type.csv`
- `evaluation_audit.json`
- `evaluation_audit.md`
- `table4.tex`
- `benchmark_hybrid.json`
- `benchmark_hybrid.csv`
- `experiment_manifest.json`
- `run_log.txt`

The existing `results/rankings.json` remains a historical top-10 input and
is never overwritten by this flow.
