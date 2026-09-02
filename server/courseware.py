"""Retrieval over the open-courseware index built by scripts/ingest_courseware.py.

Design notes for the serverless runtime:

* No heavy dependencies. Vectors are a memory-mapped float16 array and search is
  a dot product in numpy -- torch / faiss / chromadb would blow the Vercel
  bundle, and at this corpus size an ANN index would be slower than brute force.
* Chunk *text* is never fully loaded. `chunks.offsets.npy` gives the byte offset
  of every line in `chunks.jsonl`, so a query reads only the k lines it hit.
  Cold start stays flat as the corpus grows.
* Vectors were unit-normalized at ingest, so cosine similarity == dot product.
* A missing or unreadable index is not an error. `available()` returns False and
  the copilot runs exactly as it did before courseware existed.

Lenses are metadata, not separate indexes: one faceted search over everything,
with an optional filter. See courseware/manifest.yaml.
"""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

INDEX_DIR = Path(__file__).resolve().parents[1] / "courseware" / "index"

_DEFAULT_MODEL = "text-embedding-3-small"
_DEFAULT_DIMS = 512

# Separates the embedded heading path from the body inside a chunk's `text`.
# Must match BODY_SEP in scripts/ingest_courseware.py.
BODY_SEP = "\n---\n"


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off")


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


@dataclass
class Passage:
    """One retrieved courseware chunk."""

    id: str
    score: float
    text: str
    source_id: str
    citation_label: str
    heading_path: str
    chapter: int | None
    chapter_title: str
    section: str
    page_start: int
    page_end: int
    lens: list[str]

    @property
    def citation(self) -> str:
        pages = (
            f"p. {self.page_start}"
            if self.page_start == self.page_end
            else f"pp. {self.page_start}-{self.page_end}"
        )
        chapter = f"Ch. {self.chapter}, " if self.chapter else ""
        return f"{self.citation_label}, {chapter}{pages}"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "score": round(self.score, 4),
            "citation": self.citation,
            "source_id": self.source_id,
            "heading_path": self.heading_path,
            "page_start": self.page_start,
            "page_end": self.page_end,
            "lens": self.lens,
        }


class _Index:
    """Loaded once per warm container."""

    def __init__(self) -> None:
        self.meta: dict[str, Any] = json.loads((INDEX_DIR / "index.meta.json").read_text("utf-8"))
        self.vectors: np.ndarray = np.load(INDEX_DIR / "vectors.f16.npy", mmap_mode="r")
        self.offsets: np.ndarray = np.load(INDEX_DIR / "chunks.offsets.npy")
        self.chunks_path: Path = INDEX_DIR / "chunks.jsonl"

        embedding = self.meta.get("embedding") or {}
        self.model: str = embedding.get("model") or _DEFAULT_MODEL
        self.dims: int = int(embedding.get("dimensions") or _DEFAULT_DIMS)

        if self.vectors.shape[0] != len(self.offsets):
            raise ValueError(
                f"Index is inconsistent: {self.vectors.shape[0]} vectors vs "
                f"{len(self.offsets)} chunk offsets. Re-run scripts/ingest_courseware.py."
            )
        if self.vectors.shape[1] != self.dims:
            raise ValueError(
                f"Index vectors are {self.vectors.shape[1]}-dim but index.meta.json "
                f"declares {self.dims}. Re-run scripts/ingest_courseware.py."
            )

        # Query vectors must come from the same model the index was built with,
        # or scores are meaningless. Fail loudly rather than retrieve nonsense.
        configured = os.getenv("COURSEWARE_EMBED_MODEL", "").strip()
        if configured and configured != self.model:
            raise ValueError(
                f"COURSEWARE_EMBED_MODEL={configured!r} does not match the model the "
                f"index was built with ({self.model!r})."
            )

        # Byte offsets only survive if nothing rewrote the file's line endings.
        # Git with core.autocrlf=true will do exactly that on checkout unless
        # .gitattributes marks these files -text, so check before trusting them.
        if len(self.offsets) > 1:
            with open(self.chunks_path, "rb") as fh:
                fh.seek(int(self.offsets[1]))
                if not fh.readline().lstrip().startswith(b"{"):
                    raise ValueError(
                        "chunks.jsonl offsets do not line up — the file's line endings were "
                        "rewritten (usually git core.autocrlf on Windows). Confirm .gitattributes "
                        "marks courseware/index/**/*.jsonl as -text, then re-run "
                        "scripts/ingest_courseware.py --rechunk."
                    )

        # One pass over the facets at load time, so a filtered query stays a
        # single masked dot product and never touches the chunk file.
        chunk_lens: list[list[str]] = []
        source_ids: list[str] = []
        with open(self.chunks_path, "rb") as fh:
            for offset in self.offsets:
                fh.seek(int(offset))
                record = json.loads(fh.readline().decode("utf-8"))
                chunk_lens.append(record.get("lens") or [])
                source_ids.append(record.get("source_id") or "")
        self._lens_masks: dict[str, np.ndarray] = {
            name: np.array([name in lens for lens in chunk_lens], dtype=bool)
            for name in (self.meta.get("lenses") or {})
        }
        self._source_ids = np.array(source_ids)

    def lens_mask(self, name: str) -> np.ndarray | None:
        return self._lens_masks.get(name)

    def source_mask(self, allowed: list[str]) -> np.ndarray:
        return np.isin(self._source_ids, list(allowed))

    def scores_for(self, query_vector: np.ndarray) -> np.ndarray:
        """Cosine similarity against every chunk, in bounded memory.

        Blockwise so a corpus that grows past a few thousand chunks never
        materializes the whole float32 matrix inside a 1GB function.
        """
        out = np.empty(self.vectors.shape[0], dtype=np.float32)
        for start in range(0, self.vectors.shape[0], 4096):
            block = np.asarray(self.vectors[start : start + 4096], dtype=np.float32)
            out[start : start + block.shape[0]] = block @ query_vector
        return out

    def read_chunk(self, row: int) -> dict[str, Any]:
        with open(self.chunks_path, "rb") as fh:
            fh.seek(int(self.offsets[row]))
            return json.loads(fh.readline().decode("utf-8"))


