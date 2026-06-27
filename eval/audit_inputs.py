"""Audit evaluation inputs, isolated collections, and complete rankings."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from eval.config import (
    AUDIT_JSON_PATH,
    AUDIT_MD_PATH,
    COLLECTIONS,
    FINAL_RESULTS,
    RANKINGS_FULL_PATH,
    SYSTEM_SPECS,
    ensure_results_dir,
)
from eval.data_io import EXPECTED_EVAL_IDS, image_map, load_cache, load_qrels, load_queries, read_json, write_json
from eval.qdrant_eval import scroll_payloads
from eval.runtime import append_run_log, get_qdrant_client


@dataclass
class Check:
    name: str
    status: str
    critical: bool
    detail: str


def validate_collection_payloads(payloads: list[dict]) -> dict[str, list]:
    expected = set(EXPECTED_EVAL_IDS)
    required = {"eval_id", "image_path", "group", "filename", "segment_id", "segment_type", "segment_text"}
    ids = {str(payload.get("eval_id", "")) for payload in payloads}
    return {
        "unknown_ids": sorted(ids - expected),
        "missing_ids": sorted(expected - ids),
        "bad_payload_indices": [index for index, payload in enumerate(payloads) if not required.issubset(payload)],
    }


def _check(checks: list[Check], name: str, condition: bool, detail: str, critical: bool = True):
    checks.append(Check(name, "pass" if condition else "fail", critical, detail))


def _skip(checks: list[Check], name: str, detail: str, critical: bool = False):
    checks.append(Check(name, "skip", critical, detail))


def audit_inputs(checks: list[Check]) -> None:
    queries = load_queries()
    cache = load_cache()
    expected = set(EXPECTED_EVAL_IDS)
    _check(checks, "query_count", len(queries) == 15, f"found={len(queries)} expected=15")
    for field in ("ocr", "vlm_solo", "vlm_fusion"):
        ids = set(cache.get(field, {}))
        _check(checks, f"{field}_count", len(ids) == 50, f"found={len(ids)} expected=50")
        _check(checks, f"{field}_canonical_ids", ids == expected, f"missing={sorted(expected-ids)} unknown={sorted(ids-expected)}")
        empty = sorted(eval_id for eval_id, text in cache.get(field, {}).items() if not str(text).strip())
        _check(checks, f"{field}_nonempty", not empty, f"empty={empty}")
    sets = [set(cache.get(field, {})) for field in ("ocr", "vlm_solo", "vlm_fusion")]
    _check(checks, "representation_id_sets_identical", len({frozenset(values) for values in sets}) == 1, "ocr/vlm_solo/vlm_fusion")
    paths = image_map()
    _check(checks, "image_count", set(paths) == expected, f"found={len(paths)} missing={sorted(expected-set(paths))}")

    gains, _, metadata = load_qrels()
    query_ids = {query.query_id for query in queries}
    _check(checks, "qrels_query_coverage", set(gains) == query_ids, f"missing={sorted(query_ids-set(gains))} extra={sorted(set(gains)-query_ids)}")
    unknown_qrels = sorted({eval_id for judgements in gains.values() for eval_id in judgements if eval_id not in expected})
    _check(checks, "qrels_ids_known", not unknown_qrels, f"unknown={unknown_qrels}")
    missing_qrels = sorted(query_id for query_id in query_ids if not gains.get(query_id))
    _check(checks, "queries_have_qrels", not missing_qrels, f"missing={missing_qrels}")
    _check(checks, "qrels_format", not metadata["graded"], f"binary={not metadata['graded']} path={metadata['path']}")


def audit_collections(checks: list[Check], strict: bool) -> None:
    try:
        client = get_qdrant_client()
        existing = {collection.name for collection in client.get_collections().collections}
    except Exception as exc:
        if strict:
            _check(checks, "qdrant_available", False, str(exc))
        else:
            _skip(checks, "qdrant_available", f"preflight only: {exc}")
        return
    _check(checks, "qdrant_available", True, "connected")
    expected = set(EXPECTED_EVAL_IDS)
    for system_name, collection in COLLECTIONS.items():
        if collection not in existing:
            if strict:
                _check(checks, f"collection_{system_name}", False, f"missing {collection}")
            else:
                _skip(checks, f"collection_{system_name}", f"not built yet: {collection}")
            continue
        payloads = scroll_payloads(client, collection)
        validation = validate_collection_payloads(payloads)
        ids = {str(payload.get("eval_id", "")) for payload in payloads}
        bad_payloads = validation["bad_payload_indices"]
        _check(checks, f"collection_{system_name}_eval_ids", ids == expected, f"points={len(payloads)} distinct_eval_ids={len(ids)}")
        _check(checks, f"collection_{system_name}_payload", not bad_payloads, f"bad_payload_indices={bad_payloads[:10]}")
        external = validation["unknown_ids"]
        _check(checks, f"collection_{system_name}_no_external_docs", not external, f"external={external}")
        full_counts = {eval_id: 0 for eval_id in expected}
        for payload in payloads:
            if payload.get("segment_type") == "full" and payload.get("eval_id") in full_counts:
                full_counts[payload["eval_id"]] += 1
        _check(
            checks,
            f"collection_{system_name}_one_full_per_label",
            all(value == 1 for value in full_counts.values()),
            f"invalid={sorted(key for key,value in full_counts.items() if value != 1)}",
        )


def audit_rankings(checks: list[Check], strict: bool) -> None:
    if not RANKINGS_FULL_PATH.exists():
        if strict:
            _check(checks, "rankings_full_exists", False, str(RANKINGS_FULL_PATH))
        else:
            _skip(checks, "rankings_full_exists", "not generated yet")
        return
    rankings = read_json(RANKINGS_FULL_PATH)
    query_ids = {query.query_id for query in load_queries()}
    found_queries = set(rankings.get("queries", {}))
    _check(checks, "ranking_query_set", found_queries == query_ids, f"found={len(found_queries)} expected=15")
    expected = set(EXPECTED_EVAL_IDS)
    systems_seen: dict[str, set[str]] = {}
    for query_id, query in rankings.get("queries", {}).items():
        systems_seen[query_id] = set(query.get("systems", {}))
        for system_name, record in query.get("systems", {}).items():
            ids = record.get("eval_ids", [])
            unique = set(ids)
            unknown = sorted(unique - expected)
            _check(checks, f"ranking_{query_id}_{system_name}_unique", len(ids) == len(unique), f"depth={len(ids)} unique={len(unique)}")
            _check(checks, f"ranking_{query_id}_{system_name}_known", not unknown, f"unknown={unknown}")
            if record.get("complete"):
                _check(checks, f"ranking_{query_id}_{system_name}_complete", len(ids) == FINAL_RESULTS and unique == expected, f"depth={len(ids)}")
    same_systems = len({frozenset(values) for values in systems_seen.values()}) <= 1
    _check(checks, "all_systems_use_same_queries", same_systems, "system sets identical across queries")
    policy = rankings.get("metadata", {}).get("id_policy", "")
    _check(checks, "no_offset_id_translation", "no offsets" in policy, policy)


def render_markdown(report: dict) -> str:
    lines = [
        "# WineEyes evaluation audit",
        "",
        f"Generated: `{report['generated_at']}`",
        f"Overall status: **{report['status'].upper()}**",
        "",
        "| Check | Status | Critical | Detail |",
        "|---|---:|---:|---|",
    ]
    for check in report["checks"]:
        detail = str(check["detail"]).replace("|", "\\|").replace("\n", " ")
        lines.append(f"| `{check['name']}` | {check['status']} | {check['critical']} | {detail} |")
    lines.append("")
    return "\n".join(lines)


def parse_args(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true", help="Require collections and rankings to exist")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    ensure_results_dir()
    append_run_log(f"audit_inputs strict={args.strict}")
    checks: list[Check] = []
    try:
        audit_inputs(checks)
        audit_collections(checks, args.strict)
        audit_rankings(checks, args.strict)
    except Exception as exc:
        checks.append(Check("audit_exception", "fail", True, f"{type(exc).__name__}: {exc}"))
    failed = [check for check in checks if check.status == "fail" and check.critical]
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "strict": args.strict,
        "status": "fail" if failed else "pass",
        "checks": [asdict(check) for check in checks],
    }
    write_json(AUDIT_JSON_PATH, report)
    AUDIT_MD_PATH.write_text(render_markdown(report), encoding="utf-8")
    print(f"Audit {report['status']}: {len(checks)} checks, {len(failed)} critical failures")
    append_run_log(f"audit_inputs status={report['status']} checks={len(checks)} failures={len(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
