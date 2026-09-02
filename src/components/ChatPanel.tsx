import { FormEvent, useEffect, useRef, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Sparkles, Wrench } from "lucide-react";
import { ChatContextSliders } from "@/components/ChatContextSliders";
import { AgentStep, ChatMessage } from "@/lib/types";

/** The one argument worth showing per tool — what it looked for, not the schema. */
function toolArgSummary(step: AgentStep): string {
  const args = step.args ?? {};
  const primary = args.query ?? args.section ?? args.expression;
  if (typeof primary === "string" && primary) {
    const scope = typeof args.year === "string" ? `${args.year} ${args.form_type ?? ""} — ` : "";
    return `${scope}"${primary}"`;
  }
  return "";
}

const CONTEXT_EXPANDED_KEY = "sec-copilot-chat-context-expanded";

type Props = {
  messages: ChatMessage[];
  isLoading?: boolean;
  error?: string;
  onRetry?: () => Promise<void> | void;
  onSubmit: (message: string) => Promise<void>;
  onMinimize?: () => void;
  /** Show sparkles in header when true (docked overlay). */
  showSparkleBrand?: boolean;
  /**
   * Open-courseware attribution strings. CC licenses require attribution wherever
   * excerpts are shown, so this renders once under the thread when any answer
   * actually drew on course material.
   */
  coursewareAttributions?: string[];
  /** Per-prompt context size controls (optional). */
  contextSettings?: {
    currentContextMax: number;
    additionalContextMax: number;
    coursewareContextMax: number;
    onCurrentContextMaxChange: (value: number) => void;
    onAdditionalContextMaxChange: (value: number) => void;
    onCoursewareContextMaxChange: (value: number) => void;
  };
};

