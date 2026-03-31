import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { ChatMessage, FilingKey, Highlight, StoredSession } from "@/lib/types";
import { loadSession, saveSession } from "@/lib/storage";

const defaultKey: FilingKey = { ticker: "CHGG", year: "2026", formType: "10-K" };

type SessionContextValue = {
  filingKey: FilingKey;
  messages: ChatMessage[];
  highlights: Highlight[];
  selectedText: string;
  documentText: string;
  documentHtml: string;
  setSelectedText: (value: string) => void;
  setDocumentText: (value: string) => void;
  addMessage: (message: ChatMessage) => void;
  addHighlight: (text: string) => void;
  switchTicker: (next: FilingKey, newDocText?: string, newDocHtml?: string) => void;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

const createEmptySession = (filingKey: FilingKey, documentText = "", documentHtml = ""): StoredSession => ({
  filingKey,
  messages: [],
  highlights: [],
  documentText,
  documentHtml,
  selectedText: "",
  updatedAt: Date.now()
});

const normalizeSession = (raw: StoredSession): StoredSession => ({
  ...raw,
  documentHtml: raw.documentHtml ?? ""
});

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<StoredSession>(createEmptySession(defaultKey));

  useEffect(() => {
    const existing = loadSession(defaultKey);
    if (existing) setSession(normalizeSession(existing));
  }, []);

  const persist = (next: StoredSession) => {
    setSession(next);
    saveSession(next);
  };

  const switchTicker = (nextKey: FilingKey, newDocText = "", newDocHtml = "") => {
    saveSession({ ...session, updatedAt: Date.now() });
    const loaded = loadSession(nextKey);
    const base = loaded ? normalizeSession(loaded) : createEmptySession(nextKey, "", "");
    const nextSession: StoredSession = {
      ...base,
      filingKey: nextKey,
      ...(newDocText
        ? { documentText: newDocText, documentHtml: newDocHtml }
        : {}),
      selectedText: "",
      updatedAt: Date.now()
    };
    persist(nextSession);
  };

  const value = useMemo<SessionContextValue>(
    () => ({
      filingKey: session.filingKey,
      messages: session.messages,
      highlights: session.highlights,
      selectedText: session.selectedText,
      documentText: session.documentText,
      documentHtml: session.documentHtml ?? "",
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
    [session]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
};
