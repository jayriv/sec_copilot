"""Build filing jump targets and extract HTML slices for lazy-loaded sections (SEC 10-K / 10-Q)."""

from __future__ import annotations

import re
from typing import Any, Literal
from urllib.parse import unquote

from bs4 import BeautifulSoup, Tag

FilingAnchorSource = Literal["toc", "heading", "target", "item"]

ITEM_RE = re.compile(r"^\s*Item\s+\d{1,2}[A-Za-z]?\b", re.I)


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

    return anchors[:max_anchors]


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
