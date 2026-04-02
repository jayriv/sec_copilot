"""Build filing jump targets and extract HTML slices for lazy-loaded sections (SEC 10-K / 10-Q)."""

from __future__ import annotations

import re
from typing import Any, Literal
from urllib.parse import unquote

from bs4 import BeautifulSoup, Tag

FilingAnchorSource = Literal["toc", "heading", "target", "item"]

ITEM_RE = re.compile(r"^\s*Item\s+\d{1,2}[A-Za-z]?\b", re.I)
_BARE_ITEM_TOC = re.compile(r"^\s*item\s+\d{1,2}[a-z]?\b", re.I)
_ITEM_HEAD_LEAD = re.compile(r"^Item\s+\d{1,2}[A-Za-z]?\b\s*[.:\u2014\u00b7\-]*\s*", re.I)
_ITEM_NEXT_BREAK = re.compile(r"\bItem\s+\d{1,2}\b", re.I)


def decode_fragment(raw: str) -> str:
    try:
        return unquote(raw)
    except Exception:
        return raw


def slugify_heading(label: str) -> str:
    s = label.strip().lower().replace("'", "").replace('"', "")
    base = re.sub(r"[^a-z0-9]+", "-", s)
    base = re.sub(r"-+", "-", base).strip("-")
    return base or "section"


def _is_bare_item_toc_label(label: str) -> bool:
    t = re.sub(r"\s+", " ", label).strip()
    if not _BARE_ITEM_TOC.match(t):
        return False
    after = _BARE_ITEM_TOC.sub("", t, count=1)
    after = re.sub(r"^[\s.:;\u2014\u00b7\-]+", "", after, flags=re.I).strip()
    return len(after) < 3


def _resolve_fragment_target(body: Tag, frag: str) -> Tag | None:
    el = body.find(id=frag)
    if el is not None:
        return el
    for node in body.find_all("a", attrs={"name": True}):
        if (node.get("name") or "").strip() == frag:
            return node
    lower = frag.lower()
    for node in body.find_all(id=True):
        if str(node.get("id", "")).lower() == lower:
            return node
    return None


def _parse_item_heading_line(snippet: str) -> str | None:
    s = re.sub(r"\s+", " ", snippet).strip()
    mpos = re.search(r"\bItem\s+\d{1,2}[A-Za-z]?\b", s, re.I)
    if not mpos:
        return None
    from_ = s[mpos.start() :]
    m = _ITEM_HEAD_LEAD.match(from_)
    if not m:
        return None
    rest = from_[m.end() :].strip()
    nb = _ITEM_NEXT_BREAK.search(rest)
    if nb and nb.start() >= 0:
        rest = rest[: nb.start()].strip()
    rest = re.sub(r"\s*\.{3,}\s*$", "", rest).strip()
    prefix = re.sub(r"\s+", " ", m.group(0)).strip()
    head = re.sub(r"[.:]\s*$", "", prefix).strip()
    if len(rest) >= 2 and re.search(r"[A-Za-z]{2,}", rest):
        combined = f"{head}. {rest}"
        combined = re.sub(r"\s+\.", ".", combined)
        return combined[:220]
    return head[:220]


def _item_heading_label_from_fragment_target(body: Tag, frag: str) -> str | None:
    el = _resolve_fragment_target(body, frag)
    if el is None:
        return None
    row = el.find_parent("tr")
    cell = el.find_parent(["td", "th"])
    parts: list[str] = []
    if row is not None and hasattr(row, "get_text"):
        parts.append(row.get_text(" ", strip=True))
    elif cell is not None and hasattr(cell, "get_text"):
        parts.append(cell.get_text(" ", strip=True))
    elif hasattr(el, "get_text"):
        parts.append(el.get_text(" ", strip=True))
    snippet = re.sub(r"\s+", " ", " ".join(parts)).strip()[:1200]
    from_row = _parse_item_heading_line(snippet)
    if from_row and len(from_row) > 12:
        return from_row
    if hasattr(el, "get_text"):
        el_txt = re.sub(r"\s+", " ", el.get_text(" ", strip=True))[:800]
        from_el = _parse_item_heading_line(el_txt)
        return from_row or from_el
    return from_row


_ITEM_KEY_RE = re.compile(r"\bItem\s+(\d{1,2}[A-Za-z]?)\b", re.I)


def _extract_item_key_from_label(label: str) -> str | None:
    m = _ITEM_KEY_RE.search(label)
    if not m:
        return None
    return m.group(1).upper()


def _parse_item_sort_rank(key: str) -> int:
    m = re.match(r"^(\d+)([A-Z]?)$", key, re.I)
    if not m:
        return 999_999
    num = int(m.group(1))
    suf = (m.group(2) or "").upper()
    sub = ord(suf) - 64 if suf else 0
    return num * 100 + sub


def _prefer_richer_item_label(a: str, b: str) -> bool:
    na = re.sub(r"\s+", " ", a).strip()
    nb = re.sub(r"\s+", " ", b).strip()
    if len(na) != len(nb):
        return len(na) > len(nb)
    a_lower = bool(re.search(r"[a-z]", na))
    b_lower = bool(re.search(r"[a-z]", nb))
    if a_lower and not b_lower:
        return True
    if not a_lower and b_lower:
        return False
    return na.casefold() < nb.casefold()


def _merge_item_anchor_group(group: list[dict[str, Any]]) -> dict[str, Any]:
    best = group[0]
    for g in group[1:]:
        if _prefer_richer_item_label(g["label"], best["label"]):
            best = g
    return best


