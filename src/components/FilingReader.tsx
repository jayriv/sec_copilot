import { useEffect, useMemo } from "react";
import { useTextSelection } from "@/hooks/useTextSelection";

type Props = {
  text: string;
  sourceQuote?: string;
  onAskSelection: (text: string) => void;
};

export const FilingReader = ({ text, sourceQuote, onAskSelection }: Props) => {
  const selection = useTextSelection("filing-reader");

  useEffect(() => {
    if (!sourceQuote) return;
    const element = document.querySelector(".source-quote-anchor");
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [sourceQuote]);

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
    <section className="relative rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div id="filing-reader" className="max-h-[70vh] overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-slate-700">
        {lines.map((line, lineIdx) => {
          const tokens = line.split("__SOURCE_QUOTE_MARK__");
          return (
            <div key={`line-${lineIdx}`}>
              {tokens.map((token, tokenIdx) => (
                <span key={`token-${lineIdx}-${tokenIdx}`}>
                  {token}
                  {tokenIdx < tokens.length - 1 && (
                    <mark className="source-highlight source-quote-anchor">
                      {sourceQuote}
                    </mark>
                  )}
                </span>
              ))}
            </div>
          );
        })}
      </div>
      {selection.visible && (
        <button
          style={{ left: selection.x, top: selection.y }}
          onClick={() => onAskSelection(selection.text)}
          className="absolute -translate-x-1/2 -translate-y-full rounded-md bg-slate-900 px-3 py-1 text-xs text-white"
        >
          Ask AI
        </button>
      )}
    </section>
  );
};