_index: _Index | None = None
_index_error: str | None = None
_lock = threading.Lock()


def _get_index() -> _Index | None:
    global _index, _index_error
    if _index is not None or _index_error is not None:
        return _index
    with _lock:
        if _index is not None or _index_error is not None:
            return _index
        try:
            if not (INDEX_DIR / "index.meta.json").exists():
                _index_error = "no courseware index present"
                return None
            _index = _Index()
        except Exception as exc:  # index problems must never take the app down
            _index_error = str(exc)
            return None
    return _index


def available() -> bool:
    return _env_flag("COURSEWARE_ENABLED", True) and _get_index() is not None


def status() -> dict[str, Any]:
    """For /health and the admin page."""
    index = _get_index()
    if index is None:
        return {"available": False, "reason": _index_error or "unknown"}
    return {
        "available": _env_flag("COURSEWARE_ENABLED", True),
        "chunk_count": index.meta.get("chunk_count", 0),
        "model": index.model,
        "dimensions": index.dims,
        "sources": [
            {k: s.get(k) for k in ("id", "title", "citation_label", "license", "chunk_count")}
            for s in index.meta.get("sources") or []
        ],
        "lenses": {
            name: {"label": cfg.get("label"), "chunk_count": cfg.get("chunk_count", 0)}
            for name, cfg in (index.meta.get("lenses") or {}).items()
        },
    }


def lenses() -> dict[str, dict[str, Any]]:
    index = _get_index()
    return dict(index.meta.get("lenses") or {}) if index else {}


def attributions() -> list[str]:
    """Required by CC licenses wherever excerpts are shown."""
    index = _get_index()
    if index is None:
        return []
    return [s["attribution"] for s in index.meta.get("sources") or [] if s.get("attribution")]


def embed_query(text: str) -> np.ndarray | None:
    index = _get_index()
    if index is None:
        return None

    # litellm on the server (already a runtime dep); the openai client is the
    # fallback so the ingest/verification scripts work without the full runtime
    # stack installed. Both target index.model at index.dims, and _Index
    # validates that against what the vectors were actually built with.
    try:
        from litellm import embedding as litellm_embedding

        response = litellm_embedding(model=index.model, input=[text], dimensions=index.dims)
        raw = response["data"][0]["embedding"]
    except ImportError:
        from openai import OpenAI

        response = OpenAI().embeddings.create(
            model=index.model, input=[text], dimensions=index.dims
        )
        raw = response.data[0].embedding

    vector = np.asarray(raw, dtype=np.float32)
    norm = float(np.linalg.norm(vector))
    return vector / norm if norm else vector


