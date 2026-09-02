"""Build the SEC Copilot courseware vector index from open textbooks.

Offline only -- never runs on Vercel. Requires `requirements-ingest.txt`.

    python scripts/ingest_courseware.py              # incremental
    python scripts/ingest_courseware.py --only bap   # one source
    python scripts/ingest_courseware.py --rechunk    # retune chunking, reuse extraction
    python scripts/ingest_courseware.py --force      # rebuild everything

Three independent cache layers, so tuning a later stage never re-runs an
earlier one:

    extract  (slow: ~9 min/book)  keyed by file hash + extractor version
    chunk    (fast)               keyed by extract hash + chunking params
    embed    (costs money)        keyed by chunk text hash + model + dims

Outputs, under courseware/index/:

    chunks.jsonl          one chunk per line, with citation + lens metadata
    chunks.offsets.npy    byte offset of each line, for seek-without-load
    vectors.f16.npy       (n_chunks, dims) unit-normalized float16
    index.meta.json       model/dims/lens registry the server validates against
    manifest.lock.json    per-source hashes driving incremental rebuilds
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
COURSEWARE = ROOT / "courseware"
INDEX_DIR = COURSEWARE / "index"
SHARD_DIR = INDEX_DIR / "sources"
CACHE_DIR = INDEX_DIR / "cache"

# Bump when extraction or chunking logic changes in a way that invalidates caches.
EXTRACTOR_VERSION = "1"
CHUNKER_VERSION = "1"

HEADING_SEP = "›"
BODY_SEP = "\n---\n"


# ---------------------------------------------------------------------------
# manifest
# ---------------------------------------------------------------------------


@dataclass
class Source:
    id: str
    path: Path
    raw: dict[str, Any]

    @property
    def citation_label(self) -> str:
        return self.raw.get("citation_label") or self.id.upper()

    @property
    def title(self) -> str:
        return self.raw.get("title") or self.id


def load_manifest() -> dict[str, Any]:
    path = COURSEWARE / "manifest.yaml"
    if not path.exists():
        sys.exit(f"No manifest at {path}")
    manifest = yaml.safe_load(io.open(path, encoding="utf-8"))

    lenses = manifest.get("lenses") or {}
    if not lenses:
        sys.exit("manifest.yaml declares no lenses")

    sources: list[Source] = []
    for entry in manifest.get("sources") or []:
        for required in ("id", "path", "title"):
            if not entry.get(required):
                sys.exit(f"Source {entry.get('id', '?')} is missing '{required}'")
        if not entry.get("license"):
            sys.exit(
                f"Source '{entry['id']}' has no license. Open courseware licenses "
                "(CC BY, BY-SA, BY-NC-SA) require attribution on redistribution, "
                "and every retrieved excerpt is a redistribution. Record it."
            )
        # Fail loudly on a lens typo now rather than silently retrieving nothing later.
        declared = set(entry.get("default_lens") or [])
        for rule in entry.get("lens_overrides") or []:
            declared |= set(rule.get("lens") or [])
        unknown = declared - set(lenses)
        if unknown:
            sys.exit(f"Source '{entry['id']}' references undeclared lenses: {sorted(unknown)}")

        pdf = (COURSEWARE / entry["path"]).resolve()
        if not pdf.exists():
            sys.exit(f"Source '{entry['id']}': file not found at {pdf}")
        sources.append(Source(id=entry["id"], path=pdf, raw=entry))

    if not sources:
        sys.exit("manifest.yaml declares no sources")
    manifest["_sources"] = sources
    return manifest


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()[:16]


def dict_hash(payload: Any) -> str:
    blob = json.dumps(payload, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def parse_ranges(spec: Any) -> set[int]:
    """'1-16, 22' -> {1..16, 22}"""
    out: set[int] = set()
    if not spec:
        return out
    for part in str(spec).split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            lo, hi = part.split("-", 1)
            out.update(range(int(lo), int(hi) + 1))
        else:
            out.add(int(part))
    return out


# ---------------------------------------------------------------------------
# stage 1: extract
# ---------------------------------------------------------------------------


def extract_pages(source: Source, cache_key: str, force: bool) -> list[dict[str, Any]]:
    """Per-page markdown via pymupdf4llm (keeps table structure). Cached."""
    cache_path = CACHE_DIR / f"{source.id}.pages.jsonl"
    meta_path = CACHE_DIR / f"{source.id}.pages.meta.json"

    if not force and cache_path.exists() and meta_path.exists():
        meta = json.loads(io.open(meta_path, encoding="utf-8").read())
        if meta.get("cache_key") == cache_key:
            pages = [
                json.loads(line)
                for line in io.open(cache_path, encoding="utf-8")
                if line.strip()
            ]
            print(f"  extract: cached ({len(pages)} pages)")
            return pages

    import pymupdf
    import pymupdf4llm

    doc = pymupdf.open(source.path)
    total = doc.page_count
    skip = parse_ranges(source.raw.get("skip_pages"))
    wanted = [p for p in range(1, total + 1) if p not in skip]
    print(f"  extract: {len(wanted)} of {total} pages (~{len(wanted) * 0.55 / 60:.0f} min)...")

    toc = doc.get_toc()
    doc.close()

    rendered = pymupdf4llm.to_markdown(
        str(source.path),
        pages=[p - 1 for p in wanted],  # pymupdf4llm takes 0-based
        page_chunks=True,
        show_progress=True,
    )

    pages = [
        {"page": page_no, "text": (chunk.get("text") or "")}
        for page_no, chunk in zip(wanted, rendered)
    ]

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with open(cache_path, "wb") as fh:
        for page in pages:
            fh.write((json.dumps(page, ensure_ascii=False) + "\n").encode("utf-8"))
    io.open(meta_path, "w", encoding="utf-8", newline="\n").write(
        json.dumps({"cache_key": cache_key, "toc": toc, "page_count": total}, ensure_ascii=False)
    )
    return pages


def load_toc(source: Source) -> tuple[list[list[Any]], int]:
    meta_path = CACHE_DIR / f"{source.id}.pages.meta.json"
    meta = json.loads(io.open(meta_path, encoding="utf-8").read())
    return meta.get("toc") or [], int(meta.get("page_count") or 0)


# ---------------------------------------------------------------------------
# stage 2: clean
# ---------------------------------------------------------------------------

_MD_NOISE = re.compile(r"[*_#`>]+")
_WS = re.compile(r"\s+")
_PAGE_NUM = re.compile(r"^\s*[*_#\s]*(\d{1,4})[*_#\s]*\s*$")
_BAD_CHARS = str.maketrans(
    {"�": "-", "’": "'", "“": '"', "”": '"'}
)

# A line must sit within this many lines of a page edge to count as furniture.
_EDGE = 4


def _normalize_line(line: str) -> str:
    return _WS.sub(" ", _MD_NOISE.sub("", line)).strip().lower()


def detect_boilerplate(pages: list[dict[str, Any]]) -> set[str]:
    """Running heads/feet, found by frequency rather than per-book regexes.

    Generic on purpose: the next textbook you add gets the same treatment with
    no configuration.
    """
    counts: Counter[str] = Counter()
    for page in pages:
        lines = [ln for ln in page["text"].splitlines() if ln.strip()]
        edge = lines[:_EDGE] + lines[-_EDGE:]
        for norm in {_normalize_line(ln) for ln in edge}:
            if norm and len(norm) < 120 and not _PAGE_NUM.match(norm):
                counts[norm] += 1

    threshold = max(6, int(len(pages) * 0.12))
    return {norm for norm, n in counts.items() if n >= threshold}


def detect_printed_offset(pages: list[dict[str, Any]], configured: Any) -> int:
    """printed book page = pdf page + offset. Read it off the footers."""
    if configured not in (None, "auto"):
        return int(configured)
    votes: Counter[int] = Counter()
    for page in pages:
        lines = [ln for ln in page["text"].splitlines() if ln.strip()]
        for line in lines[-_EDGE:]:
            m = _PAGE_NUM.match(line)
            if m:
                votes[int(m.group(1)) - page["page"]] += 1
                break
    if not votes:
        return 0
    offset, n = votes.most_common(1)[0]
    print(f"  printed page offset: {offset:+d} (from {n}/{len(pages)} footers)")
    return offset


def clean_pages(pages: list[dict[str, Any]], boilerplate: set[str]) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for page in pages:
        lines = page["text"].splitlines()
        # Index of each non-blank line, to know whether we are at a page edge.
        content_idx = [i for i, ln in enumerate(lines) if ln.strip()]
        edge = set(content_idx[:_EDGE]) | set(content_idx[-_EDGE:])
        keep: list[str] = []
        for i, line in enumerate(lines):
            if i in edge:
                if _PAGE_NUM.match(line):
                    continue
                if _normalize_line(line) in boilerplate:
                    continue
            keep.append(line)
        text = "\n".join(keep).translate(_BAD_CHARS)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        if text:
            cleaned.append({"page": page["page"], "text": text})
    return cleaned


# ---------------------------------------------------------------------------
# stage 3: sections from the embedded TOC
# ---------------------------------------------------------------------------


@dataclass
class Section:
    chapter: int | None
    chapter_title: str
    section_title: str
    page_start: int
    page_end: int

    @property
    def heading_path(self) -> str:
        head = f"Ch. {self.chapter} {self.chapter_title}" if self.chapter else self.chapter_title
        if self.section_title and self.section_title != self.chapter_title:
            return f"{head} {HEADING_SEP} {self.section_title}"
        return head


_CHAPTER_RE = re.compile(r"^\s*(\d{1,2})\.\s*(.+)$")


def build_sections(toc: list[list[Any]], page_count: int) -> list[Section]:
    entries = [
        (int(lvl), str(title).translate(_BAD_CHARS).strip(), int(page)) for lvl, title, page in toc
    ]
    entries.sort(key=lambda e: e[2])

    sections: list[Section] = []
    chapter: int | None = None
    chapter_title = "Front matter"

    for i, (level, title, page) in enumerate(entries):
        end = (entries[i + 1][2] - 1) if i + 1 < len(entries) else page_count
        if end < page:
            end = page

        m = _CHAPTER_RE.match(title) if level == 1 else None
        if m:
            chapter = int(m.group(1))
            chapter_title = m.group(2).strip()
            section_title = chapter_title
        elif level == 1:
            chapter = None
            chapter_title = title
            section_title = title
        else:
            section_title = title

        sections.append(
            Section(
                chapter=chapter,
                chapter_title=chapter_title,
                section_title=section_title,
                page_start=page,
                page_end=end,
            )
        )
    return sections


def lens_for(source: Source, chapter: int | None, pdf_page: int) -> list[str]:
    lens = list(source.raw.get("default_lens") or [])
    for rule in source.raw.get("lens_overrides") or []:
        chapters = parse_ranges(rule.get("chapters"))
        pages = parse_ranges(rule.get("pages"))
        if (chapter is not None and chapter in chapters) or (pdf_page in pages):
            lens = list(rule.get("lens") or [])
    return lens


# ---------------------------------------------------------------------------
# stage 4: chunk
# ---------------------------------------------------------------------------


@dataclass
class Block:
    page: int
    text: str
    tokens: int
    is_table: bool = False


def _encoder():
    import tiktoken

    return tiktoken.get_encoding("cl100k_base")


def blocks_for_pages(pages: Iterable[dict[str, Any]], enc) -> list[Block]:
    """Paragraph/table blocks. Markdown tables stay whole -- splitting a table
    mid-row produces chunks that are worse than useless."""
    blocks: list[Block] = []
    for page in pages:
        buf: list[str] = []
        buf_is_table = False

        def flush() -> None:
            nonlocal buf, buf_is_table
            body = "\n".join(buf).strip()
            if body:
                blocks.append(Block(page["page"], body, len(enc.encode(body)), buf_is_table))
            buf = []
            buf_is_table = False

        for line in page["text"].splitlines():
            is_table_line = line.lstrip().startswith("|")
            if not line.strip():
                flush()
                continue
            if buf and is_table_line != buf_is_table:
                flush()
            buf.append(line)
            buf_is_table = is_table_line
        flush()
    return blocks


def split_oversized(block: Block, limit: int, enc) -> list[Block]:
    if block.tokens <= limit:
        return [block]
    out: list[Block] = []
    buf: list[str] = []
    count = 0
    for line in block.text.splitlines():
        n = len(enc.encode(line))
        if buf and count + n > limit:
            out.append(Block(block.page, "\n".join(buf), count, block.is_table))
            buf, count = [], 0
        buf.append(line)
        count += n
    if buf:
        out.append(Block(block.page, "\n".join(buf), count, block.is_table))
    return out


def chunk_source(
    source: Source,
    pages: list[dict[str, Any]],
    sections: list[Section],
    cfg: dict[str, Any],
    printed_offset: int,
) -> list[dict[str, Any]]:
    enc = _encoder()
    target = int(cfg.get("target_tokens", 750))
    overlap = int(cfg.get("overlap_tokens", 110))
    minimum = int(cfg.get("min_tokens", 80))

    by_page = {p["page"]: p for p in pages}
    chunks: list[dict[str, Any]] = []

    for section in sections:
        section_pages = [
            by_page[p] for p in range(section.page_start, section.page_end + 1) if p in by_page
        ]
        if not section_pages:
            continue

        blocks: list[Block] = []
        for block in blocks_for_pages(section_pages, enc):
            blocks.extend(split_oversized(block, target, enc))

        prefix = f"{section.heading_path}{BODY_SEP}"
        prefix_tokens = len(enc.encode(prefix))
        budget = max(target - prefix_tokens, 200)

        current: list[Block] = []
        current_tokens = 0

        def emit() -> None:
            nonlocal current, current_tokens
            if not current:
                return
            body_tokens = sum(b.tokens for b in current)
            if body_tokens >= minimum:
                p_start = min(b.page for b in current)
                p_end = max(b.page for b in current)
                chunks.append(
                    {
                        "id": f"{source.id}:{len(chunks):05d}",
                        "source_id": source.id,
                        "citation_label": source.citation_label,
                        "chapter": section.chapter,
                        "chapter_title": section.chapter_title,
                        "section": section.section_title,
                        "heading_path": section.heading_path,
                        "page_start": p_start + printed_offset,
                        "page_end": p_end + printed_offset,
                        "pdf_page_start": p_start,
                        "pdf_page_end": p_end,
                        "lens": lens_for(source, section.chapter, p_start),
                        "tokens": body_tokens + prefix_tokens,
                        # Heading path is embedded with the body on purpose: it
                        # carries topical context a bare paragraph lacks, and it
                        # is what makes the citation self-evident in the prompt.
                        "text": prefix + "\n\n".join(b.text for b in current),
                    }
                )
            # Carry the tail forward as overlap.
            tail: list[Block] = []
            carried = 0
            for block in reversed(current):
                if carried >= overlap or block.is_table:
                    break
                tail.insert(0, block)
                carried += block.tokens
            current = tail
            current_tokens = carried

        for block in blocks:
            if current and current_tokens + block.tokens > budget:
                emit()
            current.append(block)
            current_tokens += block.tokens
        emit()
        current, current_tokens = [], 0

    # Renumber so ids stay dense after min_tokens drops.
    for i, chunk in enumerate(chunks):
        chunk["id"] = f"{source.id}:{i:05d}"
    return chunks


# ---------------------------------------------------------------------------
# stage 5: embed
# ---------------------------------------------------------------------------


def embed_chunks(source_id: str, chunks: list[dict[str, Any]], emb_cfg: dict[str, Any]) -> np.ndarray:
    model = emb_cfg["model"]
    dims = int(emb_cfg["dimensions"])
    batch_size = int(emb_cfg.get("batch_size", 96))

    cache_path = CACHE_DIR / f"{source_id}.emb.npz"
    cache: dict[str, np.ndarray] = {}
    if cache_path.exists():
        blob = np.load(cache_path, allow_pickle=False)
        if str(blob["model"]) == model and int(blob["dims"]) == dims:
            cache = {h: v for h, v in zip(blob["hashes"].tolist(), blob["vectors"])}

    def text_hash(text: str) -> str:
        return hashlib.sha256(f"{model}|{dims}|{text}".encode("utf-8")).hexdigest()[:24]

    hashes = [text_hash(c["text"]) for c in chunks]
    todo = {h: c["text"] for h, c in zip(hashes, chunks) if h not in cache}
    unique_todo = list(todo.items())

    if unique_todo:
        from openai import OpenAI

        client = OpenAI()
        est = sum(len(t) for _, t in unique_todo) / 4 / 1_000_000 * 0.02
        print(f"  embed: {len(unique_todo)} new chunks ({len(cache)} cached), ~${est:.3f}")
        for i in range(0, len(unique_todo), batch_size):
            batch = unique_todo[i : i + batch_size]
            resp = client.embeddings.create(
                model=model, input=[t for _, t in batch], dimensions=dims
            )
            for (h, _), item in zip(batch, resp.data):
                cache[h] = np.asarray(item.embedding, dtype=np.float32)
            print(f"    {min(i + batch_size, len(unique_todo))}/{len(unique_todo)}", end="\r")
        print()
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            cache_path,
            model=np.array(model),
            dims=np.array(dims),
            hashes=np.array(list(cache.keys())),
            vectors=np.stack(list(cache.values())),
        )
    else:
        print(f"  embed: all {len(chunks)} chunks cached")

    vectors = np.stack([cache[h] for h in hashes]).astype(np.float32)
    # Unit-normalize once here so retrieval is a plain dot product.
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return (vectors / norms).astype(np.float16)


# ---------------------------------------------------------------------------
# shards + combined index
# ---------------------------------------------------------------------------


def write_shard(source_id: str, chunks: list[dict[str, Any]], vectors: np.ndarray) -> None:
    SHARD_DIR.mkdir(parents=True, exist_ok=True)
    with open(SHARD_DIR / f"{source_id}.chunks.jsonl", "wb") as fh:
        for chunk in chunks:
            fh.write((json.dumps(chunk, ensure_ascii=False) + "\n").encode("utf-8"))
    np.save(SHARD_DIR / f"{source_id}.vectors.f16.npy", vectors)


def read_shard(source_id: str) -> tuple[list[dict[str, Any]], np.ndarray]:
    chunks = [
        json.loads(line)
        for line in io.open(SHARD_DIR / f"{source_id}.chunks.jsonl", encoding="utf-8")
        if line.strip()
    ]
    vectors = np.load(SHARD_DIR / f"{source_id}.vectors.f16.npy")
    return chunks, vectors


def build_combined(manifest: dict[str, Any], lock: dict[str, Any]) -> dict[str, Any]:
    """Concatenate per-source shards. Shards are why incremental works: adding
    book #11 re-embeds book #11 and nothing else."""
    sources: list[Source] = manifest["_sources"]
    all_chunks: list[dict[str, Any]] = []
    all_vectors: list[np.ndarray] = []

    for source in sources:
        if not (SHARD_DIR / f"{source.id}.chunks.jsonl").exists():
            sys.exit(
                f"Source '{source.id}' has no shard in {SHARD_DIR}. Shards are "
                "committed alongside the index; if this is a fresh clone missing "
                f"one, fetch the PDF from the manifest url and run:\n"
                f"    python scripts/ingest_courseware.py --only {source.id}"
            )
        chunks, vectors = read_shard(source.id)
        all_chunks.extend(chunks)
        all_vectors.append(vectors)

    vectors = np.concatenate(all_vectors, axis=0)

    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    offsets: list[int] = []
    cursor = 0
    # Binary mode: byte offsets must not be disturbed by newline translation.
    with open(INDEX_DIR / "chunks.jsonl", "wb") as fh:
        for chunk in all_chunks:
            line = (json.dumps(chunk, ensure_ascii=False) + "\n").encode("utf-8")
            offsets.append(cursor)
            cursor += len(line)
            fh.write(line)
    np.save(INDEX_DIR / "chunks.offsets.npy", np.asarray(offsets, dtype=np.int64))
    np.save(INDEX_DIR / "vectors.f16.npy", vectors)

    lens_counts: Counter[str] = Counter()
    for chunk in all_chunks:
        for lens in chunk.get("lens") or []:
            lens_counts[lens] += 1

    meta = {
        "manifest_version": manifest.get("version", 1),
        "embedding": {
            "model": manifest["embedding"]["model"],
            "dimensions": int(manifest["embedding"]["dimensions"]),
        },
        "chunk_count": len(all_chunks),
        "vector_bytes": int(vectors.nbytes),
        "lenses": {
            name: {
                "label": cfg.get("label", name),
                "description": (cfg.get("description") or "").strip(),
                "guidance": (cfg.get("guidance") or "").strip(),
                "chunk_count": lens_counts.get(name, 0),
            }
            for name, cfg in (manifest.get("lenses") or {}).items()
        },
        "sources": [
            {
                "id": s.id,
                "citation_label": s.citation_label,
                "title": s.title,
                "authors": s.raw.get("authors") or [],
                "license": s.raw.get("license"),
                "license_url": s.raw.get("license_url"),
                "attribution": (s.raw.get("attribution") or "").strip(),
                "url": s.raw.get("url"),
                "chunk_count": lock.get(s.id, {}).get("chunk_count", 0),
            }
            for s in sources
        ],
    }
    io.open(INDEX_DIR / "index.meta.json", "w", encoding="utf-8", newline="\n").write(
        json.dumps(meta, indent=2, ensure_ascii=False) + "\n"
    )
    return meta


# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--only", help="ingest a single source id")
    parser.add_argument("--force", action="store_true", help="rebuild every stage")
    parser.add_argument(
        "--rechunk", action="store_true", help="re-chunk and re-embed, reuse extraction"
    )
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    manifest = load_manifest()
    sources: list[Source] = manifest["_sources"]
    if args.only:
        sources = [s for s in sources if s.id == args.only]
        if not sources:
            sys.exit(f"No source with id '{args.only}'")

    if not os.getenv("OPENAI_API_KEY"):
        sys.exit("OPENAI_API_KEY is not set (checked environment and .env)")

    lock_path = INDEX_DIR / "manifest.lock.json"
    lock: dict[str, Any] = {}
    if lock_path.exists():
        lock = json.loads(io.open(lock_path, encoding="utf-8").read())

    emb_cfg = manifest["embedding"]
    chunk_cfg = manifest.get("chunking") or {}

    for source in sources:
        print(f"\n[{source.id}] {source.title}")
        src_hash = file_hash(source.path)
        extract_key = dict_hash(
            {"file": src_hash, "skip": source.raw.get("skip_pages"), "v": EXTRACTOR_VERSION}
        )
        chunk_key = dict_hash(
            {
                "extract": extract_key,
                "chunking": chunk_cfg,
                "lens": [source.raw.get("default_lens"), source.raw.get("lens_overrides")],
                "offset": source.raw.get("printed_page_offset"),
                "v": CHUNKER_VERSION,
            }
        )
        embed_key = dict_hash(
            {"chunk": chunk_key, "emb": {k: emb_cfg[k] for k in ("model", "dimensions")}}
        )
        entry = lock.get(source.id, {})
        shard_exists = (SHARD_DIR / f"{source.id}.chunks.jsonl").exists()

        if not args.force and not args.rechunk and shard_exists and entry.get("embed_key") == embed_key:
            print(f"  unchanged ({entry.get('chunk_count')} chunks) -- skipping")
            continue

        pages = extract_pages(source, extract_key, force=args.force)
        toc, page_count = load_toc(source)

        boilerplate = detect_boilerplate(pages)
        if boilerplate:
            print(f"  boilerplate: dropped {len(boilerplate)} running head/foot patterns")
            for line in sorted(boilerplate, key=len, reverse=True)[:3]:
                print(f"    - {line[:72]}")
        printed_offset = detect_printed_offset(pages, source.raw.get("printed_page_offset"))
        cleaned = clean_pages(pages, boilerplate)

        sections = build_sections(toc, page_count)
        print(f"  sections: {len(sections)} from embedded TOC")

        chunks = chunk_source(source, cleaned, sections, chunk_cfg, printed_offset)
        tokens = [c["tokens"] for c in chunks] or [0]
        print(f"  chunks: {len(chunks)} (median {int(np.median(tokens))} tok, max {max(tokens)})")

        vectors = embed_chunks(source.id, chunks, emb_cfg)
        write_shard(source.id, chunks, vectors)

        lock[source.id] = {
            "file_hash": src_hash,
            "extract_key": extract_key,
            "chunk_key": chunk_key,
            "embed_key": embed_key,
            "chunk_count": len(chunks),
            "printed_page_offset": printed_offset,
        }
        INDEX_DIR.mkdir(parents=True, exist_ok=True)
        io.open(lock_path, "w", encoding="utf-8", newline="\n").write(
            json.dumps(lock, indent=2, ensure_ascii=False) + "\n"
        )

    meta = build_combined(load_manifest(), lock)
    mb = (INDEX_DIR / "vectors.f16.npy").stat().st_size / 1e6
    text_mb = (INDEX_DIR / "chunks.jsonl").stat().st_size / 1e6
    print(f"\nindex: {meta['chunk_count']} chunks | vectors {mb:.1f} MB | text {text_mb:.1f} MB")
    for name, cfg in meta["lenses"].items():
        print(f"  {name:32s} {cfg['chunk_count']:>6d} chunks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
