import { useEffect, useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { FilingReader } from "@/components/FilingReader";
import { RecentResearch } from "@/components/RecentResearch";
import { TickerSwitcher } from "@/components/TickerSwitcher";
import { useSession } from "@/context/SessionContext";
import { loadRecents } from "@/lib/storage";
import { ChatMessage, FilingKey } from "@/lib/types";

type FilingResponse = {
  ticker: string;
  year: string;
  form_type: string;
  filing_text: string;
  cached?: boolean;
};

type ChatResponse = {
  answer: string;
  source_quote?: string;
};

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export default function HomePage() {
  const {
    filingKey,
    documentText,
    messages,
    selectedText,
    setSelectedText,
    setDocumentText,
    addMessage,
    addHighlight,
    switchTicker
  } = useSession();
  const [sourceQuote, setSourceQuote] = useState<string | undefined>();
  const [recents, setRecents] = useState<FilingKey[]>([]);
  const [isSwitchingTicker, setIsSwitchingTicker] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [sessionSavedMessage, setSessionSavedMessage] = useState<string | undefined>();
  const [lastTickerAttempt, setLastTickerAttempt] = useState<FilingKey | undefined>();
  const [lastPrompt, setLastPrompt] = useState<string | undefined>();
  const [errorScope, setErrorScope] = useState<"ticker" | "chat" | undefined>();
  const [isCachedFiling, setIsCachedFiling] = useState(false);

  useEffect(() => {
    setRecents(loadRecents());
  }, [filingKey]);

  const fetchFiling = async (key: FilingKey) => {
    const response = await fetch(`${apiBase}/filing?ticker=${key.ticker}&year=${key.year}&form_type=${key.formType}`);
    if (!response.ok) {
      throw new Error("Unable to load filing.");
    }
    const data = (await response.json()) as FilingResponse;
    return data;
  };

  const onSwitchTicker = async (key: FilingKey) => {
    setIsSwitchingTicker(true);
    setErrorMessage(undefined);
    setErrorScope(undefined);
    setLastTickerAttempt(key);
    try {
      const filingData = await fetchFiling(key);
      switchTicker(key, filingData.filing_text);
      setIsCachedFiling(Boolean(filingData.cached));
      setSourceQuote(undefined);
      setSessionSavedMessage(`Session saved for ${filingKey.ticker} ${filingKey.formType} (${filingKey.year}).`);
      window.setTimeout(() => setSessionSavedMessage(undefined), 2200);
    } catch (error) {
      setErrorScope("ticker");
      setErrorMessage(error instanceof Error ? error.message : "Failed to switch ticker.");
    } finally {
      setIsSwitchingTicker(false);
    }
  };

  const onAskSelected = (text: string) => {
    addHighlight(text);
    setSelectedText(text);
  };

  const onSubmitChat = async (prompt: string) => {
    setErrorMessage(undefined);
    setErrorScope(undefined);
    addMessage({ id: crypto.randomUUID(), role: "user", content: prompt });
    setLastPrompt(prompt);
    const payload = {
      ticker: filingKey.ticker,
      year: filingKey.year,
      form_type: filingKey.formType,
      question: prompt,
      current_context: documentText,
      selected_text: selectedText
    };
    setIsAsking(true);
    try {
      const response = await fetch(`${apiBase}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error("Chat request failed.");
      }
      const data = (await response.json()) as ChatResponse;
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.answer,
        sourceQuote: data.source_quote
      };
      addMessage(assistantMessage);
      setSourceQuote(data.source_quote);
    } catch (error) {
      setErrorScope("chat");
      setErrorMessage(error instanceof Error ? error.message : "Could not get answer.");
    } finally {
      setIsAsking(false);
    }
  };

  const onRetryTicker = async () => {
    if (!lastTickerAttempt || isSwitchingTicker) return;
    await onSwitchTicker(lastTickerAttempt);
  };

  const onRetryChat = async () => {
    if (!lastPrompt || isAsking) return;
    await onSubmitChat(lastPrompt);
  };

  return (
    <main className="mx-auto h-screen max-w-[1400px] px-6 py-5">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-900">SEC Copilot</h1>
            {isCachedFiling && (
              <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600 ring-1 ring-slate-200">cached</span>
            )}
          </div>
          <p className="text-sm text-slate-500">Session-aware filing research with comparison-ready Q&A.</p>
        </div>
        <TickerSwitcher initial={filingKey} isLoading={isSwitchingTicker} onSwitch={onSwitchTicker} />
      </header>
      {sessionSavedMessage && (
        <div className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200">
          {sessionSavedMessage}
        </div>
      )}
      {errorMessage && errorScope === "ticker" && (
        <div className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
          <div>{errorMessage}</div>
          <button className="mt-2 rounded bg-rose-100 px-2 py-1 text-xs text-rose-700" onClick={onRetryTicker}>
            Retry ticker load
          </button>
        </div>
      )}

      <section className="grid h-[calc(100%-68px)] grid-cols-12 gap-5">
        <div className="col-span-7 flex flex-col gap-4">
          <RecentResearch items={recents} onPick={onSwitchTicker} />
          <FilingReader text={documentText} sourceQuote={sourceQuote} onAskSelection={onAskSelected} />
        </div>
        <div className="col-span-5">
          <ChatPanel
            messages={messages}
            selectedText={selectedText}
            isLoading={isAsking}
            error={errorScope === "chat" ? errorMessage : undefined}
            onRetry={errorScope === "chat" ? onRetryChat : undefined}
            onSubmit={onSubmitChat}
          />
        </div>
      </section>
    </main>
  );
}
