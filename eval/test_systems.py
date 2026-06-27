import os
os.environ.setdefault("QDRANT_HOST", os.getenv("QDRANT_HOST", "localhost"))
os.environ.setdefault("QDRANT_PORT", os.getenv("QDRANT_PORT", "6333"))
os.environ.setdefault("OLLAMA_HOST", os.getenv("OLLAMA_HOST", "http://localhost:11434"))

from eval.utils import get_rs
from eval.systems import OwnSystem, ClipSystem, Bm25System, SearchHit

rs = get_rs()
QUERY = "etiqueta de Jerez"
K = 5

for S in (OwnSystem(rs), ClipSystem(rs), Bm25System(rs)):
    hits = S.search(QUERY, K)
    assert hits, f"{S.name} devolvio 0 resultados"
    for h in hits:
        assert isinstance(h, SearchHit), f"{S.name}: {h} no es SearchHit"
    print(f"{S.name:14s} -> {', '.join(str(h.img_id) for h in hits)}")

print("systems OK")