def _dedupe_and_sort_item_anchors(anchors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    non_items: list[dict[str, Any]] = []
    buckets: dict[str, list[dict[str, Any]]] = {}
    for a in anchors:
        key = _extract_item_key_from_label(a["label"])
        if key:
            buckets.setdefault(key, []).append(a)
        else:
            non_items.append(a)
    merged_items: list[dict[str, Any]] = []
    for group in buckets.values():
        merged_items.append(_merge_item_anchor_group(group))

    def _sort_key(x: dict[str, Any]) -> int:
        k = _extract_item_key_from_label(x["label"])
        return _parse_item_sort_rank(k) if k else 999_999

    merged_items.sort(key=_sort_key)
    return non_items + merged_items


def build_filing_anchors(raw_html: str, max_anchors: int = 320) -> list[dict[str, Any]]:
    soup = BeautifulSoup(raw_html, "html.parser")
    body = soup.body
    if body is None:
        return []

    seen: set[str] = set()
    anchors: list[dict[str, Any]] = []

    def push(anchor_id: str, label: str, level: int, source: FilingAnchorSource) -> None:
        clean_id = anchor_id.strip()
        if not clean_id or clean_id in seen:
            return
        clean_label = re.sub(r"\s+", " ", label).strip()[:220] or clean_id
        seen.add(clean_id)
        anchors.append({"id": clean_id, "label": clean_label, "level": level, "source": source})

    for a in body.select("a[name]"):
        nm = (a.get("name") or "").strip()
        if nm and not a.get("id"):
            a["id"] = nm

    linked_fragments: set[str] = set()
    for a in body.select('a[href^="#"]'):
        href = (a.get("href") or "").strip()
        if not href or href == "#":
            continue
        frag = decode_fragment(href[1:])
        if frag:
            linked_fragments.add(frag)

    for a in body.select('a[href^="#"]'):
        href = (a.get("href") or "").strip()
        if not href or href == "#":
            continue
        frag = decode_fragment(href[1:])
        if not frag:
            continue
        label = re.sub(r"\s+", " ", (a.get_text() or "")).strip() or frag
        if _is_bare_item_toc_label(label):
            rich = _item_heading_label_from_fragment_target(body, frag)
            if rich:
                label = rich
        push(frag, label, 2, "toc")

    slug_seen: dict[str, int] = {}
    for h in body.select("h1,h2,h3,h4,h5,h6"):
        label = re.sub(r"\s+", " ", (h.get_text() or "")).strip()
        if not label:
            continue
        try:
            level = int(h.name[1])
        except (TypeError, ValueError):
            level = 2
        hid = (h.get("id") or "").strip()
        if not hid:
            base = slugify_heading(label[:200])
            prior = slug_seen.get(base, 0)
            slug_seen[base] = prior + 1
            hid = base if prior == 0 else f"{base}-{prior + 1}"
            h["id"] = hid
        push(hid, label, level, "heading")

    def label_for_unknown_target(el: Tag) -> str:
        t = re.sub(r"\s+", " ", (el.get_text() or "")).strip()
        if 8 < len(t) < 200:
            return t
        return str(el.get("id") or "")

    for frag in linked_fragments:
        if frag in seen:
            continue
        el = body.find(id=frag)
        if el is None:
            for node in body.find_all("a", attrs={"name": True}):
                if (node.get("name") or "").strip() == frag:
                    el = node
                    break
        if el is None:
            lower = frag.lower()
            for node in body.find_all(id=True):
                if str(node.get("id", "")).lower() == lower:
                    el = node
                    break
        if el is not None:
            push(frag, label_for_unknown_target(el), 3, "target")

    item_slug_seen: dict[str, int] = {}
    for el in body.select("p, td, div, font, span"):
        if not isinstance(el, Tag):
            continue
        text = re.sub(r"\s+", " ", (el.get_text() or "")).strip()
        if len(text) > 350 or len(text) < 8:
            continue
        if not ITEM_RE.match(text[:120]):
            continue
        if len(list(el.children)) > 8:
            continue
        eid = (el.get("id") or "").strip()
        if eid and eid in seen:
            continue
        label = text[:160]
        base = slugify_heading(label[:48]) or "item"
        prior = item_slug_seen.get(base, 0)
        item_slug_seen[base] = prior + 1
        new_id = f"sec-item-{base}" if prior == 0 else f"sec-item-{base}-{prior + 1}"
        if not el.get("id"):
            el["id"] = new_id
        final_id = str(el.get("id") or new_id)
        push(final_id, label, 1, "item")

    merged = _dedupe_and_sort_item_anchors(anchors)
    return merged[:max_anchors]


def extract_fragment_html(raw_html: str, fragment: str, max_chars: int) -> str | None:
    """
    Return a large HTML slice starting at the first tag that defines this fragment (id or name).
    SEC filings nest anchors in tables; a raw substring is more reliable than sibling walking.
    """
    fid = decode_fragment(fragment.strip().lstrip("#"))
    if not fid:
        return None

    esc = re.escape(fid)
    patterns = [
        rf'\b(?:id|name)\s*=\s*"{esc}"',
        rf"(?:id|name)\s*=\s*'{esc}'",
    ]
    pos: int | None = None
    for pat in patterns:
        m = re.search(pat, raw_html, re.I)
        if m:
            pos = m.start()
            break
    if pos is None:
        for m in re.finditer(r'(?i)\b(?:id|name)\s*=\s*["\']([^"\']+)["\']', raw_html):
            if m.group(1).strip().lower() == fid.lower():
                pos = m.start()
                break
    if pos is None:
        return None

    start = raw_html.rfind("<", 0, pos)
    if start < 0:
        start = pos
    return raw_html[start : start + max_chars]
