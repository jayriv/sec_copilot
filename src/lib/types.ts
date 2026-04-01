export type FilingKey = {
  ticker: string;
  year: string;
  formType: string;
};

/** Jump targets for the filing reader (mirrors server FilingAnchorModel). */
export type FilingAnchor = {
  id: string;
  label: string;
  level: number;
  source: "toc" | "heading" | "target" | "item";
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sourceQuote?: string;
  /** User message created from filing selection (styled in thread order). */
  kind?: "selection" | "chat";
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
  /** When the API sent a partial HTML head, TOC still comes from the full parse on the server. */
  documentHtmlPartial?: boolean;
  documentAnchors?: FilingAnchor[];
  selectedText: string;
  updatedAt: number;
};
