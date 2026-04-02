export const COPILOT_PURPLE_SHADOW_HOVER = "0 10px 28px -8px rgba(54, 1, 63, 0.38)";

export type FilingAnchor = {
  id: string;
  label: string;
  level: number;
  source: "toc" | "heading" | "target" | "item";
};

const ITEM_RE = /^\s*Item\s+\d{1,2}[A-Z]?\b/i;

/** TOC link text is often only "Item 1." — resolve title from the in-document anchor row. */
function isBareItemTocLabel(label: string): boolean {
  const t = label.replace(/\s+/g, " ").trim();
  if (!/^\s*item\s+\d{1,2}[a-z]?\b/i.test(t)) return false;
  const after = t
    .replace(/^\s*item\s+\d{1,2}[a-z]?\b/i, "")
    .replace(/^[\s.:;\u2014\u00b7\-]+/i, "")
    .trim();
  return after.length < 3;
}

function resolveFragmentTarget(body: HTMLElement, frag: string): Element | null {
  try {
    const byId = body.querySelector(`#${CSS.escape(frag)}`);
    if (byId) return byId;
  } catch {
    /* invalid id selector */
  }
  const byName = body.querySelector(`[name="${escapeAttr(frag)}"]`);
  if (byName) return byName;
  const lower = frag.toLowerCase();
  for (const node of body.querySelectorAll("[id]")) {
    if (node.id.toLowerCase() === lower) return node;
  }
  return null;
}

/** Parse "Item 1. Business …" from a short text blob (table row / cell). */
function parseItemHeadingLine(snippet: string): string | null {
  const s = snippet.replace(/\s+/g, " ").trim();
  const idx = s.search(/\bItem\s+\d{1,2}[A-Za-z]?\b/i);
  if (idx < 0) return null;
  const from = s.slice(idx);
  const m = from.match(/^Item\s+\d{1,2}[A-Za-z]?\b\s*[.:\u2014\u00b7\-]*\s*/i);
  if (!m) return null;
  let rest = from.slice(m[0].length).trim();
  const stop = rest.search(/\bItem\s+\d{1,2}\b/i);
  if (stop >= 0) rest = rest.slice(0, stop).trim();
  rest = rest.replace(/\s*\.{3,}\s*$/, "").trim();
  const prefix = from.slice(0, m[0].length).replace(/\s+/g, " ").trim();
  const head = prefix.replace(/[.:]\s*$/, "").trim();
  if (rest.length >= 2 && /[A-Za-z]{2,}/.test(rest)) {
    return `${head}. ${rest}`.replace(/\s+\./g, ".").slice(0, 220);
  }
  return head.slice(0, 220);
}

