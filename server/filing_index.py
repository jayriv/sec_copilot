"""Keyword search and section slicing over a filing's plain text.

Why BM25 here when courseware uses embeddings: the two corpora need different
things. A student asks the textbook things like "why doesn't depreciation
affect cash" and the answer is phrased completely differently, so retrieval has
to bridge paraphrase — that needs embeddings. Filings are the opposite: the
terms of art appear verbatim ("deferred revenue", "goodwill impairment",
"remaining performance obligations"), so lexical matching is already strong.
BM25 is also free, instant, and adds no API round-trip inside an agent loop
that has a 60s serverless budget to respect.

The filing text arrives in the chat payload, so nothing here re-fetches from
EDGAR. Indexes are cached per container by content hash.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections import Counter
from dataclasses import dataclass, field

_TOKEN = re.compile(r"[a-z0-9]+")
# Item headings in 10-K/10-Q text. Not anchored to line starts: edgartools text
# is not reliably line-broken.
_ITEM = re.compile(r"\bItem\s+(\d{1,2}[A-Z]?)\s*[.:—-]?\s*", re.IGNORECASE)

# Words that carry no retrieval signal in filings specifically ("company" and
# "financial" appear in nearly every chunk of a 10-K).
_STOP = frozenset(
    """a an and are as at be been but by for from has have in into is it its of on or such
    that the their there these they this to was were which will with would about we our us
    company companies financial statements statement year years ended""".split()
)

# A real Item section runs to the next Item; table-of-contents entries sit a few
# characters apart. Anything shorter than this is TOC noise.
_MIN_SECTION_CHARS = 600
# Small chunks on purpose. A hit is handed to the model whole, so a large chunk
# spends most of its budget on whatever surrounded the match. BM25 over a few
# thousand short chunks is still sub-millisecond.
_CHUNK_CHARS = 800
_CHUNK_OVERLAP = 120
_K1 = 1.5
_B = 0.75


def _tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOP and len(t) > 1]


@dataclass
class Chunk:
    text: str
    section: str
    start: int
    tokens: Counter = field(default_factory=Counter)
    length: int = 0


@dataclass
class Section:
    label: str
    start: int
    end: int


class FilingIndex:
    def __init__(self, text: str) -> None:
        self.text = text
        self.sections = _find_sections(text)
        self.chunks = _build_chunks(text, self.sections)

        self._avg_len = (sum(c.length for c in self.chunks) / len(self.chunks)) if self.chunks else 0.0
        doc_freq: Counter[str] = Counter()
        for chunk in self.chunks:
            doc_freq.update(chunk.tokens.keys())
        n = max(len(self.chunks), 1)
        self._idf = {
            term: math.log(1 + (n - df + 0.5) / (df + 0.5)) for term, df in doc_freq.items()
        }

    def outline(self) -> list[str]:
        return [s.label for s in self.sections]

    def section_text(self, label: str, max_chars: int) -> str | None:
        """Text of a section by loose label match, e.g. 'Item 7' or 'item 1a'."""
        wanted = _normalize_item(label)
        if not wanted:
            return None
        for section in self.sections:
            if _normalize_item(section.label) == wanted:
                return self.text[section.start : section.end][:max_chars]
        return None

    def search(self, query: str, k: int = 5, max_chars_each: int = 1600) -> list[dict[str, object]]:
        terms = _tokenize(query)
        if not terms or not self.chunks:
            return []
        # Exact phrases matter in filings; give a bonus rather than relying on
        # bag-of-words alone for multiword terms of art.
        phrase = " ".join(terms[:6])

        scored: list[tuple[float, Chunk]] = []
        for chunk in self.chunks:
            score = 0.0
            for term in terms:
                tf = chunk.tokens.get(term, 0)
                if not tf:
                    continue
                idf = self._idf.get(term, 0.0)
                denom = tf + _K1 * (1 - _B + _B * (chunk.length / (self._avg_len or 1)))
                score += idf * (tf * (_K1 + 1)) / (denom or 1)
            if score and phrase and phrase in " ".join(_tokenize(chunk.text)):
                score *= 1.25
            if score:
                scored.append((score, chunk))

        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [
            {
                "section": chunk.section,
                "score": round(score, 3),
                "text": chunk.text[:max_chars_each],
            }
            for score, chunk in scored[:k]
        ]


def _normalize_item(label: str) -> str:
    m = re.search(r"(\d{1,2}[A-Za-z]?)", label or "")
    return m.group(1).upper() if m else ""


def _find_sections(text: str) -> list[Section]:
    matches = list(_ITEM.finditer(text))
    if not matches:
        return []
    spans: list[Section] = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        # Label with the heading words that follow the marker, when present.
        tail = text[m.end() : m.end() + 70].strip().split("\n")[0]
        tail = re.sub(r"\s+", " ", tail)[:60].strip()
        label = f"Item {m.group(1).upper()}" + (f" — {tail}" if tail else "")
        spans.append(Section(label=label, start=m.start(), end=end))

    # Drop table-of-contents hits: real sections are long.
    body = [s for s in spans if (s.end - s.start) >= _MIN_SECTION_CHARS]
    # Keep the last occurrence per item number — the TOC comes first.
    by_item: dict[str, Section] = {}
    for section in body:
        by_item[_normalize_item(section.label)] = section
    return sorted(by_item.values(), key=lambda s: s.start)


def _spans(text: str, sections: list[Section]) -> list[tuple[str, int, int]]:
    """(label, start, end) covering the document, including any preamble."""
    if not sections:
        return [("(no Item headings)", 0, len(text))]
    out: list[tuple[str, int, int]] = []
    if sections[0].start > 0:
        out.append(("(front matter)", 0, sections[0].start))
    out.extend((s.label, s.start, s.end) for s in sections)
    return out


def _build_chunks(text: str, sections: list[Section]) -> list[Chunk]:
    """Chunk within each section, never across.

    A chunk that straddles an Item boundary gets labelled by whichever section
    it started in, which mislabels the hit the model is shown — observed with
    an Item 8 passage reported as Item 7.
    """
    chunks: list[Chunk] = []
    step = max(_CHUNK_CHARS - _CHUNK_OVERLAP, 1)
    for label, span_start, span_end in _spans(text, sections):
        for start in range(span_start, span_end, step):
            body = text[start : min(start + _CHUNK_CHARS, span_end)]
            if not body.strip():
                continue
            tokens = _tokenize(body)
            if not tokens:
                continue
            chunks.append(
                Chunk(
                    text=body, section=label, start=start, tokens=Counter(tokens), length=len(tokens)
                )
            )
    return chunks


# Cache per container. Filings are large; two is enough for "current filing"
# plus one comparison filing without holding a session's worth of documents.
_CACHE: dict[str, FilingIndex] = {}
_CACHE_ORDER: list[str] = []
_CACHE_MAX = 2


def get_index(text: str) -> FilingIndex:
    key = hashlib.sha256(text.encode("utf-8", "ignore")).hexdigest()[:16]
    hit = _CACHE.get(key)
    if hit is not None:
        return hit
    index = FilingIndex(text)
    _CACHE[key] = index
    _CACHE_ORDER.append(key)
    while len(_CACHE_ORDER) > _CACHE_MAX:
        _CACHE.pop(_CACHE_ORDER.pop(0), None)
    return index