def retrieve(
    query: str,
    *,
    k: int | None = None,
    lens: str | list[str] | None = None,
    source_ids: list[str] | None = None,
    min_score: float | None = None,
) -> list[Passage]:
    """Top-k courseware passages above a similarity floor.

    The floor is what keeps textbook material out of purely factual questions
    ("what was 2023 revenue?") -- those retrieve nothing and the prompt stays
    exactly as it is today.
    """
    index = _get_index()
    if index is None or not _env_flag("COURSEWARE_ENABLED", True):
        return []
    query = (query or "").strip()
    if not query:
        return []

    k = k or _env_int("COURSEWARE_TOP_K", 6)
    # 0.45 measured on the bap corpus: separates 17 concept questions
    # (min 0.368, p10 0.451) from 8 company-fact / off-topic ones (max 0.444).
    # Re-measure with scripts/search_courseware.py after adding a source.
    floor = min_score if min_score is not None else _env_float("COURSEWARE_MIN_SCORE", 0.45)

    query_vector = embed_query(query)
    if query_vector is None:
        return []

    # Vectors are unit-normalized at ingest, so this dot product is cosine.
    scores = index.scores_for(query_vector)

    # Lens filters union together; a source filter then intersects.
    mask: np.ndarray | None = None
    for name in [lens] if isinstance(lens, str) else list(lens or []):
        lens_mask = index.lens_mask(name)
        if lens_mask is not None:
            mask = lens_mask if mask is None else (mask | lens_mask)
    if source_ids:
        source_mask = index.source_mask(source_ids)
        mask = source_mask if mask is None else (mask & source_mask)
    if mask is not None:
        if not mask.any():
            return []
        scores = np.where(mask, scores, -np.inf)

    # Overscan, then cap hits per section. Chunk overlap means the 3 best
    # matches for "break-even volume" are otherwise three neighbouring slices
    # of one section, crowding out every other angle on the question.
    pool_size = min(len(scores), max(k * 4, k))
    pool = np.argpartition(-scores, pool_size - 1)[:pool_size] if pool_size < len(scores) else np.arange(len(scores))
    pool = pool[np.argsort(-scores[pool])]

    max_per_section = _env_int("COURSEWARE_MAX_PER_SECTION", 2)
    per_section: dict[tuple[str, str], int] = {}

    passages: list[Passage] = []
    for row in pool:
        if len(passages) >= k:
            break
        score = float(scores[row])
        if not np.isfinite(score) or score < floor:
            continue
        chunk = index.read_chunk(int(row))
        section_key = (chunk["source_id"], chunk.get("section", ""))
        if per_section.get(section_key, 0) >= max_per_section:
            continue
        per_section[section_key] = per_section.get(section_key, 0) + 1
        passages.append(
            Passage(
                id=chunk["id"],
                score=score,
                text=chunk["text"],
                source_id=chunk["source_id"],
                citation_label=chunk["citation_label"],
                heading_path=chunk["heading_path"],
                chapter=chunk.get("chapter"),
                chapter_title=chunk.get("chapter_title", ""),
                section=chunk.get("section", ""),
                page_start=chunk["page_start"],
                page_end=chunk["page_end"],
                lens=chunk.get("lens") or [],
            )
        )
    return passages


def passage_body(passage: Passage) -> str:
    """Chunk text without the heading path that was embedded into it at ingest."""
    return passage.text.split(BODY_SEP, 1)[-1].strip()


def dominant_lenses(passages: list[Passage], max_lenses: int = 2) -> list[tuple[str, str]]:
    """The lenses the retrieved evidence favours, as (name, label), best first.

    Score-weighted rather than counted, so one strong hit outranks several weak
    ones. This is what makes a lens more than a filter: the analytical posture
    is chosen by the evidence, not declared up front.
    """
    if not passages:
        return []
    registry = lenses()
    weights: dict[str, float] = {}
    for passage in passages:
        for name in passage.lens:
            weights[name] = weights.get(name, 0.0) + passage.score
    ordered = sorted(weights.items(), key=lambda kv: kv[1], reverse=True)[:max_lenses]
    return [(name, (registry.get(name) or {}).get("label", name)) for name, _ in ordered]


def dominant_lens_guidance(passages: list[Passage], max_lenses: int = 2) -> str:
    """Reasoning guidance for whichever lenses the retrieved evidence favours."""
    registry = lenses()
    fragments = []
    for name, label in dominant_lenses(passages, max_lenses):
        guidance = (registry.get(name) or {}).get("guidance", "").strip()
        if guidance:
            fragments.append(f"{label}:\n{guidance}")
    return "\n\n".join(fragments)


def _block(passage: Passage) -> str:
    # Citation inline, so the model can attribute without a second lookup.
    return f"[{passage.citation}] {passage.heading_path}\n{passage_body(passage)}"


def fit_passages(passages: list[Passage], max_chars: int) -> list[Passage]:
    """The prefix of `passages` that fits the character budget.

    Callers trim with this *before* formatting, so the citations they report
    are exactly the passages the model was given -- never a longer list.
    """
    if max_chars <= 0:
        return []
    out: list[Passage] = []
    used = 0
    for passage in passages:
        size = len(_block(passage))
        # Always keep the best passage, even if it alone exceeds the budget.
        if out and used + size > max_chars:
            break
        out.append(passage)
        used += size
    return out


def format_passages(passages: list[Passage]) -> str:
    """Prompt-ready block for passages already trimmed by `fit_passages`."""
    return "\n\n---\n\n".join(_block(p) for p in passages)
