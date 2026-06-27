# WineEyes evaluation audit

Generated: `2026-06-19T11:57:11.751419+00:00`
Overall status: **PASS**

| Check | Status | Critical | Detail |
|---|---:|---:|---|
| `query_count` | pass | True | found=15 expected=15 |
| `ocr_count` | pass | True | found=50 expected=50 |
| `ocr_canonical_ids` | pass | True | missing=[] unknown=[] |
| `ocr_nonempty` | pass | True | empty=[] |
| `vlm_solo_count` | pass | True | found=50 expected=50 |
| `vlm_solo_canonical_ids` | pass | True | missing=[] unknown=[] |
| `vlm_solo_nonempty` | pass | True | empty=[] |
| `vlm_fusion_count` | pass | True | found=50 expected=50 |
| `vlm_fusion_canonical_ids` | pass | True | missing=[] unknown=[] |
| `vlm_fusion_nonempty` | pass | True | empty=[] |
| `representation_id_sets_identical` | pass | True | ocr/vlm_solo/vlm_fusion |
| `image_count` | pass | True | found=50 missing=[] |
| `qrels_query_coverage` | pass | True | missing=[] extra=[] |
| `qrels_ids_known` | pass | True | unknown=[] |
| `queries_have_qrels` | pass | True | missing=[] |
| `qrels_format` | pass | True | binary=True path=data\qrels.json |
| `qdrant_available` | pass | True | connected |
| `collection_solo_ocr_eval_ids` | pass | True | points=50 distinct_eval_ids=50 |
| `collection_solo_ocr_payload` | pass | True | bad_payload_indices=[] |
| `collection_solo_ocr_no_external_docs` | pass | True | external=[] |
| `collection_solo_ocr_one_full_per_label` | pass | True | invalid=[] |
| `collection_solo_vlm_eval_ids` | pass | True | points=50 distinct_eval_ids=50 |
| `collection_solo_vlm_payload` | pass | True | bad_payload_indices=[] |
| `collection_solo_vlm_no_external_docs` | pass | True | external=[] |
| `collection_solo_vlm_one_full_per_label` | pass | True | invalid=[] |
| `collection_ocr_vlm_eval_ids` | pass | True | points=50 distinct_eval_ids=50 |
| `collection_ocr_vlm_payload` | pass | True | bad_payload_indices=[] |
| `collection_ocr_vlm_no_external_docs` | pass | True | external=[] |
| `collection_ocr_vlm_one_full_per_label` | pass | True | invalid=[] |
| `collection_ocr_vlm_hybrid_full_eval_ids` | pass | True | points=50 distinct_eval_ids=50 |
| `collection_ocr_vlm_hybrid_full_payload` | pass | True | bad_payload_indices=[] |
| `collection_ocr_vlm_hybrid_full_no_external_docs` | pass | True | external=[] |
| `collection_ocr_vlm_hybrid_full_one_full_per_label` | pass | True | invalid=[] |
| `collection_ocr_vlm_hybrid_segmented_eval_ids` | pass | True | points=2704 distinct_eval_ids=50 |
| `collection_ocr_vlm_hybrid_segmented_payload` | pass | True | bad_payload_indices=[] |
| `collection_ocr_vlm_hybrid_segmented_no_external_docs` | pass | True | external=[] |
| `collection_ocr_vlm_hybrid_segmented_one_full_per_label` | pass | True | invalid=[] |
| `ranking_query_set` | pass | True | found=15 expected=15 |
| `ranking_q01_solo_ocr_unique` | pass | True | depth=50 unique=50 |
| `ranking_q01_solo_ocr_known` | pass | True | unknown=[] |
| `ranking_q01_solo_ocr_complete` | pass | True | depth=50 |
| `ranking_q01_solo_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q01_solo_vlm_known` | pass | True | unknown=[] |
| `ranking_q01_solo_vlm_complete` | pass | True | depth=50 |
| `ranking_q01_ocr_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q01_ocr_vlm_known` | pass | True | unknown=[] |
| `ranking_q01_ocr_vlm_complete` | pass | True | depth=50 |
| `ranking_q01_ocr_vlm_hybrid_full_unique` | pass | True | depth=50 unique=50 |
| `ranking_q01_ocr_vlm_hybrid_full_known` | pass | True | unknown=[] |
| `ranking_q01_ocr_vlm_hybrid_full_complete` | pass | True | depth=50 |
| `ranking_q01_ocr_vlm_hybrid_segmented_unique` | pass | True | depth=50 unique=50 |
| `ranking_q01_ocr_vlm_hybrid_segmented_known` | pass | True | unknown=[] |
| `ranking_q01_ocr_vlm_hybrid_segmented_complete` | pass | True | depth=50 |
| `ranking_q01_bm25_ocr_unique` | pass | True | depth=10 unique=10 |
| `ranking_q01_bm25_ocr_known` | pass | True | unknown=[] |
| `ranking_q01_bm25_fusion_unique` | pass | True | depth=10 unique=10 |
| `ranking_q01_bm25_fusion_known` | pass | True | unknown=[] |
| `ranking_q01_clip_zeroshot_unique` | pass | True | depth=10 unique=10 |
| `ranking_q01_clip_zeroshot_known` | pass | True | unknown=[] |
| `ranking_q02_solo_ocr_unique` | pass | True | depth=50 unique=50 |
| `ranking_q02_solo_ocr_known` | pass | True | unknown=[] |
| `ranking_q02_solo_ocr_complete` | pass | True | depth=50 |
| `ranking_q02_solo_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q02_solo_vlm_known` | pass | True | unknown=[] |
| `ranking_q02_solo_vlm_complete` | pass | True | depth=50 |
| `ranking_q02_ocr_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q02_ocr_vlm_known` | pass | True | unknown=[] |
| `ranking_q02_ocr_vlm_complete` | pass | True | depth=50 |
| `ranking_q02_ocr_vlm_hybrid_full_unique` | pass | True | depth=50 unique=50 |
| `ranking_q02_ocr_vlm_hybrid_full_known` | pass | True | unknown=[] |
| `ranking_q02_ocr_vlm_hybrid_full_complete` | pass | True | depth=50 |
| `ranking_q02_ocr_vlm_hybrid_segmented_unique` | pass | True | depth=50 unique=50 |
| `ranking_q02_ocr_vlm_hybrid_segmented_known` | pass | True | unknown=[] |
| `ranking_q02_ocr_vlm_hybrid_segmented_complete` | pass | True | depth=50 |
| `ranking_q02_bm25_ocr_unique` | pass | True | depth=10 unique=10 |
| `ranking_q02_bm25_ocr_known` | pass | True | unknown=[] |
| `ranking_q02_bm25_fusion_unique` | pass | True | depth=10 unique=10 |
| `ranking_q02_bm25_fusion_known` | pass | True | unknown=[] |
| `ranking_q02_clip_zeroshot_unique` | pass | True | depth=10 unique=10 |
| `ranking_q02_clip_zeroshot_known` | pass | True | unknown=[] |
| `ranking_q03_solo_ocr_unique` | pass | True | depth=50 unique=50 |
| `ranking_q03_solo_ocr_known` | pass | True | unknown=[] |
| `ranking_q03_solo_ocr_complete` | pass | True | depth=50 |
| `ranking_q03_solo_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q03_solo_vlm_known` | pass | True | unknown=[] |
| `ranking_q03_solo_vlm_complete` | pass | True | depth=50 |
| `ranking_q03_ocr_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q03_ocr_vlm_known` | pass | True | unknown=[] |
| `ranking_q03_ocr_vlm_complete` | pass | True | depth=50 |
| `ranking_q03_ocr_vlm_hybrid_full_unique` | pass | True | depth=50 unique=50 |
| `ranking_q03_ocr_vlm_hybrid_full_known` | pass | True | unknown=[] |
| `ranking_q03_ocr_vlm_hybrid_full_complete` | pass | True | depth=50 |
| `ranking_q03_ocr_vlm_hybrid_segmented_unique` | pass | True | depth=50 unique=50 |
| `ranking_q03_ocr_vlm_hybrid_segmented_known` | pass | True | unknown=[] |
| `ranking_q03_ocr_vlm_hybrid_segmented_complete` | pass | True | depth=50 |
| `ranking_q03_bm25_ocr_unique` | pass | True | depth=10 unique=10 |
| `ranking_q03_bm25_ocr_known` | pass | True | unknown=[] |
| `ranking_q03_bm25_fusion_unique` | pass | True | depth=10 unique=10 |
| `ranking_q03_bm25_fusion_known` | pass | True | unknown=[] |
| `ranking_q03_clip_zeroshot_unique` | pass | True | depth=10 unique=10 |
| `ranking_q03_clip_zeroshot_known` | pass | True | unknown=[] |
| `ranking_q04_solo_ocr_unique` | pass | True | depth=50 unique=50 |
| `ranking_q04_solo_ocr_known` | pass | True | unknown=[] |
| `ranking_q04_solo_ocr_complete` | pass | True | depth=50 |
| `ranking_q04_solo_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q04_solo_vlm_known` | pass | True | unknown=[] |
| `ranking_q04_solo_vlm_complete` | pass | True | depth=50 |
| `ranking_q04_ocr_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q04_ocr_vlm_known` | pass | True | unknown=[] |
| `ranking_q04_ocr_vlm_complete` | pass | True | depth=50 |
| `ranking_q04_ocr_vlm_hybrid_full_unique` | pass | True | depth=50 unique=50 |
| `ranking_q04_ocr_vlm_hybrid_full_known` | pass | True | unknown=[] |
| `ranking_q04_ocr_vlm_hybrid_full_complete` | pass | True | depth=50 |
| `ranking_q04_ocr_vlm_hybrid_segmented_unique` | pass | True | depth=50 unique=50 |
| `ranking_q04_ocr_vlm_hybrid_segmented_known` | pass | True | unknown=[] |
| `ranking_q04_ocr_vlm_hybrid_segmented_complete` | pass | True | depth=50 |
| `ranking_q04_bm25_ocr_unique` | pass | True | depth=10 unique=10 |
| `ranking_q04_bm25_ocr_known` | pass | True | unknown=[] |
| `ranking_q04_bm25_fusion_unique` | pass | True | depth=10 unique=10 |
| `ranking_q04_bm25_fusion_known` | pass | True | unknown=[] |
| `ranking_q04_clip_zeroshot_unique` | pass | True | depth=10 unique=10 |
| `ranking_q04_clip_zeroshot_known` | pass | True | unknown=[] |
| `ranking_q05_solo_ocr_unique` | pass | True | depth=50 unique=50 |
| `ranking_q05_solo_ocr_known` | pass | True | unknown=[] |
| `ranking_q05_solo_ocr_complete` | pass | True | depth=50 |
| `ranking_q05_solo_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q05_solo_vlm_known` | pass | True | unknown=[] |
| `ranking_q05_solo_vlm_complete` | pass | True | depth=50 |
| `ranking_q05_ocr_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q05_ocr_vlm_known` | pass | True | unknown=[] |
| `ranking_q05_ocr_vlm_complete` | pass | True | depth=50 |
| `ranking_q05_ocr_vlm_hybrid_full_unique` | pass | True | depth=50 unique=50 |
| `ranking_q05_ocr_vlm_hybrid_full_known` | pass | True | unknown=[] |
| `ranking_q05_ocr_vlm_hybrid_full_complete` | pass | True | depth=50 |
| `ranking_q05_ocr_vlm_hybrid_segmented_unique` | pass | True | depth=50 unique=50 |
| `ranking_q05_ocr_vlm_hybrid_segmented_known` | pass | True | unknown=[] |
| `ranking_q05_ocr_vlm_hybrid_segmented_complete` | pass | True | depth=50 |
| `ranking_q05_bm25_ocr_unique` | pass | True | depth=10 unique=10 |
| `ranking_q05_bm25_ocr_known` | pass | True | unknown=[] |
| `ranking_q05_bm25_fusion_unique` | pass | True | depth=10 unique=10 |
| `ranking_q05_bm25_fusion_known` | pass | True | unknown=[] |
| `ranking_q05_clip_zeroshot_unique` | pass | True | depth=10 unique=10 |
| `ranking_q05_clip_zeroshot_known` | pass | True | unknown=[] |
| `ranking_q06_solo_ocr_unique` | pass | True | depth=50 unique=50 |
| `ranking_q06_solo_ocr_known` | pass | True | unknown=[] |
| `ranking_q06_solo_ocr_complete` | pass | True | depth=50 |
| `ranking_q06_solo_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q06_solo_vlm_known` | pass | True | unknown=[] |
| `ranking_q06_solo_vlm_complete` | pass | True | depth=50 |
| `ranking_q06_ocr_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q06_ocr_vlm_known` | pass | True | unknown=[] |
| `ranking_q06_ocr_vlm_complete` | pass | True | depth=50 |
| `ranking_q06_ocr_vlm_hybrid_full_unique` | pass | True | depth=50 unique=50 |
| `ranking_q06_ocr_vlm_hybrid_full_known` | pass | True | unknown=[] |
| `ranking_q06_ocr_vlm_hybrid_full_complete` | pass | True | depth=50 |
| `ranking_q06_ocr_vlm_hybrid_segmented_unique` | pass | True | depth=50 unique=50 |
| `ranking_q06_ocr_vlm_hybrid_segmented_known` | pass | True | unknown=[] |
| `ranking_q06_ocr_vlm_hybrid_segmented_complete` | pass | True | depth=50 |
| `ranking_q06_bm25_ocr_unique` | pass | True | depth=10 unique=10 |
| `ranking_q06_bm25_ocr_known` | pass | True | unknown=[] |
| `ranking_q06_bm25_fusion_unique` | pass | True | depth=10 unique=10 |
| `ranking_q06_bm25_fusion_known` | pass | True | unknown=[] |
| `ranking_q06_clip_zeroshot_unique` | pass | True | depth=10 unique=10 |
| `ranking_q06_clip_zeroshot_known` | pass | True | unknown=[] |
| `ranking_q07_solo_ocr_unique` | pass | True | depth=50 unique=50 |
| `ranking_q07_solo_ocr_known` | pass | True | unknown=[] |
| `ranking_q07_solo_ocr_complete` | pass | True | depth=50 |
| `ranking_q07_solo_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q07_solo_vlm_known` | pass | True | unknown=[] |
| `ranking_q07_solo_vlm_complete` | pass | True | depth=50 |
| `ranking_q07_ocr_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q07_ocr_vlm_known` | pass | True | unknown=[] |
| `ranking_q07_ocr_vlm_complete` | pass | True | depth=50 |
| `ranking_q07_ocr_vlm_hybrid_full_unique` | pass | True | depth=50 unique=50 |
| `ranking_q07_ocr_vlm_hybrid_full_known` | pass | True | unknown=[] |
| `ranking_q07_ocr_vlm_hybrid_full_complete` | pass | True | depth=50 |
| `ranking_q07_ocr_vlm_hybrid_segmented_unique` | pass | True | depth=50 unique=50 |
| `ranking_q07_ocr_vlm_hybrid_segmented_known` | pass | True | unknown=[] |
| `ranking_q07_ocr_vlm_hybrid_segmented_complete` | pass | True | depth=50 |
| `ranking_q07_bm25_ocr_unique` | pass | True | depth=10 unique=10 |
| `ranking_q07_bm25_ocr_known` | pass | True | unknown=[] |
| `ranking_q07_bm25_fusion_unique` | pass | True | depth=10 unique=10 |
| `ranking_q07_bm25_fusion_known` | pass | True | unknown=[] |
| `ranking_q07_clip_zeroshot_unique` | pass | True | depth=10 unique=10 |
| `ranking_q07_clip_zeroshot_known` | pass | True | unknown=[] |
| `ranking_q08_solo_ocr_unique` | pass | True | depth=50 unique=50 |
| `ranking_q08_solo_ocr_known` | pass | True | unknown=[] |
| `ranking_q08_solo_ocr_complete` | pass | True | depth=50 |
| `ranking_q08_solo_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q08_solo_vlm_known` | pass | True | unknown=[] |
| `ranking_q08_solo_vlm_complete` | pass | True | depth=50 |
| `ranking_q08_ocr_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q08_ocr_vlm_known` | pass | True | unknown=[] |
| `ranking_q08_ocr_vlm_complete` | pass | True | depth=50 |
| `ranking_q08_ocr_vlm_hybrid_full_unique` | pass | True | depth=50 unique=50 |
| `ranking_q08_ocr_vlm_hybrid_full_known` | pass | True | unknown=[] |
| `ranking_q08_ocr_vlm_hybrid_full_complete` | pass | True | depth=50 |
| `ranking_q08_ocr_vlm_hybrid_segmented_unique` | pass | True | depth=50 unique=50 |
| `ranking_q08_ocr_vlm_hybrid_segmented_known` | pass | True | unknown=[] |
| `ranking_q08_ocr_vlm_hybrid_segmented_complete` | pass | True | depth=50 |
| `ranking_q08_bm25_ocr_unique` | pass | True | depth=10 unique=10 |
| `ranking_q08_bm25_ocr_known` | pass | True | unknown=[] |
| `ranking_q08_bm25_fusion_unique` | pass | True | depth=10 unique=10 |
| `ranking_q08_bm25_fusion_known` | pass | True | unknown=[] |
| `ranking_q08_clip_zeroshot_unique` | pass | True | depth=10 unique=10 |
| `ranking_q08_clip_zeroshot_known` | pass | True | unknown=[] |
| `ranking_q09_solo_ocr_unique` | pass | True | depth=50 unique=50 |
| `ranking_q09_solo_ocr_known` | pass | True | unknown=[] |
| `ranking_q09_solo_ocr_complete` | pass | True | depth=50 |
| `ranking_q09_solo_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q09_solo_vlm_known` | pass | True | unknown=[] |
| `ranking_q09_solo_vlm_complete` | pass | True | depth=50 |
| `ranking_q09_ocr_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q09_ocr_vlm_known` | pass | True | unknown=[] |
| `ranking_q09_ocr_vlm_complete` | pass | True | depth=50 |
| `ranking_q09_ocr_vlm_hybrid_full_unique` | pass | True | depth=50 unique=50 |
| `ranking_q09_ocr_vlm_hybrid_full_known` | pass | True | unknown=[] |
| `ranking_q09_ocr_vlm_hybrid_full_complete` | pass | True | depth=50 |
| `ranking_q09_ocr_vlm_hybrid_segmented_unique` | pass | True | depth=50 unique=50 |
| `ranking_q09_ocr_vlm_hybrid_segmented_known` | pass | True | unknown=[] |
| `ranking_q09_ocr_vlm_hybrid_segmented_complete` | pass | True | depth=50 |
| `ranking_q09_bm25_ocr_unique` | pass | True | depth=10 unique=10 |
| `ranking_q09_bm25_ocr_known` | pass | True | unknown=[] |
| `ranking_q09_bm25_fusion_unique` | pass | True | depth=10 unique=10 |
| `ranking_q09_bm25_fusion_known` | pass | True | unknown=[] |
| `ranking_q09_clip_zeroshot_unique` | pass | True | depth=10 unique=10 |
| `ranking_q09_clip_zeroshot_known` | pass | True | unknown=[] |
| `ranking_q10_solo_ocr_unique` | pass | True | depth=50 unique=50 |
| `ranking_q10_solo_ocr_known` | pass | True | unknown=[] |
| `ranking_q10_solo_ocr_complete` | pass | True | depth=50 |
| `ranking_q10_solo_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q10_solo_vlm_known` | pass | True | unknown=[] |
| `ranking_q10_solo_vlm_complete` | pass | True | depth=50 |
| `ranking_q10_ocr_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q10_ocr_vlm_known` | pass | True | unknown=[] |
| `ranking_q10_ocr_vlm_complete` | pass | True | depth=50 |
| `ranking_q10_ocr_vlm_hybrid_full_unique` | pass | True | depth=50 unique=50 |
| `ranking_q10_ocr_vlm_hybrid_full_known` | pass | True | unknown=[] |
| `ranking_q10_ocr_vlm_hybrid_full_complete` | pass | True | depth=50 |
| `ranking_q10_ocr_vlm_hybrid_segmented_unique` | pass | True | depth=50 unique=50 |
| `ranking_q10_ocr_vlm_hybrid_segmented_known` | pass | True | unknown=[] |
| `ranking_q10_ocr_vlm_hybrid_segmented_complete` | pass | True | depth=50 |
| `ranking_q10_bm25_ocr_unique` | pass | True | depth=10 unique=10 |
| `ranking_q10_bm25_ocr_known` | pass | True | unknown=[] |
| `ranking_q10_bm25_fusion_unique` | pass | True | depth=10 unique=10 |
| `ranking_q10_bm25_fusion_known` | pass | True | unknown=[] |
| `ranking_q10_clip_zeroshot_unique` | pass | True | depth=10 unique=10 |
| `ranking_q10_clip_zeroshot_known` | pass | True | unknown=[] |
| `ranking_q11_solo_ocr_unique` | pass | True | depth=50 unique=50 |
| `ranking_q11_solo_ocr_known` | pass | True | unknown=[] |
| `ranking_q11_solo_ocr_complete` | pass | True | depth=50 |
| `ranking_q11_solo_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q11_solo_vlm_known` | pass | True | unknown=[] |
| `ranking_q11_solo_vlm_complete` | pass | True | depth=50 |
| `ranking_q11_ocr_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q11_ocr_vlm_known` | pass | True | unknown=[] |
| `ranking_q11_ocr_vlm_complete` | pass | True | depth=50 |
| `ranking_q11_ocr_vlm_hybrid_full_unique` | pass | True | depth=50 unique=50 |
| `ranking_q11_ocr_vlm_hybrid_full_known` | pass | True | unknown=[] |
| `ranking_q11_ocr_vlm_hybrid_full_complete` | pass | True | depth=50 |
| `ranking_q11_ocr_vlm_hybrid_segmented_unique` | pass | True | depth=50 unique=50 |
| `ranking_q11_ocr_vlm_hybrid_segmented_known` | pass | True | unknown=[] |
| `ranking_q11_ocr_vlm_hybrid_segmented_complete` | pass | True | depth=50 |
| `ranking_q11_bm25_ocr_unique` | pass | True | depth=10 unique=10 |
| `ranking_q11_bm25_ocr_known` | pass | True | unknown=[] |
| `ranking_q11_bm25_fusion_unique` | pass | True | depth=10 unique=10 |
| `ranking_q11_bm25_fusion_known` | pass | True | unknown=[] |
| `ranking_q11_clip_zeroshot_unique` | pass | True | depth=10 unique=10 |
| `ranking_q11_clip_zeroshot_known` | pass | True | unknown=[] |
| `ranking_q12_solo_ocr_unique` | pass | True | depth=50 unique=50 |
| `ranking_q12_solo_ocr_known` | pass | True | unknown=[] |
| `ranking_q12_solo_ocr_complete` | pass | True | depth=50 |
| `ranking_q12_solo_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q12_solo_vlm_known` | pass | True | unknown=[] |
| `ranking_q12_solo_vlm_complete` | pass | True | depth=50 |
| `ranking_q12_ocr_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q12_ocr_vlm_known` | pass | True | unknown=[] |
| `ranking_q12_ocr_vlm_complete` | pass | True | depth=50 |
| `ranking_q12_ocr_vlm_hybrid_full_unique` | pass | True | depth=50 unique=50 |
| `ranking_q12_ocr_vlm_hybrid_full_known` | pass | True | unknown=[] |
| `ranking_q12_ocr_vlm_hybrid_full_complete` | pass | True | depth=50 |
| `ranking_q12_ocr_vlm_hybrid_segmented_unique` | pass | True | depth=50 unique=50 |
| `ranking_q12_ocr_vlm_hybrid_segmented_known` | pass | True | unknown=[] |
| `ranking_q12_ocr_vlm_hybrid_segmented_complete` | pass | True | depth=50 |
| `ranking_q12_bm25_ocr_unique` | pass | True | depth=10 unique=10 |
| `ranking_q12_bm25_ocr_known` | pass | True | unknown=[] |
| `ranking_q12_bm25_fusion_unique` | pass | True | depth=10 unique=10 |
| `ranking_q12_bm25_fusion_known` | pass | True | unknown=[] |
| `ranking_q12_clip_zeroshot_unique` | pass | True | depth=10 unique=10 |
| `ranking_q12_clip_zeroshot_known` | pass | True | unknown=[] |
| `ranking_q13_solo_ocr_unique` | pass | True | depth=50 unique=50 |
| `ranking_q13_solo_ocr_known` | pass | True | unknown=[] |
| `ranking_q13_solo_ocr_complete` | pass | True | depth=50 |
| `ranking_q13_solo_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q13_solo_vlm_known` | pass | True | unknown=[] |
| `ranking_q13_solo_vlm_complete` | pass | True | depth=50 |
| `ranking_q13_ocr_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q13_ocr_vlm_known` | pass | True | unknown=[] |
| `ranking_q13_ocr_vlm_complete` | pass | True | depth=50 |
| `ranking_q13_ocr_vlm_hybrid_full_unique` | pass | True | depth=50 unique=50 |
| `ranking_q13_ocr_vlm_hybrid_full_known` | pass | True | unknown=[] |
| `ranking_q13_ocr_vlm_hybrid_full_complete` | pass | True | depth=50 |
| `ranking_q13_ocr_vlm_hybrid_segmented_unique` | pass | True | depth=50 unique=50 |
| `ranking_q13_ocr_vlm_hybrid_segmented_known` | pass | True | unknown=[] |
| `ranking_q13_ocr_vlm_hybrid_segmented_complete` | pass | True | depth=50 |
| `ranking_q13_bm25_ocr_unique` | pass | True | depth=10 unique=10 |
| `ranking_q13_bm25_ocr_known` | pass | True | unknown=[] |
| `ranking_q13_bm25_fusion_unique` | pass | True | depth=10 unique=10 |
| `ranking_q13_bm25_fusion_known` | pass | True | unknown=[] |
| `ranking_q13_clip_zeroshot_unique` | pass | True | depth=10 unique=10 |
| `ranking_q13_clip_zeroshot_known` | pass | True | unknown=[] |
| `ranking_q14_solo_ocr_unique` | pass | True | depth=50 unique=50 |
| `ranking_q14_solo_ocr_known` | pass | True | unknown=[] |
| `ranking_q14_solo_ocr_complete` | pass | True | depth=50 |
| `ranking_q14_solo_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q14_solo_vlm_known` | pass | True | unknown=[] |
| `ranking_q14_solo_vlm_complete` | pass | True | depth=50 |
| `ranking_q14_ocr_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q14_ocr_vlm_known` | pass | True | unknown=[] |
| `ranking_q14_ocr_vlm_complete` | pass | True | depth=50 |
| `ranking_q14_ocr_vlm_hybrid_full_unique` | pass | True | depth=50 unique=50 |
| `ranking_q14_ocr_vlm_hybrid_full_known` | pass | True | unknown=[] |
| `ranking_q14_ocr_vlm_hybrid_full_complete` | pass | True | depth=50 |
| `ranking_q14_ocr_vlm_hybrid_segmented_unique` | pass | True | depth=50 unique=50 |
| `ranking_q14_ocr_vlm_hybrid_segmented_known` | pass | True | unknown=[] |
| `ranking_q14_ocr_vlm_hybrid_segmented_complete` | pass | True | depth=50 |
| `ranking_q14_bm25_ocr_unique` | pass | True | depth=10 unique=10 |
| `ranking_q14_bm25_ocr_known` | pass | True | unknown=[] |
| `ranking_q14_bm25_fusion_unique` | pass | True | depth=10 unique=10 |
| `ranking_q14_bm25_fusion_known` | pass | True | unknown=[] |
| `ranking_q14_clip_zeroshot_unique` | pass | True | depth=10 unique=10 |
| `ranking_q14_clip_zeroshot_known` | pass | True | unknown=[] |
| `ranking_q15_solo_ocr_unique` | pass | True | depth=50 unique=50 |
| `ranking_q15_solo_ocr_known` | pass | True | unknown=[] |
| `ranking_q15_solo_ocr_complete` | pass | True | depth=50 |
| `ranking_q15_solo_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q15_solo_vlm_known` | pass | True | unknown=[] |
| `ranking_q15_solo_vlm_complete` | pass | True | depth=50 |
| `ranking_q15_ocr_vlm_unique` | pass | True | depth=50 unique=50 |
| `ranking_q15_ocr_vlm_known` | pass | True | unknown=[] |
| `ranking_q15_ocr_vlm_complete` | pass | True | depth=50 |
| `ranking_q15_ocr_vlm_hybrid_full_unique` | pass | True | depth=50 unique=50 |
| `ranking_q15_ocr_vlm_hybrid_full_known` | pass | True | unknown=[] |
| `ranking_q15_ocr_vlm_hybrid_full_complete` | pass | True | depth=50 |
| `ranking_q15_ocr_vlm_hybrid_segmented_unique` | pass | True | depth=50 unique=50 |
| `ranking_q15_ocr_vlm_hybrid_segmented_known` | pass | True | unknown=[] |
| `ranking_q15_ocr_vlm_hybrid_segmented_complete` | pass | True | depth=50 |
| `ranking_q15_bm25_ocr_unique` | pass | True | depth=10 unique=10 |
| `ranking_q15_bm25_ocr_known` | pass | True | unknown=[] |
| `ranking_q15_bm25_fusion_unique` | pass | True | depth=10 unique=10 |
| `ranking_q15_bm25_fusion_known` | pass | True | unknown=[] |
| `ranking_q15_clip_zeroshot_unique` | pass | True | depth=10 unique=10 |
| `ranking_q15_clip_zeroshot_known` | pass | True | unknown=[] |
| `all_systems_use_same_queries` | pass | True | system sets identical across queries |
| `no_offset_id_translation` | pass | True | canonical eval_id; no offsets or positional translation |
