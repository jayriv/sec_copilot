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

/** One open-courseware passage sent with a question (mirrors server CoursewareCitation). */
export type CoursewareCitation = {
  id: string;
  /** e.g. "BAP, Ch. 5, pp. 205-206" */
  citation: string;
  headingPath: string;
  sourceId: string;
  lens: string[];
  score: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sourceQuote?: string;
  /** Course material consulted for this answer. */
  citations?: CoursewareCitation[];
  /** Lens labels whose guidance shaped the answer, e.g. ["Financial statement analysis"]. */
  lenses?: string[];
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
