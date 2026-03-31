import { FormEvent, useEffect, useRef, useState } from "react";
import { ChatMessage } from "@/lib/types";

type Props = {
  messages: ChatMessage[];
  isLoading?: boolean;
  error?: string;
  onRetry?: () => Promise<void> | void;
  onSubmit: (message: string) => Promise<void>;
};

export const ChatPanel = ({ messages, isLoading = false, error, onRetry, onSubmit }: Props) => {
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
    <section className="flex h-full flex-col rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">Copilot Chat</h2>
      {error && (
        <div className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <div>{error}</div>
          {onRetry && (
            <button className="mt-2 rounded bg-rose-100 px-2 py-1 text-xs text-rose-700" onClick={onRetry} type="button">
              Retry
            </button>
          )}
        </div>
      )}
      <div className="mb-3 flex-1 space-y-2 overflow-y-auto">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`rounded-md px-3 py-2 text-sm ${
              message.role === "user"
                ? message.kind === "selection"
                  ? "border border-amber-200/80 bg-amber-50/90 text-slate-900"
                  : "bg-slate-100 text-slate-900"
                : "bg-slate-900 text-white"
            }`}
          >
            {message.kind === "selection" && (
              <div className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-amber-800/90">
                From filing
              </div>
            )}
            <div className="whitespace-pre-wrap">{message.content}</div>
          </div>
        ))}
        {isLoading && <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-500">Thinking...</div>}
        <div ref={bottomRef} aria-hidden />
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none"
          placeholder="Ask about this filing..."
        />
        <button
          disabled={isLoading}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );
};
