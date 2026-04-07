import { useEffect, useState } from "react";
import Link from "next/link";
import { Settings, Sparkles } from "lucide-react";
import { ChatPanel } from "@/components/ChatPanel";
import { FilingReader } from "@/components/FilingReader";
import { RecentResearch } from "@/components/RecentResearch";
import { TickerSwitcher } from "@/components/TickerSwitcher";
import { useSession } from "@/context/SessionContext";
import { loadRecents } from "@/lib/storage";
import { LlmModelPicker } from "@/components/LlmModelPicker";
import {
  DEFAULT_ADDITIONAL_CONTEXT_MAX,
  DEFAULT_CURRENT_CONTEXT_MAX,
  loadAdditionalContextMax,
  loadCurrentContextMax,
  getEffectiveSystemPromptForRequest,
  persistAdditionalContextMax,
  persistCurrentContextMax
} from "@/lib/copilotSettings";
import { DEFAULT_LLM_MODEL, isKnownLlmModel, LLM_MODEL_STORAGE_KEY } from "@/lib/llmCatalog";
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
  /** When API is online, whether EDGAR_IDENTITY is set (required for SEC data). */
  const [edgarIdentityOk, setEdgarIdentityOk] = useState<boolean | null>(null);
  const [chatDocked, setChatDocked] = useState(false);
  const [chatModel, setChatModel] = useState(DEFAULT_LLM_MODEL);
  const [currentContextMax, setCurrentContextMax] = useState(DEFAULT_CURRENT_CONTEXT_MAX);
  const [additionalContextMax, setAdditionalContextMax] = useState(DEFAULT_ADDITIONAL_CONTEXT_MAX);

  useEffect(() => {
    setCurrentContextMax(loadCurrentContextMax());
    setAdditionalContextMax(loadAdditionalContextMax());
  }, []);

  useEffect(() => {
    persistCurrentContextMax(currentContextMax);
  }, [currentContextMax]);

  useEffect(() => {
    persistAdditionalContextMax(additionalContextMax);
  }, [additionalContextMax]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LLM_MODEL_STORAGE_KEY);
      if (stored && isKnownLlmModel(stored)) setChatModel(stored);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(LLM_MODEL_STORAGE_KEY, chatModel);
    } catch {
      /* ignore */
    }
  }, [chatModel]);

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
          if (response.ok) {
            try {
              const body = (await response.json()) as { edgar_identity_configured?: boolean };
              setEdgarIdentityOk(Boolean(body.edgar_identity_configured));
            } catch {
              setEdgarIdentityOk(null);
            }
          } else {
            setEdgarIdentityOk(null);
          }
        }
      } catch {
        if (!cancelled) {
          setHealthStatus("offline");
          setEdgarIdentityOk(null);
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
      let msg = "Unable to load filing.";
      try {
        const errBody = (await response.json()) as { detail?: unknown };
        if (errBody.detail !== undefined) {
          msg =
            typeof errBody.detail === "string"
              ? errBody.detail
              : JSON.stringify(errBody.detail);
        }
      } catch {
        /* keep default */
      }
      throw new Error(msg);
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
    const sp = getEffectiveSystemPromptForRequest();
    const payload = {
      ticker: filingKey.ticker,
      year: filingKey.year,
      form_type: filingKey.formType,
      question: prompt,
      current_context: documentText,
      selected_text: selectedText,
      llm_model: chatModel,
      current_context_max_chars: currentContextMax,
      additional_context_max_chars: additionalContextMax,
      ...(sp ? { system_prompt: sp } : {})
    };
    setIsAsking(true);
    try {
      const response = await fetch(`${apiBase}${apiPrefix}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        let msg = "Chat request failed.";
        try {
          const errBody = (await response.json()) as { detail?: unknown };
          if (errBody.detail !== undefined) {
            msg =
              typeof errBody.detail === "string"
                ? errBody.detail
                : JSON.stringify(errBody.detail);
          }
        } catch {
          /* keep default */
        }
        throw new Error(msg);
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
      <header className="z-50 flex shrink-0 items-center justify-between gap-3 border-b border-violet-100/80 bg-white/85 px-3 py-2 shadow-sm shadow-violet-950/5 backdrop-blur-md sm:px-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h1 className="text-base font-semibold leading-tight text-violet-950 sm:text-lg">SEC Copilot</h1>
            {isCachedFiling && (
              <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[0.65rem] font-medium text-violet-900/85 ring-1 ring-violet-200/80">
                cached
              </span>
            )}
            <span
              className={`rounded px-1.5 py-0.5 text-[0.65rem] font-medium ring-1 ${
                healthStatus === "online"
                  ? edgarIdentityOk === false
                    ? "bg-amber-50 text-amber-900 ring-amber-200"
                    : "bg-emerald-50 text-emerald-800 ring-emerald-200"
                  : healthStatus === "offline"
                    ? "bg-rose-50 text-rose-800 ring-rose-200"
                    : "bg-slate-100 text-slate-700 ring-slate-200"
              }`}
              title={
                healthStatus === "offline"
                  ? "Copilot API unreachable (Python serverless). Check deployment logs — not necessarily sec.gov."
                  : healthStatus === "checking"
                    ? "Checking Copilot API health…"
                    : edgarIdentityOk === false
                      ? "Set EDGAR_IDENTITY in Vercel (SEC-required User-Agent). Example: Your Name your@email.com"
                      : "Copilot API is up; filings load from SEC EDGAR via edgartools."
              }
            >
              {healthStatus === "online"
                ? edgarIdentityOk === false
                  ? "Copilot API online · EDGAR_IDENTITY missing"
                  : "Copilot API online"
                : healthStatus === "offline"
                  ? "Copilot API offline"
                  : "checking Copilot API"}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[0.7rem] leading-snug text-slate-600">
            <span className="hidden min-[380px]:inline">Session-aware filing research with comparison-ready Q&A.</span>
            <span className="min-[380px]:hidden">SEC filing research & Q&A</span>
            <span className="text-slate-300" aria-hidden>
              ·
            </span>
            <Link
              href="/admin"
              className="inline-flex shrink-0 items-center gap-1 font-medium text-violet-700 hover:text-violet-900"
            >
              <Settings className="h-3 w-3 shrink-0" aria-hidden />
              Admin
            </Link>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-end sm:gap-3">
          <LlmModelPicker value={chatModel} onChange={setChatModel} />
          <TickerSwitcher initial={filingKey} isLoading={isSwitchingTicker} onSwitch={onSwitchTicker} />
        </div>
      </header>
      {sessionSavedMessage && (
        <div className="shrink-0 border-b border-emerald-100 bg-emerald-50/95 px-3 py-1.5 text-xs text-emerald-900 sm:px-4">
          {sessionSavedMessage}
        </div>
      )}
      {errorMessage && errorScope === "ticker" && (
        <div className="shrink-0 border-b border-rose-100 bg-rose-50/95 px-3 py-2 text-xs text-rose-900 sm:px-4 sm:text-sm">
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
          className="absolute inset-0 flex min-h-0 flex-col gap-2 p-3 transition-[padding-right] duration-300 sm:p-4"
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
                contextSettings={{
                  currentContextMax,
                  additionalContextMax,
                  onCurrentContextMaxChange: setCurrentContextMax,
                  onAdditionalContextMaxChange: setAdditionalContextMax
                }}
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
