import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  buildFilingAnchors,
  collectAnchorCandidates,
  COPILOT_PURPLE_SHADOW_HOVER,
  findBestAnchorTarget,
  isInsideLikelyToc,
  scrollFilingFragmentIntoView
} from "@/lib/filingAnchors";
import { useTextSelection } from "@/hooks/useTextSelection";
import type { FilingAnchor, FilingKey } from "@/lib/types";

type Props = {
  text: string;
  html?: string;
  sourceQuote?: string;
  onAskSelection: (text: string) => void;
  filingKey?: FilingKey;
  apiBase?: string;
  apiPrefix?: string;
  /** From API (full-doc parse); keeps the TOC when only a partial HTML head is loaded. */
  externalAnchors?: FilingAnchor[];
  htmlPartial?: boolean;
};

function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const FilingReader = ({
  text,
  html = "",
  sourceQuote,
  onAskSelection,
  filingKey,
  apiBase = "",
  apiPrefix = "/api/py",
  externalAnchors,
  htmlPartial = false
}: Props) => {
  const { selection, dismiss } = useTextSelection("filing-reader");
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentRootRef = useRef<HTMLDivElement>(null);
  const [sanitizedHtml, setSanitizedHtml] = useState<string | null>(null);
  const [anchors, setAnchors] = useState<FilingAnchor[]>([]);
  const [fragmentOverride, setFragmentOverride] = useState<string | null>(null);
  const pendingScrollIdRef = useRef<string | null>(null);
  const fragmentCacheRef = useRef<Map<string, string>>(new Map());

  const showHtml = Boolean((fragmentOverride ?? html)?.trim());
  const rawHtmlInput = fragmentOverride ?? html;

  useEffect(() => {
    setFragmentOverride(null);
    fragmentCacheRef.current.clear();
  }, [html]);

  useEffect(() => {
    if (!showHtml) {
      setSanitizedHtml(null);
      setAnchors([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const DOMPurify = (await import("dompurify")).default;
      let raw = rawHtmlInput;
      if (sourceQuote && raw.includes(sourceQuote)) {
        raw = raw.replace(
          sourceQuote,
          `<mark id="source-quote-anchor" class="source-highlight source-quote-anchor">${escapeHtmlText(
            sourceQuote
          )}</mark>`
        );
      }
      const clean = DOMPurify.sanitize(raw, {
        USE_PROFILES: { html: true },
        ADD_TAGS: ["mark"],
        ADD_ATTR: ["id", "class", "name"],
      });
      if (cancelled) return;

      try {
        const doc = new DOMParser().parseFromString(clean, "text/html");
        const fromServer = externalAnchors && externalAnchors.length > 0 ? externalAnchors : buildFilingAnchors(doc);
        if (!cancelled) {
          setAnchors(fromServer);
          setSanitizedHtml(doc.body.innerHTML);
        }
      } catch {
        if (!cancelled) {
          setAnchors(externalAnchors && externalAnchors.length > 0 ? externalAnchors : []);
          setSanitizedHtml(clean);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rawHtmlInput, html, fragmentOverride, showHtml, sourceQuote, externalAnchors]);

  useEffect(() => {
    if (!sourceQuote || !showHtml) return;
    requestAnimationFrame(() => {
      scrollFilingFragmentIntoView("source-quote-anchor", contentRootRef.current, scrollContainerRef.current);
    });
  }, [sourceQuote, sanitizedHtml, showHtml]);

  useEffect(() => {
    const id = pendingScrollIdRef.current;
    if (!id || !sanitizedHtml) return;
    pendingScrollIdRef.current = null;
    requestAnimationFrame(() => {
      scrollFilingFragmentIntoView(id, contentRootRef.current, scrollContainerRef.current);
    });
  }, [sanitizedHtml]);

  const lines = useMemo(() => {
    const sanitized = text ?? "";
    if (!sourceQuote || !sanitized.includes(sourceQuote)) {
      return sanitized.split("\n");
    }

    const parts = sanitized.split(sourceQuote);
    const rendered: string[] = [];
    parts.forEach((part, idx) => {
      rendered.push(part);
      if (idx < parts.length - 1) {
        rendered.push("__SOURCE_QUOTE_MARK__");
      }
    });
    return rendered.join("").split("\n");
  }, [text, sourceQuote]);

  const fetchSectionHtml = useCallback(
    async (fragment: string): Promise<string | null> => {
      const cached = fragmentCacheRef.current.get(fragment);
      if (cached) return cached;
      if (!htmlPartial || !filingKey) return null;
      const params = new URLSearchParams({
        ticker: filingKey.ticker,
        year: filingKey.year,
        form_type: filingKey.formType,
        fragment
      });
      const url = `${apiBase}${apiPrefix}/filing/fragment?${params}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = (await res.json()) as { html: string };
      fragmentCacheRef.current.set(fragment, data.html);
      return data.html;
    },
    [apiBase, apiPrefix, filingKey, htmlPartial]
  );

  const scrollByLabelFallback = (label: string): boolean => {
    const root = contentRootRef.current;
    const scrollContainer = scrollContainerRef.current;
    if (!root || !scrollContainer) return false;

    const normalizedLabel = label.replace(/\s+/g, " ").trim().toLowerCase();
    const itemMatch = normalizedLabel.match(/\bitem\s+(\d{1,2}[a-z]?)\b/i);
    if (!normalizedLabel && !itemMatch) return false;

    const verticalOffsetInContainer = (el: HTMLElement) => {
      const cr = scrollContainer.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      return scrollContainer.scrollTop + (er.top - cr.top);
    };

    const relTopInFiling = (el: HTMLElement) => {
      const rr = root.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      return (er.top - rr.top + scrollContainer.scrollTop) / Math.max(root.scrollHeight, 1);
    };

    const scrollToElement = (target: HTMLElement) => {
      const cRect = scrollContainer.getBoundingClientRect();
      const tRect = target.getBoundingClientRect();
      const nextTop = scrollContainer.scrollTop + (tRect.top - cRect.top) - 12;
      scrollContainer.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
    };

    const collectItemNodes = (itemRe: RegExp) => {
      const nodes = root.querySelectorAll(
        "p,div,td,th,span,strong,b,h1,h2,h3,h4,h5,h6,font,li,em,i,a"
      );
      const candidates: HTMLElement[] = [];
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i] as HTMLElement;
        if (el.closest("script,style")) continue;
        if (el.children.length > 100) continue;
        const txt = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        if (txt.length < 8 || txt.length > 900) continue;
        if (!itemRe.test(txt.slice(0, 500))) continue;
        if (el.tagName === "A") {
          const href = el.getAttribute("href")?.trim() ?? "";
          if (href.startsWith("#") && relTopInFiling(el) < 0.2) continue;
        }
        candidates.push(el);
      }
      return candidates;
    };

    if (itemMatch) {
      const piece = itemMatch[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const itemRe = new RegExp(`\\bitem\\s+${piece}\\b`, "i");
      const looseRe = new RegExp(`item\\s+${piece}\\b`, "i");

      let candidates = collectItemNodes(itemRe);
      if (candidates.length === 0) {
        candidates = collectItemNodes(looseRe);
      }

      if (candidates.length === 0) return false;

      let working = candidates.filter((el) => !isInsideLikelyToc(el, root));
      if (working.length === 0) working = candidates;

      if (working.length >= 2 && working.some((el) => relTopInFiling(el) > 0.1)) {
        const narrowed = working.filter((el) => relTopInFiling(el) > 0.05);
        if (narrowed.length > 0) working = narrowed;
      }

      let target = working[0];
      let bestY = verticalOffsetInContainer(target);
      for (let i = 1; i < working.length; i++) {
        const el = working[i];
        const y = verticalOffsetInContainer(el);
        if (y > bestY) {
          bestY = y;
          target = el;
        }
      }
      scrollToElement(target);
      return true;
    }

    const matchesText = (el: Element) => {
      const txt = (el.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!txt || txt.length > 400) return false;
      if (normalizedLabel.length < 4) return false;
      const needle =
        normalizedLabel.length <= 48 ? normalizedLabel : normalizedLabel.slice(0, 48);
      return txt.includes(needle);
    };

    const pool = Array.from(
      root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,div,td,th,span,li,font,b,strong,a,em")
    ).filter((el) => {
      if (el.tagName === "A") {
        const href = el.getAttribute("href")?.trim() ?? "";
        if (href.startsWith("#") && relTopInFiling(el as HTMLElement) < 0.18) return false;
      }
      return matchesText(el);
    });

    if (pool.length === 0) return false;

    let working = pool.filter((el) => !isInsideLikelyToc(el, root));
    if (working.length === 0) working = pool;

    if (working.some((el) => relTopInFiling(el as HTMLElement) > 0.1)) {
      const narrowed = working.filter((el) => relTopInFiling(el as HTMLElement) > 0.06);
      if (narrowed.length > 0) working = narrowed;
    }

    let target = working[0] as HTMLElement;
    let bestY = verticalOffsetInContainer(target);
    for (let i = 1; i < working.length; i++) {
      const el = working[i] as HTMLElement;
      const y = verticalOffsetInContainer(el);
      if (y > bestY) {
        bestY = y;
        target = el;
      }
    }
    scrollToElement(target);
    return true;
  };

  const navigateToSection = async (anchor: { id: string; label: string }): Promise<boolean> => {
    const root = contentRootRef.current;
    const scroller = scrollContainerRef.current;
    if (!root || !scroller) return false;

    // Fragment / id first: label heuristics used to run first and could "succeed" on the wrong
    // nodes (e.g. Item regex) and skip real #anchor scrolling entirely.
    const candidates = collectAnchorCandidates(root, anchor.id);
    const canScrollByFragment =
      candidates.length >= 2 ||
      (candidates.length === 1 && !isInsideLikelyToc(candidates[0], root));

    if (canScrollByFragment && findBestAnchorTarget(root, anchor.id)) {
      scrollFilingFragmentIntoView(anchor.id, root, scroller);
      return true;
    }

    const sectionHtml = await fetchSectionHtml(anchor.id);
    if (sectionHtml) {
      pendingScrollIdRef.current = anchor.id;
      setFragmentOverride(sectionHtml);
      return true;
    }

    if (scrollByLabelFallback(anchor.label)) return true;

    if (candidates.length === 1 && findBestAnchorTarget(root, anchor.id)) {
      scrollFilingFragmentIntoView(anchor.id, root, scroller);
      return true;
    }

    return false;
  };

  return (
    <section className="group/filing relative flex h-full min-h-0 flex-col rounded-2xl border border-violet-100/80 bg-white p-5 shadow-[0_6px_20px_-6px_rgba(54,1,63,0.26)] ring-1 ring-slate-200/80 transition duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_44px_-14px_rgba(54,1,63,0.24)]">
      {showHtml && anchors.length > 0 && (
        <details
          open
          className="group/toc mb-3 shrink-0 rounded-xl border border-violet-100/90 bg-gradient-to-b from-white to-violet-50/40 shadow-[0_4px_16px_-6px_rgba(54,1,63,0.15)] ring-1 ring-violet-100/60"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium text-violet-950/90 [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-violet-600 transition group-open/toc:rotate-90" strokeWidth={2} />
            <span>Table of contents & jump to section</span>
            {htmlPartial && (
              <span className="ml-auto rounded-md bg-violet-100/80 px-1.5 py-0.5 text-[0.65rem] font-normal text-violet-900/70">
                sections on demand
              </span>
            )}
          </summary>
          <div className="border-t border-violet-100/80 px-3 pb-3 pt-1">
            <label className="block text-[0.65rem] font-medium uppercase tracking-wide text-violet-950/55">
              Section
              <select
                className="mt-1.5 w-full max-w-md rounded-lg border border-violet-200/90 bg-white px-2 py-2 text-xs text-slate-800 shadow-[0_4px_14px_-4px_rgba(54,1,63,0.22)] outline-none transition hover:shadow-[0_6px_18px_-4px_rgba(54,1,63,0.3)] focus:border-violet-400 focus:ring-2 focus:ring-violet-300/50"
                defaultValue=""
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  if (!Number.isFinite(idx) || idx < 0) return;
                  const anchor = anchors[idx];
                  if (!anchor) return;
                  void (async () => {
                    await navigateToSection(anchor);
                  })();
                  e.currentTarget.value = "";
                }}
              >
                <option value="" disabled>
                  Select…
                </option>
                {anchors.map((a, idx) => (
                  <option key={`${a.source}-${a.id}-${idx}`} value={String(idx)}>
                    {`${"  ".repeat(Math.max(0, a.level - 1))}${a.label}`}
                  </option>
                ))}
              </select>
            </label>
            {sourceQuote && (
              <button
                type="button"
                className="mt-2 rounded-lg border border-violet-200/90 bg-white px-3 py-1.5 text-xs font-medium text-violet-950 shadow-[0_4px_12px_-4px_rgba(54,1,63,0.2)] transition hover:bg-violet-50"
                onClick={() =>
                  scrollFilingFragmentIntoView("source-quote-anchor", contentRootRef.current, scrollContainerRef.current)
                }
              >
                Jump to quote
              </button>
            )}
          </div>
        </details>
      )}
      <div
        id="filing-reader"
        ref={scrollContainerRef}
        className="relative min-h-0 flex-1 overflow-y-auto text-sm leading-relaxed text-slate-800"
        onClick={(e) => {
          const t = e.target as HTMLElement | null;
          const a = t?.closest?.("a");
          if (!a) return;
          const href = a.getAttribute("href")?.trim();
          if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) return;

          let fragment = "";
          if (href.startsWith("#")) {
            fragment = href.slice(1);
          } else if (href.includes("#")) {
            try {
              const u = new URL(href, window.location.href);
              if (u.origin !== window.location.origin || u.pathname !== window.location.pathname) {
                return;
              }
              fragment = u.hash.slice(1);
            } catch {
              return;
            }
          }
          if (!fragment) return;

          const root = contentRootRef.current;
          if (!root) return;
          const label = (a.textContent ?? "").replace(/\s+/g, " ").trim();

          e.preventDefault();
          void (async () => {
            const ok = await navigateToSection({ id: fragment, label: label || fragment });
            if (!ok && findBestAnchorTarget(root, fragment)) {
              scrollFilingFragmentIntoView(fragment, root, scrollContainerRef.current);
            }
          })();
        }}
      >
        {showHtml && sanitizedHtml && (
          <div
            ref={contentRootRef}
            className="filing-html prose prose-slate max-w-none prose-headings:scroll-mt-24 prose-p:my-2 prose-li:my-0.5 prose-table:text-sm prose-a:text-violet-900 prose-a:decoration-violet-300"
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          />
        )}
        {showHtml && !sanitizedHtml && (
          <p className="text-slate-400">Loading formatted view…</p>
        )}
        {!showHtml && (
          <div className="whitespace-pre-wrap text-slate-700">
            {lines.map((line, lineIdx) => {
              const tokens = line.split("__SOURCE_QUOTE_MARK__");
              return (
                <div key={`line-${lineIdx}`}>
                  {tokens.map((token, tokenIdx) => (
                    <span key={`token-${lineIdx}-${tokenIdx}`}>
                      {token}
                      {tokenIdx < tokens.length - 1 && (
                        <mark className="source-highlight source-quote-anchor">{sourceQuote}</mark>
                      )}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {selection.visible && (
        <button
          type="button"
          style={{
            position: "fixed",
            left: `${selection.x}px`,
            top: `${selection.y}px`,
            transform: "translate(-50%, -100%)",
            zIndex: 60,
            boxShadow: COPILOT_PURPLE_SHADOW_HOVER,
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onAskSelection(selection.text);
            dismiss();
          }}
          className="rounded-lg bg-[#36013F] px-3 py-1.5 text-xs font-medium text-white ring-1 ring-violet-900/30 transition hover:bg-violet-900"
        >
          Add to AI Chat
        </button>
      )}
    </section>
  );
};
