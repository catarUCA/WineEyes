"""Deprecated compatibility entry point for the corrected evaluation flow."""

from __future__ import annotations

import sys


def main() -> int:
    print(
        "eval.run_hybrid_eval was retired because it translated positional IDs. "
        "Use: python -m eval.build_eval_indices --reset && python -m eval.run_retrieval",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
