"""Query the courseware index from the terminal.

Retrieval quality is the thing to get right before any of this reaches the
prompt -- if the chunks are wrong, every downstream problem looks like a model
problem. Use this to eyeball hits, tune `chunking` in the manifest, and pick a
sane COURSEWARE_MIN_SCORE.

    python scripts/search_courseware.py "how is inventory valued under LIFO"
    python scripts/search_courseware.py "current ratio" --lens financial-statement-analysis
    python scripts/search_courseware.py --suite      # fixed question set, for regressions
"""

from __future__ import annotations

import argparse
import sys
import textwrap
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from server import courseware  # noqa: E402

# Questions a student actually asks while reading a 10-K, plus two that should
# retrieve nothing -- the negative cases matter as much as the positive ones.
SUITE = [
    "what does deferred revenue mean",
    "how is inventory valued under LIFO versus FIFO",
    "why does depreciation not affect cash",
    "how do I read a statement of cash flows",
    "what is the current ratio and what does it tell me",
    "explain accrual accounting versus cash basis",
    "how are treasury shares accounted for",
    "what is a contingent liability",
    "how do you compute break-even volume",
    "what was Apple's revenue in fiscal 2023",  # negative: company fact, not concept
    "who is the CEO of Microsoft",  # negative: not in any textbook
]


def show(query: str, args: argparse.Namespace) -> None:
    passages = courseware.retrieve(
        query, k=args.k, lens=args.lens, min_score=args.min_score
    )
    print(f"\n\033[1m{query}\033[0m")
    if not passages:
        print("  (nothing above the score floor)")
        return
    for p in passages:
        lens = ",".join(p.lens) or "-"
        print(f"  {p.score:.3f}  [{p.citation}]  {p.heading_path}")
        print(f"         lens: {lens}")
        if args.verbose:
            body = courseware.passage_body(p)
            print(textwrap.indent(textwrap.fill(body[:400], 96), "         | "))

    guidance = courseware.dominant_lens_guidance(passages)
    if guidance and args.verbose:
        print("\n  --- lens guidance that would be injected ---")
        print(textwrap.indent(guidance, "  "))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("query", nargs="*", help="free-text query")
    parser.add_argument("--suite", action="store_true", help="run the fixed question set")
    parser.add_argument("-k", type=int, default=5)
    parser.add_argument("--lens", action="append", help="restrict to a lens (repeatable)")
    parser.add_argument("--min-score", type=float, default=0.0, help="score floor (0 shows everything)")
    parser.add_argument("-v", "--verbose", action="store_true", help="show passage text and lens guidance")
    args = parser.parse_args()

    status = courseware.status()
    if not status.get("available"):
        sys.exit(f"Index unavailable: {status.get('reason')}")
    print(
        f"index: {status['chunk_count']} chunks | {status['model']} @ {status['dimensions']}d | "
        + ", ".join(f"{s['citation_label']} ({s['chunk_count']})" for s in status["sources"])
    )

    if args.suite:
        for query in SUITE:
            show(query, args)
    elif args.query:
        show(" ".join(args.query), args)
    else:
        parser.error("give a query or --suite")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
