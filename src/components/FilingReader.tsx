import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildFilingAnchors,
  COPILOT_PURPLE_SHADOW_HOVER,
  findBestAnchorTarget,
  isInsideLikelyToc,
  scrollFilingFragmentIntoView
} from "@/lib/filingAnchors";
import { useTextSelection } from "@/hooks/useTextSelection";

type Props = {
  text: string;
  html?: string;
  sourceQuote?: string;
  onAskSelection: (text: string) => void;
};

function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const FilingReader = ({ text, html = "", sourceQuote, onAskSelection }: Props) => {
  const { selection, dismiss } = useTextSelection("filing-reader");
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentRootRef = useRef<HTMLDivElement>(null);
  const [sanitizedHtml, setSanitizedHtml] = useState<string | null>(null);
  const [anchors, setAnchors] = useState<ReturnType<typeof buildFilingAnchors>>([]);
  const showHtml = Boolean(html?.trim());

  useEffect(() => {
    if (!showHtml) {
      setSanitizedHtml(null);
      setAnchors([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const DOMPurify = (await import("dompurify")).default;
      let raw = html;
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
        const nextAnchors = buildFilingAnchors(doc);
        if (!cancelled) {
          setAnchors(nextAnchors);
          setSanitizedHtml(doc.body.innerHTML);
        }
      } catch {
        if (!cancelled) {
          setAnchors([]);
          setSanitizedHtml(clean);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [html, showHtml, sourceQuote]);

  useEffect(() => {
    if (!sourceQuote || !showHtml) return;
    requestAnimationFrame(() => {
      scrollFilingFragmentIntoView("source-quote-anchor", contentRootRef.current, scrollContainerRef.current);
    });
  }, [sourceQuote, sanitizedHtml, showHtml]);

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

  const scrollByLabelFallback = (label: string): boolean => {
    const root = contentRootRef.current;
    const scrollContainer = scrollContainerRef.current;
    if (!root || !scrollContainer) return false;

    const normalizedLabel = label.replace(/\s+/g, " ").trim().toLowerCase();
    const itemToken = normalizedLabel.match(/\bitem\s+\d{1,2}[a-z]?\b/i)?.[0]?.toLowerCase();
    if (!normalizedLabel && !itemToken) return false;

    const verticalOffsetInContainer = (el: HTMLElement) => {
      const cr = scrollContainer.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      return scrollContainer.scrollTop + (er.top - cr.top);
    };

    const matchesText = (el: Element) => {
      const txt = (el.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!txt || txt.length > 320) return false;
      if (itemToken && txt.includes(itemToken)) return true;
      return normalizedLabel.length > 12 && txt.includes(normalizedLabel.slice(0, 48));
    };

    const pool = Array.from(
      root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,div,td,th,span,li,font,b,strong")
    ).filter(matchesText);

    if (pool.length === 0) return false;

    const relTopInFiling = (el: HTMLElement) => {
      const rr = root.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      return (er.top - rr.top + scrollContainer.scrollTop) / Math.max(root.scrollHeight, 1);
    };

    let working = pool.filter((el) => !isInsideLikelyToc(el, root));
    if (working.length === 0) working = pool;

    const hasLower = working.some((el) => relTopInFiling(el as HTMLElement) > 0.12);
    if (hasLower) {
      working = working.filter((el) => {
        if (relTopInFiling(el as HTMLElement) >= 0.05) return true;
        return !working.some((o) => relTopInFiling(o as HTMLElement) > 0.12);
      });
    }

    const headings = working.filter((el) => /^H[1-6]$/i.test(el.tagName));
    const candidates = headings.length > 0 && itemToken ? headings : working;

    let target = candidates[0] as HTMLElement;
    let bestY = verticalOffsetInContainer(target);
    for (let i = 1; i < candidates.length; i++) {
      const el = candidates[i] as HTMLElement;
      const y = verticalOffsetInContainer(el);
      if (y > bestY) {
        bestY = y;
        target = el;
      }
    }

    const cRect = scrollContainer.getBoundingClientRect();
    const tRect = target.getBoundingClientRect();
    const nextTop = scrollContainer.scrollTop + (tRect.top - cRect.top) - 12;
    scrollContainer.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
    return true;
  };

  return (
    <section className="group/filing relative flex h-full min-h-0 flex-col rounded-2xl border border-violet-100/80 bg-white p-5 shadow-[0_6px_20px_-6px_rgba(54,1,63,0.26)] ring-1 ring-slate-200/80 transition duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_44px_-14px_rgba(54,1,63,0.24)]">
      {showHtml && anchors.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <label className="text-xs font-medium text-violet-950/80">
            Jump to section
            <select
              className="ml-2 rounded-lg border border-violet-200/90 bg-white px-2 py-1.5 text-xs text-slate-800 shadow-[0_4px_14px_-4px_rgba(54,1,63,0.22)] outline-none transition hover:shadow-[0_6px_18px_-4px_rgba(54,1,63,0.3)] focus:border-violet-400 focus:ring-2 focus:ring-violet-300/50"
              defaultValue=""
              onChange={(e) => {
                const idx = Number(e.target.value);
                if (!Number.isFinite(idx) || idx < 0) return;
                const anchor = anchors[idx];
                if (!anchor) return;
                requestAnimationFrame(() => {
                  const root = contentRootRef.current;
                  const scroller = scrollContainerRef.current;
                  if (root && findBestAnchorTarget(root, anchor.id)) {
                    scrollFilingFragmentIntoView(anchor.id, root, scroller);
                    return;
                  }
                  scrollByLabelFallback(anchor.label);
                });
                e.currentTarget.value = "";
              }}
            >
              <option value="" disabled>
                Select…
              </option>
              {anchors.map((a, idx) => (
                <option key={`${a.source}-${a.id}`} value={String(idx)}>
                  {`${"  ".repeat(Math.max(0, a.level - 1))}${a.label}`}
                </option>
              ))}
            </select>
          </label>
          {sourceQuote && (
            <button
              type="button"
              className="rounded-lg border border-violet-200/90 bg-white px-3 py-1.5 text-xs font-medium text-violet-950 shadow-[0_4px_12px_-4px_rgba(54,1,63,0.2)] transition hover:bg-violet-50"
              onClick={() =>
                scrollFilingFragmentIntoView("source-quote-anchor", contentRootRef.current, scrollContainerRef.current)
              }
            >
              Jump to quote
            </button>
          )}
        </div>
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
              fragment = new URL(href, window.location.href).hash.slice(1);
            } catch {
              return;
            }
          }
          if (!fragment) return;

          const root = contentRootRef.current;
          if (!root) return;
          const hasTarget = findBestAnchorTarget(root, fragment);
          if (hasTarget) {
            e.preventDefault();
            scrollFilingFragmentIntoView(fragment, root, scrollContainerRef.current);
            return;
          }
          const label = (a.textContent ?? "").replace(/\s+/g, " ").trim();
          if (label && scrollByLabelFallback(label)) {
            e.preventDefault();
          }
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
