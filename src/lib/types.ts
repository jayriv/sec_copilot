export type FilingKey = {
  ticker: string;
  year: string;
  formType: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sourceQuote?: string;
};

export type Highlight = {
  id: string;
  text: string;
  createdAt: number;
};

export type StoredSession = {
  filingKey: FilingKey;
  messages: ChatMessage[];
  highlights: Highlight[];
  documentText: string;
  /** Sanitized HTML from SEC filing when available (display); plain text remains in documentText for LLM. */
  documentHtml: string;
  selectedText: string;
  updatedAt: number;
};
