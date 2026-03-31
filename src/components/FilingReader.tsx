import { useEffect, useMemo, useState } from "react";
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

type HtmlAnchor = {
  id: string;
  label: string;
  level: number;
};

function slugifyHeading(input: string): string {
  const base = input
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "section";
}

export const FilingReader = ({ text, html = "", sourceQuote, onAskSelection }: Props) => {
  const { selection, dismiss } = useTextSelection("filing-reader");
  const [sanitizedHtml, setSanitizedHtml] = useState<string | null>(null);
  const [anchors, setAnchors] = useState<HtmlAnchor[]>([]);
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
        ADD_ATTR: ["id", "class"],
      });
      if (cancelled) return;

      // Add stable ids to headings and collect anchors for quick navigation.
      try {
        const doc = new DOMParser().parseFromString(clean, "text/html");
        const seen = new Map<string, number>();
        const nextAnchors: HtmlAnchor[] = [];
        const headings = Array.from(doc.querySelectorAll("h1,h2,h3,h4,h5,h6"));
        for (const heading of headings) {
          const label = (heading.textContent ?? "").replace(/\s+/g, " ").trim();
          if (!label) continue;
          const level = Number(heading.tagName.slice(1));

          let id = heading.getAttribute("id")?.trim() || "";
          if (!id) {
            const base = slugifyHeading(label);
            const prior = seen.get(base) ?? 0;
            seen.set(base, prior + 1);
            id = prior === 0 ? base : `${base}-${prior + 1}`;
            heading.setAttribute("id", id);
          }
          nextAnchors.push({ id, label, level });
        }

        setAnchors(nextAnchors.slice(0, 250));
        setSanitizedHtml(doc.body.innerHTML);
      } catch {
        setAnchors([]);
        setSanitizedHtml(clean);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [html, showHtml, sourceQuote]);

  useEffect(() => {
    if (!sourceQuote) return;
    const element = document.querySelector(".source-quote-anchor");
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
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

  return (
    <section className="relative flex h-full min-h-0 flex-col rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      {showHtml && anchors.length > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <label className="text-xs font-medium text-slate-600">
            Jump to section
            <select
              className="ml-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none"
              defaultValue=""
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                e.currentTarget.value = "";
              }}
            >
              <option value="" disabled>
                Select…
              </option>
              {anchors.map((a) => (
                <option key={a.id} value={a.id}>
                  {`${"  ".repeat(Math.max(0, a.level - 1))}${a.label}`}
                </option>
              ))}
            </select>
          </label>
          {sourceQuote && (
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
              onClick={() => document.getElementById("source-quote-anchor")?.scrollIntoView({ behavior: "smooth", block: "center" })}
            >
              Jump to quote
            </button>
          )}
        </div>
      )}
      <div
        id="filing-reader"
        className="relative min-h-0 flex-1 overflow-y-auto text-sm leading-relaxed text-slate-800"
      >
        {showHtml && sanitizedHtml && (
          <div
            className="filing-html prose prose-slate max-w-none prose-headings:scroll-mt-24 prose-p:my-2 prose-li:my-0.5 prose-table:text-sm"
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
            zIndex: 50
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onAskSelection(selection.text);
            dismiss();
          }}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg ring-1 ring-slate-700/20 hover:bg-slate-800"
        >
          Add to AI Chat
        </button>
      )}
    </section>
  );
};