export const ChatPanel = ({
  messages,
  isLoading = false,
  error,
  onRetry,
  onSubmit,
  onMinimize,
  showSparkleBrand = true,
  coursewareAttributions,
  contextSettings
}: Props) => {
  const usedCourseware = messages.some((m) => (m.citations?.length ?? 0) > 0);
  const [input, setInput] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setContextOpen(window.localStorage.getItem(CONTEXT_EXPANDED_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleContextOpen = () => {
    setContextOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(CONTEXT_EXPANDED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    if (!value) return;
    setInput("");
    await onSubmit(value);
  };

  return (
    <section className="group/chat flex h-full min-h-0 flex-col rounded-2xl rounded-r-none border-l border-violet-100/90 bg-gradient-to-b from-white via-white to-violet-50/30 p-4 shadow-[0_6px_24px_-6px_rgba(54,1,63,0.22)] ring-1 ring-violet-100/70 transition duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_12px_40px_-10px_rgba(54,1,63,0.3)]">
      <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-violet-950">
          {showSparkleBrand && <Sparkles className="h-4 w-4 text-violet-600" strokeWidth={2} aria-hidden />}
          Copilot Chat
        </h2>
        {onMinimize && (
          <button
            type="button"
            onClick={onMinimize}
            className="rounded-lg border border-violet-200/80 bg-white/90 p-1.5 text-violet-800 shadow-[0_3px_12px_-4px_rgba(54,1,63,0.2)] transition hover:border-violet-300 hover:bg-violet-50"
            aria-label="Minimize chat"
            title="Minimize chat"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}
      </div>
      {contextSettings && (
        <div className="mb-2 shrink-0">
          <button
            type="button"
            onClick={toggleContextOpen}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-violet-100/90 bg-violet-50/50 px-2.5 py-1.5 text-left text-xs font-medium text-violet-900/90 shadow-sm transition hover:bg-violet-50"
            aria-expanded={contextOpen}
            aria-controls="copilot-context-sliders"
            id="copilot-context-toggle"
          >
            <span>Context size (tokens)</span>
            <ChevronRight
              className={`h-4 w-4 shrink-0 text-violet-700 transition-transform ${contextOpen ? "rotate-90" : ""}`}
              aria-hidden
            />
          </button>
          {contextOpen && (
            <div id="copilot-context-sliders" className="mt-2">
              <ChatContextSliders
                currentContextMax={contextSettings.currentContextMax}
                additionalContextMax={contextSettings.additionalContextMax}
                coursewareContextMax={contextSettings.coursewareContextMax}
                onCurrentContextMaxChange={contextSettings.onCurrentContextMaxChange}
                onAdditionalContextMaxChange={contextSettings.onAdditionalContextMaxChange}
                onCoursewareContextMaxChange={contextSettings.onCoursewareContextMaxChange}
              />
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="mb-3 shrink-0 rounded-lg border border-rose-100 bg-rose-50/90 px-3 py-2 text-xs text-rose-800">
          <div>{error}</div>
          {onRetry && (
            <button
              className="mt-2 rounded-md bg-rose-100 px-2 py-1 text-xs text-rose-800 shadow-sm hover:bg-rose-200/80"
              onClick={onRetry}
              type="button"
            >
              Retry
            </button>
          )}
        </div>
      )}
      <div className="mb-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`rounded-lg px-3 py-2 text-sm shadow-sm transition ${
              message.role === "user"
                ? message.kind === "selection"
                  ? "border border-amber-200/90 bg-amber-50/95 text-slate-900 shadow-[0_4px_14px_-6px_rgba(54,1,63,0.12)]"
                  : "border border-slate-100 bg-slate-50/90 text-slate-900 shadow-[0_4px_12px_-6px_rgba(54,1,63,0.1)]"
                : "border border-violet-900/10 bg-[#36013F] text-white shadow-[0_6px_20px_-8px_rgba(54,1,63,0.45)]"
            }`}
          >
            {message.kind === "selection" && (
              <div className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-amber-900/80">
                From filing
              </div>
            )}
            <div className="whitespace-pre-wrap">{message.content}</div>
            {message.role === "assistant" && (message.trace?.length ?? 0) > 0 && (
              <details className="mt-2 border-t border-white/15 pt-2">
                <summary className="flex cursor-pointer items-center gap-1.5 text-[0.6rem] font-semibold uppercase tracking-wide text-violet-200/80">
                  <Wrench className="h-3 w-3 shrink-0" aria-hidden />
                  {message.trace?.length} research{" "}
                  {message.trace?.length === 1 ? "step" : "steps"}
                </summary>
                <ol className="mt-1.5 space-y-1">
                  {message.trace?.map((step, i) => (
                    <li key={`${step.tool}-${i}`} className="text-[0.65rem] text-violet-100/85">
                      <span className="font-mono text-violet-200">{step.tool}</span>
                      {toolArgSummary(step) && (
                        <span className="text-violet-100/70"> · {toolArgSummary(step)}</span>
                      )}
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {message.role === "assistant" && (message.citations?.length ?? 0) > 0 && (
              <div className="mt-2 border-t border-white/15 pt-2">
                <div className="mb-1 flex flex-wrap items-center gap-x-1.5 text-[0.6rem] font-semibold uppercase tracking-wide text-violet-200/80">
                  <BookOpen className="h-3 w-3 shrink-0" aria-hidden />
                  Course material
                  {(message.lenses?.length ?? 0) > 0 && (
                    <span className="font-normal normal-case tracking-normal text-violet-200/60">
                      · {message.lenses?.join(" · ")}
                    </span>
                  )}
                </div>
                <ul className="flex flex-wrap gap-1">
                  {message.citations?.map((citation) => (
                    <li
                      key={citation.id}
                      className="rounded-md bg-white/10 px-1.5 py-0.5 text-[0.65rem] text-violet-100"
                      title={citation.headingPath}
                    >
                      {citation.citation}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2 text-sm text-violet-900/80">
            <Sparkles className="h-4 w-4 shrink-0 animate-pulse text-violet-600" />
            Thinking…
          </div>
        )}
        <div ref={bottomRef} aria-hidden />
      </div>
      {usedCourseware && (coursewareAttributions?.length ?? 0) > 0 && (
        <div className="mb-2 shrink-0 border-t border-violet-100 pt-2 text-[0.6rem] leading-snug text-violet-900/55">
          {coursewareAttributions?.map((attribution) => (
            <div key={attribution}>{attribution}</div>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex shrink-0 gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
          className="flex-1 rounded-xl border border-violet-200/80 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-[0_4px_16px_-6px_rgba(54,1,63,0.25)] outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:shadow-[0_6px_22px_-6px_rgba(54,1,63,0.35)] focus:ring-2 focus:ring-violet-300/40"
          placeholder="Ask about this filing..."
        />
        <button
          disabled={isLoading}
          className="rounded-xl bg-[#36013F] px-4 py-2.5 text-sm font-medium text-white shadow-[0_6px_18px_-6px_rgba(54,1,63,0.45)] transition hover:bg-violet-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );
};
