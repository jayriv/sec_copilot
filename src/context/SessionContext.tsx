import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ChatMessage, FilingAnchor, FilingKey, Highlight, StoredSession } from "@/lib/types";
import { loadLastActiveFilingKey, loadRecents, loadSession, saveSession } from "@/lib/storage";

const defaultKey: FilingKey = { ticker: "CHGG", year: "2026", formType: "10-K" };

type SessionContextValue = {
  filingKey: FilingKey;
  messages: ChatMessage[];
  highlights: Highlight[];
  selectedText: string;
  documentText: string;
  documentHtml: string;
  documentAnchors: FilingAnchor[];
  documentHtmlPartial: boolean;
  setSelectedText: (value: string) => void;
  setDocumentText: (value: string) => void;
  addMessage: (message: ChatMessage) => void;
  addHighlight: (text: string) => void;
  switchTicker: (
    next: FilingKey,
    newDocText?: string,
    newDocHtml?: string,
    filingMeta?: { anchors?: FilingAnchor[]; htmlPartial?: boolean }
  ) => void;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

const createEmptySession = (filingKey: FilingKey, documentText = "", documentHtml = ""): StoredSession => ({
  filingKey,
  messages: [],
  highlights: [],
  documentText,
  documentHtml,
  documentAnchors: [],
  documentHtmlPartial: false,
  selectedText: "",
  updatedAt: Date.now()
});

const normalizeSession = (raw: StoredSession): StoredSession => ({
  ...raw,
  documentHtml: raw.documentHtml ?? "",
  documentHtmlPartial: raw.documentHtmlPartial ?? false,
  documentAnchors: raw.documentAnchors ?? []
});

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<StoredSession>(createEmptySession(defaultKey));

  useEffect(() => {
    const key = loadLastActiveFilingKey() ?? loadRecents()[0] ?? defaultKey;
    const existing = loadSession(key);
    if (existing) {
      setSession(normalizeSession(existing));
    } else {
      setSession(createEmptySession(key));
    }
  }, []);

  const persist = (next: StoredSession) => {
    setSession(next);
    saveSession(next);
  };

  const switchTicker = useCallback(
    (
      nextKey: FilingKey,
      newDocText = "",
      newDocHtml = "",
      filingMeta?: { anchors?: FilingAnchor[]; htmlPartial?: boolean }
    ) => {
      saveSession({ ...session, updatedAt: Date.now() });
      const loaded = loadSession(nextKey);
      const base = loaded ? normalizeSession(loaded) : createEmptySession(nextKey, "", "");
      const nextSession: StoredSession = {
        ...base,
        filingKey: nextKey,
        ...(newDocText
          ? {
              documentText: newDocText,
              documentHtml: newDocHtml ?? "",
              documentAnchors: filingMeta?.anchors ?? [],
              documentHtmlPartial: filingMeta?.htmlPartial ?? false
            }
          : {}),
        selectedText: "",
        updatedAt: Date.now()
      };
      persist(nextSession);
    },
    [session]
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      filingKey: session.filingKey,
      messages: session.messages,
      highlights: session.highlights,
      selectedText: session.selectedText,
      documentText: session.documentText,
      documentHtml: session.documentHtml ?? "",
      documentAnchors: session.documentAnchors ?? [],
      documentHtmlPartial: session.documentHtmlPartial ?? false,
      setSelectedText: (selectedText) => persist({ ...session, selectedText, updatedAt: Date.now() }),
      setDocumentText: (documentText) => persist({ ...session, documentText, updatedAt: Date.now() }),
      addMessage: (message) =>
        persist({
          ...session,
          messages: [...session.messages, message],
          updatedAt: Date.now()
        }),
      addHighlight: (text) =>
        persist({
          ...session,
          highlights: [...session.highlights, { id: crypto.randomUUID(), text, createdAt: Date.now() }],
          updatedAt: Date.now()
        }),
      switchTicker
    }),
    [session, switchTicker]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
};
