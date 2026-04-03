import { FormEvent, useEffect, useRef, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { ChatContextSliders } from "@/components/ChatContextSliders";
import { ChatMessage } from "@/lib/types";

type Props = {
  messages: ChatMessage[];
  isLoading?: boolean;
  error?: string;
  onRetry?: () => Promise<void> | void;
  onSubmit: (message: string) => Promise<void>;
  onMinimize?: () => void;
  /** Show sparkles in header when true (docked overlay). */
  showSparkleBrand?: boolean;
  /** Per-prompt context size controls (optional). */
  contextSettings?: {
    currentContextMax: number;
    additionalContextMax: number;
    onCurrentContextMaxChange: (value: number) => void;
    onAdditionalContextMaxChange: (value: number) => void;
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
  contextSettings
}: Props) => {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

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
        <ChatContextSliders
          currentContextMax={contextSettings.currentContextMax}
          additionalContextMax={contextSettings.additionalContextMax}
          onCurrentContextMaxChange={contextSettings.onCurrentContextMaxChange}
          onAdditionalContextMaxChange={contextSettings.onAdditionalContextMaxChange}
        />
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
