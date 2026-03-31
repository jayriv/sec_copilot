export const COPILOT_PURPLE_SHADOW_HOVER = "0 10px 28px -8px rgba(54, 1, 63, 0.38)";

export type FilingAnchor = {
  id: string;
  label: string;
  level: number;
  source: "toc" | "heading" | "target" | "item";
};

const ITEM_RE = /^\s*Item\s+\d{1,2}[A-Z]?\b/i;

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

/** Prefer id match, then legacy `<a name="…">` / `[name=…]`. */
export function scrollToFilingAnchor(fragment: string, root: Document | HTMLElement | null = document) {
  const raw = fragment.replace(/^#/, "").trim();
  if (!raw) return;
  const id = decodeFragment(raw);
  const scope: Document | HTMLElement = root ?? document;

  const tryById = (fid: string) => {
    try {
      return scope.querySelector(`#${CSS.escape(fid)}`);
    } catch {
      return null;
    }
  };

  let el: Element | null = tryById(id);
  if (!el) el = scope.querySelector(`[name="${escapeAttr(id)}"]`);
  if (!el && id !== raw) {
    el = tryById(raw);
    if (!el) el = scope.querySelector(`[name="${escapeAttr(raw)}"]`);
  }

  el?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    const label = (a.textContent ?? "").replace(/\s+/g, " ").trim() || frag;
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
