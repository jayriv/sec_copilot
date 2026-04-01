import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { ChatPanel } from "@/components/ChatPanel";
import { FilingReader } from "@/components/FilingReader";
import { RecentResearch } from "@/components/RecentResearch";
import { TickerSwitcher } from "@/components/TickerSwitcher";
import { useSession } from "@/context/SessionContext";
import { loadRecents } from "@/lib/storage";
import { ChatMessage, FilingAnchor, FilingKey } from "@/lib/types";

type FilingResponse = {
  ticker: string;
  year: string;
  form_type: string;
  filing_text: string;
  filing_html?: string | null;
  filing_html_partial?: boolean;
  filing_anchors?: FilingAnchor[] | null;
  cached?: boolean;
};

type ChatResponse = {
  answer: string;
  source_quote?: string;
};

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const apiPrefix = "/api/py";

export default function HomePage() {
  const {
    filingKey,
    documentText,
    documentHtml,
    documentAnchors,
    documentHtmlPartial,
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
  const [healthStatus, setHealthStatus] = useState<"checking" | "online" | "offline">("checking");
  const [chatDocked, setChatDocked] = useState(false);

  useEffect(() => {
    setRecents(loadRecents());
  }, [filingKey]);

  useEffect(() => {
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const response = await fetch(`${apiBase}${apiPrefix}/health`);
        if (!cancelled) {
          setHealthStatus(response.ok ? "online" : "offline");
        }
      } catch {
        if (!cancelled) {
          setHealthStatus("offline");
        }
      }
    };
    checkHealth();
    const timer = window.setInterval(checkHealth, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const fetchFiling = async (key: FilingKey) => {
    const response = await fetch(
      `${apiBase}${apiPrefix}/filing?ticker=${key.ticker}&year=${key.year}&form_type=${key.formType}`
    );
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
      switchTicker(key, filingData.filing_text, filingData.filing_html ?? "", {
        anchors: filingData.filing_anchors ?? [],
        htmlPartial: Boolean(filingData.filing_html_partial)
      });
      setIsCachedFiling(Boolean(filingData.cached));
      setSourceQuote(undefined);
      setSessionSavedMessage(`Session saved for ${key.ticker} ${key.formType} (${key.year}).`);
      window.setTimeout(() => setSessionSavedMessage(undefined), 2200);
    } catch (error) {
      setErrorScope("ticker");
      setErrorMessage(error instanceof Error ? error.message : "Failed to switch ticker.");
    } finally {
      setIsSwitchingTicker(false);
    }
  };

  const onAskSelected = (text: string) => {
    setChatDocked(true);
    addHighlight(text);
    setSelectedText(text);
    addMessage({
      id: crypto.randomUUID(),
      role: "user",
      kind: "selection",
      content: text
    });
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
      const response = await fetch(`${apiBase}${apiPrefix}/chat`, {
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

  const chatOverlayWidth = "min(33.333vw, 26rem)";

  return (
    <main className="flex h-screen min-h-0 flex-col bg-gradient-to-br from-violet-50/50 via-slate-50 to-indigo-50/40">
      <header className="z-50 flex shrink-0 items-center justify-between gap-4 border-b border-violet-100/80 bg-white/85 px-5 py-4 shadow-sm shadow-violet-950/5 backdrop-blur-md">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-violet-950">SEC Copilot</h1>
            {isCachedFiling && (
              <span className="rounded-md bg-violet-50 px-2 py-1 text-xs text-violet-900/80 ring-1 ring-violet-200/80">
                cached
              </span>
            )}
            <span
              className={`rounded-md px-2 py-1 text-xs ring-1 ${
                healthStatus === "online"
                  ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                  : healthStatus === "offline"
                    ? "bg-rose-50 text-rose-800 ring-rose-200"
                    : "bg-slate-100 text-slate-700 ring-slate-200"
              }`}
              title="Copilot API status (this service loads filings from the SEC EDGAR database)."
            >
              {healthStatus === "online"
                ? "SEC EDGAR API online"
                : healthStatus === "offline"
                  ? "SEC EDGAR API offline"
                  : "checking SEC EDGAR API"}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-600">
            Session-aware filing research with comparison-ready Q&A.
          </p>
        </div>
        <TickerSwitcher initial={filingKey} isLoading={isSwitchingTicker} onSwitch={onSwitchTicker} />
      </header>
      {sessionSavedMessage && (
        <div className="shrink-0 border-b border-emerald-100 bg-emerald-50/95 px-5 py-2 text-sm text-emerald-900">
          {sessionSavedMessage}
        </div>
      )}
      {errorMessage && errorScope === "ticker" && (
        <div className="shrink-0 border-b border-rose-100 bg-rose-50/95 px-5 py-3 text-sm text-rose-900">
          <div>{errorMessage}</div>
          <button
            className="mt-2 rounded-md bg-rose-100 px-3 py-1 text-xs text-rose-900 shadow-sm hover:bg-rose-200/80"
            onClick={onRetryTicker}
          >
            Retry ticker load
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div
          className="absolute inset-0 flex min-h-0 flex-col gap-3 p-4 transition-[padding-right] duration-300"
          style={chatDocked ? { paddingRight: `calc(${chatOverlayWidth} + 1rem)` } : {}}
        >
          <div className="min-h-0 flex-1">
            <FilingReader
              text={documentText}
              html={documentHtml}
              sourceQuote={sourceQuote}
              onAskSelection={onAskSelected}
              filingKey={filingKey}
              apiBase={apiBase}
              apiPrefix={apiPrefix}
              externalAnchors={documentAnchors}
              htmlPartial={documentHtmlPartial}
            />
          </div>
          <RecentResearch items={recents} onPick={onSwitchTicker} />
        </div>

        {chatDocked && (
          <div
            className="pointer-events-none absolute bottom-4 right-4 top-4 z-40 flex min-w-[280px] max-w-[calc(100vw-2rem)]"
            style={{ width: chatOverlayWidth }}
          >
            <div className="pointer-events-auto flex min-h-0 flex-1 flex-col">
              <ChatPanel
                messages={messages}
                isLoading={isAsking}
                error={errorScope === "chat" ? errorMessage : undefined}
                onRetry={errorScope === "chat" ? onRetryChat : undefined}
                onSubmit={onSubmitChat}
                onMinimize={() => setChatDocked(false)}
                showSparkleBrand
              />
            </div>
          </div>
        )}

        {!chatDocked && (
          <button
            type="button"
            onClick={() => setChatDocked(true)}
            className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#36013F] text-white shadow-[0_10px_34px_-6px_rgba(54,1,63,0.55)] ring-2 ring-violet-200/60 transition hover:scale-105 hover:shadow-[0_14px_40px_-6px_rgba(54,1,63,0.65)] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            aria-label="Open Copilot chat"
            title="Open chat"
          >
            <Sparkles className="h-6 w-6" strokeWidth={2} />
          </button>
        )}
      </div>
    </main>
  );
}