function itemHeadingLabelFromFragmentTarget(body: HTMLElement, frag: string): string | null {
  const el = resolveFragmentTarget(body, frag);
  if (!el) return null;
  const row = el.closest("tr");
  const cell = el.closest("td,th");
  const snippet = (row?.textContent ?? cell?.textContent ?? el.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
  return parseItemHeadingLine(snippet);
}

function slugifyHeading(input: string): string {
  const base = input
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "section";
}

function decodeFragment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function escapeAttr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Relative vertical position of `el` within `contentRoot` (0 = top, 1 = bottom). */
export function relativeTopInRoot(el: Element, contentRoot: HTMLElement): number {
  const rr = contentRoot.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  const h = Math.max(contentRoot.scrollHeight, 1);
  return (er.top - rr.top + contentRoot.scrollTop) / h;
}

/**
 * SEC filings duplicate anchors (TOC vs body). Layout is often nested tables; a table with many `#`
 * links can be the real document body — only treat as TOC when the table sits in the upper part
 * of the filing and has several in-doc links.
 */
export function isInsideLikelyToc(el: Element, contentRoot: HTMLElement): boolean {
  const table = el.closest("table");
  if (!table || !contentRoot.contains(table)) return false;
  const hashLinks = table.querySelectorAll('a[href^="#"]');
  if (hashLinks.length < 3) return false;
  const tableTop = relativeTopInRoot(table, contentRoot);
  if (tableTop > 0.42) return false;
  return true;
}

function sortElementsInTreeOrder(nodes: Element[]): Element[] {
  return [...nodes].sort((a, b) => {
    const bit = a.compareDocumentPosition(b);
    if (bit & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (bit & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

/** Collect all elements matching a fragment (ids often duplicated: TOC vs body). */
function collectAnchorCandidates(contentRoot: HTMLElement, fragment: string): Element[] {
  const raw = fragment.replace(/^#/, "").trim();
  if (!raw) return [];
  const id = decodeFragment(raw);
  const seen = new Set<Element>();
  const add = (node: Element | null) => {
    if (node && contentRoot.contains(node) && !seen.has(node)) {
      seen.add(node);
    }
  };

  try {
    add(contentRoot.querySelector(`#${CSS.escape(id)}`));
  } catch {
    /* ignore */
  }
  add(contentRoot.querySelector(`[name="${escapeAttr(id)}"]`));
  if (id !== raw) {
    try {
      add(contentRoot.querySelector(`#${CSS.escape(raw)}`));
    } catch {
      /* ignore */
    }
    add(contentRoot.querySelector(`[name="${escapeAttr(raw)}"]`));
  }

  const doc = contentRoot.ownerDocument;
  if (doc) {
    const byId = doc.getElementById(id);
    if (byId && contentRoot.contains(byId)) add(byId);
  }

  const lower = id.toLowerCase();
  Array.from(contentRoot.querySelectorAll("[id]")).forEach((node) => {
    if (node.id === id || node.id.toLowerCase() === lower) add(node);
  });

  return sortElementsInTreeOrder(Array.from(seen));
}

/**
 * Prefer the real section over the TOC. SEC HTML almost always repeats the same `id` twice:
 * first hit = TOC row, second hit = in-document anchor. When only one node exists, it is often
 * TOC-only (body uses a different anchor) — return null so the UI can scroll by section label.
 */
export function findBestAnchorTarget(contentRoot: HTMLElement | null, fragment: string): Element | null {
  if (!contentRoot) return null;
  const candidates = collectAnchorCandidates(contentRoot, fragment);
  if (candidates.length === 0) return null;

  if (candidates.length >= 2) {
    return candidates[1];
  }
  return candidates[0];
}

/** @deprecated Use findBestAnchorTarget — kept for quick checks; may return a TOC node. */
export function findAnchorTarget(contentRoot: HTMLElement | null, fragment: string): Element | null {
  return findBestAnchorTarget(contentRoot, fragment);
}

/**
 * Scroll so the target sits near the top of the filing scroll panel.
 * `scrollIntoView` often fails when the only scrollable ancestor is an inner `overflow-y-auto`
 * div (the window does not move, so nothing appears to happen).
 */
export function scrollFilingFragmentIntoView(
  fragment: string,
  contentRoot: HTMLElement | null,
  scrollContainer: HTMLElement | null
) {
  const target = findBestAnchorTarget(contentRoot, fragment);
  if (!target) return;

  if (!scrollContainer || !scrollContainer.contains(target)) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const margin = 12;
  const cRect = scrollContainer.getBoundingClientRect();
  const tRect = target.getBoundingClientRect();
  const nextTop = scrollContainer.scrollTop + (tRect.top - cRect.top) - margin;
  scrollContainer.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
}

/**
 * After DOMPurify: normalize SEC-style anchors (`name` → `id`), collect jump targets.
 * Order follows the filing: TOC `#` links first (SEC table of contents), then headings,
 * then in-document targets referenced by TOC but missing from the first pass, then Item lines.
 */
export function buildFilingAnchors(doc: Document): FilingAnchor[] {
  const body = doc.body;
  const seen = new Set<string>();
  const anchors: FilingAnchor[] = [];

  const push = (id: string, label: string, level: number, source: FilingAnchor["source"]) => {
    const cleanId = id.trim();
    if (!cleanId || seen.has(cleanId)) return;
    const cleanLabel = label.replace(/\s+/g, " ").trim().slice(0, 220) || cleanId;
    seen.add(cleanId);
    anchors.push({ id: cleanId, label: cleanLabel, level, source });
  };

  body.querySelectorAll("a[name]").forEach((a) => {
    const nm = a.getAttribute("name")?.trim();
    if (nm && !a.id) a.id = nm;
  });

  const linkedFragments = new Set<string>();
  body.querySelectorAll('a[href^="#"]').forEach((a) => {
    const href = a.getAttribute("href")?.trim();
    if (!href || href === "#") return;
    const frag = decodeFragment(href.slice(1));
    if (frag) linkedFragments.add(frag);
  });

  body.querySelectorAll('a[href^="#"]').forEach((a) => {
    const href = a.getAttribute("href")?.trim();
    if (!href || href === "#") return;
    const frag = decodeFragment(href.slice(1));
    if (!frag) return;
    let label = (a.textContent ?? "").replace(/\s+/g, " ").trim() || frag;
    if (isBareItemTocLabel(label)) {
      const rich = itemHeadingLabelFromFragmentTarget(body, frag);
      if (rich) label = rich;
    }
    push(frag, label, 2, "toc");
  });

  const slugSeen = new Map<string, number>();
  body.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
    const label = (h.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!label) return;
    const level = Number(h.tagName.slice(1));
    let id = h.id?.trim() || "";
    if (!id) {
      const base = slugifyHeading(label);
      const prior = slugSeen.get(base) ?? 0;
      slugSeen.set(base, prior + 1);
      id = prior === 0 ? base : `${base}-${prior + 1}`;
      h.id = id;
    }
    push(id, label, level, "heading");
  });

  const labelForUnknownTarget = (el: Element): string => {
    const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (t.length > 8 && t.length < 200) return t;
    return el.id;
  };

  linkedFragments.forEach((frag) => {
    if (seen.has(frag)) return;
    let el: Element | null = null;
    try {
      el = body.querySelector(`#${CSS.escape(frag)}`);
    } catch {
      el = null;
    }
    if (!el) el = body.querySelector(`[name="${escapeAttr(frag)}"]`);
    if (el) push(frag, labelForUnknownTarget(el), 3, "target");
  });

  const itemSlugSeen = new Map<string, number>();
  body.querySelectorAll("p, td, div, font, span").forEach((el) => {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length > 350 || text.length < 8 || !ITEM_RE.test(text.slice(0, 120))) return;
    if (el.children.length > 8) return;
    if (el.id && seen.has(el.id)) return;

    const label = text.slice(0, 160);
    const base = slugifyHeading(label.slice(0, 48)) || "item";
    const prior = itemSlugSeen.get(base) ?? 0;
    itemSlugSeen.set(base, prior + 1);
    const newId = prior === 0 ? `sec-item-${base}` : `sec-item-${base}-${prior + 1}`;
    if (!el.id) el.id = newId;
    const finalId = el.id;
    push(finalId, label, 1, "item");
  });

  return anchors.slice(0, 320);
}
